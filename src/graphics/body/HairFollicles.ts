// Wave X lane H: hair FOLLICLES on the skull (pure — no THREE, no DOM, no Math.random).
//
// Hair is no longer a cap shell plus fall tubes: it is GROWN. This module places the roots. A
// follicle is a point ON the skull ellipsoid (the cranium FaceAnchors state: skullCentre +
// skullRadii) inside a HAIRLINE region:
//   * front: a forehead line above the brow, lower toward the temples (an elder male recedes:
//     the temples rise first — the M — then the centre, and a strong recession opens the crown);
//   * sides: down to the brow line in front of the ear, down to the nape behind it;
//   * the EAR and its surround carry no follicle (the ear pokes through; a pointed ear's zone
//     reaches up and back toward its tip);
//   * nape: the back hairline sits at about mouth level.
// Spacing is Poisson-disc-ish (random sequential addition with a minimum distance, seeded from
// lookSeed), and the COUNT scales with the ancestry's hair density and the region's area.

import type { Vec3 } from "./contracts.ts";

/** Stated numbers of the follicle field (head heights h unless stated). */
export const FOLLICLE = {
  /** Follicles per h² of hairline region at density 1 (a stylised field, not 100k real hairs). */
  perH2AtDensity1: 900,
  /** Minimum follicle spacing as a fraction of the mean spacing sqrt(area / N). */
  spacingFrac: 0.7,
  /** Dart-throwing attempts per wanted follicle before the field is declared full. */
  attemptsPer: 40,
  /** Front hairline above the skull centre at the forehead's middle (h) — the brow is at +0.10 h. */
  frontLineDy: 0.25,
  /** How far the hairline drops toward the temples (h): temples sit at frontLineDy − this. */
  templeDrop: 0.10,
  /** Hairline in front of the ear (side), above the skull centre (h): just above the brow. */
  sideLineDy: 0.13,
  /** The nape hairline below the skull centre (h) — about mouth level. */
  napeDy: -0.30,
  /** Recession: the temples rise by this much at recession 1 (h), the centre by centreRise. */
  templeRise: 0.13,
  centreRise: 0.06,
  /** Recession above which the crown opens (a bald spot of this angular radius at recession 1, rad). */
  crownOpenAt: 0.7,
  crownSpotRad: 0.45,
  /** The face/ear guard: hair in front of the ear's back plane stays above browY + this (h). */
  fringeClearDy: 0.03,
  /** Ear exclusion zone around the ear anchor: half-height × the ear height, half-depth (h). */
  earZoneHalfHeightPerEar: 0.62,
  earZoneHalfDepth: 0.13,
  /** A pointed ear's zone grows by this fraction and shifts up/back toward its tip (h). */
  earPointGrow: 0.8,
  earPointUp: 0.10,
  earPointBack: 0.05,
} as const;

/** Canon ear height over head height (AnatomyParts.EAR_HEIGHT_PER_HEAD's value, read-only copy). */
export const EAR_H_PER_HEAD = 0.286;

/**
 * The head the hair grows on, in ONE coordinate space (head-bone space in the game, model space
 * in tests): the skull ellipsoid, the brow line, the ears and the chin.
 */
export interface HeadFrame {
  h: number;
  /** Skull ellipsoid centre and radii (the cranium of AnatomyParts.headNode). */
  sc: Vec3;
  sr: Vec3;
  /** Brow ridge height (the fringe never comes below it). */
  browY: number;
  /** Ear anchors (pinna centres), L then R. */
  ear: [Vec3, Vec3];
  /** Ear height (m) and its pointedness 0..1 (elf = 1). */
  earH: number;
  earPointed: number;
  chinY: number;
  mouthY: number;
}

/** Build the frame from FaceAnchors-like data, shifted by `origin` (anchor − origin = local). */
export function headFrameOf(
  face: { skullCentre: Vec3; skullRadii: Vec3; brow: [Vec3, Vec3]; ear: [Vec3, Vec3]; chin: Vec3; mouth: Vec3 },
  origin: Vec3, h: number, earLengthMul: number,
): HeadFrame {
  const at = (p: Vec3): Vec3 => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  const pointed = Math.max(0, Math.min(1, (earLengthMul - 1) / (1.9 - 1)));
  return {
    h, sc: at(face.skullCentre), sr: [...face.skullRadii] as Vec3,
    browY: at(face.brow[0])[1], ear: [at(face.ear[0]), at(face.ear[1])],
    earH: EAR_H_PER_HEAD * h * Math.min(1, earLengthMul), earPointed: pointed,
    chinY: at(face.chin)[1], mouthY: at(face.mouth)[1],
  };
}

/** A hair root on the skull. */
export interface Follicle {
  /** On the skull ellipsoid surface. */
  p: Vec3;
  /** Outward unit normal of the ellipsoid there. */
  n: Vec3;
  /** Azimuth around the vertical axis (0 = straight forward, +π/2 = +x side) and height dy/h. */
  azimuth: number;
  dy: number;
}

