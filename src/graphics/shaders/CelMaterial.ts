// Wave TEX (lane R, contract C-REND): the GLSL of the layered material channels for the cel shaders.
// Opt-in per material by `#define USE_WAVE_TEX` (CelSkinned.createCelSkinnedSurfaceMaterial `material`), so
// every other cel surface compiles exactly as before. Three pieces:
//
//   celShadeMat()  celShade (CelShader.ts) plus the new channels. Its NEUTRAL path is celShade's own
//                  expression, evaluated unchanged; every new term sits behind a dead-zone test
//                  (MaterialChannels.DEAD_ZONE), so neutral channels give byte-identical pixels.
//       roughness  r < 0.5 (glossy): a cel specular BAND (threshold on a Phong lobe whose exponent and band
//                  softness follow the gloss g = 2 (0.5 - r): wide + soft at g -> 0, tight + crisp at g = 1)
//                  and a wider rim; r > 0.5 (matte): the rim fades (to 40 % at r = 1); 0.5 = the old look.
//       ao         multiplies the LIT term (ambient + key band + rim + specular + fill), not emissive.
//       subsurface a warm wrap at the terminator (n.l in [-0.35, 0.3], peak at 0), colour SSS_TINT x light.
//       emissive   linear RGB added after lighting.
//   DECAL_GLSL     the fragment decal list (MaterialChannels.packDecals layout), evaluated from the BIND-pose
//                  position: albedo (normal-over), roughness (lerp), relief (bind-frame finite differences),
//                  emissive and the `marks` coverage for the debug view.
//   bounded normal the height channel (vertex aMaterial.y + decal relief) perturbs the normal through
//                  perturbNormalArb on screen derivatives, then boundTilt clamps the tilt at MAX_TILT so a
//                  relief moves a fragment across at most one cel band (MaterialChannels.boundTilt proof).

import {
  DEAD_ZONE, DECAL_MAX, DECAL_VEC4, DETAIL_MATERIALS, DETAIL_PER_MATERIAL, HEIGHT_VIEW_RANGE, MAX_TILT, RELIEF_SHOULDER, RELIEF_SHOULDER_MAX, STROKES_MAX,
} from "./MaterialChannels.ts";
import { CEL_BAND_EDGES, CEL_BAND_WEIGHTS } from "./CelShader.ts";
import { GLYPH_ATLAS_COLS, GLYPH_CELL_PX, GLYPH_DIST_MAX, GLYPH_EXTENT } from "../textures/GlyphAtlas.ts";

const f = (x: number) => {
  const s = String(x);
  return s.includes(".") || s.includes("e") ? s : s + ".0";
};

/** Warm subsurface tint (linear), the colour of blood under thin skin. */
export const SSS_TINT = [1.0, 0.42, 0.28] as const;
/** Strength of the subsurface wrap at subsurface = 1 (fraction of base x light). */
export const SSS_GAIN = 0.35;
/** Gloss specular band peak (fraction of the light colour) at roughness 0. */
export const GLOSS_SPEC_GAIN = 0.3;
/** Dotwork drawn as dots only while a dot pitch spans >= this many pixels; below, as a continuous tone. */
export const DOT_TONE_PX = 2.5;
/** Ink of the dotwork tone (QD Z-84: >= 60 % of the stroke's pixels must read). */
export const DOT_TONE_INK = 0.75;
/** Detail period (mm) from which a feature is a full bump (studs) rather than a fine texture (pores, grain). */
export const DETAIL_COARSE_MM = 20;
/** Share of a material DETAIL's bump that reaches the band normal (the rest reads through the albedo), as wave X. */
export const DETAIL_NORMAL_SHARE = 0.3;
/** Albedo gain of the material relief's lambert change (pitfall: under cel bands a bump only moves band edges). */
export const RELIEF_ALBEDO_GAIN = 0.9;

/**
 * celShadeMat(base, n, l, viewPos, world, worldN, specular, m, emissive): m = (roughness, height, ao, subsurface).
 * Needs CEL_LIGHT_GLSL (CelShader.ts) before it.
 */
