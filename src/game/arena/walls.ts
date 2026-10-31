// Wall plans (wave J, lane J-T): the perimeter wall is no longer one height all the way round.
// A plan COMBINES 1..3 rules (contracts.ts WallRuleKind) into WALL_SEGMENTS = 48 segments of
// 7.5° each, segment k spanning [k·Δ, (k+1)·Δ) with Δ = 2π/48 (the last one ends at exactly 2π).
//
// Heights (m above the rim) — DRASTICALLY lower than the old single 1.4..6 m wall:
//   base B = cfg.wallHeight (randomArena: 0.4 + 1.2·u^1.5, median ≈ 0.82 m)
//   none        0
//   low         cfg.wallLow (0.3..0.9: a curb; under WALL_BLOCK_HEIGHT = 0.6 a knocked body trips over)
//   full        B
//   ruin        B·(0.35 + 1.1·(v − cut)/(1 − cut)) where the periodic 1D value noise v ≥ cut, else 0
//   battlement  merlons max(B, 0.8·wallTall), crenels min(wallLow, 0.5) (open), period P ∈ {4, 6, 8, 12} segments
//   gates       B with `count` openings of width wallGate (≥ 15° = 2 segments) centred on the gate bearings
//   half        B on an arc of span wallArc, 0 elsewhere
//   towers      wallLow with `count` towers of wallTall (each ±0.75 segment wide)
//   every segment is clamped to [0, WALL_MAX_HEIGHT = 3.5 m]; under 0.05 m counts as 0 (an opening).
// Combine (weights sum to 1): blend Σ w·h · max · min (rules with weight 0 skipped) · sectors (each
// rule owns a contiguous share w of the fundamental domain).
//
// Symmetry: every rule is evaluated at the bearing FOLDED into the group's fundamental domain
// (symmetry.ts foldHalfSteps), so the plan is G-invariant by construction. With the mirror axis on
// the 3.75° lattice and the rotational order dividing 48 (2, 3, 4, 6) the fold maps segment centres
// onto segment centres exactly; rotational order 5 is invariant as a FUNCTION but sampled on a
// lattice it does not divide (a transition may land one segment off its image: a documented gap).
// Gate bearings sit perpendicular to the spawn line (each fighter equidistant from each gate).
//
// Deterministic: only `seed` (ruin noise) and cfg are read; no Math.random.
// Pure module: no Three.js, no DOM.
import { rng32 } from "../../core/MathCore.ts";
import type { ArenaConfig } from "../ArenaConfig.ts";
import {
  NO_SYMMETRY, WALL_BLOCK_HEIGHT, WALL_RULE_KINDS, WALL_SEGMENTS,
  type SymmetrySpec, type WallCombine, type WallPlan, type WallRule, type WallRuleKind, type WallSegment,
} from "./contracts.ts";
import { AXIS_STEP_DEG, foldHalfSteps } from "./symmetry.ts";
import { seatBearing } from "./spawns.ts";

/** Tallest wall any rule builds, m (towers, merlons). */
export const WALL_MAX_HEIGHT = 3.5;
/** A segment lower than this is an opening (height 0), m. */
export const WALL_MIN_HEIGHT = 0.05;
/** Battlement periods allowed (divisors of 48, so the pattern closes round the rim). */
export const BATTLEMENT_PERIODS = [4, 6, 8, 12] as const;
/** Narrowest gate, rad (two segments: a 32-ray digest always sees it). */
export const GATE_MIN_WIDTH = (2 * 2 * Math.PI) / WALL_SEGMENTS;
/** Order of the wallCombine parameter. */
export const WALL_COMBINES: readonly WallCombine[] = ["blend", "max", "min", "sectors"];

const TAU = Math.PI * 2;
const SEG = TAU / WALL_SEGMENTS;
const DEG = Math.PI / 180;
const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
/** Smallest |a − b| between two bearings, rad. */
const angDiff = (a: number, b: number) => { const d = (((a - b) % TAU) + TAU) % TAU; return Math.min(d, TAU - d); };

