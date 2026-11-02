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
  void main() {
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
    if (vSurf.x < 0.5) {
      h += uDetailGain.y * ((dNoise(p * 90.0) - 0.5) * dFade(90.0, px) + 0.45 * (dNoise(p * 260.0) - 0.5) * dFade(260.0, px));
      h -= uDetailGain.y * 0.6 * smoothstep(0.72, 0.92, dNoise(p * 600.0)) * dFade(600.0, px);
    } else {
      float twill = sin((p.x + p.y + 0.6 * p.z) * 1570.0);
      h += uDetailGain.z * (0.5 * twill * dFade(250.0, px) + (dNoise(p * 40.0) - 0.5) * 1.2);
    }
    return h;
  }
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
    vec3 c = celShade(baseColor * vPaint, n, l, viewPos, vWorld, vWorldN, uSpecular);
    gl_FragColor = vec4(c * detailK, 1.0);
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
}

/** Default detail gains: abs relief (m), skin grain (m), cloth weave (m), albedo gain of the bump's lambert change. */
export const BODY_DETAIL_GAIN = { abs: 0.0075, skin: 0.0005, cloth: 0.00035, albedo: 1.1 } as const;

/** The cel surface material for a SkinnedMesh (uniforms shared with CelShader's lighting). */
export function createCelSkinnedSurfaceMaterial(color: THREE.ColorRepresentation, opts: CelSkinnedOptions = {}): THREE.ShaderMaterial {
  const g = BODY_DETAIL_GAIN;
  return new THREE.ShaderMaterial({
    uniforms: celUniforms({
      baseColor: { value: new THREE.Color(color) }, uSpecular: { value: opts.specular ?? 0 },
      // Per-material (never shared): each rig writes its own abs band (SkinnedHumanoid, from plan.physique).
      uAbs: { value: new THREE.Vector4(0, 0, 0, 0) },
      uDetailGain: { value: new THREE.Vector4(g.abs, g.skin, g.cloth, g.albedo) },
    }),
    defines: opts.detail ? { USE_BODY_DETAIL: "" } : {},
    vertexShader: skinnedCelVertex,
    fragmentShader: skinnedCelFragment,
    side: THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
  });
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