export const CEL_MATERIAL_GLSL = /* glsl */ `
vec3 celShadeMat(vec3 base, vec3 n, vec3 l, vec3 viewPos, vec3 world, vec3 worldN, float specular, vec4 m, vec3 emissive) {
  float ao = m.z;
  bool aoOn = ao < ${f(DEAD_ZONE.ao)};
  float dr = m.x - 0.5;
  bool roughOn = abs(dr) >= ${f(DEAD_ZONE.roughness)};
  bool sssOn = m.w >= ${f(DEAD_ZONE.subsurface)};
  bool emOn = max(max(abs(emissive.r), abs(emissive.g)), abs(emissive.b)) >= ${f(DEAD_ZONE.emissive)};
  float rw = max(fwidth(1.0 - max(n.z, 0.0)), 0.01);  // rim edge AA width (derivative in uniform flow)
  float wN = fwidth(max(dot(n, l), 0.0));             // band AA: d(n.l) per pixel, taken in uniform flow too
  // Neutral channels: the pre-TEX colour by the pre-TEX function, returned ALONE. Any extra term on the same value
  // (even + 0.0) lets the GPU compiler re-associate / fuse celShade's arithmetic (fast math): a single function
  // that added guarded terms moved 8-9 pixels by 1/255 in Chrome/Metal (RENDER.md, identity).
  if (!(aoOn || roughOn || sssOn || emOn)) return celShade(base, n, l, viewPos, world, worldN, specular);
  // Off-neutral (wave TEX closing, agent F): celShade's terms evaluated ONCE here. The first version called celShade
  // and then looked the key's shadow up a SECOND time for the extra terms (9 more PCF taps per fragment: most of the
  // +1.3 ms of the 2-rig arena). Same law as celShade (CelShader.ts); the band AA width is fwidth(n.l) scaled by the
  // shadow term (fwidth(light) without the shadow edge: derivatives must stay in uniform flow).
  float ndl = max(dot(n, l), 0.0);
  float sh = celShadow(world, normalize(worldN));
  float light = ndl * mix(0.08, 1.0, sh);
  float w = max(wN * mix(0.08, 1.0, sh) * 0.75, 0.004);
  float band = ${CEL_BAND_WEIGHTS[0].toFixed(2)} * smoothstep(${CEL_BAND_EDGES[0].toFixed(2)} - w, ${CEL_BAND_EDGES[0].toFixed(2)} + w, light)
             + ${CEL_BAND_WEIGHTS[1].toFixed(2)} * smoothstep(${CEL_BAND_EDGES[1].toFixed(2)} - w, ${CEL_BAND_EDGES[1].toFixed(2)} + w, light);
  float hemi = clamp(normalize(worldN).y * 0.5 + 0.5, 0.0, 1.0);
  vec3 amb = ambientColor * 1.15 * mix(uGroundTint, uSkyTint, hemi);
  float rimEdge = 1.0 - max(n.z, 0.0);
  float rimShape = 0.55 + 0.45 * clamp(-l.z + 0.3, 0.0, 1.0);
  float rim0 = smoothstep(0.62 - rw, 0.62 + rw, rimEdge) * 0.2 * rimShape;
  vec3 view = normalize(-viewPos);
  float spec = 0.0;
  if (specular > 0.0) {
    float s = pow(max(dot(reflect(-l, n), view), 0.0), 22.0);
    spec = (smoothstep(0.42, 0.52, s) * 0.85 + s * 0.15) * specular * sh;
  }
  vec3 mr = mangaRamp(ndl);
  vec3 shadedBase = mix(base * mr.y, base, clamp(band / 0.62, 0.0, 1.0));
  float fillN = max(dot(normalize(worldN), uFillDir), 0.0);
  vec3 c = shadedBase * (amb + lightColor * band + rim0 * (lightColor * mix(0.4, 1.0, sh) + ambientColor)) + lightColor * spec + base * uFillColor * fillN;
  if (aoOn) c *= clamp(ao, 0.0, 1.0);           // ao multiplies the whole lit term (emissive is added later)
  float aoK = aoOn ? clamp(ao, 0.0, 1.0) : 1.0;
  if (roughOn || sssOn) {
    if (roughOn) {
      if (dr < 0.0) {
        // Glossy: a cel highlight band on a Phong lobe (wide + soft when barely glossy, tight + crisp at r = 0),
        // and a wider rim. Shadowed by the key's shadow like the metal band.
        float g = clamp(-dr * 2.0, 0.0, 1.0);
        float lobe = pow(max(dot(reflect(-l, n), view), 0.0), mix(6.0, 48.0, g));
        float soft = mix(0.2, 0.05, g);
        float sb = smoothstep(0.5 - soft, 0.5 + soft, lobe) * step(0.0, dot(n, l));
        c += lightColor * sb * g * ${f(GLOSS_SPEC_GAIN)} * sh * aoK;
        float rimG = smoothstep(0.5 - rw, 0.5 + rw, rimEdge) * 0.1 * g * rimShape;
        c += shadedBase * rimG * lightColor * mix(0.4, 1.0, sh) * aoK;
      } else {
        // Matte: the rim (a sheen) fades, to 40 % at r = 1.
        float mt = clamp(dr * 2.0, 0.0, 1.0);
        float rim = smoothstep(0.62 - rw, 0.62 + rw, rimEdge) * 0.2 * rimShape;
        c -= shadedBase * rim * (lightColor * mix(0.4, 1.0, sh) + ambientColor) * 0.6 * mt * aoK;
      }
    }
    if (sssOn) {
      // Subsurface: light bleeding past the terminator, warm (thin skin: ears, lips, nostrils).
      float nl = dot(n, l);
      float wrap = smoothstep(-0.35, 0.0, nl) * (1.0 - smoothstep(0.0, 0.3, nl));
      c += base * vec3(${SSS_TINT.map(f).join(", ")}) * lightColor * wrap * clamp(m.w, 0.0, 1.0) * ${f(SSS_GAIN)} * mix(0.35, 1.0, sh) * aoK;
    }
  }
  if (emOn) c += max(emissive, vec3(0.0));
  return c;
}
// Clamp the tilt of nb from n at MAX_TILT (mirror of MaterialChannels.boundTilt).
vec3 boundTilt(vec3 n, vec3 nb) {
  float c = dot(n, nb);
  const float cm = ${f(Math.cos(MAX_TILT))};
  if (c >= cm) return nb;
  vec3 t = nb - c * n;
  float tl = length(t);
  if (tl < 1e-6) t = normalize(cross(n, abs(n.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  else t /= tl;
  return n * cm + t * ${f(Math.sin(MAX_TILT))};
}
// Inverse of the sRGB output transfer: a debug value v lands on the screen as byte round(255 v).
float wtLin(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 wtLin3(vec3 v) { return vec3(wtLin(v.r), wtLin(v.g), wtLin(v.b)); }
`;

