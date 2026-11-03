// Wave X lane H: hair MESH — guide strands -> flat strand CARDS (ribbons) with a cel hair shader.
//
// Budget: the WHOLE live rig is pinned under 12 000 triangles (tests/ancestry_look_test.ts) and
// the body + face already use ~10.7-10.8 k, so the hair gets HAIR_TRI_BUDGET (the old cap +
// fall tubes + lobes cost ~1.07 k). The strand detail therefore lives in the SHADER, not in
// triangles: each card is a clump of hair whose fragment shader draws
//   * strand streaks across the card (lanes of slightly different tone, darker grooves),
//   * a tapered, pointed tip (alpha-tested, so cut ends read as hair, not as a ribbon end),
//   * a cel-quantised ANISOTROPIC highlight band (Kajiya-Kay on the strand tangent), the classic
//     ring of light across a hair mass,
//   * salt-and-pepper grey sub-strands at HairShade.subStrandGrey(g),
// on top of per-vertex colours from HairShade (root dark -> tip light, per-clump tone, grey clumps).
// An UNDERLAYER (the scalp tinted the root tone, its edge snapped onto the hairline) stops the
// skin showing through between cards; a shaved head is that underlayer alone (stubble).
//
// The vertex data are built by pure code (buildHairData — no THREE), so the tests measure the
// same vertices the GPU draws; buildHairMeshes only wraps them in BufferGeometries.

// @deno-types="@types/three"
import * as THREE from "three";
import { CEL_LIGHT_GLSL, celUniforms } from "../shaders/CelShader.ts";
import type { Vec3 } from "./contracts.ts";
import {
  ellipsoidPoint, type FollicleField, type HeadFrame, inHairRegion, placeFollicles, recessionFor,
} from "./HairFollicles.ts";
import {
  arcLength, clearance, GROWTH, growHair, guardPoint, type HairGrowthResult, type HairPlan, hairPlanFor, type HairSpecLike,
} from "./HairGrowth.ts";
import { clumpIsGrey, clumpTone, greyRgb, HAIR_SHADE, type Rgb, strandColour, subStrandGrey } from "./HairShade.ts";
import { hexToLinear } from "../paint/Blend.ts";
import { HAIR_INTELLECT, intellectDensity, intellectGrey, intellectLengthMul, intellectSilver, intellectUnit, silverShift } from "./HairIntellect.ts";

/** Triangles the hair may use (the rig's 12 k budget minus the body and face; see the header). */
export const HAIR_TRI_BUDGET = 1100;

/** Card/underlayer resolution numbers. */
export const HAIR_MESH = {
  /** A HANGING card segment is at most this long (h), and at most a third of a curl wave. */
  maxSegment: 0.14,
  minSegment: 0.07,
  maxSegments: 9,
  /** The scalp part (lying on the head, curl only sideways): segment length (h) and cap. */
  scalpSegment: 0.09,
  scalpSegments: 6,
  /** Card width = widthPerRadius × clump RMS radius × (0.8 + 0.4·density), clamped (h). */
  widthPerRadius: 2.6,
  widthMin: 0.05,
  widthMax: 0.2,
  /** Cards narrow toward the tip by this fraction (the shader tapers the last part to a point). */
  tipNarrow: 0.35,
  /** Underlayer grid (longitude × latitude cells over the whole sphere) and its gap (h). */
  underLon: 18,
  underLat: 10,
  underGap: 0.006,
  /** Braid bundle segments per (h) of braid, clamped; tie rings use tieSegments sides. */
  braidSegPerH: 16,
  braidSegMax: 26,
  tieSegments: 8,
  /** First guess of the clump count before the budget fit. */
  clumpGuess: 120,
} as const;