/** Point on the skull ellipsoid along unit sphere direction u. */
export function ellipsoidPoint(f: HeadFrame, u: Vec3): Vec3 {
  return [f.sc[0] + f.sr[0] * u[0], f.sc[1] + f.sr[1] * u[1], f.sc[2] + f.sr[2] * u[2]];
}

/** Outward unit normal of the skull ellipsoid at a SURFACE point. */
export function ellipsoidNormal(f: HeadFrame, p: Vec3): Vec3 {
  const nx = (p[0] - f.sc[0]) / (f.sr[0] * f.sr[0]), ny = (p[1] - f.sc[1]) / (f.sr[1] * f.sr[1]), nz = (p[2] - f.sc[2]) / (f.sr[2] * f.sr[2]);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Signed radial distance of p from the skull surface along the ray from the centre (> 0 outside). */
export function radialError(f: HeadFrame, p: Vec3): number {
  const dx = p[0] - f.sc[0], dy = p[1] - f.sc[1], dz = p[2] - f.sc[2];
  const q = Math.hypot(dx / f.sr[0], dy / f.sr[1], dz / f.sr[2]);
  const d = Math.hypot(dx, dy, dz);
  return q < 1e-12 ? -d : d * (q - 1) / q;
}

/** z of the ear's back plane: hair below the brow line must stay behind it (head-local). */
export function earBackZ(f: HeadFrame): number {
  return f.ear[0][2] - FOLLICLE.earZoneHalfDepth * f.h * 0.75;
}

/** The ear exclusion ellipse (in the y-z plane) for ear i: centre and half-axes. */
export function earZone(f: HeadFrame, i: 0 | 1): { c: Vec3; ry: number; rz: number } {
  const e = f.ear[i];
  const grow = 1 + FOLLICLE.earPointGrow * f.earPointed;
  return {
    c: [e[0], e[1] + FOLLICLE.earPointUp * f.h * f.earPointed, e[2] - FOLLICLE.earPointBack * f.h * f.earPointed],
    ry: FOLLICLE.earZoneHalfHeightPerEar * f.earH * grow,
    rz: FOLLICLE.earZoneHalfDepth * f.h * (1 + 0.4 * f.earPointed),
  };
}

/** Normalised ellipse radius of p in ear i's zone (< 1 inside), only on that ear's side of the head. */
export function earZoneQ(f: HeadFrame, p: Vec3, i: 0 | 1): number {
  const z = earZone(f, i);
  const side = Math.sign(f.ear[i][0] - f.sc[0]);
  if ((p[0] - f.sc[0]) * side < 0.45 * f.sr[0]) return Infinity; // the other half of the head
  return Math.hypot((p[1] - z.c[1]) / z.ry, (p[2] - z.c[2]) / z.rz);
}

/**
 * True when p lies on the FACE (in front of the ear's back plane and below browY + the fringe
 * clearance) or in an EAR zone. No follicle may sit here; no hair vertex may either.
 */
export function onFaceOrEar(f: HeadFrame, p: Vec3): boolean {
  if (p[2] > earBackZ(f) && p[1] < f.browY + FOLLICLE.fringeClearDy * f.h) return true;
  return earZoneQ(f, p, 0) < 1 || earZoneQ(f, p, 1) < 1;
}

/** Male-pattern recession 0..1 (male only; elves never recede). `lifeFraction` from Age.ts. */
export function recessionFor(sex: string | undefined, race: string | null | undefined, lifeFraction: number, seedUnit: number): number {
  if ((sex ?? "male") !== "male" || race === "elf") return 0;
  const t = Math.max(0, Math.min(1, (lifeFraction - 0.45) / 0.4));
  return t * (0.35 + 0.65 * seedUnit);
}

/** Lowest allowed hairline height (dy/h above the skull centre) at azimuth az, for a recession. */
export function hairlineDy(f: HeadFrame, az: number, z: number, recession: number): number {
  const a = Math.abs(az);
  if (z <= earBackZ(f)) return FOLLICLE.napeDy; // behind the ear: down to the nape
  const front = 0.35 * Math.PI;
  if (a < front) {
    const k = a / front;
    // Forehead line: high in the middle, dropping toward the temples. Recession raises the
    // temples (sin bump peaking at k ~ 0.75: the M) and, less, the middle.
    const base = FOLLICLE.frontLineDy - FOLLICLE.templeDrop * k * k;
    const rise = recession * (FOLLICLE.centreRise + (FOLLICLE.templeRise - FOLLICLE.centreRise) * Math.sin(Math.min(1, k / 0.75) * Math.PI / 2));
    return base + rise;
  }
  return FOLLICLE.sideLineDy + recession * FOLLICLE.templeRise * 0.6;
}

/** Whether a SURFACE point lies in the hairline region (for this recession). */
export function inHairRegion(f: HeadFrame, p: Vec3, recession: number): boolean {
  const dx = p[0] - f.sc[0], dz = p[2] - f.sc[2];
  const az = Math.atan2(dx / f.sr[0], dz / f.sr[2]);
  const dy = (p[1] - f.sc[1]) / f.h;
  if (dy < hairlineDy(f, az, p[2], recession)) return false;
  if (onFaceOrEar(f, p)) return false;
  if (recession > FOLLICLE.crownOpenAt) {
    // The crown opens: a spot around the vertex (top, slightly back) of growing angular radius.
    const u: Vec3 = [dx / f.sr[0], (p[1] - f.sc[1]) / f.sr[1], dz / f.sr[2]];
    const l = Math.hypot(...u) || 1;
    const v: Vec3 = [0, 0.92, -0.39];
    const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / l)));
    const rad = FOLLICLE.crownSpotRad * (recession - FOLLICLE.crownOpenAt) / (1 - FOLLICLE.crownOpenAt);
    if (ang < rad) return false;
  }
  return true;
}