const N4 = DECAL_MAX * DECAL_VEC4;

/** Fragment decal list. Needs `vBind`, `vBindN` and highp (WebGL2 fragment shaders always have it). */
export const DECAL_GLSL = /* glsl */ `
uniform vec4 uDecals[${N4}];
uniform float uDecalCount;
uniform float uDecalRelief;   // 1 when any decal carries relief (finite-difference pass on)
uniform sampler2D uGlyphAtlas;
float wtHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float wtNoise(vec2 x) {
  vec2 i = floor(x), fr = fract(x);
  fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(wtHash(i), wtHash(i + vec2(1.0, 0.0)), fr.x), mix(wtHash(i + vec2(0.0, 1.0)), wtHash(i + vec2(1.0, 1.0)), fr.x), fr.y);
}
// Unsigned distance (glyph units) from glyph-frame point q to glyph g's strokes: ONE atlas fetch.
float glyphDist(float g, vec2 q) {
  float cx = mod(g, ${f(GLYPH_ATLAS_COLS)}), cy = floor(g / ${f(GLYPH_ATLAS_COLS)});
  const float h = ${f(0.5 / GLYPH_CELL_PX)};
  vec2 fr = clamp(q / ${f(2 * GLYPH_EXTENT)} + 0.5, h, 1.0 - h);
  float d = texture2D(uGlyphAtlas, (vec2(cx, cy) + fr) / ${f(GLYPH_ATLAS_COLS)}).r * ${f(GLYPH_DIST_MAX)};
  return max(d, length(max(abs(q) - ${f(GLYPH_EXTENT)}, 0.0)));
}
// Decal i's local coordinates at bind point p (normal pn): uv in metres on the decal plane (or arc-length
// on a wrapped limb), and a facing weight (0 = do not draw). False when p is outside the footprint.
bool decalFrame(int i, vec3 p, vec3 pn, out vec2 uv, out float face) {
  vec4 d0 = uDecals[i * ${DECAL_VEC4}];
  vec3 dd = p - d0.xyz;
  uv = vec2(0.0); face = 0.0;
  if (dot(dd, dd) > d0.w * d0.w) return false;
  vec3 t = uDecals[i * ${DECAL_VEC4} + 1].xyz;
  vec3 nn = uDecals[i * ${DECAL_VEC4} + 2].xyz;
  vec3 b = cross(nn, t);
  vec4 d6 = uDecals[i * ${DECAL_VEC4} + 6];
  float wr = d6.y;
  if (wr > 0.0) {
    // Wrapped on a limb of radius wr: arc-length coordinates about the limb axis (the tangent, or the
    // bitangent when wrapMode d6.z = 1), so a band closes round the arm and a glyph follows its curvature.
    bool aboutB = d6.z > 0.5;
    vec3 ax = aboutB ? b : t;
    vec3 q = dd + nn * wr;                       // from the limb's axis (centre - normal x radius)
    float along = dot(q, ax);
    vec3 rad = q - along * ax;
    float rl = length(rad);
    float arc = atan(dot(rad, aboutB ? t : b), dot(rad, nn)) * wr;
    uv = aboutB ? vec2(arc, along) : vec2(along, arc);
    face = rl > 1e-5 ? smoothstep(0.05, 0.35, dot(rad / rl, pn)) : 0.0;
  } else {
    uv = vec2(dot(dd, t), dot(dd, b));
    face = smoothstep(0.15, 0.45, dot(pn, nn)) * (1.0 - smoothstep(0.55, 1.0, abs(dot(dd, nn)) / max(d0.w, 1e-4)));
  }
  return face > 0.0;
}
// Signed distance (metres, < 0 inside) of decal i at uv. relief = true skips glyph kinds' extra work only.
float decalSdf(int i, vec2 uv, float px) {
  float L = uDecals[i * ${DECAL_VEC4} + 1].w, W = uDecals[i * ${DECAL_VEC4} + 2].w;
  vec4 d4 = uDecals[i * ${DECAL_VEC4} + 4];
  float sp = uDecals[i * ${DECAL_VEC4} + 6].x;
  int kind = int(d4.x + 0.5);
  float seed = d4.w;
  if (kind <= 1) {
    // line / stitched: spindle strokes (count parallel ones, claw marks), optional waviness by seed.
    // stitched (kind 1): d4.y is the STITCH count (FragmentDecal.count, M sends it), not parallel strokes: one line,
    // centred (closing, F: QC REN-9 — the line was offset (n - 1)/2 x spacing beside its cross ticks).
    float n = kind == 1 ? 1.0 : max(1.0, d4.y);
    float s = 1e3;
    for (int k = 0; k < ${STROKES_MAX}; k++) {
      if (float(k) >= n) break;
      float mid = (n - 1.0) * 0.5;
      float off = (float(k) - mid) * sp;
      float Lk = L * (1.0 - 0.15 * abs(float(k) - mid) / max(mid, 1.0));
      float u = uv.x;
      float v = uv.y - off - (seed > 0.0 ? 0.6 * W * sin(u / max(L, 1e-4) * 2.7 + seed * 6.2832 + float(k)) : 0.0);
      float tu = clamp(u / Lk, -1.0, 1.0);
      float hw = W * max(0.25, sqrt(max(0.0, 1.0 - tu * tu)));
      s = min(s, max(abs(v) - hw, abs(u) - Lk));
      if (kind == 1 && sp > 0.0) {
        // stitches: cross ticks every sp along the line (count is 1 for a stitched scar)
        float um = u - sp * floor(u / sp + 0.5);
        s = min(s, max(max(abs(um) - 0.3 * W, abs(uv.y) - 3.0 * W), abs(u) - L));
        break;
      }
    }
    return s;
  }
  if (kind == 2) {
    // disc: puncture / burn (seed > 0: irregular edge)
    float r = min(L, W);
    float s = (length(uv / vec2(L, W)) - 1.0) * r;
    if (seed > 0.0) s += (wtNoise(uv / r * 2.2 + seed * 37.0) - 0.5) * 0.45 * r;
    return s;
  }
  float g = d4.y;
  if (kind == 3) {
    // glyph: L = glyph radius, W = stroke half width; d6.w glyphs in a row along the tangent (pitch sp):
    // only the nearest one is looked up (still one fetch).
    float rows = uDecals[i * ${DECAL_VEC4} + 6].w;
    vec2 q = uv;
    if (rows > 1.5 && sp > 0.0) {
      float mid = (rows - 1.0) * 0.5;
      float k = clamp(floor(uv.x / sp + mid + 0.5), 0.0, rows - 1.0);
      q.x -= (k - mid) * sp;
    }
    return (glyphDist(g, q / L) * L) - W;
  }
  if (kind == 4) {
    // dotwork: dots of radius W on a pitch-sp grid, kept where the glyph's strokes (widened) pass
    float pitch = max(sp, 2.2 * W);
    // Dots closer than DOT_TONE_PX pixels cannot be drawn as dots (they alias into speckle or vanish): the dotted
    // stroke is drawn as a continuous TONE instead, at DOT_TONE_INK (decalInk), like a printer's halftone seen from afar.
    bool tone = pitch < ${f(DOT_TONE_PX)} * px;
    vec2 cc = (floor(uv / pitch) + 0.5) * pitch;
    float keep = glyphDist(g, (tone ? uv : cc) / L) * L - max(W * 2.0, pitch * 0.55);
    if (tone) return keep;
    float s = length(uv - cc) - W;
    return keep <= 0.0 ? max(s, max(abs(uv.x), abs(uv.y)) - L * ${f(GLYPH_EXTENT)}) : max(s, keep);
  }
  // band: around a limb (uv.x along the axis, uv.y arc length); solid, or a glyph repeated round it
  float edge = abs(uv.x) - L;
  if (g < 0.0) return edge;
  float period = 2.0 * L;
  float cy = uv.y - period * floor(uv.y / period + 0.5);
  return max(glyphDist(g, vec2(cy, uv.x) / L) * L - W, edge);
}
// Ink factor of decal i at pixel footprint px: a stroke thinner than a pixel keeps its area (not a full-strength
// shimmer); dotwork below DOT_TONE_PX px per dot is drawn as a tone at DOT_TONE_INK.
float decalInk(int i, float px) {
  float W = uDecals[i * ${DECAL_VEC4} + 2].w;
  if (int(uDecals[i * ${DECAL_VEC4} + 4].x + 0.5) == 4) {
    float pitch = max(uDecals[i * ${DECAL_VEC4} + 6].x, 2.2 * W);
    if (pitch < ${f(DOT_TONE_PX)} * px) return ${f(DOT_TONE_INK)};
  }
  return clamp(2.0 * W / max(px, 1e-6), 0.25, 1.0);
}
float decalCoverage(float s, float px, float blur) {
  float a = max(1e-6, sqrt(0.49 * px * px + blur * blur));
  return 1.0 - smoothstep(-a, a, s);
}
// Colour pass: composites every decal over (albedo, rough); returns the marks coverage (max) and its colour, and
// how many decals WITH RELIEF have p inside their footprint (0 = the relief pass is skipped for this fragment).
// skinW: 1 on bare skin, 0 under a garment (a scar or a tattoo is in the skin: hidden by cloth, never printed on it).
// Coverage of INK (relief-free decals: tattoos, flat paint) at this fragment, set by decalShade. The skin edge
// highlight is held off it so it never lifts tattoo ink (QA Z-147), while scars (relief != 0) keep the lift.
float wtInkCov = 0.0;
float decalShade(vec3 p, vec3 pn, float px, float skinW, inout vec3 albedo, inout float rough, inout vec3 emis, out float marks, out vec3 markCol) {
  marks = 0.0; markCol = vec3(0.0); wtInkCov = 0.0;
  float reliefHits = 0.0;
  if (skinW <= 0.0) return 0.0;
  for (int i = 0; i < ${DECAL_MAX}; i++) {
    if (float(i) >= uDecalCount) break;
    vec2 uv; float face;
    if (!decalFrame(i, p, pn, uv, face)) continue;
    float s = decalSdf(i, uv, px);
    vec4 d3 = uDecals[i * ${DECAL_VEC4} + 3];
    vec4 d5 = uDecals[i * ${DECAL_VEC4} + 5];
    if (d5.z != 0.0) reliefHits += 1.0;
    float cov = decalCoverage(s, px, uDecals[i * ${DECAL_VEC4} + 4].z) * face * skinW;
    cov *= decalInk(i, px);
    if (cov <= 0.0) continue;
    albedo = mix(albedo, d3.rgb, cov * d3.a);
    rough = mix(rough, d5.x, cov * d5.y);
    emis += d3.rgb * d5.w * cov;
    if (d5.z == 0.0) wtInkCov = max(wtInkCov, cov * d3.a);
    if (cov > marks) { marks = cov; markCol = d3.a > 0.0 ? d3.rgb : vec3(0.8, 0.2, 0.6); }
  }
  return reliefHits;
}
// Relief (metres) of every decal at bind point p: a PLATEAU of the decal's height with steep shoulders at the stroke
// edge (wave TEX closing, F): shoulder half width a = max(min(RELIEF_SHOULDER x W, RELIEF_SHOULDER_MAX), blur,
// px / 2) (MaterialChannels.reliefProfile mirrors it). The first law spread the shoulder over max(W, blur, px), so a
// 0.4 mm ridge 4 mm wide tilted the normal by ~0.1 rad and barely reached the cel bands; a scar's real edge is steep
// (the plateau is the healed tissue, the shoulder its border), and the tilt bound (boundTilt) still caps it.
float decalRelief(vec3 p, vec3 pn, float px, float skinW) {
  float H = 0.0;
  for (int i = 0; i < ${DECAL_MAX}; i++) {
    if (float(i) >= uDecalCount) break;
    float h = uDecals[i * ${DECAL_VEC4} + 5].z;
    if (h == 0.0) continue;
    vec2 uv; float face;
    if (!decalFrame(i, p, pn, uv, face)) continue;
    float s = decalSdf(i, uv, px);
    float a = max(max(min(uDecals[i * ${DECAL_VEC4} + 2].w * ${f(RELIEF_SHOULDER)}, ${f(RELIEF_SHOULDER_MAX)}), uDecals[i * ${DECAL_VEC4} + 4].z), px * 0.5);
    H += h * (1.0 - smoothstep(-a, a, s)) * face * skinW;
  }
  return H;
}
`;

