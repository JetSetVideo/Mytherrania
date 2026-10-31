// Wave J (lane J-E): the spectator speed's frame arithmetic — how many fight substeps a rendered
// frame runs and how long each is. The engine renders, runs the HUD and moves the camera on the
// REAL frame time; only the fight (physics, AI, swings, resources, timers, ragdoll) advances by the
// scaled time, in substeps of at most SIM_SUBSTEP so the swept wall test, the blade sweep and the
// ragdoll keep their small-dt behaviour at 8×.
//
// The frame budget: a substep costs CPU (two rigs posed, two blades swept, two bodies stepped). When
// the wanted substeps would not fit the 60 FPS budget next to the rest of the frame, the plan runs
// only as many SIM_SUBSTEP steps as fit and drops the remaining simulated time — the match plays
// slower than asked (the HUD shows the effective speed) instead of the frame rate collapsing.
//
// Pure module: no THREE, no DOM.
import { stepTime, SPEEDS, type SpeedId } from "../game/MatchControl.ts";

/** Longest simulated time one fight substep may advance, s. */
export const SIM_SUBSTEP = 1 / 60;
/** The frame budget at 60 FPS, ms. */
export const FRAME_BUDGET_MS = 1000 / 60;
/** Share of the frame budget the substeps may fill together with the rest of the frame. */
export const BUDGET_SHARE = 0.85;

/** Keys that step the spectator speed down (−1) or up (+1): [ ] and − + (main row and numpad). */
export const SPEED_KEYS: Readonly<Record<string, -1 | 1>> = {
  BracketLeft: -1, BracketRight: 1, Minus: -1, Equal: 1, NumpadSubtract: -1, NumpadAdd: 1,
};

/** The speed one step slower (dir −1) or faster (+1) than `id`, clamped to the table's ends. */
export function shiftSpeed(id: string, dir: -1 | 1): SpeedId {
  const i = SPEEDS.findIndex((s) => s.id === id);
  const from = i < 0 ? SPEEDS.findIndex((s) => s.id === "normal") : i;
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, from + dir))].id;
}

export interface SubstepPlan {
  /** Substeps to run this frame (≥ 1; a paused frame runs one of dt 0). */
  n: number;
  /** Simulated seconds per substep (≤ SIM_SUBSTEP). */
  dt: number;
  /** Simulated seconds this frame actually advances (n · dt). */
  sim: number;
  /** Substeps the full speed would have needed. */
  wanted: number;
  /** True when the budget cut the substeps (the frame advances less than the speed asks). */
  capped: boolean;
}

/**
 * The plan for one frame: real frame time `realDt` (s) at speed `speedId`, given the measured CPU
 * cost of one substep (`stepMs`) and of everything else in the frame (`otherMs`).
 *   sim    = stepTime(realDt, speed)                 (× timeScale, clamped to MAX_STEP_SECONDS)
 *   wanted = ⌈sim / SIM_SUBSTEP⌉
 *   room   = ⌊(BUDGET_SHARE · budget − otherMs) / stepMs⌋, at least 1
 *   n      = min(wanted, room); dt = sim / n when n = wanted, else SIM_SUBSTEP (time is dropped)
 */
export function substepPlan(realDt: number, speedId: string, stepMs: number, otherMs: number, budgetMs = FRAME_BUDGET_MS): SubstepPlan {
  const sim = stepTime(Number.isFinite(realDt) ? realDt : 0, speedId);
  if (!(sim > 0)) return { n: 1, dt: 0, sim: 0, wanted: 1, capped: false };
  const wanted = Math.max(1, Math.ceil(sim / SIM_SUBSTEP - 1e-9));
  const cost = Number.isFinite(stepMs) && stepMs > 0.02 ? stepMs : 0.02;
  const other = Number.isFinite(otherMs) && otherMs > 0 ? otherMs : 0;
  const room = Math.max(1, Math.floor((BUDGET_SHARE * budgetMs - other) / cost));
  if (room >= wanted) return { n: wanted, dt: sim / wanted, sim, wanted, capped: false };
  return { n: room, dt: SIM_SUBSTEP, sim: room * SIM_SUBSTEP, wanted, capped: true };
}

/** Effective time scale over a window: simulated seconds per real second (0 when no real time passed). */
export function effectiveSpeed(simS: number, realS: number): number {
  return realS > 1e-6 && Number.isFinite(simS) ? simS / realS : 0;
}

/** HUD label of a time scale: "8×", "½×", "5.3×". */
export function speedLabel(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return "0×";
  if (Math.abs(scale - 0.5) < 0.01) return "½×";
  return Math.abs(scale - Math.round(scale)) < 0.05 ? `${Math.round(scale)}×` : `${scale.toFixed(1)}×`;
}