/** Bearing (rad) of the first gate and the gate count for a map (perpendicular to the spawn line). */
export function gateBearings(cfg: ArenaConfig, sym: SymmetrySpec): { phase: number; count: number } {
  const a = sym.axisDeg * DEG;
  switch (sym.kind) {
    case "none": return { phase: seatBearing(cfg, sym) + Math.PI / 2, count: 2 };
    case "mirror":
    case "mirror2": return { phase: a, count: 2 };
    case "point": return { phase: a + Math.PI / 2, count: 2 };
    case "rotational": { const m = Math.max(1, sym.order); return { phase: a + Math.PI / m, count: m }; }
  }
}

function ruleKind(v: number): WallRuleKind | null {
  if (!Number.isFinite(v) || v < -0.5) return null;
  return WALL_RULE_KINDS[Math.max(0, Math.min(WALL_RULE_KINDS.length - 1, Math.round(v)))];
}

/** Nearest allowed battlement period. */
export function snapPeriod(p: number): number {
  let best: number = BATTLEMENT_PERIODS[0];
  for (const q of BATTLEMENT_PERIODS) if (Math.abs(q - p) < Math.abs(best - p)) best = q;
  return best;
}

/** The rules (with weights and resolved parameters) and the combine mode a config asks for. */
export function wallRulesFor(cfg: ArenaConfig, seed: number, sym: SymmetrySpec = NO_SYMMETRY): { rules: WallRule[]; combine: WallCombine } {
  if (!(cfg.walls >= 1)) return { rules: [{ kind: "none", weight: 1, params: {} }], combine: "blend" };
  const kinds: WallRuleKind[] = [];
  const k1 = ruleKind(cfg.wallRule) ?? "full";
  kinds.push(k1);
  const k2 = ruleKind(cfg.wallRule2);
  if (k2) { kinds.push(k2); const k3 = ruleKind(cfg.wallRule3); if (k3) kinds.push(k3); }
  const mix = kinds.length > 1 ? Math.max(0, Math.min(0.9, fin(cfg.wallMix, 0.4))) : 0;
  const weights = kinds.map((_, i) => (i === 0 ? 1 - mix : mix / (kinds.length - 1)));
  const B = Math.max(0, fin(cfg.wallHeight, 0.9));
  const tall = Math.max(0, Math.min(WALL_MAX_HEIGHT, fin(cfg.wallTall, 2.4)));
  const low = Math.max(0, fin(cfg.wallLow, 0.45));
  const gates = gateBearings(cfg, sym);
  const alpha = sym.axisDeg * DEG;
  const rotOrder = sym.kind === "rotational" ? sym.order : sym.kind === "point" || sym.kind === "mirror2" ? 2 : 1;
  const rules: WallRule[] = kinds.map((kind, i) => {
    let params: Record<string, number>;
    switch (kind) {
      case "none": params = {}; break;
      case "low": params = { h: low }; break;
      case "full": params = { h: B }; break;
      case "ruin": params = { h: B, cut: Math.max(0, Math.min(0.9, fin(cfg.wallGap, 0.35))), knots: 12, seed: ((seed >>> 0) ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0 }; break;
      case "battlement":
        params = { high: Math.min(WALL_MAX_HEIGHT, Math.max(B, 0.8 * tall)), low: Math.min(low, 0.5), period: snapPeriod(fin(cfg.wallPeriod, 6)), phase: alpha };
        break;
      case "gates":
        params = { h: B, width: Math.max(GATE_MIN_WIDTH, fin(cfg.wallGate, 30) * DEG), phase: gates.phase, count: gates.count };
        break;
      case "half": {
        // A mirror map keeps the arc centred on its axis (fair to both seats); otherwise it is
        // centred on the gate bearing plus wallArcCentre (the fold replicates it for point/rotational maps).
        const c = fin(cfg.wallArcCentre, 0) * DEG;
        const centre = sym.kind === "mirror" || sym.kind === "mirror2" ? alpha + (c >= 0 ? 0 : Math.PI) : gates.phase + c;
        params = { h: B, span: Math.max(30, Math.min(300, fin(cfg.wallArc, 180))) * DEG, centre };
        break;
      }
      case "towers": {
        let count = Math.max(2, Math.min(12, Math.round(fin(cfg.wallTowers, 4))));
        count = Math.ceil(count / rotOrder) * rotOrder; // an orbit of the rotations
        params = { high: tall, low, count, phase: sym.kind === "none" ? gates.phase : alpha };
        break;
      }
    }
    return { kind, weight: weights[i], params };
  });
  const ci = Math.max(0, Math.min(3, Math.round(fin(cfg.wallCombine, 0))));
  return { rules, combine: WALL_COMBINES[ci] };
}

/** Periodic 1D value noise on the bearing, in [0, 1] (smoothstep between `knots` seeded values). */
function ruinNoise(params: Record<string, number>): (phi: number) => number {
  const K = Math.max(3, Math.round(params.knots ?? 12));
  const r = rng32((params.seed ?? 1) >>> 0);
  const v = Array.from({ length: K }, () => r());
  return (phi: number) => {
    const t = (((phi / TAU) % 1) + 1) % 1 * K;
    const i = Math.floor(t) % K, f = t - Math.floor(t), s = f * f * (3 - 2 * f);
    return v[i] + (v[(i + 1) % K] - v[i]) * s;
  };
}

/** Height of one rule at a bearing (rad), m, before clamping. */
function ruleHeight(rule: WallRule, phi: number, noise: ((phi: number) => number) | null): number {
  const p = rule.params;
  switch (rule.kind) {
    case "none": return 0;
    case "low":
    case "full": return p.h ?? 0;
    case "ruin": {
      const v = noise ? noise(phi) : 0.5, cut = p.cut ?? 0.35;
      return v < cut ? 0 : (p.h ?? 0) * (0.35 + 1.1 * (v - cut) / Math.max(1e-6, 1 - cut));
    }
    case "battlement": {
      const P = p.period ?? 6;
      // Merlon CENTRED on the phase bearing (so the pattern is symmetric about it).
      const u = ((((phi - (p.phase ?? 0)) / SEG + P / 4) % P) + P) % P;
      return u < P / 2 ? p.high ?? 0 : p.low ?? 0;
    }
    case "gates": {
      const n = Math.max(1, p.count ?? 2), half = (p.width ?? GATE_MIN_WIDTH) / 2;
      for (let j = 0; j < n; j++) if (angDiff(phi, (p.phase ?? 0) + (TAU * j) / n) < half - 1e-9) return 0;
      return p.h ?? 0;
    }
    case "half": return angDiff(phi, p.centre ?? 0) <= (p.span ?? Math.PI) / 2 + 1e-9 ? p.h ?? 0 : 0;
    case "towers": {
      const n = Math.max(1, p.count ?? 4);
      for (let j = 0; j < n; j++) if (angDiff(phi, (p.phase ?? 0) + (TAU * j) / n) < 0.75 * SEG) return p.high ?? 0;
      return p.low ?? 0;
    }
  }
}

/** Combine the rules at one folded bearing; `frac` ∈ [0, 1) is the position in the fundamental domain (sectors). */
function combineAt(rules: readonly WallRule[], combine: WallCombine, phi: number, frac: number, noises: readonly (((phi: number) => number) | null)[]): number {
  switch (combine) {
    case "blend": {
      let h = 0;
      for (let i = 0; i < rules.length; i++) h += rules[i].weight * ruleHeight(rules[i], phi, noises[i]);
      return h;
    }
    case "max":
    case "min": {
      let h = combine === "max" ? -Infinity : Infinity, any = false;
      for (let i = 0; i < rules.length; i++) {
        if (!(rules[i].weight > 0) && rules.length > 1) continue;
        const v = ruleHeight(rules[i], phi, noises[i]);
        h = combine === "max" ? Math.max(h, v) : Math.min(h, v);
        any = true;
      }
      return any ? h : 0;
    }
    case "sectors": {
      let acc = 0;
      for (let i = 0; i < rules.length; i++) {
        acc += rules[i].weight;
        if (frac < acc - 1e-12 || i === rules.length - 1) return ruleHeight(rules[i], phi, noises[i]);
      }
      return 0;
    }
  }
}

/**
 * The wall plan of an arena: rules from the config (wallRule/wallRule2/wallRule3, wallMix,
 * wallCombine, the rule parameters), combined per segment, symmetric under `sym`.
 * cfg.walls = 0 → one "none" rule and every segment 0 (no wall at all).
 * Per segment: resistance = cfg.wallResistance · clamp(h / B, 0.25, 2) (0 for an opening) —
 * a tower is tougher than the base wall, a curb weaker; bounce = cfg.wallBounce (halved on a
 * wall under WALL_BLOCK_HEIGHT, 0 for an opening).
 */
export function wallPlanFor(cfg: ArenaConfig, seed: number, sym: SymmetrySpec = NO_SYMMETRY): WallPlan {
  const { rules, combine } = wallRulesFor(cfg, seed, sym);
  const B = Math.max(0, fin(cfg.wallHeight, 0.9));
  const noises = rules.map((r) => (r.kind === "ruin" ? ruinNoise(r.params) : null));
  const A = sym.axisDeg / AXIS_STEP_DEG;
  const segments: WallSegment[] = [];
  for (let k = 0; k < WALL_SEGMENTS; k++) {
    // Segment centre in half-segment units (2k + 1 of 96): integers keep the fold exact.
    const f = foldHalfSteps(sym, 2 * k + 1);
    const phi = (f.u * Math.PI) / WALL_SEGMENTS;
    const frac = Math.max(0, Math.min(0.999999, (f.u - A) / f.width));
    let h = cfg.walls >= 1 ? combineAt(rules, combine, phi, frac, noises) : 0;
    h = Number.isFinite(h) ? Math.max(0, Math.min(WALL_MAX_HEIGHT, h)) : 0;
    if (h < WALL_MIN_HEIGHT) h = 0;
    const resistance = h > 0 ? Math.max(0, fin(cfg.wallResistance, 2200)) * Math.max(0.25, Math.min(2, B > 0 ? h / B : 1)) : 0;
    const bounce = h > 0 ? Math.max(0, Math.min(1, fin(cfg.wallBounce, 0.3))) * (h >= WALL_BLOCK_HEIGHT ? 1 : 0.5) : 0;
    segments.push({ a0: k * SEG, a1: k === WALL_SEGMENTS - 1 ? TAU : (k + 1) * SEG, height: h, resistance, bounce });
  }
  let cover = 0, mean = 0, max = 0;
  for (const s of segments) {
    const w = s.a1 - s.a0;
    if (s.height >= WALL_BLOCK_HEIGHT) cover += w;
    mean += w * s.height;
    max = Math.max(max, s.height);
  }
  return { rules, combine, baseHeight: B, segments, coverage: cover / TAU, meanHeight: mean / TAU, maxHeight: max };
}

/** Index of the segment holding a bearing (rad, any value; wrapped into [0, 2π)). */
export function segmentIndexAt(plan: WallPlan, angle: number): number {
  const a = (((angle % TAU) + TAU) % TAU);
  const segs = plan.segments;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].a0 <= a) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Wall height at a bearing (rad), m (0 = an opening there). */
export function wallHeightAt(plan: WallPlan, angle: number): number {
  return plan.segments.length ? plan.segments[segmentIndexAt(plan, angle)].height : 0;
}

/** Classify a plan: "open" (no segment blocks), "enclosed" (every segment blocks) or "mixed". */
export function planEnclosure(plan: WallPlan): "open" | "enclosed" | "mixed" {
  if (plan.coverage <= 1e-9) return "open";
  if (plan.coverage >= 1 - 1e-9) return "enclosed";
  return "mixed";
}