/**
 * Material relief details (P's FragmentDetail), from the bind position; a feature fades out as its period nears
 * the pixel footprint (no shimmer). Studs / plates / weave run on the bind plane facing the normal's dominant axis
 * (a 2D lattice on the surface; a 3D lattice would cut irregular circles). Heights in metres.
 */
export const DETAIL_GLSL = /* glsl */ `
uniform vec4 uMatDetail[${DETAIL_MATERIALS * DETAIL_PER_MATERIAL}];
float wtH3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wtN3(vec3 x) {
  vec3 i = floor(x), fr = fract(x);
  fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(mix(wtH3(i), wtH3(i + vec3(1, 0, 0)), fr.x), mix(wtH3(i + vec3(0, 1, 0)), wtH3(i + vec3(1, 1, 0)), fr.x), fr.y),
             mix(mix(wtH3(i + vec3(0, 0, 1)), wtH3(i + vec3(1, 0, 1)), fr.x), mix(wtH3(i + vec3(0, 1, 1)), wtH3(i + vec3(1, 1, 1)), fr.x), fr.y), fr.z);
}
vec2 wtPlane(vec3 p, vec3 n) {
  vec3 a = abs(n);
  return a.x > a.y && a.x > a.z ? p.zy : (a.y > a.z ? p.xz : p.xy);
}
float detailOne(vec4 d, vec3 p, vec3 n, float px) {
  float per = d.y;
  if (per <= 0.0 || d.z == 0.0) return 0.0;
  float fade = 1.0 - smoothstep(0.25, 0.7, px / per);
  if (fade <= 0.0) return 0.0;
  int kind = int(d.x + 0.5);
  vec3 q = p / per;
  float h;
  if (kind == 0) {          // pores: sparse dimples
    h = -smoothstep(0.62, 0.85, wtN3(q));
  } else if (kind == 1) {   // weave: twill ribs on the facing plane
    vec2 w = wtPlane(q, n);
    h = 0.5 * sin((w.x + w.y) * 6.2832) * (0.75 + 0.25 * sin(w.x * 3.1416));
  } else if (kind == 2) {   // grain: fbm
    h = 0.0; float a = 0.5, fq = 1.0;
    for (int o = 0; o < 4; o++) { if (float(o) >= d.w) break; h += a * (wtN3(q * fq) - 0.5); a *= 0.5; fq *= 2.07; }
  } else if (kind == 3) {   // hammered: shallow dents (inverted ridges of a noise)
    h = -abs(2.0 * wtN3(q) - 1.0) + 0.5;
  } else if (kind == 4) {   // strands: noise stretched along the bind up axis (fur, hair)
    h = wtN3(vec3(q.x, q.y * 0.12, q.z)) - 0.5;
  } else if (kind == 5) {   // plates: raised plates, sunken seams on a jittered lattice
    vec2 w = wtPlane(q, n) + 0.35 * vec2(wtN3(q * 0.5), wtN3(q * 0.5 + 7.0));
    vec2 f = fract(w);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    h = smoothstep(0.0, 0.3, e) - 0.5;
  } else {                  // studs: round domes on a lattice (radius 0.16 period)
    vec2 c = fract(wtPlane(q, n)) - 0.5;
    float r = length(c) / 0.16;
    h = r < 1.0 ? sqrt(1.0 - r * r) : 0.0;
  }
  return h * d.z * fade;
}
// Relief of the details at p, weighted by the vertex one-hot material weights w (seams blend), split into
// x = FINE features (period < ${DETAIL_COARSE_MM} mm: pores, grain, weave — 30 % to the band normal) and
// y = COARSE features (studs, big plates — a full bump, like a scar).
vec2 detailRelief(vec4 w, vec3 p, vec3 n, float px) {
  vec2 H = vec2(0.0);
  for (int m = 0; m < ${DETAIL_MATERIALS}; m++) {
    float wm = w[m];
    if (wm <= 0.001) continue;
    for (int k = 0; k < ${DETAIL_PER_MATERIAL}; k++) {
      vec4 d = uMatDetail[m * ${DETAIL_PER_MATERIAL} + k];
      float h = wm * detailOne(d, p, n, px);
      if (d.y < ${(DETAIL_COARSE_MM / 1000).toFixed(4)}) H.x += h; else H.y += h;
    }
  }
  return H;
}
`;

/** The channel debug view codes the shader switches on (MaterialChannels.CHANNEL_VIEWS order). */
export const CHANNEL_VIEW_GLSL = /* glsl */ `
uniform float uChannelView;   // 0 final, 1 albedo, 2 roughness, 3 height, 4 normal, 5 ao, 6 marks
const float WT_HEIGHT_VIEW = ${f(HEIGHT_VIEW_RANGE)};
`;
