// Wave X lane H: hair GROWTH (pure — no THREE, no DOM, no Math.random).
//
// Each guide strand (one per CLUMP of follicles) is grown as a polyline from its root:
//   1. it leaves the scalp along the normal blended with the comb flow (a crown WHORL, a
//      PARTING, a gather toward a TIE point, or a standing CREST);
//   2. it HUGS the skull: every point keeps a clearance >= its layer gap against the skull
//      ellipsoid (FaceParts.skullClearance's measure), and above the skull's widest band it is
//      held at that gap so the hair lies on the head instead of standing off it;
//   3. gravity takes over with arc length, so below the skull the strand falls (drifting a
//      little backward over the upper back);
//   4. CURL (node.hair.curl) winds a helix around the fallen centreline, growing in from the root;
//   5. it is CUT to the style's length (buzz/short/shoulder/long), a FRINGE strand is cut above
//      the brow so it never covers the eyes, a bob is cut at the jaw plane, and hair below the
//      brow line is tucked BEHIND the ear's back plane (the ears poke through, the face stays clear);
//   6. GATHERED styles bring their strands to a tie point: a ponytail falls from it, a topknot
//      coils into a bun, and BRAIDS split their strands into three bundles that interleave
//      (offsets 120° apart on a figure-eight: each bundle crosses the braid's centre line every
//      half period) down to an end tie with a short tuft.

import type { Vec3 } from "./contracts.ts";
import {
  earBackZ, earZone, ellipsoidNormal, ellipsoidPoint, type Follicle, FOLLICLE, type HeadFrame, hairRng,
} from "./HairFollicles.ts";

export type HairStyleId = "shaved" | "crop" | "bob" | "flowing" | "braided" | "topknot" | "mohawk" | "wild" | "ponytail";
export type LengthTier = "buzz" | "short" | "shoulder" | "long";
export type Sweep = "whorl" | "parting" | "gather" | "crest";

/** Stated growth numbers (head heights h unless stated). */
export const GROWTH = {
  /** Integration step along the strand (h). */
  step: 0.02,
  /** Layer gap range: each clump rides the skull at its own gap (h), × (0.6 + 0.6·density). */
  gapMin: 0.012,
  gapMax: 0.034,
  /** Flow fades into gravity over this arc length (h). */
  flowFade: 0.45,
  /** The strand leaves the root along the normal over this arc length (h). */
  liftLen: 0.04,
  /** Above sc.y − hugBand·sr.y the strand is held at its gap (it lies on the head). */
  hugBand: 0.12,
  /** Backward drift of the fall once below the skull (z per unit drop). */
  backDrift: 0.22,
  /** Curl helix amplitude per unit curl (h) and its wavelength range (h). */
  curlAmp: 0.04,
  curlWaveStraight: 0.34,
  curlWaveCoiled: 0.10,
  /** Tier edges on the cut length (h): < buzz -> buzz, < short -> short, < shoulder -> shoulder. */
  tierBuzz: 0.15,
  tierShort: 0.6,
  tierShoulder: 1.5,
  /** Longest fall (h): min(L, longBase + longGain·L). */
  longBase: 1.0,
  longGain: 0.45,
  /** Tie radius (h) and braid geometry: width, pitch (h per full twist), tuft past the end tie. */
  tieRadius: 0.035,
  braidWidth: 0.095,
  braidPitch: 0.16,
  braidTuft: 0.10,
  /** Ponytail bundle radius (h) just below its tie (it swells to ~1.6x then narrows). */
  tailRadius: 0.06,
  /** Bun radius (h) for the topknot. */
  bunRadius: 0.065,
} as const;

/** The ancestry hair spec fields this module reads (Ancestry.HairSpec). */
export interface HairSpecLike {
  length: string;
  styles: string[];
  curl: number;
  density: number;
}

/** The resolved style of one character. */
export interface HairPlan {
  style: HairStyleId;
  tier: LengthTier;
  /** The cut length of a free strand (m). */
  lengthM: number;
  curl: number;
  density: number;
  sweep: Sweep;
  /** Parting offset −1..1 (× 0.35 skull half-width) for parting styles. */
  parting: number;
  /** Braid count (0 = none) and whether every strand joins a braid (else only nearby ones). */
  braids: number;
  braidAll: boolean;
  /** Plane cut height (m, head-local) for a bob; null = none. */
  planeY: number | null;
}

