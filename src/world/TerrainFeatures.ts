// TerrainFeatures: what gets stamped onto the heightfield (R07).
//
//   Pareto bumps/dips   many small, few large: amplitudes drawn from a capped, stratified
//                       Pareto so the top 20% of features hold ~80% of the amplitude; signs
//                       alternate by size rank (raise, dig, raise, ...), so every scale is
//                       balanced. Each radius is DERIVED from its amplitude so the bump
//                       respects the walkable slope: r = 1.5 A / (tan(maxSlope) * g).
//   cliffs              a terrace face: one side raised by H/2, the other dug by H/2 (opposite
//                       signs), so the face is an H jump over one cell. The face nodes are
//                       FLAGGED: the slope rule does not apply to them.
//   holes               a flat-bottomed pit of depth holeDepth below its rim, with a ramp exit
//                       that stays on the grid and out of the fight zone. FLAGGED.
//   ramps               a planar incline at rampSlopeTan carved through a hole wall or a
//                       cliff face so nothing is a trap. FLAGGED (kept planar by relaxation).
//
// Pure module: no Three.js, no DOM.
import { clamp, lerp, paretoSample, PARETO_80_20_ALPHA, smoothstep } from "../core/MathCore.ts";
import { PARETO_TOP_FRACTION, PROFILE_PEAK_SLOPE, stratifiedParetoSample, type DeliberateCounts, type TerrainRules } from "./TerrainRules.ts";

/**
 * featureMask values. 0 = ordinary ground, bound by the slope rule. They are distinct BITS
 * (exactly one is set on a flagged node), so a reader may test either `m === FEATURE_HOLE`
 * or `m & FEATURE_HOLE` (Lane F's minimap uses bit tests: pass it
 * `{ cliff: FEATURE_CLIFF, hole: FEATURE_HOLE }`).
 */
export const FEATURE_NONE = 0;
export const FEATURE_HOLE = 1;
export const FEATURE_CLIFF = 2;
export const FEATURE_RAMP = 4;

/** The ring outline as a polar function. */
export interface ArenaOutline {
  /** Distance from the arena centre to the ring edge along `angle` (radians, atan2(z, x)), m. */
  radiusAt(angle: number): number;
}

/** rNorm of a world point: distance from the centre / ring radius in that direction (0 at the centre). */
export function rNormAt(outline: ArenaOutline, x: number, z: number): number {
  const dist = Math.hypot(x, z);
  if (dist < 1e-9) return 0;
  return dist / Math.max(1e-6, outline.radiusAt(Math.atan2(z, x)));
}

export type TerrainFeatureKind = "bump" | "dip" | "hole" | "cliff" | "ramp";

/** One stamped feature, in world metres. Lane F (minimap) can draw these directly. */
export interface TerrainFeature {
  kind: TerrainFeatureKind;
  /** Centre, m. */
  x: number;
  z: number;
  /** Bump/dip/hole radius; cliff and ramp HALF-length, m. */
  radius: number;
  /** Signed height change, m: + raises (bump, cliff jump, ramp rise), - digs (dip, hole). */
  amplitude: number;
  /** Pareto draw in units of the local relief (bumps/dips only; 0 for deliberate features). */
  relative: number;
  /** Unit direction: cliff = toward the raised side, ramp = uphill. (0, 0) for discs. */
  dirX: number;
  dirZ: number;
}

/** The mutable grid the stamps write into while generating (float64 heights). */
export interface WorkGrid {
  cols: number;
  rows: number;
  /** Node spacing, m. */
  cell: number;
  /** World position of node (0, 0), m. */
  originX: number;
  originZ: number;
  /** Heights, m (or relative units before the relief scaling). */
  h: Float64Array;
  /** featureMask codes per node. */
  mask: Uint8Array;
}

/** Visit nodes whose world position lies within the axis-aligned box [x0,x1] x [z0,z1]. */
function forNodesInBox(g: WorkGrid, x0: number, x1: number, z0: number, z1: number, visit: (n: number, x: number, z: number) => void): void {
  const i0 = Math.max(0, Math.ceil((x0 - g.originX) / g.cell)), i1 = Math.min(g.cols - 1, Math.floor((x1 - g.originX) / g.cell));
  const j0 = Math.max(0, Math.ceil((z0 - g.originZ) / g.cell)), j1 = Math.min(g.rows - 1, Math.floor((z1 - g.originZ) / g.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) visit(j * g.cols + i, g.originX + i * g.cell, g.originZ + j * g.cell);
  }
}

