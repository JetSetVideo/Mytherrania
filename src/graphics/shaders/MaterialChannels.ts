// Wave TEX (lane R, contract C-REND): the RENDER side of the layered material channels. Pure module (no
// THREE, no DOM): the vertex attribute layout, the neutral values, the fragment DECAL record and its packing
// into a fixed uniform block, the channel debug views, and the TypeScript mirrors of the shader's bounded
// normal and decal profiles (so tests pin the GLSL's arithmetic without a GPU).
//
// Vertex channels (low frequency, one value per skin vertex; L's Channels.MATERIAL_LAYOUT):
//   aMaterial vec4 = (roughness 0 glossy..1 matte, height signed metres, ao 0..1, subsurface 0..1)
//   aEmissive vec3 = linear RGB added after lighting (optional attribute)
// Neutral = (0.5, 0, 1, 0) and black: the shader skips every new term inside a small DEAD ZONE around the
// neutral value (a constant varying can interpolate to 1 ulp off), so a body with neutral channels renders
// with exactly the pre-TEX arithmetic (pixel test: tools/bench-wave-tex.ts --identity, 0 changed pixels).
//
// Fragment decals (fine marks: scars, tattoos — a 2 mm line cannot live on a 25 mm vertex grid): at most
// DECAL_MAX per body, each evaluated per FRAGMENT from the BIND-pose position (vBind), so a mark sticks to
// the skin through every pose and needs no UVs. Each decal is a 2D profile in its own tangent frame
// (centre, normal, tangent) — optionally wrapped around a limb (arc-length coordinates about the tangent
// axis) — with a signed distance s (metres, < 0 inside) anti-aliased by the pixel footprint fwidth(vBind):
//   coverage = 1 - smoothstep(-a, a, s),  a = sqrt((0.7 px)^2 + blur^2)   (blur = ink migration / soft edge)
// Packed as DECAL_VEC4 vec4 per decal into `uniform vec4 uDecals[DECAL_MAX * DECAL_VEC4]` (no texture fetch
// for the parameters); glyph decals do ONE fetch from the glyph SDF atlas (textures/GlyphAtlas.ts).

/** Vertex attribute names. */
export const MATERIAL_ATTRIBUTE = "aMaterial";
export const EMISSIVE_ATTRIBUTE = "aEmissive";
/** Fine edge-highlight weight per vertex (float, 0..1; P's EDGE_CREST), wave TEX closing (F). */
export const EDGE_ATTRIBUTE = "aEdge";
/**
 * The fine EDGE highlight (closing, F, QA Z-71 WARN-1): the edge layer's per-vertex lift is spread over 22-35 mm
 * triangles, so on a close-up it reads as a soft glow, not as the painter's crisp line on the crest. The edge layer
 * also emits a CREST weight per vertex (its lift, normalised to the skin preset's full edge = 1); the skinned cel shader
 * re-thresholds the interpolated weight per fragment, smoothstep(onset, full, w), and lifts the albedo toward white by
 * `lift` there: a thin painted line along every ridge the vertex highlight already marks. Skin only (garments keep
 * their vertex highlight: a crest on metal trim printed white blotches) and not on hands / feet (toes are a few vertices),
 * the weight 1-ring smoothed before export; onset / full sit near the skin crest's p85 / p95 on the four races (Warrior
 * bodies), so the full line covers a few % of the skin and fades over ~10 % more.
 */
export const EDGE_CREST = { onset: 0.2, full: 0.6, lift: 0.4 } as const;
/** aMaterial components (identical to paint/Channels.ts MATERIAL_LAYOUT). */
export const MATERIAL_COMPONENTS = ["roughness", "height", "ao", "subsurface"] as const;
/** The neutral aMaterial value: renders exactly as before wave TEX. */
export const MATERIAL_NEUTRAL = [0.5, 0, 1, 0] as const;
/**
 * Dead zones around neutral (shader skips the term inside them): |roughness - 0.5| < 0.004,
 * ao > 0.998, subsurface < 0.002, |emissive| < 1/1024 per component. Height 0 interpolates to exactly 0.
 */
export const DEAD_ZONE = { roughness: 0.004, ao: 0.998, subsurface: 0.002, emissive: 1 / 1024 } as const;

/** Most decals a body carries (uniform block size). */
export const DECAL_MAX = 16;
/** vec4 per decal. */
export const DECAL_VEC4 = 7;
/** Floats in the packed block. */
export const DECAL_FLOATS = DECAL_MAX * DECAL_VEC4 * 4;