/** A deterministic [0,1) hash of an int. */
export function hashUnit(n: number): number {
  let h = Math.imul((n | 0) ^ 0x2c1b3c6d, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}

/** The length tier of a cut length (m) on a head of height h. */
export function tierOf(lengthM: number, h: number): LengthTier {
  const l = lengthM / h;
  if (l < GROWTH.tierBuzz) return "buzz";
  if (l < GROWTH.tierShort) return "short";
  if (l < GROWTH.tierShoulder) return "shoulder";
  return "long";
}

/** Races whose loose styles may grow a single braid by a deterministic chance (task: ork/nomad). */
const BRAID_CHANCE: Record<string, number> = { ork: 0.3, nomad: 0.3, dwarf: 0.35, wood: 0.35 };

/**
 * Resolve the style for a character: the style draw from the ancestry's list (by seed), the
 * length from the tier (Proportions.hairLengthM), a ponytail variant of long flowing hair, the
 * braid count, and the bob's jaw plane.
 */
export function hairPlanFor(spec: HairSpecLike, f: HeadFrame, lengthM: number, seed: number, ancestryIds: string[] = []): HairPlan {
  const h = f.h;
  const styles = spec.styles.length > 0 ? spec.styles : ["crop"];
  let style = styles[Math.floor(hashUnit(seed ^ 0x51a7e) * styles.length) % styles.length] as HairStyleId;
  const capped = Math.min(lengthM, GROWTH.longBase * h + GROWTH.longGain * lengthM);
  if (style === "flowing" && capped > 1.2 * h && hashUnit(seed ^ 0x9071a) < 0.3) style = "ponytail";
  let curl = Math.max(0, Math.min(1, spec.curl));
  let len = capped;
  let sweep: Sweep = "parting";
  let braids = 0, braidAll = false;
  let planeY: number | null = null;
  switch (style) {
    case "shaved": len = 0.02 * h; sweep = "whorl"; break;
    case "mohawk": len = Math.max(0.25 * h, Math.min(0.42 * h, capped)); sweep = "crest"; break;
    case "crop": len = Math.min(capped, 0.45 * h); sweep = "whorl"; break;
    case "wild": len = Math.max(0.35 * h, 0.9 * capped); sweep = "whorl"; curl = Math.min(1, curl + 0.25); break;
    case "bob": len = Math.min(capped, 1.2 * h); planeY = f.chinY + 0.04 * h; break;
    case "flowing": break;
    case "ponytail": len = Math.max(capped, 1.2 * h); sweep = "gather"; break;
    case "topknot": len = Math.max(capped, 0.9 * h); sweep = "gather"; break;
    case "braided":
      len = Math.max(capped, 1.4 * h); sweep = "gather"; braidAll = true;
      braids = 1 + Math.floor(hashUnit(seed ^ 0xb4a1d) * 3); // 1..3
      break;
  }
  // A deterministic extra braid for the braiding ancestries' loose long styles.
  if (braids === 0 && (style === "wild" || style === "flowing") && len >= 0.35 * h) {
    const chance = Math.max(0, ...ancestryIds.map((id) => BRAID_CHANCE[id] ?? 0));
    if (hashUnit(seed ^ 0x3b4a1) < chance) { braids = 1; len = Math.max(len, 0.8 * h); }
  }
  const parting = (hashUnit(seed ^ 0x9a47) - 0.5) * 1.6;
  return { style, tier: tierOf(len, h), lengthM: len, curl, density: Math.max(0, Math.min(1, spec.density)), sweep, parting, braids, braidAll, planeY };
}

// --- small vector helpers --------------------------------------------------------------------
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3, fb: Vec3 = [0, -1, 0]): Vec3 => { const l = len3(a); return l < 1e-12 ? fb : [a[0] / l, a[1] / l, a[2] / l]; };
const tproj = (v: Vec3, n: Vec3): Vec3 => sub(v, mul(n, dot(v, n)));

/** Signed clearance of p from the skull ellipsoid along the centre ray (> 0 outside). */
export function clearance(f: HeadFrame, p: Vec3): number {
  const dx = p[0] - f.sc[0], dy = p[1] - f.sc[1], dz = p[2] - f.sc[2];
  const q = Math.hypot(dx / f.sr[0], dy / f.sr[1], dz / f.sr[2]);
  const d = Math.hypot(dx, dy, dz);
  return q < 1e-12 ? -d : d * (q - 1) / q;
}

/** Move p along the centre ray so its clearance is exactly `gap`. */
export function atClearance(f: HeadFrame, p: Vec3, gap: number): Vec3 {
  const v = sub(p, f.sc);
  const q = Math.hypot(v[0] / f.sr[0], v[1] / f.sr[1], v[2] / f.sr[2]);
  if (q < 1e-12) return add(f.sc, [0, f.sr[1] + gap, 0]);
  const d = len3(v), surf = d / q;
  return add(f.sc, mul(v, (surf + gap) / d));
}

