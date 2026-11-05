// Cel shading for SKINNED meshes (lane A, R03): the same look as CelShader.ts (anti-aliased light
// bands, received shadow, hemisphere ambient, rim, metal-only specular, #172128 ink hull of 0.035 m), but the vertex stage runs
// three.js's skinning chunks so a THREE.SkinnedMesh deforms with its bones. three.js turns
// USE_SKINNING on by itself for a SkinnedMesh (WebGLPrograms: `skinning: object.isSkinnedMesh`)
// and declares skinIndex/skinWeight; the shader only has to include the chunks.
//
// Vertex colours (lane B's paintVertices: LINEAR RGB per vertex, attribute `color`) multiply
// the base colour when the material is built with `vertexColors: true`: three.js then emits
// `#define USE_COLOR` and declares `attribute vec3 color;` itself (WebGLProgram, non-raw
// ShaderMaterial prefix), so the shader never redeclares it and reads it only under
// #ifdef USE_COLOR into the varying vPaint (1 when unpainted). Painted skin uses a WHITE base
// colour so the paint carries the colour — the same 4 edits lane B specifies for CelShader.ts.

// @deno-types="@types/three"
import * as THREE from "three";
import { CEL_LIGHT_GLSL, celUniforms } from "./CelShader.ts";
import { INK_BASE_WIDTH, INK_GLSL } from "./Ink.ts";
import { CEL_MATERIAL_GLSL, CHANNEL_VIEW_GLSL, DECAL_GLSL, DETAIL_GLSL, DETAIL_NORMAL_SHARE, RELIEF_ALBEDO_GAIN } from "./CelMaterial.ts";
import { DECAL_FLOATS, DETAIL_MATERIALS, DETAIL_PER_MATERIAL, EDGE_CREST } from "./MaterialChannels.ts";

/** Ink colour and the DEFAULT hull base width of the outline, identical to CelShader.createCelMesh. */
export const CEL_INK = "#172128";
export const CEL_OUTLINE_WIDTH = INK_BASE_WIDTH;