/** Decal profile kinds and their shader codes (index). */
export const DECAL_KINDS = ["line", "stitched", "disc", "glyph", "dots", "band"] as const;
export type DecalKind = typeof DECAL_KINDS[number];

type V3 = readonly [number, number, number];

/**
 * One fragment decal, in the BIND-pose model frame (metres). Producers: M's marks (scars, tattoos) and L's
 * Evaluate fragment layer list. Semantics of the two extents per kind:
 *   line / stitched  halfLength along `tangent`, halfWidth across (a spindle: tapers to the tips)
 *   disc             semi-axes halfLength (tangent) x halfWidth (puncture, burn)
 *   glyph            halfLength = glyph radius (square), halfWidth = stroke half-width
 *   dots             glyph drawn in dotwork: halfLength = glyph radius, halfWidth = dot radius, spacing = dot pitch
 *   band             ring around a limb (needs wrapRadius): halfLength = band half-width along the tangent
 *                    (limb axis), halfWidth = stroke half-width of the repeated glyph (no glyph = solid band)
 */
export interface FragmentDecal {
  kind: DecalKind;
  /** Centre on the skin surface (bind pose, model metres). */
  center: V3;
  /** Skin normal at the centre (bind pose). Decals only show on skin facing within ~75° of it. */
  normal: V3;
  /** Length axis (tangent plane; Langer's line already applied). Re-orthogonalised against `normal`. */
  tangent: V3;
  halfLength: number;
  halfWidth: number;
  /** Edge softness in metres (scar edge, tattoo ink migration). >= 0. */
  blur?: number;
  /** Linear RGB composited normal-over at `albedoOpacity` x coverage. */
  albedo?: V3;
  albedoOpacity?: number;
  /** Target roughness (0 glossy .. 1 matte) lerped in at `roughnessOpacity` x coverage. */
  roughness?: number;
  roughnessOpacity?: number;
  /** Relief at the centre line, metres (> 0 raised / hypertrophic, < 0 sunken / atrophic). |h| <= HEIGHT_LIMIT. Ignored (0) for glyph / dots / band. */
  height?: number;
  /** 0..1: albedo x strength added after lighting (runes). */
  emissive?: number;
  /** Glyph index (paint/Symbols.ts TATTOO_SYMBOLS) for glyph / dots / band. */
  glyph?: number;
  /** Parallel strokes (claw marks), stitches, or glyphs in a row along the tangent (runic); 1..8. */
  count?: number;
  /** Stroke spacing (claw) / stitch pitch / dot pitch, metres. */
  spacing?: number;
  /** Wrap radius (m): the decal follows a limb of this radius about its tangent axis (band; optional for glyphs). */
  wrapRadius?: number;
  /**
   * The limb axis to wrap about (glyph / dots / line): the decal wraps about whichever of its own tangent or
   * bitangent (normal x tangent) is closer to this axis. Absent = about the tangent. Bands always wrap about the tangent.
   */
  wrapAxis?: V3;
  /** Seed of the waviness / edge jitter. */
  seed?: number;
}

/** Largest relief a decal may carry (metres) — L's Channels.HEIGHT_RANGE_M. */
export const HEIGHT_LIMIT = 0.008;
/** Most parallel strokes / stitches evaluated per decal (shader loop bound). */
export const STROKES_MAX = 8;

/** Packed decal block. */
export interface PackedDecals {
  data: Float32Array;
  count: number;
  /** Decals beyond DECAL_MAX or rejected as degenerate (index into the input). */
  dropped: number[];
  /** True when any packed decal carries relief (enables the finite-difference height pass). */
  anyHeight: boolean;
}

const clamp = (x: number, a: number, b: number) => (x !== x ? a : x < a ? a : x > b ? b : x);
const fin = (x: number | undefined, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);

function norm3(v: V3): [number, number, number] | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-9) || !Number.isFinite(l)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Bounding radius (m) of a decal's footprint around its centre (the shader's early reject). */
export function decalRadius(d: FragmentDecal): number {
  const L = Math.max(0, fin(d.halfLength, 0)), W = Math.max(0, fin(d.halfWidth, 0));
  const blur = Math.max(0, fin(d.blur, 0));
  const n = clamp(Math.round(fin(d.count, 1)), 1, STROKES_MAX), sp = Math.max(0, fin(d.spacing, 0));
  let r: number;
  switch (d.kind) {
    case "band": {
      const wr = Math.max(0, fin(d.wrapRadius, 0));
      r = Math.hypot(L, 2 * wr);
      break;
    }
    case "line": case "stitched": r = Math.hypot(L, W * 3 + (d.kind === "line" ? (n - 1) * sp / 2 : 0)); break;
    case "glyph": case "dots": r = Math.SQRT2 * L + W + (n - 1) / 2 * sp; break;
    default: r = Math.max(L, W) * 1.3;
  }
  return r + 2 * blur + W + 0.002;
}