/** Outward normal at the surface point under p (radial projection, then the ellipsoid normal). */
function normalUnder(f: HeadFrame, p: Vec3): Vec3 {
  return ellipsoidNormal(f, atClearance(f, p, 0));
}

/**
 * The guards every hair point obeys (growth AND the built mesh): outside the skull by >= minGap;
 * below the brow line, behind the ear's back plane; out of the ear zones. Returns the corrected
 * point. `fringeY` = browY + FOLLICLE.fringeClearDy·h.
 */
export function guardPoint(f: HeadFrame, p: Vec3, minGap: number): Vec3 {
  let q: Vec3 = [p[0], p[1], p[2]];
  const back = earBackZ(f);
  const fringeY = f.browY + FOLLICLE.fringeClearDy * f.h;
  for (let it = 0; it < 4; it++) {
    // Ear zones: push out radially in the y-z ellipse (biased backward), with a small margin.
    for (const i of [0, 1] as const) {
      const z = earZone(f, i);
      const side = Math.sign(f.ear[i][0] - f.sc[0]);
      if ((q[0] - f.sc[0]) * side < 0.45 * f.sr[0]) continue;
      const ey = (q[1] - z.c[1]) / z.ry, ez = (q[2] - z.c[2]) / z.rz;
      const r = Math.hypot(ey, ez);
      if (r < 1.02) {
        let dy = ey, dz = ez - 0.35; // bias backward
        const l = Math.hypot(dy, dz) || 1;
        dy /= l; dz /= l;
        if (dz > 0 && q[1] < fringeY) dz = -Math.abs(dz); // never forward onto the face
        const n = Math.hypot(dy, dz) || 1;
        q = [q[0], z.c[1] + (dy / n) * 1.03 * z.ry, z.c[2] + (dz / n) * 1.03 * z.rz];
      }
    }
    // Face: below the fringe line nothing sits in front of the ear's back plane.
    if (q[1] < fringeY && q[2] > back) q = [q[0], q[1], back];
    // Skull: never inside.
    if (clearance(f, q) < minGap) q = atClearance(f, q, minGap);
  }
  return q;
}

/**
 * Slide a step around an ear zone: when p + dir·step would enter it, the direction is turned onto
 * the zone's ellipse tangent (in the y-z plane) that runs BACK and DOWN, so a falling strand
 * flows behind the ear instead of pinning on top of it. Returns null when no ear is in the way.
 */
export function earSlide(f: HeadFrame, p: Vec3, dir: Vec3, step: number): Vec3 | null {
  const q = add(p, mul(dir, step));
  for (const i of [0, 1] as const) {
    const z = earZone(f, i);
    const side = Math.sign(f.ear[i][0] - f.sc[0]);
    if ((q[0] - f.sc[0]) * side < 0.45 * f.sr[0]) continue;
    const ey = (q[1] - z.c[1]) / z.ry, ez = (q[2] - z.c[2]) / z.rz;
    if (Math.hypot(ey, ez) >= 1.08) continue;
    // Gradient of the ellipse (y, z), then its two tangents; take the one heading back/down.
    const gy = ey / z.ry, gz = ez / z.rz;
    let ty = -gz, tz = gy;
    if (ty * -0.5 + tz * -1 < 0) { ty = -ty; tz = -tz; }
    const outY = gy, outZ = gz; // a little outward so it clears the zone
    const l = Math.hypot(ty, tz) || 1, lo = Math.hypot(outY, outZ) || 1;
    return norm([dir[0] * 0.3, ty / l + 0.35 * outY / lo, tz / l + 0.35 * outZ / lo]);
  }
  return null;
}

/** A clump of follicles feeding one guide strand. */
export interface Clump {
  root: Follicle;
  members: number;
  /** RMS distance of its follicles from the root (m). */
  radius: number;
}