/** Bilinear sample of the working heights at world (x, z), clamped to the grid. */
export function sampleWork(g: WorkGrid, x: number, z: number): number {
  const fx = clamp((x - g.originX) / g.cell, 0, g.cols - 1), fz = clamp((z - g.originZ) / g.cell, 0, g.rows - 1);
  const i = Math.min(g.cols - 2, Math.floor(fx)), j = Math.min(g.rows - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j, n = j * g.cols + i;
  const top = lerp(g.h[n], g.h[n + 1], tx), bottom = lerp(g.h[n + g.cols], g.h[n + g.cols + 1], tx);
  return lerp(top, bottom, tz);
}

/**
 * Stamp the Pareto bumps and dips into `g.h` (RELATIVE units: 1 = the local relief).
 * `reliefAt(x, z)` gives the local relief in metres, used to derive each radius from
 * the slope rule. Returns the feature list (amplitudes in metres at the centre).
 */
export function stampParetoBumps(g: WorkGrid, rules: TerrainRules, reliefAt: (x: number, z: number) => number, rng: () => number): TerrainFeature[] {
  const n = rules.featureCount;
  const drawn = stratifiedParetoSample(rng, n, 1 / rules.featureCapRatio, rules.featureAlpha, rules.featureCapRatio);
  // Opposite signs by size rank: the largest raises, the next digs, ... (first sign random).
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => drawn[b] - drawn[a]);
  const firstSign = rng() < 0.5 ? 1 : -1;
  const sign = new Int8Array(n);
  order.forEach((idx, rank) => { sign[idx] = rank % 2 === 0 ? firstSign : -firstSign; });
  const slopeBudget = rules.maxSlopeTan * rules.featureSlopeUse;
  const halfX = ((g.cols - 1) * g.cell) / 2, halfZ = ((g.rows - 1) * g.cell) / 2;
  const out: TerrainFeature[] = [];
  for (let k = 0; k < n; k++) {
    const x = lerp(-halfX, halfX, rng()), z = lerp(-halfZ, halfZ, rng());
    const relief = Math.max(1e-6, reliefAt(x, z));
    // r = 1.5 A / slopeBudget, clamped to the representable range; if clamped at the top,
    // the amplitude is cut back so the slope rule still holds: A = r * slopeBudget / 1.5.
    const radius = clamp((PROFILE_PEAK_SLOPE * drawn[k] * relief) / slopeBudget, rules.featureMinRadius, rules.featureMaxRadius);
    const relative = Math.min(drawn[k], (radius * slopeBudget) / (PROFILE_PEAK_SLOPE * relief));
    const signed = sign[k] * relative;
    forNodesInBox(g, x - radius, x + radius, z - radius, z + radius, (node, nx, nz) => {
      const dist = Math.hypot(nx - x, nz - z);
      if (dist < radius) g.h[node] += signed * (1 - smoothstep(0, radius, dist));
    });
    out.push({ kind: signed >= 0 ? "bump" : "dip", x, z, radius, amplitude: signed * relief, relative: drawn[k], dirX: 0, dirZ: 0 });
  }
  return out;
}

/** What `stampDeliberate` placed (it skips a feature when no legal spot exists). */
export interface DeliberateResult {
  features: TerrainFeature[];
  placed: DeliberateCounts;
}

interface Footprint { x: number; z: number; r: number }

/**
 * Stamp cliffs, then holes (each with a ramp exit), then a ramp up each cliff, onto the
 * METRE heights in `g.h`, flagging their nodes in `g.mask`. Placement keeps every stamp
 * out of the fight zone (rNorm >= fightZoneFraction) and off the other deliberate stamps;
 * up to `attempts` tries per feature, derived as ceil(1 / d^2) = 25.
 */