/** Deterministic PRNG (mulberry32) — no Math.random. */
export function hairRng(seed: number): () => number {
  let a = (seed ^ 0x6a09e667) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform direction on the unit sphere from two uniforms. */
function sphereDir(u1: number, u2: number): Vec3 {
  const y = 1 - 2 * u1, r = Math.sqrt(Math.max(0, 1 - y * y)), phi = 2 * Math.PI * u2;
  return [r * Math.sin(phi), y, r * Math.cos(phi)];
}

/** Approximate area (m²) of the ellipsoid surface inside the hair region (Fibonacci sampling). */
export function hairRegionArea(f: HeadFrame, recession: number, samples = 3000): number {
  // Surface area element of an ellipsoid parametrised by the sphere direction: |J| = |sr|·|n_scaled|.
  let inside = 0, total = 0;
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < samples; i++) {
    const y = 1 - (2 * (i + 0.5)) / samples, r = Math.sqrt(1 - y * y), phi = i * ga;
    const u: Vec3 = [r * Math.sin(phi), y, r * Math.cos(phi)];
    const w = Math.hypot(u[0] * f.sr[1] * f.sr[2], u[1] * f.sr[0] * f.sr[2], u[2] * f.sr[0] * f.sr[1]);
    total += w;
    if (inHairRegion(f, ellipsoidPoint(f, u), recession)) inside += w;
  }
  return (4 * Math.PI * total / samples) * (inside / Math.max(1e-12, total));
}

/** Options of the follicle field. */
export interface FollicleOpts {
  density: number;
  seed: number;
  recession?: number;
}

/** The follicle field: roots on the scalp, Poisson-disc-ish, count ∝ density × region area. */
export interface FollicleField {
  follicles: Follicle[];
  /** The count asked for and the minimum spacing used (m). */
  target: number;
  spacing: number;
  areaM2: number;
  recession: number;
}

/** Place the follicles (deterministic per seed). */
export function placeFollicles(f: HeadFrame, o: FollicleOpts): FollicleField {
  const recession = o.recession ?? 0;
  const area = hairRegionArea(f, recession);
  const d = Math.max(0, Math.min(1, o.density));
  const target = Math.max(0, Math.round(FOLLICLE.perH2AtDensity1 * d * area / (f.h * f.h)));
  const spacing = target > 0 ? FOLLICLE.spacingFrac * Math.sqrt(area / target) : 0;
  const rng = hairRng(o.seed);
  const out: Follicle[] = [];
  // Spatial hash on the spacing so each candidate checks only its neighbours.
  const cell = Math.max(spacing, 1e-6);
  const grid = new Map<string, Vec3[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const s2 = spacing * spacing;
  const maxAttempts = target * FOLLICLE.attemptsPer;
  for (let k = 0; k < maxAttempts && out.length < target; k++) {
    const u = sphereDir(rng(), rng());
    const p = ellipsoidPoint(f, u);
    if (!inHairRegion(f, p, recession)) continue;
    const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
    let ok = true;
    for (let ix = -1; ix <= 1 && ok; ix++) for (let iy = -1; iy <= 1 && ok; iy++) for (let iz = -1; iz <= 1 && ok; iz++) {
      for (const q of grid.get(`${cx + ix},${cy + iy},${cz + iz}`) ?? []) {
        const ddx = q[0] - p[0], ddy = q[1] - p[1], ddz = q[2] - p[2];
        if (ddx * ddx + ddy * ddy + ddz * ddz < s2) { ok = false; break; }
      }
    }
    if (!ok) continue;
    const kk = key(p[0], p[1], p[2]);
    const list = grid.get(kk);
    if (list) list.push(p); else grid.set(kk, [p]);
    out.push({
      p, n: ellipsoidNormal(f, p),
      azimuth: Math.atan2((p[0] - f.sc[0]) / f.sr[0], (p[2] - f.sc[2]) / f.sr[2]),
      dy: (p[1] - f.sc[1]) / f.h,
    });
  }
  return { follicles: out, target, spacing, areaM2: area, recession };
}