/** Farthest-point clumping: C roots spread over the field, each follicle joins its nearest root. */
export function clumpFollicles(follicles: Follicle[], count: number, seed: number): Clump[] {
  const n = follicles.length;
  const C = Math.max(0, Math.min(count, n));
  if (C === 0) return [];
  const centres: number[] = [Math.floor(hashUnit(seed ^ 0xc1) * n) % n];
  const dist = new Float64Array(n).fill(Infinity);
  const d2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (;;) {
    const last = follicles[centres[centres.length - 1]].p;
    let best = -1, bestD = -1;
    for (let i = 0; i < n; i++) {
      const d = d2(follicles[i].p, last);
      if (d < dist[i]) dist[i] = d;
      if (dist[i] > bestD) { bestD = dist[i]; best = i; }
    }
    if (centres.length >= C) break;
    centres.push(best);
  }
  const sums = centres.map(() => ({ m: 0, r2: 0 }));
  for (let i = 0; i < n; i++) {
    let bi = 0, bd = Infinity;
    for (let c = 0; c < centres.length; c++) {
      const d = d2(follicles[i].p, follicles[centres[c]].p);
      if (d < bd) { bd = d; bi = c; }
    }
    sums[bi].m++;
    sums[bi].r2 += bd;
  }
  return centres.map((ci, k) => ({ root: follicles[ci], members: sums[k].m, radius: Math.sqrt(sums[k].r2 / Math.max(1, sums[k].m)) }));
}

/** Why a strand ended. */
/** "blocked": the guards (ear zone / face plane / skull) stopped it before its length. */
export type CutBy = "length" | "fringe" | "plane" | "tie" | "blocked";

/** One grown guide strand. */
export interface GuideStrand {
  clump: number;
  root: Vec3;
  /** The centreline before curl (its arc length is the cut length). */
  spine: Vec3[];
  /** The final polyline (curl applied, guards applied). */
  points: Vec3[];
  /** Per-point width scale (1 on the scalp, narrower into a tie). */
  width: number[];
  /** Arc length of the spine (m), the target cut length (m), and why it stopped. */
  spineLength: number;
  target: number;
  cutBy: CutBy;
  /** Index from which the strand HANGS (moves with secondary motion); points.length = never. */
  hangFrom: number;
  /** "scalp" (loose), "tail" (ponytail/bun), "braid" (into braid i). */
  kind: "scalp" | "tail" | "braid";
  braid: number;
  /** Root sector 0..4 by azimuth (the secondary lock group it hangs in). */
  sector: number;
  /** Layer gap (m). */
  gap: number;
  /** Fringe strand (root on the forehead). */
  fringe: boolean;
  /** The clump's RMS follicle radius (m): the card width derives from it. */
  radius: number;
  /** Per point: the centre of the bundle this point wraps (a ponytail's axis), or null (the head). */
  axis: (Vec3 | null)[];
}

/** A braid: centreline, lateral axis, three interleaved bundles, and its end tie. */
export interface Braid {
  root: Vec3;
  spine: Vec3[];
  side: Vec3[];
  strands: [Vec3[], Vec3[], Vec3[]];
  /** Index on the spine of the end tie, its position and radius. */
  tieIndex: number;
  tie: Vec3;
  tieRadius: number;
  width: number;
  length: number;
}

/** A tie (ponytail band, bun pin, braid band). */
export interface Tie { p: Vec3; dir: Vec3; r: number; kind: "ponytail" | "bun" | "braid-root" | "braid-end" }

export interface HairGrowthResult {
  plan: HairPlan;
  strands: GuideStrand[];
  braids: Braid[];
  ties: Tie[];
  /** Integration step (m). */
  ds: number;
}

/** Direction on the unit sphere -> the skull surface point lifted by `gap`. */
function surfaceAt(f: HeadFrame, u: Vec3, gap: number): Vec3 {
  return atClearance(f, ellipsoidPoint(f, norm(u)), gap);
}

/** Grow a free-falling centreline from p0 (used by tails and braids): hugs the skull, then falls. */
function fallLine(f: HeadFrame, p0: Vec3, dir0: Vec3, length: number, gap: number, ds: number): Vec3[] {
  const pts: Vec3[] = [p0];
  let p = p0, dir = norm(dir0), s = 0;
  while (s < length - 1e-9) {
    const step = Math.min(ds, length - s);
    const below = p[1] < f.sc[1] - 0.6 * f.sr[1];
    const g: Vec3 = norm([0, -1, below ? -GROWTH.backDrift : 0]);
    dir = norm(add(mul(dir, 0.6), mul(g, 0.4)));
    let q = add(p, mul(dir, step));
    q = guardPoint(f, q, gap);
    s += step;
    pts.push(q);
    p = q;
  }
  return pts;
}