export function stampDeliberate(g: WorkGrid, rules: TerrainRules, outline: ArenaOutline, counts: DeliberateCounts, rng: () => number): DeliberateResult {
  const d = PARETO_TOP_FRACTION;
  const attempts = Math.ceil(1 / (d * d));
  const features: TerrainFeature[] = [];
  const taken: Footprint[] = [];
  const placed: DeliberateCounts = { holes: 0, cliffs: 0, ramps: 0 };
  const halfX = ((g.cols - 1) * g.cell) / 2, halfZ = ((g.rows - 1) * g.cell) / 2;
  const fightEdge = rules.fightZoneFraction + g.cell / rules.base.arenaRadius;
  const outerBand = 1 + rules.base.outsideMarginFraction * rules.featureSlopeUse;
  /** Every probe point (corners, edge midpoints, nearest point to the centre) outside the fight zone. */
  const clearOfFight = (pts: [number, number][]) => pts.every(([x, z]) => rNormAt(outline, x, z) >= fightEdge);
  const inGrid = (x: number, z: number, pad: number) => Math.abs(x) <= halfX - pad && Math.abs(z) <= halfZ - pad;
  const freeOf = (f: Footprint) => taken.every((t) => Math.hypot(t.x - f.x, t.z - f.z) > t.r + f.r + 2 * g.cell);
  /** A random centre in the band between the fight zone and the outskirts, plus its outward unit vector. */
  const candidate = () => {
    const angle = rng() * Math.PI * 2;
    const r = lerp(rules.fightZoneFraction, outerBand, rng()) * outline.radiusAt(angle);
    // Rotate the outward normal by up to +-d*pi so features are not all perfectly radial.
    const turn = angle + (rng() * 2 - 1) * d * Math.PI;
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r, nx: Math.cos(turn), nz: Math.sin(turn) };
  };

  // ---- cliffs: terrace faces, raised side outward (the arena reads as a bowl) ----
  const cliffHalf = rules.cliffHeight / 2;
  const cliffWidth = rules.cliffSlopeWidth;
  const cliffs: TerrainFeature[] = [];
  for (let c = 0; c < counts.cliffs; c++) {
    const halfLength = cliffWidth * (1 + rng()); // in [W, 2W] so the end taper fits
    for (let a = 0; a < attempts; a++) {
      const p = candidate();
      const tx = -p.nz, tz = p.nx;
      const corners: [number, number][] = [[p.x, p.z]];
      for (const su of [-1, 0, 1]) for (const sv of [-1, 0, 1]) corners.push([p.x + tx * su * halfLength + p.nx * sv * cliffWidth, p.z + tz * su * halfLength + p.nz * sv * cliffWidth]);
      // The rectangle's point nearest the arena centre: the centre in the (u, v) frame, clamped.
      const cu = clamp(-(p.x * tx + p.z * tz), -halfLength, halfLength), cv = clamp(-(p.x * p.nx + p.z * p.nz), -cliffWidth, cliffWidth);
      corners.push([p.x + tx * cu + p.nx * cv, p.z + tz * cu + p.nz * cv]);
      const fp = { x: p.x, z: p.z, r: Math.hypot(halfLength, cliffWidth) };
      if (!inGrid(p.x, p.z, g.cell) || !clearOfFight(corners) || !freeOf(fp)) continue;
      forNodesInBox(g, p.x - fp.r, p.x + fp.r, p.z - fp.r, p.z + fp.r, (node, x, z) => {
        const u = (x - p.x) * tx + (z - p.z) * tz, v = (x - p.x) * p.nx + (z - p.z) * p.nz;
        if (Math.abs(u) > halfLength || Math.abs(v) > cliffWidth) return;
        const taper = 1 - smoothstep(halfLength - cliffWidth, halfLength, Math.abs(u));
        const profile = 1 - smoothstep(0, cliffWidth, Math.abs(v));
        g.h[node] += (v >= 0 ? cliffHalf : -cliffHalf) * profile * taper; // raise one side, dig the other
        if (Math.abs(v) < g.cell) g.mask[node] = FEATURE_CLIFF;
      });
      taken.push(fp);
      const f: TerrainFeature = { kind: "cliff", x: p.x, z: p.z, radius: halfLength, amplitude: rules.cliffHeight, relative: 0, dirX: p.nx, dirZ: p.nz };
      features.push(f);
      cliffs.push(f);
      placed.cliffs++;
      break;
    }
  }

  // ---- holes, each with a ramp exit carved outward ----
  let rampsLeft = counts.ramps;
  const rampRun = rules.holeExitRun; // horizontal run to climb one hole depth
  for (let hIdx = 0; hIdx < counts.holes; hIdx++) {
    const radius = paretoSample(rng, rules.holeRadiusMin, PARETO_80_20_ALPHA, rules.holeRadiusMax);
    for (let a = 0; a < attempts; a++) {
      const p = candidate();
      const ring: [number, number][] = [[p.x, p.z]];
      for (let k = 0; k < 8; k++) ring.push([p.x + Math.cos((k * Math.PI) / 4) * radius, p.z + Math.sin((k * Math.PI) / 4) * radius]);
      const centreDist = Math.hypot(p.x, p.z) || 1; // the rim point nearest the arena centre
      ring.push([p.x - (p.x / centreDist) * radius, p.z - (p.z / centreDist) * radius]);
      // The exit ramp may leave in any direction, so the footprint covers its full run all round.
      const fp = { x: p.x, z: p.z, r: radius + rampRun };
      if (!inGrid(p.x, p.z, radius + g.cell) || !clearOfFight(ring) || !freeOf(fp)) continue;
      // Exit direction: along the ring first (tangents), then outward, then inward; the first
      // whose whole run (twice the nominal run, as carveRamp may need) stays on the grid and
      // out of the fight zone. No legal direction -> try another spot.
      const reach = radius + 2 * rampRun;
      const exits: [number, number][] = [[-p.nz, p.nx], [p.nz, -p.nx], [p.nx, p.nz], [-p.nx, -p.nz]];
      const exit = exits.find(([ux, uz]) => {
        const probe: [number, number][] = [];
        for (let k = 1; k <= 4; k++) probe.push([p.x + ux * (reach * k) / 4, p.z + uz * (reach * k) / 4]);
        return probe.every(([x, z]) => inGrid(x, z, rules.rampHalfWidth + g.cell)) && clearOfFight(probe);
      });
      if (!exit) continue;
      // Depth is measured from the rim: the mean height of the ring just outside the radius.
      let rim = 0;
      for (let k = 0; k < 16; k++) rim += sampleWork(g, p.x + Math.cos((k * Math.PI) / 8) * (radius + g.cell), p.z + Math.sin((k * Math.PI) / 8) * (radius + g.cell));
      const bottom = rim / 16 - rules.holeDepth;
      forNodesInBox(g, p.x - radius, p.x + radius, p.z - radius, p.z + radius, (node, x, z) => {
        if (Math.hypot(x - p.x, z - p.z) <= radius) { g.h[node] = bottom; g.mask[node] = FEATURE_HOLE; }
      });
      taken.push(fp);
      features.push({ kind: "hole", x: p.x, z: p.z, radius, amplitude: -rules.holeDepth, relative: 0, dirX: 0, dirZ: 0 });
      placed.holes++;
      if (rampsLeft > 0) {
        const ramp = carveRamp(g, rules, p.x, p.z, exit[0], exit[1], bottom, radius + g.cell, reach);
        features.push(ramp);
        placed.ramps++;
        rampsLeft--;
      }
      break;
    }
  }

  // ---- one ramp up each cliff, while ramps remain: a causeway rising through the face ----
  for (const c of cliffs) {
    if (rampsLeft <= 0) break;
    const top = sampleWork(g, c.x + c.dirX * g.cell, c.z + c.dirZ * g.cell);
    // Fixed point: run S so that plane(0) = terrain(start) and plane(S) = top of the face.
    let run = rules.cliffHeight / rules.rampSlopeTan;
    for (let it = 0; it < 4; it++) {
      const start = sampleWork(g, c.x - c.dirX * run, c.z - c.dirZ * run);
      run = clamp((top - start) / rules.rampSlopeTan, g.cell, 4 * rules.cliffHeight / rules.rampSlopeTan);
    }
    const ox = c.x - c.dirX * run, oz = c.z - c.dirZ * run;
    features.push(carveRamp(g, rules, ox, oz, c.dirX, c.dirZ, sampleWork(g, ox, oz), run + g.cell, run + 2 * g.cell + rules.cliffHeight / rules.rampSlopeTan));
    placed.ramps++;
    rampsLeft--;
  }
  return { features, placed };
}