const skinnedCelVertex = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform vec3 lightDirection;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vPaint;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  #ifdef USE_BODY_DETAIL
    attribute vec2 aSurface;  // x = garment (1) / skin (0), y = the trunk (abs allowed)
    varying vec3 vBind;       // BIND-pose model position: the detail sticks to the skin as it deforms
    varying vec3 vBindN;
    varying vec2 vSurf;
  #endif
  #ifdef USE_WAVE_TEX
    attribute vec4 aMaterial; // wave TEX: roughness, height (m), ao, subsurface (MaterialChannels.ts)
    varying vec4 vMat;
    #ifndef USE_BODY_DETAIL
      varying vec3 vBind;
      varying vec3 vBindN;
    #endif
    #ifdef USE_WAVE_TEX_EMISSIVE
      attribute vec3 aEmissive;
      varying vec3 vEmis;
    #endif
    #ifdef USE_WAVE_TEX_DETAILS
      attribute vec4 aDetailW;  // one-hot material weights of P's relief details (MaterialChannels.packDetails)
      varying vec4 vDetailW;
    #endif
    #ifdef USE_WAVE_TEX_EDGE
      attribute float aEdge;    // fine edge-highlight weight (P's EDGE_CREST), re-thresholded per fragment
      varying float vEdge;
    #endif
  #endif
  void main() {
    #ifdef USE_WAVE_TEX
      vMat = aMaterial;
      #ifndef USE_BODY_DETAIL
        vBind = position;
        vBindN = normal;
      #endif
      #ifdef USE_WAVE_TEX_EMISSIVE
        vEmis = aEmissive;
      #endif
      #ifdef USE_WAVE_TEX_DETAILS
        vDetailW = aDetailW;
      #endif
      #ifdef USE_WAVE_TEX_EDGE
        vEdge = aEdge;
      #endif
    #endif
    #ifdef USE_COLOR
      vPaint = color;      // linear RGB from paintVertices; skinning never touches it
    #else
      vPaint = vec3(1.0);
    #endif
    #ifdef USE_BODY_DETAIL
      vBind = position;
      vBindN = normal;
      vSurf = aSurface;
    #endif
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    viewNormal = normalize(normalMatrix * objectNormal);
    viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorld = world.xyz;
    vWorldN = normalize(mat3(modelMatrix) * objectNormal);
    vec4 mv = viewMatrix * world;
    viewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

// Wave X lane B: SURFACE DETAIL below the polygonising grid (2.2-3.5 cm cells cannot carry a six-pack,
// skin grain or a weave). A height field H (metres) is evaluated on the BIND-pose position (so it rides
// the skin through every pose) and turned into a perturbed normal with screen-space derivatives (three's
// bump-map construction). Under cel bands a bump only moves a band EDGE, so the detail's own lambert
// change is also applied to the albedo (DETAIL_GAIN): the six-pack and the grain read INSIDE a flat band.
// Every octave fades out as it nears the pixel size (fwidth of the bind position x its frequency), so a
// far body never shimmers.
//   abs     the rectus abdominis: two columns either side of the linea alba, cut into four segments by
//           three tendinous intersections (the lowest, below the navel, half height), on the trunk front.
//   skin    grain (~1.1 cm and ~3.8 mm value noise) + pores (~1.7 mm, sparse dimples) + mottling (colour, ~5 cm).
//   cloth   a twill (~4 mm diagonal ribs) + slubs (~2.5 cm), on the garment regions.
export const BODY_DETAIL_GLSL = /* glsl */ `
  uniform vec4 uAbs;        // yTop, yBottom, halfWidth, frontZ (model metres)
  uniform vec4 uDetailGain; // abs relief (m), skin grain (m), cloth weave (m), albedo gain
  varying vec3 vBind;
  varying vec3 vBindN;
  varying vec2 vSurf;
  float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // 1 while one period spans several pixels, 0 once it nears a pixel (no shimmer).
  float dFade(float freq, float px) { return 1.0 - smoothstep(0.25, 0.7, px * freq); }
  float absRelief(vec3 p, vec3 n) {
    float halfW = uAbs.z;
    if (halfW <= 0.0 || vSurf.y < 0.5) return 0.0;
    float u = abs(p.x) / halfW;
    float v = (p.y - uAbs.y) / max(1e-4, uAbs.x - uAbs.y);
    float inside = smoothstep(1.05, 0.8, u) * smoothstep(-0.04, 0.06, v) * smoothstep(1.06, 0.94, v)
                 * smoothstep(0.15, 0.55, n.z) * step(0.0, p.z);
    if (inside <= 0.0) return 0.0;
    // Segments: [0, 0.3] below the navel (softer), then three above, split by tendinous intersections
    // that sit a little higher on one side (real intersections are never a ruled grid).
    float vv = v + (p.x > 0.0 ? 0.018 : -0.012);
    float v0 = vv < 0.3 ? 0.0 : (vv < 0.54 ? 0.3 : (vv < 0.77 ? 0.54 : 0.77));
    float v1 = vv < 0.3 ? 0.3 : (vv < 0.54 ? 0.54 : (vv < 0.77 ? 0.77 : 1.0));
    float t = (vv - v0) / (v1 - v0);
    // Each belly a soft DOME (elliptical), widest in the upper rows, the lowest segment longer and flatter.
    float taper = mix(0.9, 1.0, clamp(v, 0.0, 1.0));
    float d = length(vec2((u - 0.53 * taper) / (0.44 * taper), (t - 0.52) / 0.56));
    float pad = smoothstep(1.0, 0.15, d) * (vv < 0.3 ? 0.5 : 1.0);
    float linea = 1.0 - smoothstep(0.03, 0.13, u);
    return inside * (pad - 0.35 * linea);
  }
  float bodyHeight(float px) {
    vec3 p = vBind;
    float h = uDetailGain.x * absRelief(p, normalize(vBindN));
    #ifndef USE_WAVE_TEX_DETAILS
    // (wave TEX closing, F: with P's material details the generic grain / twill gains are 0, so their four value
    // noises are skipped instead of being multiplied by 0 — the neutral compile keeps this code verbatim.)
    if (vSurf.x < 0.5) {
      h += uDetailGain.y * ((dNoise(p * 90.0) - 0.5) * dFade(90.0, px) + 0.45 * (dNoise(p * 260.0) - 0.5) * dFade(260.0, px));
      h -= uDetailGain.y * 0.6 * smoothstep(0.72, 0.92, dNoise(p * 600.0)) * dFade(600.0, px);
    } else {
      float twill = sin((p.x + p.y + 0.6 * p.z) * 1570.0);
      h += uDetailGain.z * (0.5 * twill * dFade(250.0, px) + (dNoise(p * 40.0) - 0.5) * 1.2);
    }
    #endif
    return h;
  }
`;

// Wave TEX (lane R, C-REND): the material channels (CelMaterial.ts). Declarations, then the main-body chunk that
// replaces the celShade call when USE_WAVE_TEX is defined. With neutral channels, no decal and the final view,
// every new term is skipped and the colour is celShade's expression x detailK (pixel-identical; RENDER.md).
const WAVE_TEX_FRAGMENT_DECL = /* glsl */ `
  varying vec4 vMat;
  #ifndef USE_BODY_DETAIL
    varying vec3 vBind;
    varying vec3 vBindN;
  #endif
  #ifdef USE_WAVE_TEX_EMISSIVE
    varying vec3 vEmis;
  #endif
  ${CEL_MATERIAL_GLSL}
  ${DECAL_GLSL}
  #ifdef USE_WAVE_TEX_DETAILS
    varying vec4 vDetailW;
    ${DETAIL_GLSL}
  #endif
  #ifdef USE_WAVE_TEX_EDGE
    varying float vEdge;
  #endif
  ${CHANNEL_VIEW_GLSL}
`;
const WAVE_TEX_FRAGMENT_MAIN = /* glsl */ `
    vec3 albedo = baseColor * vPaint;
    float rough = vMat.x;
    float marks = 0.0;
    vec3 markCol = vec3(0.0);
    float hDec = 0.0;
    vec3 nMat = n;
    #ifdef USE_WAVE_TEX_LIT
    // Derivatives first, in uniform control flow.
    vec3 wtDx = dFdx(vBind), wtDy = dFdy(vBind);
    float wtPx = length(abs(wtDx) + abs(wtDy));          // pixel footprint in bind metres (= fwidth)
    vec2 wtDHv = vec2(dFdx(vMat.y), dFdy(vMat.y));        // vertex height: per-triangle gradient per pixel
    vec3 wtVx = dFdx(viewPos), wtVy = dFdy(viewPos);
    vec3 wtPn = normalize(vBindN);
    #ifdef USE_WAVE_TEX_DETAILS
      // P's material relief (pores, weave, grain, hammered, strands, plates, studs): noise-like, so its screen
      // derivatives are taken directly (uniform control flow, before any branch of this main).
      vec2 hDet2 = detailRelief(vDetailW, vBind, wtPn, wtPx);
      float hDet = hDet2.x + hDet2.y;
      vec2 dHdet = vec2(dFdx(hDet2.x), dFdy(hDet2.x));   // fine: 30 % to the band normal
      vec2 dHcoarse = vec2(dFdx(hDet2.y), dFdy(hDet2.y)); // coarse (studs): a full bump
    #else
      float hDet = 0.0;
      vec2 dHdet = vec2(0.0);
      vec2 dHcoarse = vec2(0.0);
    #endif
    vec3 emis = vec3(0.0);
    #ifdef USE_WAVE_TEX_EMISSIVE
      emis = vEmis;
    #endif
    vec2 dHd = vec2(0.0);
    float wtSkin = 1.0;
    #ifdef USE_BODY_DETAIL
      wtSkin = 1.0 - smoothstep(0.35, 0.65, vSurf.x);    // garment vertices hide the marks (QD Z-37)
    #endif
    if (uDecalCount > 0.5) {
      float reliefHits = decalShade(vBind, wtPn, wtPx, wtSkin, albedo, rough, emis, marks, markCol);
      if (uDecalRelief > 0.5 && reliefHits > 0.0) {
        // Relief gradient by finite differences of the decal height field IN THE BIND FRAME, mapped to
        // per-pixel derivatives through the bind position's screen derivatives (no 2x2-quad steps on a thin scar).
        hDec = decalRelief(vBind, wtPn, wtPx, wtSkin);
        float e = max(wtPx * 0.5, 1.5e-4);
        vec3 t1 = normalize(cross(wtPn, abs(wtPn.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(wtPn, t1);
        vec3 gB = ((decalRelief(vBind + e * t1, wtPn, wtPx, wtSkin) - hDec) * t1 + (decalRelief(vBind + e * t2, wtPn, wtPx, wtSkin) - hDec) * t2) / e;
        dHd = vec2(dot(gB, wtDx), dot(gB, wtDy));
      }
    }
    #ifdef USE_WAVE_TEX_EDGE
      // The miniature's fine EDGE highlight (closing, F): P's per-vertex crest weight, interpolated over the 22-35 mm
      // triangles, re-thresholded per fragment into a lighter line along the ridge (lift toward white, linear). Applied
      // AFTER the decals so a ridge scar is lifted with the skin around it and stays paler (QD Z-157 / QA Z-159), but
      // held off tattoo ink (wtInkCov, relief-free decals), which it used to lift +23 L* (QA Z-147).
      albedo += (1.0 - albedo) * (smoothstep(${EDGE_CREST.onset.toFixed(2)}, ${EDGE_CREST.full.toFixed(2)}, vEdge) * ${EDGE_CREST.lift.toFixed(2)}) * (1.0 - wtInkCov);
    #endif
    vec2 wtDH = wtDHv + dHd + dHcoarse;
    hDec += hDet;
    float reliefK = 1.0;
    if (wtDH.x != 0.0 || wtDH.y != 0.0) {
      // Vertex height + decal relief (scars): three's perturbNormalArb, then the tilt bound (MaterialChannels.boundTilt).
      vec3 r1 = cross(wtVy, n), r2 = cross(n, wtVx);
      float det = dot(wtVx, r1);
      if (abs(det) > 1e-12) {
        vec3 grad = sign(det) * (wtDH.x * r1 + wtDH.y * r2);
        nMat = boundTilt(n, normalize(abs(det) * n - grad));
        reliefK = clamp(1.0 + ${RELIEF_ALBEDO_GAIN.toFixed(2)} * (dot(nMat, l) - dot(n, l)), 0.7, 1.3);
      }
    }
    if (dHdet.x != 0.0 || dHdet.y != 0.0) {
      // Material details (pores, studs, weave ...): high-frequency, so like the wave-X detail only 30 % reaches the
      // band normal (a full bump speckles the cel band edges) and the rest reads through the albedo (+-20 %).
      vec3 r1 = cross(wtVy, nMat), r2 = cross(nMat, wtVx);
      float det = dot(wtVx, r1);
      if (abs(det) > 1e-12) {
        vec3 nD = boundTilt(nMat, normalize(abs(det) * nMat - sign(det) * (dHdet.x * r1 + dHdet.y * r2)));
        reliefK *= clamp(1.0 + ${RELIEF_ALBEDO_GAIN.toFixed(2)} * (dot(nD, l) - dot(nMat, l)), 0.8, 1.2);
        nMat = normalize(mix(nMat, nD, ${DETAIL_NORMAL_SHARE.toFixed(2)}));
      }
    }
    vec3 c = celShadeMat(albedo, nMat, l, viewPos, vWorld, vWorldN, uSpecular, vec4(rough, vMat.y, vMat.z, vMat.w), emis);
    vec3 wtOut = c * detailK * reliefK;
    #else
    // Neutral channels and no decal (USE_WAVE_TEX_LIT off, decided on the CPU): the pre-TEX statement, verbatim.
    vec3 c = celShade(baseColor * vPaint, n, l, viewPos, vWorld, vWorldN, uSpecular);
    vec3 wtOut = c * detailK;
    #endif
    if (uChannelView > 0.5) {
      int cv = int(uChannelView + 0.5);
      vec3 dbg = albedo;
      if (cv == 2) dbg = vec3(wtLin(clamp(rough, 0.0, 1.0)));
      else if (cv == 3) dbg = vec3(wtLin(clamp(0.5 + (vMat.y + hDec) / (2.0 * WT_HEIGHT_VIEW), 0.0, 1.0)));
      else if (cv == 4) dbg = wtLin3(nMat * 0.5 + 0.5);
      else if (cv == 5) dbg = vec3(wtLin(clamp(vMat.z, 0.0, 1.0)));
      else if (cv == 6) dbg = mix(vec3(wtLin(0.82)), markCol, marks);
      wtOut = dbg;
    }
    gl_FragColor = vec4(wtOut, 1.0);
`;

// The shared CelShader lighting (bands, received shadow, hemisphere ambient, rim, metal specular).
const skinnedCelFragment = /* glsl */ `
  #include <packing>
  uniform vec3 baseColor;
  uniform float uSpecular;
  ${CEL_LIGHT_GLSL}
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vPaint;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  #ifdef USE_BODY_DETAIL
  ${BODY_DETAIL_GLSL}
  #endif
  #ifdef USE_WAVE_TEX
  ${WAVE_TEX_FRAGMENT_DECL}
  #endif
  void main() {
    vec3 n = normalize(viewNormal);
    vec3 l = normalize(viewLight);
    float detailK = 1.0;
    #ifdef USE_BODY_DETAIL
      // Pixel footprint in bind metres, then the bump (three's perturbNormalArb on a procedural height).
      float px = length(fwidth(vBind));
      float H = bodyHeight(px);
      vec3 dpx = dFdx(viewPos), dpy = dFdy(viewPos);
      vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
      float det = dot(dpx, r1);
      vec2 dH = vec2(dFdx(H), dFdy(H)); // in uniform control flow (never inside the branch below)
      if (abs(det) > 1e-12) {
        vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
        vec3 nb = normalize(abs(det) * n - grad);
        detailK = clamp(1.0 + uDetailGain.w * (dot(nb, l) - dot(n, l)), 0.62, 1.38);
        n = normalize(mix(n, nb, 0.3)); // the bands see a little of the bump (the albedo term carries the rest)
      }
      // Mottling: a slow colour variation of bare skin (cloth keeps its own weave paint).
      if (vSurf.x < 0.5) detailK *= 1.0 + 0.07 * (dNoise(vBind * 18.0) - 0.5);
    #endif
    #ifdef USE_WAVE_TEX
    ${WAVE_TEX_FRAGMENT_MAIN}
    #else
    vec3 c = celShade(baseColor * vPaint, n, l, viewPos, vWorld, vWorldN, uSpecular);
    gl_FragColor = vec4(c * detailK, 1.0);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Inverted hull: push the SKINNED position out along the SKINNED normal in view space, by the
// VARIABLE ink mark (lane P-A) — the Ink.ts law runs here with its constants on the shared cel
// uniforms, so a lit, camera-facing surface collapses the hull to zero and a silhouette edge is
// fully marked. `outlineWidth` is the per-mesh base width.
const skinnedOutlineVertex = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  uniform float outlineWidth;
  uniform vec3 lightDirection;
  uniform float uIsFace;
  uniform float uMaterialInk;
  ${INK_GLSL}
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
    vec3 n = normalize(normalMatrix * objectNormal);
    vec3 lightView = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    float strength = inkStrength(n, lightView, viewPosition.xyz, uIsFace, uMaterialInk);
    float w = inkWidth(strength, outlineWidth, 1.0);
    viewPosition.xyz += n * w;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const outlineFragment = /* glsl */ `
  uniform vec3 inkColor;
  void main() {
    gl_FragColor = vec4(inkColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Options of the skinned cel materials. */
export interface CelSkinnedOptions {
  /** Metal-only specular strength (0 for flesh/cloth, CelShader.SPECULAR_METAL for metal). */
  specular?: number;
  /**
   * Multiply the base colour by the geometry's `color` attribute (painted skin). Defaults
   * to `geometry.hasAttribute("color")` in createCelSkinnedMesh.
   */
  vertexColors?: boolean;
  /** Hull base width in metres (default CEL_OUTLINE_WIDTH). The mark is capped at Ink.INK_MAX_WIDTH. */
  outlineWidth?: number;
  /** True on face geometry: the ink law suppresses the mark on a front-facing face. */
  isFace?: boolean;
  /** Per-mesh ink multiplier in [0, 1] (0 mutes the outline). */
  materialInk?: number;
  /**
   * Wave X lane B: the sub-grid surface detail (abs, skin grain/pores, cloth weave). Needs the geometry's
   * `aSurface` attribute (vec2: garment, trunk). Off by default: every other skinned mesh is unchanged.
   */
  detail?: boolean;
  /**
   * Wave TEX (lane R): the layered material channels — geometry attribute `aMaterial` (vec4 roughness, height,
   * ao, subsurface), optional `aEmissive` (vec3), the fragment decal block and the channel debug view
   * (MaterialChannels.ts). `true` or `{ emissive }`. Off by default: every other skinned mesh is unchanged.
   */
  material?: boolean | { emissive?: boolean; lit?: boolean; details?: boolean; edge?: boolean };
}

/** Default detail gains: abs relief (m), skin grain (m), cloth weave (m), albedo gain of the bump's lambert change. */
export const BODY_DETAIL_GAIN = { abs: 0.0075, skin: 0.0005, cloth: 0.00035, albedo: 1.1 } as const;

/** The cel surface material for a SkinnedMesh (uniforms shared with CelShader's lighting). */
export function createCelSkinnedSurfaceMaterial(color: THREE.ColorRepresentation, opts: CelSkinnedOptions = {}): THREE.ShaderMaterial {
  const g = BODY_DETAIL_GAIN;
  const mat = new THREE.ShaderMaterial({
    uniforms: celUniforms({
      baseColor: { value: new THREE.Color(color) }, uSpecular: { value: opts.specular ?? 0 },
      // Per-material (never shared): each rig writes its own abs band (SkinnedHumanoid, from plan.physique).
      uAbs: { value: new THREE.Vector4(0, 0, 0, 0) },
      uDetailGain: { value: new THREE.Vector4(g.abs, g.skin, g.cloth, g.albedo) },
      ...(opts.material ? materialUniforms() : {}),
    }),
    defines: {
      ...(opts.detail ? { USE_BODY_DETAIL: "" } : {}),
      ...(opts.material ? { USE_WAVE_TEX: "" } : {}),
      ...(typeof opts.material === "object" && opts.material.emissive ? { USE_WAVE_TEX_EMISSIVE: "" } : {}),
      ...(typeof opts.material === "object" && (opts.material.lit || opts.material.emissive || opts.material.details || opts.material.edge) ? { USE_WAVE_TEX_LIT: "" } : {}),
      ...(typeof opts.material === "object" && opts.material.details ? { USE_WAVE_TEX_DETAILS: "" } : {}),
      ...(typeof opts.material === "object" && opts.material.edge ? { USE_WAVE_TEX_EDGE: "" } : {}),
    },
    vertexShader: skinnedCelVertex,
    fragmentShader: skinnedCelFragment,
    side: THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
  });
  // Wave TEX: whether the VERTEX channels are neutral (MaterialRender.setDecals keeps USE_WAVE_TEX_LIT on for
  // off-neutral vertex channels even with no decal).
  if (typeof opts.material === "object" && (opts.material.lit || opts.material.emissive || opts.material.details || opts.material.edge)) mat.userData.wtVertexNeutral = false;
  return mat;
}

/**
 * Wave TEX: the per-material uniforms of the material channels (never shared between rigs). uDecals is a flat
 * Float32Array of DECAL_FLOATS (three uploads a numeric array as-is); write it IN PLACE (setDecals in
 * SkinnedHumanoid / MaterialRender.ts) so occlusion fade variants that share the uniform objects follow.
 */
export function materialUniforms(): Record<string, THREE.IUniform> {
  return {
    uDecals: { value: new Float32Array(DECAL_FLOATS) },
    uDecalCount: { value: 0 },
    uDecalRelief: { value: 0 },
    uGlyphAtlas: { value: null },
    uChannelView: { value: 0 },
    uMatDetail: { value: new Float32Array(DETAIL_MATERIALS * DETAIL_PER_MATERIAL * 4) },
  };
}

/** The inverted-hull outline material for a SkinnedMesh. */
export function createCelSkinnedOutlineMaterial(opts: CelSkinnedOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: celUniforms({
      inkColor: { value: new THREE.Color(CEL_INK) },
      outlineWidth: { value: opts.outlineWidth ?? CEL_OUTLINE_WIDTH },
      uIsFace: { value: opts.isFace ? 1 : 0 },
      uMaterialInk: { value: opts.materialInk ?? 1 },
    }),
    vertexShader: skinnedOutlineVertex,
    fragmentShader: outlineFragment,
    side: THREE.BackSide,
  });
}

/** A skinned cel body: the surface and its hull share one geometry and one THREE.Skeleton. */
export interface CelSkinnedMesh {
  group: THREE.Group;
  surface: THREE.SkinnedMesh;
  outline: THREE.SkinnedMesh;
}

/**
 * Build the cel surface + ink hull as two SkinnedMeshes over `geometry` (which must carry
 * skinIndex/skinWeight), both bound to `skeleton` with the identity bind matrix (the
 * geometry is authored in the skeleton root's space). When the geometry carries a `color`
 * attribute the surface is painted (white base × vertex colour); `color` is used otherwise. The meshes skip frustum culling: the
 * bind-pose bounding sphere does not follow the bones.
 */
export function createCelSkinnedMesh(
  geometry: THREE.BufferGeometry,
  skeleton: THREE.Skeleton,
  color: THREE.ColorRepresentation,
  opts: CelSkinnedOptions = {},
): CelSkinnedMesh {
  const painted = opts.vertexColors ?? geometry.hasAttribute("color");
  // Painted skin: white base so the paint carries the colour; unpainted: the palette colour.
  const surface = new THREE.SkinnedMesh(geometry, createCelSkinnedSurfaceMaterial(painted ? "#ffffff" : color, { ...opts, vertexColors: painted }));
  surface.name = "cel-surface";
  const outline = new THREE.SkinnedMesh(geometry, createCelSkinnedOutlineMaterial(opts));
  outline.name = "cel-outline";
  for (const m of [surface, outline]) {
    m.frustumCulled = false;
    m.bind(skeleton, new THREE.Matrix4());
  }
  const group = new THREE.Group();
  group.name = "cel-skinned";
  group.add(surface, outline);
  return { group, surface, outline };
}

/** The GLSL sources, exported so a test can assert the skinning chunks are present. */
export const CEL_SKINNED_SHADERS = {
  surfaceVertex: skinnedCelVertex,
  surfaceFragment: skinnedCelFragment,
  outlineVertex: skinnedOutlineVertex,
  outlineFragment,
} as const;