/** Arc length of a polyline. */
export function arcLength(pts: Vec3[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len3(sub(pts[i], pts[i - 1]));
  return s;
}

/** Orthonormal frame around a tangent t, with `out` as the preferred second axis. */
function frameAround(t: Vec3, out: Vec3): [Vec3, Vec3] {
  let b1 = norm(tproj(out, t), [1, 0, 0]);
  if (Math.abs(dot(b1, t)) > 0.99) b1 = norm(cross(t, [1, 0, 0]));
  const b2 = norm(cross(t, b1));
  return [b1, b2];
}

/** Horizontal outward direction from the head's vertical axis (the hanging mass's normal). */
function outward(f: HeadFrame, p: Vec3): Vec3 {
  return norm([p[0] - f.sc[0], 0, p[2] - f.sc[2]], [0, 0, -1]);
}

/** Tie point for a gathered style. */
function tieFor(f: HeadFrame, plan: HairPlan): { p: Vec3; kind: Tie["kind"] } | null {
  if (plan.style === "ponytail") return { p: surfaceAt(f, [0, 0.12, -1], 0.03 * f.h), kind: "ponytail" };
  if (plan.style === "topknot") return { p: surfaceAt(f, [0, 1, -0.4], 0.03 * f.h), kind: "bun" };
  return null;
}

/** Braid roots on the scalp: one at the back, or two behind the ears, or both. */
function braidRoots(f: HeadFrame, count: number): Vec3[] {
  const gap = 0.025 * f.h;
  const back = surfaceAt(f, [0, -0.25, -1], gap);
  const side = (s: number) => surfaceAt(f, [s * 0.7, -0.25, -0.95], gap);
  if (count <= 1) return [back];
  if (count === 2) return [side(1), side(-1)];
  return [side(1), back, side(-1)];
}

/** Build a three-strand braid from its root down `length` (m). */
export function buildBraid(f: HeadFrame, root: Vec3, length: number, ds: number, seed: number): Braid {
  const h = f.h;
  const dir0 = add(normalUnder(f, root), [0, -1.5, 0]);
  const spine = fallLine(f, root, dir0, length + GROWTH.braidTuft * h, 0.03 * h, ds);
  const width = GROWTH.braidWidth * h;
  const A = 0.5 * width, B = 0.22 * width;
  const omega = (2 * Math.PI) / (GROWTH.braidPitch * h);
  const phase0 = hashUnit(seed ^ 0x77) * Math.PI * 2;
  const side: Vec3[] = [], strands: [Vec3[], Vec3[], Vec3[]] = [[], [], []];
  let s = 0, tieIndex = spine.length - 1;
  for (let i = 0; i < spine.length; i++) {
    if (i > 0) s += len3(sub(spine[i], spine[i - 1]));
    if (s <= length + 1e-9) tieIndex = i;
    const t = norm(sub(spine[Math.min(spine.length - 1, i + 1)], spine[Math.max(0, i - 1)]));
    const out = outward(f, spine[i]);
    const sd = norm(cross(t, out), [1, 0, 0]);
    const dp = norm(cross(sd, t));
    side.push(sd);
    // The three bundles converge onto the centre at the root and at the end tie, then fan a little
    // in the tuft. Each interleaves on a figure-eight: lateral A·sin(φ), depth B·sin(2φ), with
    // φ = ωs + 2πk/3, so bundle k crosses the centre line every half period.
    const into = Math.min(1, s / (0.06 * h));
    const toTie = s <= length ? Math.min(1, (length - s) / (0.05 * h)) : 0;
    const tuft = s > length ? Math.min(1, (s - length) / (GROWTH.braidTuft * h)) : 0;
    for (let k = 0; k < 3; k++) {
      const phi = omega * s + phase0 + (2 * Math.PI * k) / 3;
      const env = into * toTie;
      const lat = A * Math.sin(phi) * env + tuft * 0.35 * width * Math.cos((2 * Math.PI * k) / 3);
      const dep = B * Math.sin(2 * phi) * env + tuft * 0.2 * width * Math.sin((2 * Math.PI * k) / 3);
      strands[k].push(guardPoint(f, add(spine[i], add(mul(sd, lat), mul(dp, dep))), 0.012 * h));
    }
  }
  return { root, spine, side, strands, tieIndex, tie: spine[tieIndex], tieRadius: 0.45 * width, width, length };
}

export interface GrowOpts {
  /** Guide strands wanted (the mesh's triangle budget decides it). */
  clumps: number;
  seed: number;
}

/**
 * Grow the hair: clump the follicles, grow one guide strand per clump, gather/braid/bun as the
 * style asks. Pure and deterministic for (frame, plan, follicles, opts).
 */
export function growHair(f: HeadFrame, plan: HairPlan, follicles: Follicle[], o: GrowOpts): HairGrowthResult {
  const h = f.h, ds = GROWTH.step * h;
  const result: HairGrowthResult = { plan, strands: [], braids: [], ties: [], ds };
  if (plan.style === "shaved" || follicles.length === 0) return result;
  let pool = follicles;
  if (plan.style === "mohawk") pool = follicles.filter((fo) => Math.abs(fo.p[0] - f.sc[0]) < 0.13 * h && fo.dy > -0.12);
  const clumps = clumpFollicles(pool, o.clumps, o.seed);
  const rng = hairRng(o.seed ^ 0x6e0f);
  const tie = tieFor(f, plan);
  if (tie) result.ties.push({ p: tie.p, dir: normalUnder(f, tie.p), r: GROWTH.tieRadius * h, kind: tie.kind });
  // Braids: roots, and their bundles.
  const roots = plan.braids > 0 ? braidRoots(f, plan.braids) : [];
  const braidLen = Math.max(0.8 * h, plan.lengthM - 0.3 * h);
  for (let b = 0; b < roots.length; b++) {
    const br = buildBraid(f, roots[b], braidLen, ds, o.seed + b * 101);
    result.braids.push(br);
    // The root band wraps the braid where it leaves the scalp: its axis is the braid's own start.
    result.ties.push({ p: roots[b], dir: norm(sub(br.spine[Math.min(2, br.spine.length - 1)], br.spine[0])), r: 0.45 * br.width, kind: "braid-root" });
    result.ties.push({ p: br.tie, dir: norm(sub(br.spine[Math.min(br.spine.length - 1, br.tieIndex + 1)], br.spine[Math.max(0, br.tieIndex - 1)])), r: br.tieRadius, kind: "braid-end" });
  }
  // The ponytail/bun centreline, shared by every gathered strand.
  let tail: Vec3[] = [];
  if (tie && tie.kind === "ponytail") {
    const tailLen = Math.max(0.5 * h, Math.min(2.2 * h, plan.lengthM - 0.4 * h));
    tail = fallLine(f, tie.p, add(normalUnder(f, tie.p), [0, -0.4, 0]), tailLen, 0.03 * h, ds);
    // The ponytail band wraps the tail's start, not the scalp normal.
    result.ties[0].dir = norm(sub(tail[Math.min(2, tail.length - 1)], tail[0]));
    result.ties[0].r = 0.75 * GROWTH.tailRadius * h;
  }
  const whorl = ellipsoidPoint(f, norm([0, 0.92, -0.39]));
  const partX = f.sc[0] + plan.parting * 0.35 * f.sr[0];
  const gapK = 0.6 + 0.6 * plan.density + (plan.style === "wild" ? 0.6 : 0);
  const fringeY = f.browY + FOLLICLE.fringeClearDy * h;
  const back = earBackZ(f);

  for (let c = 0; c < clumps.length; c++) {
    const cl = clumps[c];
    const root = cl.root.p, n0 = cl.root.n;
    const gap = (GROWTH.gapMin + (GROWTH.gapMax - GROWTH.gapMin) * rng()) * h * gapK;
    const az = cl.root.azimuth;
    const sector = Math.min(4, Math.floor(((az + Math.PI) / (2 * Math.PI)) * 5));
    const fringe = Math.abs(az) < 0.35 * Math.PI && root[2] > back;
    // Which gather target (if any) this strand heads for.
    let target: Vec3 | null = null, braidIdx = -1;
    if (result.braids.length > 0) {
      let bd = Infinity;
      for (let b = 0; b < result.braids.length; b++) {
        const d = len3(sub(root, result.braids[b].root));
        if (d < bd) { bd = d; braidIdx = b; }
      }
      if (plan.braidAll || bd < 0.3 * h) target = result.braids[braidIdx].root; else braidIdx = -1;
    } else if (tie) target = tie.p;
    // Free length: style length (jittered ±4 % so the cut edge is not a ruler line), crest stiff.
    const freeLen = plan.lengthM * (0.96 + 0.08 * rng());
    const flowAt = (p: Vec3, n: Vec3): Vec3 => {
      if (target) {
        // Toward the tie along the surface; from the far side of the head (the chord runs through
        // the skull) go down and back first so the strand wraps round instead of stalling.
        // Close to the tie: aim straight at it (the tangent of a chord this short spins round it).
        if (len3(sub(target, p)) < 0.12 * h) return norm(sub(target, p));
        const t = tproj(sub(target, p), n);
        const lt = len3(t);
        const fb = norm(tproj([0, -0.4, -1], n));
        return lt < 0.3 * len3(sub(target, p)) ? norm(add(mul(norm(t, fb), lt / Math.max(1e-9, len3(sub(target, p)))), fb)) : norm(t);
      }
      if (plan.sweep === "crest") return norm(add(n, [0, 0.35, -0.35]));
      if (plan.sweep === "parting") {
        const sg = p[0] >= partX ? 1 : -1;
        // Front strands sweep to the sides and back from the part instead of into the eyes.
        return norm(tproj([sg, -0.55, p[2] > f.sc[2] + 0.2 * f.sr[2] ? -0.35 : -0.1], n));
      }
      return norm(tproj(sub(p, whorl), n), norm(tproj([0, -1, -0.3], n)));
    };
    const spine: Vec3[] = [root];
    const width: number[] = [1];
    let p = root, s = 0;
    let dir = norm(add(mul(n0, 0.7), mul(flowAt(root, n0), 0.7)));
    let cutBy: CutBy = "length";
    let reached = false;
    // A gathered strand travels at most ~1.8x its chord to the tie (then it just ends: a strand
    // that cannot reach its tie must not wander round the head).
    let goal = target ? 1.8 * len3(sub(target, root)) + 0.15 * h : freeLen;
    let hangFrom = -1;
    let stuck = 0;
    while (s < goal - 1e-9) {
      const n = normalUnder(f, p);
      const fl = flowAt(p, n);
      const wFlow = target ? 1 : plan.sweep === "crest" ? 1 : Math.exp(-s / (GROWTH.flowFade * h));
      const below = p[1] < f.sc[1] - 0.6 * f.sr[1];
      const g: Vec3 = norm([0, -1, below ? -GROWTH.backDrift : 0]);
      const lift = Math.exp(-s / (GROWTH.liftLen * h)) * (plan.style === "wild" ? 0.8 : 0.5);
      const desired = norm(add(add(mul(fl, wFlow), mul(g, (1 - wFlow) * (plan.style === "wild" ? 0.6 : 1))), mul(n, lift)));
      dir = norm(add(mul(dir, 0.5), mul(desired, 0.5)));
      const step = Math.min(ds, goal - s);
      const slid = earSlide(f, p, dir, step);
      if (slid) dir = slid;
      let q = add(p, mul(dir, step));
      // Hug: above the skull's widest band the strand lies on the head at its gap.
      if (plan.sweep !== "crest" && q[1] > f.sc[1] - GROWTH.hugBand * f.sr[1]) q = atClearance(f, q, gap);
      // Fringe cut: a forehead strand stops above the brow.
      if (q[1] < fringeY + 0.01 * h && q[2] > back && fringe && !target) { cutBy = "fringe"; break; }
      // The bob's plane cut.
      if (plan.planeY !== null && q[1] < plan.planeY) { cutBy = "plane"; break; }
      const minGap = plan.sweep === "crest" ? 0.002 * h : Math.min(gap, 0.012 * h);
      q = guardPoint(f, q, minGap);
      let realStep = len3(sub(q, p));
      if (realStep < 1e-9) break;
      // The arc length is what is CUT: trim the last step to land on the length (the hug and the
      // guards can lengthen a step, so the step is measured, not assumed).
      if (s + realStep > goal) {
        q = guardPoint(f, add(p, mul(sub(q, p), (goal - s) / realStep)), minGap);
        realStep = len3(sub(q, p));
        // A guard threw the trimmed point past the length: cut here instead (short by < 1 step).
        if (s + realStep > goal + 1e-9) { if (goal - s > 1e-9 && !target) cutBy = "blocked"; break; }
      }
      // A strand pinned against a guard (it barely moves) is blocked: stop it.
      stuck = realStep < 0.3 * step ? stuck + 1 : 0;
      if (stuck >= 4) { cutBy = target ? cutBy : "blocked"; break; }
      s += realStep;
      spine.push(q);
      width.push(1);
      p = q;
      if (hangFrom < 0 && !target && q[1] < f.sc[1] - 0.2 * f.sr[1]) hangFrom = spine.length - 1;
      if (target && !reached && len3(sub(q, target)) < Math.max(GROWTH.tieRadius * h, 1.5 * ds)) {
        reached = true;
        cutBy = "tie";
        goal = s; // the scalp part ends at the tie
      }
    }
    const spineLength = arcLength(spine);
    if (target && !reached) cutBy = "blocked"; // never reached its tie: ends where the travel limit stopped it
    // Taper the width into a tie.
    if (target) for (let i = 0; i < width.length; i++) width[i] = 1 - 0.6 * Math.min(1, i / Math.max(1, width.length - 1)) ** 2;
    // Curl: a helix around the centreline growing in from the root.
    const amp = GROWTH.curlAmp * h * plan.curl * (plan.style === "wild" ? 1.4 : 1);
    const wave = (GROWTH.curlWaveStraight + (GROWTH.curlWaveCoiled - GROWTH.curlWaveStraight) * plan.curl) * h;
    const phase = rng() * Math.PI * 2;
    const points: Vec3[] = [];
    const axis: (Vec3 | null)[] = [];
    let acc = 0;
    for (let i = 0; i < spine.length; i++) {
      if (i > 0) acc += len3(sub(spine[i], spine[i - 1]));
      const t = norm(sub(spine[Math.min(spine.length - 1, i + 1)], spine[Math.max(0, i - 1)]));
      const [b1, b2] = frameAround(t, outward(f, spine[i]));
      // Strands lying on the scalp curl only sideways (b2), the hanging part in full helix.
      const ramp = Math.min(1, acc / (0.12 * h)) * (target ? Math.max(0, 1 - acc / Math.max(1e-6, spineLength)) : 1);
      const w = 2 * Math.PI * acc / wave + phase;
      const hug = spine[i][1] > f.sc[1] - GROWTH.hugBand * f.sr[1];
      const off = add(mul(b1, hug ? 0 : amp * ramp * Math.cos(w)), mul(b2, amp * ramp * Math.sin(w)));
      let q = guardPoint(f, add(spine[i], off), 0.004 * h);
      if (q[1] < fringeY && q[2] > back) q = [q[0], q[1], back];
      points.push(q);
      axis.push(null);
    }
    let kind: GuideStrand["kind"] = "scalp";
    // Gathered: continue into the tail / bun / braid.
    if (target && reached) {
      if (braidIdx >= 0) {
        kind = "braid";
        const br = result.braids[braidIdx];
        const bundle = br.strands[c % 3];
        for (let i = 1; i < bundle.length; i++) { points.push(bundle[i]); width.push(0.5); axis.push(br.spine[i]); }
      } else if (tie && tie.kind === "ponytail") {
        kind = "tail";
        const th = (c / Math.max(1, clumps.length)) * Math.PI * 2 * 7.13 + rng();
        const rr = GROWTH.tailRadius * h * (0.45 + 0.55 * rng());
        let ta = 0;
        for (let i = 1; i < tail.length; i++) {
          ta += len3(sub(tail[i], tail[i - 1]));
          const t = norm(sub(tail[Math.min(tail.length - 1, i + 1)], tail[i - 1]));
          const [b1, b2] = frameAround(t, outward(f, tail[i]));
          const u = ta / Math.max(1e-6, arcLength(tail));
          const R = rr * (1 + 1.6 * Math.sin(Math.PI * Math.min(1, u * 1.3)) * 0.6);
          const cw = 2 * Math.PI * ta / wave + phase;
          const cOff = add(mul(b1, amp * Math.cos(cw)), mul(b2, amp * Math.sin(cw)));
          points.push(guardPoint(f, add(add(tail[i], add(mul(b1, R * Math.cos(th)), mul(b2, R * Math.sin(th)))), cOff), 0.01 * h));
          width.push(0.6 * (1 - 0.45 * u));
          axis.push(tail[i]);
        }
      } else if (tie && tie.kind === "bun") {
        kind = "tail";
        const nT = normalUnder(f, tie.p);
        const [e1, e2] = frameAround(nT, [1, 0, 0]);
        const rb = GROWTH.bunRadius * h;
        const B = add(tie.p, mul(nT, 0.045 * h));
        const th0 = rng() * Math.PI * 2;
        const L = 2 * Math.PI * rb * 1.15;
        const steps = Math.max(6, Math.ceil(L / ds));
        const lift = (rng() - 0.5) * 0.04 * h;
        for (let i = 1; i <= steps; i++) {
          const u = i / steps, a = th0 + (L * u) / rb;
          const rad = rb * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.4)));
          points.push(add(B, add(add(mul(e1, rad * Math.cos(a)), mul(e2, rad * Math.sin(a))), mul(nT, lift + 0.03 * h * Math.sin(Math.PI * u)))));
          width.push(0.6);
          axis.push(B);
        }
      }
      hangFrom = kind === "tail" && tie?.kind === "bun" ? points.length : spine.length - 1;
    }
    if (hangFrom < 0) hangFrom = Math.max(1, Math.floor(points.length * 0.6));
    result.strands.push({
      clump: c, root, spine, points, width, spineLength, target: target ? spineLength : freeLen, cutBy, hangFrom, kind,
      braid: braidIdx, sector, gap, fringe, radius: cl.radius, axis,
    });
  }
  return result;
}