/**
 * Carve a planar ramp: plane(s) = h0 + rampSlopeTan * s along the unit direction (ux, uz)
 * from (ox, oz). It runs at least to `mustPass` and stops at the first s where the plane
 * reaches the original terrain on its centre line (so the top joins the ground flush), or
 * at `maxLength`. Every node within rampHalfWidth of the centre line is set to the plane
 * and flagged FEATURE_RAMP.
 */
function carveRamp(g: WorkGrid, rules: TerrainRules, ox: number, oz: number, ux: number, uz: number, h0: number, mustPass: number, maxLength: number): TerrainFeature {
  const step = g.cell / 2;
  let length = maxLength;
  for (let s = mustPass; s <= maxLength; s += step) {
    if (h0 + rules.rampSlopeTan * s >= sampleWork(g, ox + ux * s, oz + uz * s)) { length = s; break; }
  }
  const w = rules.rampHalfWidth, tx = -uz, tz = ux;
  const reach = Math.hypot(length, w);
  forNodesInBox(g, ox - reach, ox + reach, oz - reach, oz + reach, (node, x, z) => {
    const s = (x - ox) * ux + (z - oz) * uz, l = (x - ox) * tx + (z - oz) * tz;
    if (s < 0 || s > length || Math.abs(l) > w) return;
    g.h[node] = h0 + rules.rampSlopeTan * s;
    g.mask[node] = FEATURE_RAMP;
  });
  return {
    kind: "ramp", x: ox + ux * length / 2, z: oz + uz * length / 2, radius: length / 2,
    amplitude: rules.rampSlopeTan * length, relative: 0, dirX: ux, dirZ: uz,
  };
}