/**
 * Pack decals into the uniform block (DECAL_VEC4 = 7 vec4 each):
 *   D0 center.xyz, radius        D1 tangent.xyz, halfLength     D2 normal.xyz, halfWidth
 *   D3 albedo.rgb, albedoOpacity D4 kind, selector, blur, seed  D5 roughness, roughOpacity, height, emissive
 *   D6 spacing, wrapRadius, wrapMode (0 about the tangent, 1 about the bitangent), glyph count (row along the tangent)
 * selector = glyph index for glyph / dots / band (-1 = none: a band without glyph is solid), stroke count for
 * line / stitched / disc. Total: never throws; NaN fields take defaults; degenerate frames (zero normal,
 * tangent parallel to the normal, zero extents) are dropped; decals beyond DECAL_MAX are dropped in order.
 */
export function packDecals(decals: readonly FragmentDecal[]): PackedDecals {
  const data = new Float32Array(DECAL_FLOATS);
  const dropped: number[] = [];
  let count = 0, anyHeight = false;
  decals.forEach((d, i) => {
    if (count >= DECAL_MAX || !d || !(DECAL_KINDS as readonly string[]).includes(d.kind)) { dropped.push(i); return; }
    const n = d.normal ? norm3(d.normal) : null;
    const t0 = d.tangent ? norm3(d.tangent) : null;
    const c = d.center;
    if (!n || !t0 || !c || c.length < 3 || !c.every(Number.isFinite)) { dropped.push(i); return; }
    // Gram-Schmidt: the tangent in the decal plane.
    const k = t0[0] * n[0] + t0[1] * n[1] + t0[2] * n[2];
    const t = norm3([t0[0] - k * n[0], t0[1] - k * n[1], t0[2] - k * n[2]]);
    const L = Math.max(0, fin(d.halfLength, 0)), W = Math.max(0, fin(d.halfWidth, 0));
    if (!t || !(L > 0) || !(W > 0)) { dropped.push(i); return; }
    const kind = DECAL_KINDS.indexOf(d.kind);
    const glyphKinds = d.kind === "glyph" || d.kind === "dots" || d.kind === "band";
    const strokes = clamp(Math.round(fin(d.count, 1)), 1, STROKES_MAX);
    const glyph = Math.floor(fin(d.glyph, -1));
    // Glyph kinds (glyph / dots / band) carry no relief: the relief pass evaluates a decal 3 times, and a glyph
    // would then cost 4 atlas fetches (budget: <= 1 extra fetch per decal; QC Z-89). Ink sits flat in the dermis.
    const h = glyphKinds ? 0 : clamp(fin(d.height, 0), -HEIGHT_LIMIT, HEIGHT_LIMIT);
    if (h !== 0) anyHeight = true;
    const a = d.albedo ?? [0, 0, 0];
    const o = count * DECAL_VEC4 * 4;
    data.set([c[0], c[1], c[2], decalRadius(d)], o);
    data.set([t[0], t[1], t[2], L], o + 4);
    data.set([n[0], n[1], n[2], W], o + 8);
    data.set([clamp(fin(a[0], 0), 0, 1), clamp(fin(a[1], 0), 0, 1), clamp(fin(a[2], 0), 0, 1),
      d.albedo ? clamp(fin(d.albedoOpacity, 1), 0, 1) : 0], o + 12);
    data.set([kind, glyphKinds ? (glyph >= 0 ? glyph : -1) : strokes, Math.max(0, fin(d.blur, 0)), fract01(fin(d.seed, 0))], o + 16);
    data.set([clamp(fin(d.roughness, 0.5), 0, 1), d.roughness === undefined ? 0 : clamp(fin(d.roughnessOpacity, 1), 0, 1), h,
      clamp(fin(d.emissive, 0), 0, 1)], o + 20);
    let wrapMode = 0;
    const ax = d.wrapAxis && d.kind !== "band" ? norm3(d.wrapAxis) : null;
    if (ax) {
      const b = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      if (Math.abs(ax[0] * b[0] + ax[1] * b[1] + ax[2] * b[2]) > Math.abs(ax[0] * t[0] + ax[1] * t[1] + ax[2] * t[2])) wrapMode = 1;
    }
    data.set([Math.max(0, fin(d.spacing, 0)), Math.max(0, fin(d.wrapRadius, 0)), wrapMode, glyphKinds ? strokes : 1], o + 24);
    count++;
  });
  return { data, count, dropped, anyHeight };
}