/** Everything the hair build reads (pure data; FaceParts fills it from the ancestry + Age.ts). */
export interface HairInput {
  frame: HeadFrame;
  spec: HairSpecLike;
  /** Proportions.hairLengthM for this head (m). */
  lengthM: number;
  seed: number;
  race: string;
  /** Ancestry ids (race, sub-race) — the braid chance reads them. */
  ancestryIds: string[];
  sex?: string;
  /** Age.lifeFraction and Age.greyFraction for this character. */
  lifeFraction: number;
  grey: number;
  baseHex: string;
  skinHex: string;
  budget?: number;
  /**
   * Wave GEN lane S: the generator's 0..1000 intelligence (BodySpec.stats). Longer, denser, silvering hair
   * above the reference (HairIntellect.ts); absent = the reference = byte-identical to wave X.
   */
  intelligence?: number | null;
}

/** One drawable group of vertices. */
export interface HairBuffer {
  pos: number[];
  nrm: number[];
  col: number[];
  uv: number[];
  tan: number[];
  seed: number[];
  idx: number[];
}

export interface HairData {
  plan: HairPlan;
  field: FollicleField;
  growth: HairGrowthResult;
  /** Static groups ride the head rigidly; hanging groups are secondary-motion masses. */
  groups: Map<string, HairBuffer>;
  hanging: string[];
  stats: {
    follicles: number;
    clumps: number;
    triangles: number;
    cardTriangles: number;
    underTriangles: number;
    braidTriangles: number;
    tieTriangles: number;
    /** Smallest skull clearance of any hair vertex (m) — must be >= 0. */
    minClearance: number;
    grey: number;
    greyClumps: number;
    recession: number;
    /** Wave GEN: the age-only grey share (grey = this after the intelligence term) and the pigment drift to silver. */
    ageGrey: number;
    silver: number;
    /** The shader's sub-strand grey rate (HairShade.subStrandGrey(grey) without the stat). */
    greySub: number;
    /** The cut length after the intelligence multiplier (m) and the follicle density used. */
    lengthM: number;
    density: number;
  };
}

const newBuf = (): HairBuffer => ({ pos: [], nrm: [], col: [], uv: [], tan: [], seed: [], idx: [] });
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3, fb: Vec3 = [0, 1, 0]): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return l < 1e-12 ? fb : [a[0] / l, a[1] / l, a[2] / l]; };

/** Resample a polyline (with per-point widths) to n+1 points evenly spaced in arc length. */
export function resample(pts: Vec3[], widths: number[], n: number, axis?: (Vec3 | null)[]): { p: Vec3[]; w: number[]; a: (Vec3 | null)[] } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(...sub(pts[i], pts[i - 1])));
  const L = cum[cum.length - 1];
  const p: Vec3[] = [], w: number[] = [], ax: (Vec3 | null)[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = Math.max(1e-12, cum[j + 1] - cum[j]);
    const t = pts.length < 2 ? 0 : Math.max(0, Math.min(1, (s - cum[j]) / seg));
    const a = pts[j], b = pts[Math.min(pts.length - 1, j + 1)];
    p.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    const wa = widths[j] ?? 1, wb = widths[Math.min(widths.length - 1, j + 1)] ?? wa;
    w.push(wa + (wb - wa) * t);
    const xa = axis?.[j] ?? null, xb = axis?.[Math.min(pts.length - 1, j + 1)] ?? null;
    ax.push(xa && xb ? [xa[0] + (xb[0] - xa[0]) * t, xa[1] + (xb[1] - xa[1]) * t, xa[2] + (xb[2] - xa[2]) * t] : (t < 0.5 ? xa : xb) ?? xa ?? xb);
  }
  return { p, w, a: ax };
}

/** The hair mass's shading normal: outward from a short vertical axis through the skull. */
function massNormal(f: HeadFrame, p: Vec3): Vec3 {
  const ay = Math.max(f.sc[1] - 0.3 * f.sr[1], Math.min(f.sc[1] + 0.1 * f.sr[1], p[1]));
  return norm([p[0] - f.sc[0], p[1] - ay, p[2] - f.sc[2]]);
}

