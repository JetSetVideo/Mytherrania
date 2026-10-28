// Win-condition variety: several ways a fight can end, exactly ONE of which is
// rolled per match, so the training corpus is not all the same ending.
//
// Death (hp ≤ 0) is always available. The other conditions are parameterised so
// the instant-battle harness can sample across them and the digest can report
// how often each decides a fight. Pure module: no Three.js, no DOM.

export type WinConditionKind = "ko" | "sudden-death" | "first-blood" | "endurance" | "domination";

export interface WinCondition {
  kind: WinConditionKind;
  /** human-readable label for the history page. */
  label: string;
}

export interface FightState {
  /** Seconds since the fight turned hostile (truce excluded). */
  hostileTime: number;
  hpA: number;
  hpB: number;
  maxHpA: number;
  maxHpB: number;
  /** Damage dealt by each side, whole fight. */
  dealtA: number;
  dealtB: number;
}

export interface WinVerdict {
  over: boolean;
  winner: 0 | 1 | null;   // null while undecided or on a draw
  reason: WinConditionKind;
}

/** Parameter bounds each condition samples inside (for the harness). */
export interface WinParams {
  suddenDeathAfter: number;   // s of hostility before next-hit-wins
  enduranceLimit: number;     // s; higher HP% at the bell wins
  dominationRatio: number;    // dealt ratio (e.g. 3 = out-damaged 3:1)
}

export const WIN_PARAM_BOUNDS: Record<keyof WinParams, [number, number]> = {
  suddenDeathAfter: [20, 90],
  enduranceLimit: [30, 120],
  dominationRatio: [2.0, 4.0],
};

const clamp = (v: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, v));

/**
 * Roll one win condition for a match. KO is the most likely; the rest add the
 * variety the models need. Deterministic from the rng.
 */
export function rollWinCondition(rng: () => number, params?: Partial<WinParams>): { cond: WinCondition; params: WinParams } {
  const p: WinParams = {
    suddenDeathAfter: clamp(params?.suddenDeathAfter ?? 20 + rng() * 70, WIN_PARAM_BOUNDS.suddenDeathAfter),
    enduranceLimit: clamp(params?.enduranceLimit ?? 30 + rng() * 90, WIN_PARAM_BOUNDS.enduranceLimit),
    dominationRatio: clamp(params?.dominationRatio ?? 2 + rng() * 2, WIN_PARAM_BOUNDS.dominationRatio),
  };
  const r = rng();
  let cond: WinCondition;
  if (r < 0.5) cond = { kind: "ko", label: "last one standing" };
  else if (r < 0.7) cond = { kind: "sudden-death", label: `sudden death after ${Math.round(p.suddenDeathAfter)}s` };
  else if (r < 0.85) cond = { kind: "endurance", label: `most health at ${Math.round(p.enduranceLimit)}s` };
  else cond = { kind: "domination", label: `out-damage ${p.dominationRatio.toFixed(1)}:1` };
  return { cond, params: p };
}

/**
 * Evaluate the rolled condition against the fight state. Death by hp ≤ 0 always
 * wins regardless of the rolled condition — it is the one rule every match shares.
 */
export function evaluateWin(cond: WinCondition, p: WinParams, s: FightState): WinVerdict {
  const deadA = s.hpA <= 0;
  const deadB = s.hpB <= 0;
  if (deadA && deadB) return { over: true, winner: null, reason: "ko" };
  if (deadB) return { over: true, winner: 0, reason: "ko" };
  if (deadA) return { over: true, winner: 1, reason: "ko" };

  switch (cond.kind) {
    case "ko":
      return { over: false, winner: null, reason: "ko" };
    case "sudden-death":
      // Before the deadline nobody wins on this condition; after it, the first
      // hit decides — which the caller detects as the next hp change. Here we only
      // report whether the deadline has passed (the harness treats the next landed
      // hit as terminal).
      return { over: false, winner: null, reason: "sudden-death" };
    case "endurance":
      if (s.hostileTime >= p.enduranceLimit) {
        const ra = s.hpA / s.maxHpA, rb = s.hpB / s.maxHpB;
        if (Math.abs(ra - rb) < 1e-9) return { over: true, winner: null, reason: "endurance" };
        return { over: true, winner: ra > rb ? 0 : 1, reason: "endurance" };
      }
      return { over: false, winner: null, reason: "endurance" };
    case "domination": {
      const totalA = s.dealtA, totalB = s.dealtB;
      if (totalA >= p.dominationRatio * Math.max(1, totalB)) return { over: true, winner: 0, reason: "domination" };
      if (totalB >= p.dominationRatio * Math.max(1, totalA)) return { over: true, winner: 1, reason: "domination" };
      return { over: false, winner: null, reason: "domination" };
    }
    default:
      // Unreachable: WinConditionKind is closed over the four cases above.
      return { over: false, winner: null, reason: "ko" };
  }
}

/** True when a sudden-death fight has passed its deadline (next hit wins). */
export function suddenDeathArmed(p: WinParams, hostileTime: number): boolean {
  return hostileTime >= p.suddenDeathAfter;
}