function fract01(x: number): number {
  const f = x - Math.floor(x);
  return Number.isFinite(f) ? f : 0;
}

/** Uniform vec4 the decal path adds to a fragment shader (packed blocks + count/flags + atlas info). */
export const DECAL_UNIFORM_VEC4 = DECAL_MAX * DECAL_VEC4 + 2;

// ---------------------------------------------------------------------------------------------------
// Channel debug views (used by U's channel switch and C's capture matrix).

export const CHANNEL_VIEWS = ["final", "albedo", "roughness", "height", "normal", "ao", "marks"] as const;
export type ChannelView = typeof CHANNEL_VIEWS[number];
/** uChannelView value of a view (0 = final = the game). Unknown names map to final. */
export function channelViewCode(view: string): number {
  const i = (CHANNEL_VIEWS as readonly string[]).indexOf(view);
  return i < 0 ? 0 : i;
}
/** Height debug scale: grey = 0.5 + height / HEIGHT_VIEW_RANGE / 2 (so +-4 mm spans black..white). */
export const HEIGHT_VIEW_RANGE = 0.004;

// ---------------------------------------------------------------------------------------------------
// Bounded perturbed normal (mirror of the GLSL `boundTilt`).

/** Largest tilt (rad) the material height may give the shading normal. */
export const MAX_TILT = 0.3;

/**
 * Clamp `nb`'s angle to `n` at `maxTilt` (both unit; returns unit). Guarantee: the lambert term of the
 * result differs from n's by at most sin(maxTilt)... precisely |dot(r,l) - dot(n,l)| <= 2 sin(maxTilt/2) for any
 * unit l (chord length), so with MAX_TILT = 0.3 a bump moves the lit fraction by <= 0.2989, less than the
 * narrowest cel band (CelShader CEL_BAND_EDGES 0.12 -> 0.5: 0.38): a relief can push a fragment across at most
 * ONE band edge and never swaps the order of the bands (no inverted shading).
 */
export function boundTilt(n: V3, nb: V3, maxTilt = MAX_TILT): [number, number, number] {
  const c = n[0] * nb[0] + n[1] * nb[1] + n[2] * nb[2];
  const cm = Math.cos(maxTilt);
  if (c >= cm) return [nb[0], nb[1], nb[2]];
  // Direction of nb's tangential part (fallback: any perpendicular when nb == -n).
  let tx = nb[0] - c * n[0], ty = nb[1] - c * n[1], tz = nb[2] - c * n[2];
  let tl = Math.hypot(tx, ty, tz);
  if (!(tl > 1e-9)) {
    const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const k = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
    tx = a[0] - k * n[0]; ty = a[1] - k * n[1]; tz = a[2] - k * n[2];
    tl = Math.hypot(tx, ty, tz);
  }
  const s = Math.sin(maxTilt);
  return [n[0] * cm + tx / tl * s, n[1] * cm + ty / tl * s, n[2] * cm + tz / tl * s];
}

// ---------------------------------------------------------------------------------------------------
// Decal profiles (mirror of the GLSL decalSdf for line / stitched / disc; glyphs use Symbols.symbolDistance).

/** Signed distance (m, < 0 inside) of a line / stitched / disc profile at tangent coords (u, v). */
export function profileSdf(kind: "line" | "stitched" | "disc", u: number, v: number, L: number, W: number, spacing = 0): number {
  if (kind === "disc") {
    const q = Math.hypot(u / L, v / W);
    return (q - 1) * Math.min(L, W);
  }
  // Spindle: the half width tapers as sqrt(1 - (u/L)^2), floored at 25 % so the tips stay drawn.
  const tu = clamp(u / L, -1, 1);
  const hw = W * Math.max(0.25, Math.sqrt(Math.max(0, 1 - tu * tu)));
  let s = Math.max(Math.abs(v) - hw, Math.abs(u) - L);
  if (kind === "stitched" && spacing > 0) {
    const um = u - spacing * Math.floor(u / spacing + 0.5);
    s = Math.min(s, Math.max(Math.abs(um) - 0.3 * W, Math.abs(v) - 3 * W, Math.abs(u) - L));
  }
  return s;
}