/** Segments a card of drawn length `len` (m) gets, given the curl wave. */
export function cardSegments(f: HeadFrame, len: number, curl: number, part: "scalp" | "hang" = "hang"): number {
  if (part === "scalp") return Math.max(2, Math.min(HAIR_MESH.scalpSegments, Math.round(len / (HAIR_MESH.scalpSegment * f.h))));
  const wave = (GROWTH.curlWaveStraight + (GROWTH.curlWaveCoiled - GROWTH.curlWaveStraight) * curl) * f.h;
  const segLen = Math.max(HAIR_MESH.minSegment * f.h, Math.min(HAIR_MESH.maxSegment * f.h, wave / 3));
  return Math.max(2, Math.min(HAIR_MESH.maxSegments, Math.round(len / segLen)));
}

/**
 * Append one card (a ribbon of 2·(n) triangles) along `pts` to `buf`; vertices are guarded
 * (outside the skull, off the face and ears). `tFrom`/`tTo` place this piece on the strand's
 * root->tip parameter (0..1) so the colour and the shader taper continue across a split.
 */
function pushCard(
  f: HeadFrame, buf: HairBuffer, pts: Vec3[], widths: number[], width: number,
  colourAt: (t: number) => Rgb, seed: number, tFrom: number, tTo: number, axis: (Vec3 | null)[] = [],
): void {
  const n = pts.length - 1;
  if (n < 1) return;
  const base = buf.pos.length / 3;
  const minGap = 0.002 * f.h;
  for (let i = 0; i <= n; i++) {
    const t = tFrom + (tTo - tFrom) * (i / n);
    const T = norm(sub(pts[Math.min(n, i + 1)], pts[Math.max(0, i - 1)]), [0, -1, 0]);
    const ax = axis[i] ?? null;
    // A bundle (ponytail, bun) wraps its own axis: the card faces away from it, so the tail reads
    // round from every side instead of as one flat ribbon.
    const N = ax ? norm(sub(pts[i], ax), massNormal(f, pts[i])) : massNormal(f, pts[i]);
    let B = cross(T, N);
    if (Math.hypot(...B) < 1e-6) B = cross(T, [0, 0, 1]);
    B = norm(B, [1, 0, 0]);
    const w = width * widths[i] * (1 - HAIR_MESH.tipNarrow * t);
    const c = colourAt(t);
    for (const side of [-0.5, 0.5]) {
      const v = guardPoint(f, addv(pts[i], mul(B, side * w)), minGap);
      buf.pos.push(v[0], v[1], v[2]);
      buf.nrm.push(N[0], N[1], N[2]);
      buf.col.push(c[0], c[1], c[2]);
      buf.uv.push(side + 0.5, t);
      buf.tan.push(T[0], T[1], T[2]);
      buf.seed.push(seed);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = base + 2 * i;
    buf.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/** A tie ring (an open band of `tieSegments` quads) around axis `dir` at p. */
function pushRing(f: HeadFrame, buf: HairBuffer, p: Vec3, dir: Vec3, r: number, colour: Rgb): void {
  const d = norm(dir, [0, -1, 0]);
  let e1 = cross(d, [0, 1, 0]);
  if (Math.hypot(...e1) < 1e-6) e1 = cross(d, [1, 0, 0]);
  e1 = norm(e1);
  const e2 = norm(cross(d, e1));
  const n = HAIR_MESH.tieSegments, half = 0.6 * r;
  const base = buf.pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    const rad = addv(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
    for (const s of [-1, 1]) {
      const v = guardPoint(f, addv(addv(p, mul(rad, r)), mul(d, s * half)), 0.001 * f.h);
      buf.pos.push(v[0], v[1], v[2]);
      buf.nrm.push(rad[0], rad[1], rad[2]);
      buf.col.push(colour[0], colour[1], colour[2]);
      buf.uv.push(0.5, 0);
      buf.tan.push(d[0], d[1], d[2]);
      buf.seed.push(-1); // -1: not hair (no streaks, no grey, no taper)
    }
  }
  for (let i = 0; i < n; i++) {
    const a = base + 2 * i;
    buf.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

/**
 * The underlayer: a lat-long grid on the skull at a small gap, kept where it touches the hair
 * region; vertices outside the region are snapped up their meridian onto the hairline, so the
 * edge follows the hairline instead of a staircase.
 */
function pushUnderlayer(f: HeadFrame, buf: HairBuffer, recession: number, colour: Rgb): void {
  const L = HAIR_MESH.underLon, M = HAIR_MESH.underLat;
  const gap = HAIR_MESH.underGap * f.h;
  const dirOf = (i: number, j: number): Vec3 => {
    const th = (Math.PI * j) / M, ph = (2 * Math.PI * i) / L;
    return [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
  };
  const inside: boolean[][] = [];
  const verts: Vec3[][] = [];
  for (let j = 0; j <= M; j++) {
    inside.push([]); verts.push([]);
    for (let i = 0; i <= L; i++) {
      const u = dirOf(i, j);
      const p = ellipsoidPoint(f, u);
      const ok = inHairRegion(f, p, recession);
      inside[j].push(ok);
      let q = p;
      if (!ok) {
        // Snap up the meridian: bisection on the polar angle between the pole and this vertex.
        let lo = 0, hi = (Math.PI * j) / M;
        const ph = (2 * Math.PI * i) / L;
        const at = (th: number): Vec3 => ellipsoidPoint(f, [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)]);
        if (inHairRegion(f, at(lo), recession)) {
          for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (inHairRegion(f, at(mid), recession)) lo = mid; else hi = mid; }
          q = at(lo);
        }
      }
      verts[j].push(q);
    }
  }
  const index = new Map<string, number>();
  const vid = (i: number, j: number): number => {
    const k = `${i},${j}`;
    const have = index.get(k);
    if (have !== undefined) return have;
    const p = guardPoint(f, addv(verts[j][i], mul(massNormal(f, verts[j][i]), gap)), 0.003 * f.h);
    const id = buf.pos.length / 3;
    const N = massNormal(f, p);
    buf.pos.push(p[0], p[1], p[2]);
    buf.nrm.push(N[0], N[1], N[2]);
    buf.col.push(colour[0], colour[1], colour[2]);
    buf.uv.push((i / L) * 6 % 1, j / M);
    const T = norm(cross(N, [0, 1, 0]), [1, 0, 0]);
    buf.tan.push(T[0], T[1], T[2]);
    buf.seed.push(-2); // -2: underlayer (streaks, no taper)
    index.set(k, id);
    return id;
  };
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < L; i++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
      const tri = (a: readonly number[], b: readonly number[], c: readonly number[]) => {
        if (!inside[a[1]][a[0]] && !inside[b[1]][b[0]] && !inside[c[1]][c[0]]) return;
        const ia = vid(a[0], a[1]), ib = vid(b[0], b[1]), ic = vid(c[0], c[1]);
        if (ia === ib || ib === ic || ia === ic) return;
        buf.idx.push(ia, ic, ib);
      };
      tri(q[0], q[1], q[2]);
      tri(q[0], q[2], q[3]);
    }
  }
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Count the triangles of a set of buffers. */
function trisOf(bufs: Iterable<HairBuffer>): number {
  let n = 0;
  for (const b of bufs) n += b.idx.length / 3;
  return n;
}

/** Build all hair vertex data for one head (pure; deterministic per input). */
export function buildHairData(input: HairInput): HairData {
  const f = input.frame, h = f.h;
  const budget = input.budget ?? HAIR_TRI_BUDGET;
  // Wave GEN lane S: intelligence -> length tier, follicle density, silver (identity at the reference).
  const I = input.intelligence;
  const lengthMul = intellectLengthMul(I);
  const specI = intellectUnit(I) === 0 ? input.spec : { ...input.spec, density: intellectDensity(input.spec.density, I) };
  const plan = hairPlanFor(specI, f, lengthMul === 1 ? input.lengthM : input.lengthM * lengthMul, input.seed, input.ancestryIds);
  const recession = recessionFor(input.sex, input.race, input.lifeFraction, ((input.seed >>> 3) % 1000) / 1000);
  const field = placeFollicles(f, { density: plan.density, seed: input.seed, recession });
  const base = hexToLinear(input.baseHex) as Rgb;
  const skin = hexToLinear(input.skinHex) as Rgb;
  const gAge = Math.max(0, Math.min(1, input.grey));
  const g = intellectGrey(gAge, I);
  const silver = intellectSilver(I);
  const silverC = hexToLinear(HAIR_INTELLECT.silverWhite);
  const greyC = greyRgb(input.race, g);
  const greyAgeC = greyRgb(input.race, gAge);
  // Never darker than the age alone: a clump grey by age keeps its (lighter-or-equal) grey; a clump the
  // intelligence turned grey takes the per-channel max of the grey and its silvered pigment; the rest
  // silvers its pigment (per-channel max). At silver 0 and g = gAge every colour is the wave-X colour.
  const maxRgb = (a: Rgb, b: Rgb): Rgb => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  const strandAt = (tone: { k: number; warm: number }, isGrey: boolean, wasGrey: boolean, t: number): Rgb => {
    if (silver === 0 && g === gAge) return strandColour(base, tone, isGrey ? greyC : null, t);
    // The pigment silvers toward the TIPS (s·t^SILVER_TIP_POW): the roots on the crown keep their colour,
    // so the silver reads through the length of the hair, not as a lit silver cap (Q2's r2 finding).
    const pig = silverShift(strandColour(base, tone, null, t), silverC, silver * Math.pow(Math.max(0, Math.min(1, t)), HAIR_INTELLECT.silverTipPow)) as Rgb;
    if (!isGrey) return pig;
    const gc = strandColour(base, tone, greyC, t);
    return wasGrey ? maxRgb(gc, strandColour(base, tone, greyAgeC, t)) : maxRgb(gc, pig);
  };
  // The underlayer (the scalp tint under the cards, i.e. the crown) keeps the AGE colour: the intelligence
  // silver lives in the strands (grey share + tip silvering), so it never reads as a silver cap.
  const meanGrey = lerpRgb(base, greyAgeC, gAge);
  const tieHex = input.race === "dwarf" ? "#b08d57" : input.race === "elf" ? "#7a8a6a" : "#4a3424";
  const tieC = hexToLinear(tieHex) as Rgb;

  const build = (clumps: number) => {
    const growth = growHair(f, plan, field.follicles, { clumps, seed: input.seed });
    const groups = new Map<string, HairBuffer>();
    const get = (k: string) => { let b = groups.get(k); if (!b) { b = newBuf(); groups.set(k, b); } return b; };
    // Underlayer: the root tone (stubble on a shaved head / a mohawk's sides).
    const under = lerpRgb(mul(meanGrey, HAIR_SHADE.underK) as Rgb, skin, plan.style === "shaved" || plan.style === "mohawk" ? 0.3 : 0);
    pushUnderlayer(f, get("under"), field.recession, under);
    const underT = trisOf([get("under")]);
    let greyClumps = 0;
    for (const s of growth.strands) {
      const tone = clumpTone(s.clump, input.seed);
      // Whole grey clumps follow the AGE share only; the intelligence's extra share is salt-and-pepper (the
      // shader's sub-strand rate, greySub) plus tip silvering, spread evenly over crown, locks and braids so it
      // never reads as a silver cap or as silver-only locks (Q2 r2).
      const isGrey = clumpIsGrey(s.clump, input.seed, gAge);
      const wasGrey = isGrey;
      if (isGrey) greyClumps++;
      const colourAt = (t: number) => strandAt(tone, isGrey, wasGrey, t);
      const width = Math.max(HAIR_MESH.widthMin * h, Math.min(HAIR_MESH.widthMax * h, HAIR_MESH.widthPerRadius * s.radius * (0.8 + 0.4 * plan.density)));
      // Braid strands draw their scalp part only (the braid bundles are drawn below).
      const drawn = s.kind === "braid" ? s.points.slice(0, s.spine.length) : s.points;
      const dw = s.kind === "braid" ? s.width.slice(0, s.spine.length) : s.width;
      const da = s.kind === "braid" ? s.axis.slice(0, s.spine.length) : s.axis;
      if (drawn.length < 2) continue;
      const len = arcLength(drawn);
      // Split at the hanging point: the scalp part is static, the rest swings. Each part gets its
      // own segment count (a long tail must not starve the scalp of segments).
      const hf = Math.max(1, Math.min(drawn.length - 1, s.hangFrom));
      const scalpPts = drawn.slice(0, hf + 1), hangPts = drawn.slice(hf);
      const scalpLen = arcLength(scalpPts), hangLen = arcLength(hangPts);
      const tSplit = scalpLen / Math.max(1e-9, len);
      const hangKey = s.kind === "tail" ? (plan.style === "topknot" ? "bun" : "tail") : `lock${s.sector}`;
      if (scalpLen > 1e-6) {
        const n = cardSegments(f, scalpLen, plan.curl, "scalp");
        const rs = resample(scalpPts, dw.slice(0, hf + 1), n, da.slice(0, hf + 1));
        pushCard(f, get("scalp"), rs.p, rs.w, width, colourAt, s.clump, 0, tSplit, rs.a);
      }
      // A ponytail is drawn by every other strand at a wider card: the bundle keeps its volume at
      // half the triangles.
      const tailSkip = s.kind === "tail" && plan.style === "ponytail" && s.clump % 2 === 1;
      if (hangLen > 1e-6 && !tailSkip) {
        const n = cardSegments(f, hangLen, plan.curl);
        const rs = resample(hangPts, dw.slice(hf), n, da.slice(hf));
        pushCard(f, get(hangKey), rs.p, rs.w, s.kind === "tail" && plan.style === "ponytail" ? 1.6 * width : width, colourAt, s.clump, tSplit, 1, rs.a);
      }
    }
    let braidT = 0;
    for (let b = 0; b < growth.braids.length; b++) {
      const br = growth.braids[b];
      const buf = get(`braid${b}`);
      const before = buf.idx.length / 3;
      const nseg = Math.max(8, Math.min(HAIR_MESH.braidSegMax, Math.round(arcLength(br.spine) / h * HAIR_MESH.braidSegPerH)));
      for (let k = 0; k < 3; k++) {
        const tone = clumpTone(1000 + b * 3 + k, input.seed);
        const isGrey = clumpIsGrey(1000 + b * 3 + k, input.seed, gAge);
        const rs = resample(br.strands[k], br.strands[k].map(() => 1), nseg);
        pushCard(f, buf, rs.p, rs.w, 0.8 * br.width, (t) => strandAt(tone, isGrey, isGrey, 0.35 + 0.65 * t), 500 + b * 3 + k, 0, 1);
      }
      pushRing(f, buf, br.tie, sub(br.spine[Math.min(br.spine.length - 1, br.tieIndex + 1)], br.spine[Math.max(0, br.tieIndex - 1)]), br.tieRadius, tieC);
      braidT += buf.idx.length / 3 - before;
    }
    let tieT = 0;
    for (const t of growth.ties) {
      if (t.kind === "braid-end") continue; // drawn with its braid
      const key = t.kind === "ponytail" ? "tail" : t.kind === "bun" ? "bun" : "scalp";
      const buf = get(key);
      const before = buf.idx.length / 3;
      pushRing(f, buf, t.p, t.dir, t.r, tieC);
      tieT += buf.idx.length / 3 - before;
    }
    const total = trisOf(groups.values());
    return { growth, groups, total, underT, braidT, tieT, greyClumps };
  };
  // Fit the clump count to the budget: grow, measure, scale, regrow (deterministic).
  let clumps = Math.min(HAIR_MESH.clumpGuess, field.follicles.length);
  let out = build(clumps);
  for (let it = 0; it < 4 && out.total > budget && clumps > 4; it++) {
    const fixed = out.underT + out.braidT + out.tieT;
    const cards = Math.max(1, out.total - fixed);
    const next = Math.max(4, Math.floor(clumps * Math.max(0.05, (budget - fixed)) / cards) - (it > 1 ? 2 : 0));
    clumps = Math.min(clumps - 1, next);
    out = build(clumps);
  }
  // Stats: the smallest clearance of any vertex against the skull ellipsoid.
  let minC = Infinity;
  for (const b of out.groups.values()) {
    for (let i = 0; i < b.pos.length; i += 3) minC = Math.min(minC, clearance(f, [b.pos[i], b.pos[i + 1], b.pos[i + 2]]));
  }
  // Drop empty groups; the hanging ones are the secondary masses.
  for (const [k, b] of [...out.groups]) if (b.idx.length === 0) out.groups.delete(k);
  const hanging = [...out.groups.keys()].filter((k) => k.startsWith("lock") || k === "tail" || k.startsWith("braid")).sort();
  return {
    plan, field, growth: out.growth, groups: out.groups, hanging,
    stats: {
      follicles: field.follicles.length, clumps: out.growth.strands.length, triangles: out.total,
      cardTriangles: out.total - out.underT - out.braidT - out.tieT, underTriangles: out.underT, braidTriangles: out.braidT, tieTriangles: out.tieT,
      minClearance: minC === Infinity ? 0 : minC, grey: g, greyClumps: out.greyClumps, recession: field.recession,
      ageGrey: gAge, silver, lengthM: plan.lengthM, density: plan.density,
      // The shader's sub-strand grey rate so the expected grey share is g with whole clumps at 0.8·gAge.
      greySub: g === gAge ? subStrandGrey(gAge) : Math.max(0, Math.min(1, (g - HAIR_SHADE.clumpGreyShare * gAge) / Math.max(1e-9, 1 - HAIR_SHADE.clumpGreyShare * gAge))),
    },
  };
}

// --- THREE side ------------------------------------------------------------------------------

const hairVertex = /* glsl */ `
  uniform vec3 lightDirection;
  attribute vec2 hairUv;
  attribute vec3 hairTan;
  attribute float hairSeed;
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vTanV;
  void main() {
    #ifdef USE_COLOR
      vColor = color;
    #else
      vColor = vec3(1.0);
    #endif
    vUv = hairUv;
    vSeed = hairSeed;
    viewNormal = normalize(normalMatrix * normal);
    vTanV = normalize(normalMatrix * hairTan);
    viewLight = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vWorldN = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * world;
    viewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const hairFragment = /* glsl */ `
  #include <packing>
  uniform vec3 baseColor;
  uniform float uSpecular;
  uniform float uGreySub;
  uniform vec3 uGreyColor;
  uniform float uLanes;
  ${CEL_LIGHT_GLSL}
  varying vec3 viewNormal;
  varying vec3 viewLight;
  varying vec3 viewPos;
  varying vec3 vWorld;
  varying vec3 vWorldN;
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vTanV;
  float hh(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
  void main() {
    bool isHair = vSeed >= 0.0;
    bool isUnder = vSeed < -1.5;
    vec3 base = baseColor * vColor;
    float lane = floor(vUv.x * uLanes);
    float ls = hh(lane + vSeed * 7.31 + 3.0);
    if (isHair) {
      // Pointed tips: the card narrows to a point over its last 30 %.
      float halfW = abs(vUv.x - 0.5) * 2.0;
      float taper = 1.0 - 0.92 * smoothstep(0.7, 1.0, vUv.y) * (0.6 + 0.4 * ls);
      if (halfW > taper) discard;
    }
    if (isHair || isUnder) {
      // Strand streaks: lanes of slightly different tone with darker grooves between them.
      float groove = smoothstep(0.32, 0.5, abs(fract(vUv.x * uLanes) - 0.5));
      base *= (0.74 + 0.42 * ls) * (1.0 - 0.3 * groove);
      // Salt-and-pepper grey sub-strands (the share HairShade.subStrandGrey states).
      if (isHair && hh(lane * 3.7 + vSeed * 1.913 + 11.0) < uGreySub) base = mix(base, uGreyColor * (0.85 + 0.25 * vUv.y), 0.9);
    }
    vec3 n = normalize(viewNormal);
    vec3 l = normalize(viewLight);
    vec3 c = celShade(base, n, l, viewPos, vWorld, vWorldN, uSpecular);
    if (isHair || isUnder) {
      // Anisotropic highlight (Kajiya-Kay on the strand tangent), cel-quantised into one band.
      vec3 T = normalize(vTanV);
      vec3 H = normalize(l + normalize(-viewPos));
      float th = dot(T, H);
      float sinTH = sqrt(max(0.0, 1.0 - th * th));
      float spec = pow(sinTH, 48.0) * max(dot(n, l), 0.0);
      float w = max(fwidth(spec), 0.02);
      float band = smoothstep(0.42 - w, 0.42 + w, spec) * (0.55 + 0.45 * ls);
      c += lightColor * band * 0.22 * (0.4 + base);
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The cel hair material (vertex colours, streaks, tapered tips, anisotropic band, grey sub-strands). */
export function hairMaterial(greySub: number, greyColour: Rgb): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: celUniforms({
      baseColor: { value: new THREE.Color(1, 1, 1) },
      uSpecular: { value: 0 },
      uGreySub: { value: greySub },
      uGreyColor: { value: new THREE.Color(greyColour[0], greyColour[1], greyColour[2]) },
      uLanes: { value: 9 },
    }),
    vertexShader: hairVertex,
    fragmentShader: hairFragment,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
}

/** One buffer -> a BufferGeometry. */
export function hairGeometry(b: HairBuffer): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute("hairUv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("hairTan", new THREE.Float32BufferAttribute(b.tan, 3));
  g.setAttribute("hairSeed", new THREE.Float32BufferAttribute(b.seed, 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

export interface HairMeshes {
  data: HairData;
  /** Rigid, skull-hugging meshes (underlayer, scalp parts of the cards, bun, root ties). */
  statics: THREE.Mesh[];
  /** The hanging locks / tail / braids — the secondary-motion masses. */
  hanging: THREE.Mesh[];
  triangles: number;
}

/** Build the hair meshes under `head` (the head bone) from pure hair data. */
export function buildHairMeshes(head: THREE.Object3D, input: HairInput): HairMeshes {
  const data = buildHairData(input);
  const mat = hairMaterial(data.stats.greySub, greyRgb(input.race, data.stats.grey));
  const statics: THREE.Mesh[] = [], hanging: THREE.Mesh[] = [];
  for (const [key, buf] of data.groups) {
    const mesh = new THREE.Mesh(hairGeometry(buf), mat);
    mesh.name = `hair-${key}`;
    // QA evidence (read by the probe page): what this hair is.
    mesh.userData.hair = { style: data.plan.style, tier: data.plan.tier, braids: data.growth.braids.length, ...data.stats };
    head.add(mesh);
    (data.hanging.includes(key) ? hanging : statics).push(mesh);
  }
  return { data, statics, hanging, triangles: data.stats.triangles };
}