/** Anti-aliased coverage of a signed distance (the shader's law). px = pixel footprint (m), blur (m). */
export function coverage(s: number, px: number, blur = 0): number {
  const a = Math.max(1e-6, Math.sqrt((0.7 * px) ** 2 + blur * blur));
  const t = clamp((s + a) / (2 * a), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/** Relief shoulder half width as a share of the stroke half width W (wave TEX closing, F: a scar's border is steep). */
export const RELIEF_SHOULDER = 0.35;
/** ... capped (m), so a wide burn disc keeps a border, not a dome. */
export const RELIEF_SHOULDER_MAX = 0.0015;
/** Shoulder half width (m) of a relief decal: max(min(RELIEF_SHOULDER W, RELIEF_SHOULDER_MAX), blur, px / 2) (GLSL decalRelief). */
export function reliefShoulder(W: number, blur: number, px: number): number {
  return Math.max(Math.min(W * RELIEF_SHOULDER, RELIEF_SHOULDER_MAX), blur, px * 0.5);
}
/** Relief (m) at signed distance s of a decal of height h (the shader's plateau law: h inside, 0 outside, smooth shoulder). */
export function reliefProfile(s: number, h: number, W: number, blur: number, px: number): number {
  const a = reliefShoulder(W, blur, px);
  const t = clamp((s + a) / (2 * a), 0, 1);
  return h * (1 - t * t * (3 - 2 * t));
}

// ---------------------------------------------------------------------------------------------------
// Material relief details (lane P's FragmentDetail: pores, weave, grain, hammered, strands, plates, studs),
// evaluated per fragment from the bind position. Up to DETAIL_MATERIALS materials per body, DETAIL_PER_MATERIAL
// details each; a vec4 vertex attribute aDetailW carries the one-hot material weight (interpolated across seams).

export const DETAIL_KINDS = ["pores", "weave", "grain", "hammered", "strands", "plates", "studs"] as const;
export type DetailKind = typeof DETAIL_KINDS[number];
export const DETAIL_MATERIALS = 4;
export const DETAIL_PER_MATERIAL = 2;
export const DETAIL_ATTRIBUTE = "aDetailW";
/** One detail: kind, feature period (mm), peak relief (m), octaves (P's Presets.FragmentDetail). */
export interface MaterialDetail { kind: DetailKind; periodMm: number; amplitude: number; octaves: number }
/** P's preset.details entry: a material id, its regions, one detail. */
export interface RegionDetail { material: string; regions: readonly string[]; detail: MaterialDetail }

/**
 * Pack region details for a mesh: uniform vec4 uMatDetail[8] = (kind, period m, amplitude m, octaves) per slot
 * (material m owns slots 2m, 2m+1) and the per-vertex one-hot weights (4 floats per vertex). Materials beyond
 * DETAIL_MATERIALS and details beyond DETAIL_PER_MATERIAL per material are dropped (reported). Total.
 */
export function packDetails(details: readonly RegionDetail[], vertexRegion: ArrayLike<number>, regionNames: readonly string[]): {
  slots: Float32Array; weights: Float32Array; materials: string[]; dropped: number[];
} {
  const slots = new Float32Array(DETAIL_MATERIALS * DETAIL_PER_MATERIAL * 4);
  const materials: string[] = [], used: number[] = [], dropped: number[] = [];
  const regionMat = new Int8Array(regionNames.length).fill(-1);
  details.forEach((d, i) => {
    const kind = d?.detail ? DETAIL_KINDS.indexOf(d.detail.kind) : -1;
    const per = fin(d?.detail?.periodMm, 0) / 1000, amp = fin(d?.detail?.amplitude, 0);
    if (kind < 0 || !(per > 0) || amp === 0) { dropped.push(i); return; }
    let m = materials.indexOf(d.material);
    if (m < 0) {
      if (materials.length >= DETAIL_MATERIALS) { dropped.push(i); return; }
      m = materials.push(d.material) - 1; used.push(0);
    }
    if (used[m] >= DETAIL_PER_MATERIAL) { dropped.push(i); return; }
    slots.set([kind, per, clamp(amp, -HEIGHT_LIMIT, HEIGHT_LIMIT), clamp(Math.round(fin(d.detail.octaves, 1)), 1, 4)], (m * DETAIL_PER_MATERIAL + used[m]) * 4);
    used[m]++;
    for (const r of d.regions ?? []) { const ri = regionNames.indexOf(r); if (ri >= 0 && regionMat[ri] < 0) regionMat[ri] = m; }
  });
  const n = vertexRegion.length, weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) { const m = regionMat[vertexRegion[v]] ?? -1; if (m >= 0) weights[v * 4 + m] = 1; }
  return { slots, weights, materials, dropped };
}

/** WebGL2 guaranteed minimum MAX_FRAGMENT_UNIFORM_VECTORS (ES 3.0 spec). */
export const WEBGL2_MIN_FRAGMENT_VEC4 = 224;
