// Wave N (lane N-B): the STRATEGY vocabulary the whole wave shares.
//
// Decode of the user's ask: "the same AIs system be able to kite and find strategies that allow them
// to hide or push the temporality". So a fighter needs a first-class notion of intent that is ABOVE
// the decision tree: `brawl` (trade blows), `kite` (keep away and poke), `hide` (break contact),
// `stall` (drag the clock), `bait` (invite a blow then punish), `trade` (stand and exchange).
//
// TWO VOCABULARIES, NEVER MERGED. src/game/MatchReport.ts's STRATEGY_IDS is the set of decision
// LEAVES a shipped tree can actually emit (`attack`/`advance`/`retreat`/`block`), derived by walking
// the real trees. The behavioural ids above are HIGHER: a report may only ever claim a tree leaf, so
// this module declares the mapping from each behavioural strategy DOWN to the leaves it prefers
// (STRATEGY_LEAVES) and asserts at load time that every named leaf is a member of STRATEGY_IDS. That
// mapping is what a future opponent model reads to turn observed leaves back into behaviour.
//
// This lane decides WHEN to ask for an engagement, it does not duplicate it: Wave M's
// src/game/Engagement.ts owns the intent (approach/hold/circle/disengage/bait) and its pull law, and
// the tree's compute hook acts on it. A strategy plan here is the input to that decision.
//
// Pure module: no DOM, no THREE, no Math.random, no clock, no `any`.

import { STRATEGY_IDS } from "./MatchReport.ts";

/** The higher, behavioural vocabulary the AI, the opponent model and the report share. */
export type StrategyId = "brawl" | "kite" | "hide" | "stall" | "bait" | "trade";

/** Every behavioural strategy, in the deterministic tie-break order used by `chooseStrategy`. */
export const STRATEGY_IDS_ALL: readonly StrategyId[] = ["brawl", "kite", "hide", "stall", "bait", "trade"];

/**
 * Which DECISION LEAVES (ids drawn from STRATEGY_IDS — never hand-copied) each behavioural
 * strategy prefers, in priority order. This is the bridge the opponent model uses: it reads the
 * leaves a tree emitted and asks which behavioural strategy is most consistent with them.
 */
export const STRATEGY_LEAVES: Record<StrategyId, readonly string[]> = {
  brawl: ["attack", "advance"], // close and swing: the whole point is contact
  kite: ["retreat", "attack"], // hold the gap above all, strike only opportunistically
  hide: ["retreat"], // break contact entirely; a hidden body does not strike
  stall: ["block", "retreat"], // never initiate: guard, give ground, let the clock run
  bait: ["advance", "retreat"], // step in to invite a blow, slip back out
  trade: ["attack", "block"], // stand and exchange: swing, then guard, no footwork
};

// Load-time assertion: the mapping may only name ids that a shipped tree can really emit. A drift
// between the two vocabularies is a hard error at import, not a silent mismatch at report time.
for (const id of STRATEGY_IDS_ALL) {
  for (const leaf of STRATEGY_LEAVES[id]) {
    if (!STRATEGY_IDS.includes(leaf)) {
      throw new Error(
        `Strategies: strategy "${id}" maps to decision leaf "${leaf}", which no shipped tree emits (STRATEGY_IDS = ${STRATEGY_IDS.join(", ")})`,
      );
    }
  }
}

/** A point in the arena floor plane, metres (x east, z north). */
export interface XY { x: number; z: number }

// ---------------------------------------------------------------------------
// The parameters a strategy carries. Every bound is a named constant with units.
// ---------------------------------------------------------------------------

/** Finite sentinel for "this strategy never hides" — kept finite so every plan is a number. */
export const NO_HIDE_S = 1e9;
/** The hardest a strategy may drag the clock, seconds of pull per decision. */
export const MAX_STALL_PULL_S = 8;
/** Health-share gap that counts as "behind"/"ahead" (matches MatchControl's JUDGE_MARGIN, 0.05). */
export const LOSS_MARGIN = 0.05;
/** Keep-away distance bounds, m. */
export const MIN_KEEP_AWAY_M = 0.5;
export const MAX_KEEP_AWAY_M = 12;
/** Engage distance floor and ceiling, m (below/at the floor is contact; a plan never engages absurdly far). */
export const MIN_ENGAGE_M = 0.5;
export const MAX_ENGAGE_M = 4;
/** How far a `flee` step targets, m (a step, not a teleport; the pilot re-plans each frame). */
export const FLEE_M = 8;
/** Seconds left under which the clock is "short" and a lead is worth defending, fraction of limit. */
export const SHORT_TIME_FRAC = 0.25;

/** The raw parameters of a behavioural strategy, before the context tunes them. */
interface StrategyBase {
  /** Distance the fighter prefers to hold while avoiding, m. */
  keepAwayM: number;
  /** Distance at/below which the fighter engages, m. */
  engageBelowM: number;
  /** Health share below which the fighter breaks off, 0..1. */
  retreatBelowHp: number;
  /** Quiet seconds of stand-off before the fighter hides, s (NO_HIDE_S = never). */
  hideAfterS: number;
  /** How hard the strategy drags the clock, seconds of pull per decision (0 = not a stall). */
  stallPullS: number;
}

/** Base parameters per strategy. Distances in m, health shares 0..1, times in s. */
const BASE: Record<StrategyId, StrategyBase> = {
  brawl: { keepAwayM: 1.2, engageBelowM: 2.6, retreatBelowHp: 0.20, hideAfterS: NO_HIDE_S, stallPullS: 0 },
  kite: { keepAwayM: 6.0, engageBelowM: 2.6, retreatBelowHp: 0.35, hideAfterS: NO_HIDE_S, stallPullS: 2 },
  hide: { keepAwayM: 6.0, engageBelowM: 1.2, retreatBelowHp: 0.50, hideAfterS: 2.0, stallPullS: 3 },
  stall: { keepAwayM: 6.0, engageBelowM: 1.2, retreatBelowHp: 0.60, hideAfterS: 4.0, stallPullS: 5 },
  bait: { keepAwayM: 3.5, engageBelowM: 2.6, retreatBelowHp: 0.40, hideAfterS: NO_HIDE_S, stallPullS: 1 },
  trade: { keepAwayM: 1.2, engageBelowM: 2.6, retreatBelowHp: 0.15, hideAfterS: NO_HIDE_S, stallPullS: 0 },
};

/** Archetypes that fight from range: they keep further away by RANGED_KEEP_AWAY_EXTRA_M, m. */
const RANGED_CLASSES = new Set(["Archer", "Mage", "Necromancer", "Priest"]);
export const RANGED_KEEP_AWAY_EXTRA_M = 1.5;

/** Everything a plan is computed from. Units: health shares 0..1, seconds (s), distances (m). */
export interface StrategyContext {
  hpFracSelf: number;
  hpFracFoe: number;
  timeLeftS: number;
  timeLimitS: number;
  classId: string;
}

/** The tuning features derived once from a context (all finite, all bounded). */
interface Features {
  selfHp: number; // 0..1
  foeHp: number; // 0..1
  lead: number; // selfHp - foeHp, -1..1
  ahead: number; // max(0, lead), 0..1
  behind: number; // max(0, -lead), 0..1
  lowTime: number; // 0 at a full clock, -> 1 as the clock runs out, 0..1
  hurt: number; // max(0, 1 - selfHp), 0..1
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);

function features(ctx: StrategyContext): Features {
  const selfHp = clamp01(ctx.hpFracSelf);
  const foeHp = clamp01(ctx.hpFracFoe);
  const lead = selfHp - foeHp;
  // timeFrac = fraction of the limit still to run; a non-finite/zero limit reads as "no clock".
  const limit = Number.isFinite(ctx.timeLimitS) && ctx.timeLimitS > 0 ? ctx.timeLimitS : 1;
  const timeFrac = clamp01(Number.isFinite(ctx.timeLeftS) ? ctx.timeLeftS / limit : 0);
  return { selfHp, foeHp, lead, ahead: Math.max(0, lead), behind: Math.max(0, -lead), lowTime: 1 - timeFrac, hurt: 1 - selfHp };
}

/**
 * The switch that stops a LOSING seat from stalling forever: a stall is permitted only while the
 * fighter is not behind on health (lead > -LOSS_MARGIN). A seat behind by more than LOSS_MARGIN may
 * never stall — it must go and win back the deficit. This is the bound the lane asserts.
 */
export function stallAllowed(ctx: StrategyContext): boolean {
  return features(ctx).lead > -LOSS_MARGIN;
}

// ---------------------------------------------------------------------------
// planFor — the parameters a strategy runs with, in this context.
// ---------------------------------------------------------------------------

export interface StrategyPlan {
  id: StrategyId;
  /** Distance to hold while avoiding, m. */
  keepAwayM: number;
  /** Distance at/below which to engage, m. */
  engageBelowM: number;
  /** Health share below which to break off, 0..1. */
  retreatBelowHp: number;
  /** Quiet seconds before hiding, s (NO_HIDE_S = never). */
  hideAfterS: number;
  /** How hard the plan drags the clock, s (0 = the stall is switched OFF). */
  stallPullS: number;
  /** WHY the plan reads as it does (the "push the temporality" claim lives here). */
  reason: string;
}

/**
 * The plan for `id` in `ctx`. Total and deterministic: every field is a finite number inside its
 * stated band. The context tunes three things — the retreat threshold rises as the fighter is hurt,
 * ranged archetypes keep further away, and a losing seat's stall pull is forced to 0 (the switch).
 */
export function planFor(id: StrategyId, ctx: StrategyContext): StrategyPlan {
  const base = BASE[id];
  const f = features(ctx);

  // A hurt fighter breaks off sooner: raise the threshold as health falls below a healthy 0.5.
  const retreatBelowHp = clamp01(base.retreatBelowHp + Math.max(0, 0.5 - f.selfHp) * 0.2);
  // Ranged archetypes keep more air: their plan holds a wider gap (m).
  const rangeExtra = RANGED_CLASSES.has(ctx.classId) ? RANGED_KEEP_AWAY_EXTRA_M : 0;
  const keepAwayM = clamp(base.keepAwayM + rangeExtra, MIN_KEEP_AWAY_M, MAX_KEEP_AWAY_M);
  const engageBelowM = clamp(base.engageBelowM, MIN_ENGAGE_M, MAX_ENGAGE_M);
  const hideAfterS = clamp(base.hideAfterS, 0, NO_HIDE_S);
  // The stall pull is bounded and, crucially, SWITCHED OFF for a losing seat.
  const allowed = stallAllowed(ctx);
  const stallPullS = allowed ? clamp(base.stallPullS, 0, MAX_STALL_PULL_S) : 0;

  const bits: string[] = [];
  bits.push(`${id} plan: keep ${keepAwayM.toFixed(1)} m, engage <= ${engageBelowM.toFixed(1)} m, break off < ${(retreatBelowHp * 100).toFixed(0)}%`);
  if (hideAfterS < NO_HIDE_S) bits.push(`hides after ${hideAfterS.toFixed(1)} s of stand-off`);
  if (base.stallPullS > 0) {
    bits.push(allowed ? `stall ON, pulls ${stallPullS.toFixed(1)} s of clock` : `stall switched OFF (behind on health)`);
  }
  // The explicit "push the temporality": a clock-dragging strategy ahead on health with a short
  // clock is told so in words (brawl/trade do not drag the clock, so the note would be a lie there).
  if (base.stallPullS > 0 && f.ahead > LOSS_MARGIN && f.lowTime >= 1 - SHORT_TIME_FRAC && allowed) {
    bits.push(`push the clock: ahead by ${(f.lead * 100).toFixed(0)}% with ${(f.lowTime * 100).toFixed(0)}% of the clock gone`);
  }
  const reason = [...bits, reasonTail(ctx, base.stallPullS > 0 && !allowed ? "must regain the lead" : "")]
    .filter((s) => s.length > 0)
    .join("; ");

  return { id, keepAwayM, engageBelowM, retreatBelowHp, hideAfterS, stallPullS, reason };
}

/** The side-of-health tail of a plan's reason, with an optional extra clause. */
function reasonTail(ctx: StrategyContext, extra: string): string {
  const f = features(ctx);
  const side = f.lead > LOSS_MARGIN ? "ahead" : f.lead < -LOSS_MARGIN ? "behind" : "level";
  return extra ? `${side} on health, ${extra}` : `${side} on health`;
}

// ---------------------------------------------------------------------------
// chooseStrategy — deterministic, stated weights.
// ---------------------------------------------------------------------------

/**
 * The stated weights of the deterministic chooser. Each score is a weighted sum of the bounded
 * features (ahead/behind/lowTime/hurt/foeHp); the highest score wins, ties broken by
 * STRATEGY_IDS_ALL order. Weights are dimensionless; features are 0..1, so scores are comparable.
 */
export const CHOOSER_WEIGHTS = {
  /** Behind on health: go and fight (favours brawl/trade). */
  brawl: { behind: 2.0, foeLow: 1.5 },
  /** Even fight: stand and exchange (favours trade, peaks at lead 0). */
  trade: { even: 1.0, foeLow: 0.5 },
  /** Ahead with a short clock: keep the gap (favours kite). */
  kite: { ahead: 1.0, lowTime: 1.5, behind: -2.0 },
  /** Ahead with a short clock: drag it (favours stall). */
  stall: { ahead: 2.0, lowTime: 2.0, behind: -3.0 },
  /** Hurt: break contact (favours hide). */
  hide: { hurt: 1.5, ahead: -1.0 },
  /** Slightly behind and healthy: invite a blow (favours bait). */
  bait: { even: 1.0, hurt: 0.3 },
} as const;

/**
 * Pick a strategy for `ctx`. Deterministic and total. A seat behind on health (> LOSS_MARGIN) can
 * NEVER be given `stall`: its stall is ineligible, so a losing fighter is forced to pursue rather
 * than run down the clock forever. The winner is the highest score; ties break in STRATEGY_IDS_ALL
 * order so the same context always yields the same id.
 */
export function chooseStrategy(ctx: StrategyContext): StrategyId {
  const f = features(ctx);
  const w = CHOOSER_WEIGHTS;
  const even = 1 - Math.abs(f.lead);
  const scores: Record<StrategyId, number> = {
    brawl: w.brawl.behind * f.behind + w.brawl.foeLow * (1 - f.foeHp),
    trade: w.trade.even * even + w.trade.foeLow * (1 - f.foeHp),
    kite: w.kite.ahead * f.ahead + w.kite.lowTime * f.lowTime + w.kite.behind * f.behind,
    stall: w.stall.ahead * f.ahead + w.stall.lowTime * f.lowTime + w.stall.behind * f.behind,
    hide: w.hide.hurt * f.hurt + w.hide.ahead * f.ahead,
    bait: w.bait.even * even + w.bait.hurt * f.hurt,
  };

  // The switch: a losing seat may not be a staller. Make `stall` ineligible for it outright.
  if (!stallAllowed(ctx)) scores.stall = Number.NEGATIVE_INFINITY;

  let best: StrategyId = STRATEGY_IDS_ALL[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const id of STRATEGY_IDS_ALL) {
    if (scores[id] > bestScore) {
      bestScore = scores[id];
      best = id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// strategyAdvice — what the pilot should actually do.
// ---------------------------------------------------------------------------

export interface AdviceContext extends StrategyContext {
  /** Fighter-to-fighter distance, m. */
  distanceM: number;
  /** Self's floor position, if the caller has it (enables a concrete `fleeTo`). */
  selfPos?: XY;
  /** The foe's floor position, if the caller has it. */
  foePos?: XY;
}

export interface StrategyAdvice {
  move: "close" | "hold" | "flee";
  /** Whether to spend a skill this decision (a press, or a defensive slip while fleeing). */
  useSkill: boolean;
  /** Where to flee to, when fleeing and both positions are known (metres). */
  fleeTo?: XY;
}

/**
 * The advice for a strategy in `advice` context. `close`/`hold`/`flee` plus whether to spend a
 * skill. Keep-away strategies (kite/hide/stall) flee when the foe is inside the gap they want to
 * hold and hold once it is outside it; pursue strategies close until inside their engage band then
 * hold. A fighter below its retreat threshold always flees. Deterministic and total.
 */
export function strategyAdvice(id: StrategyId, ctx: AdviceContext): StrategyAdvice {
  const plan = planFor(id, ctx);
  const dist = Number.isFinite(ctx.distanceM) ? Math.max(0, ctx.distanceM) : plan.keepAwayM;
  const keepAway = id === "kite" || id === "hide" || id === "stall";

  let move: StrategyAdvice["move"];
  if (ctx.hpFracSelf <= plan.retreatBelowHp) {
    move = "flee";
  } else if (keepAway) {
    // A keep-away plan wants the gap held: too close -> slip out, already clear -> hold the line.
    move = dist < plan.keepAwayM ? "flee" : "hold";
  } else {
    move = dist <= plan.engageBelowM ? "hold" : "close";
  }

  // Spend a skill when pressing in our own band (brawl/trade/bait), or a slip while a kite flees.
  const inBand = dist <= plan.engageBelowM;
  const useSkill = move === "hold"
    ? (id === "brawl" || id === "trade" || id === "bait") && inBand
    : move === "flee" && id === "kite";

  const advice: StrategyAdvice = { move, useSkill };
  if (move === "flee" && ctx.selfPos && ctx.foePos) {
    advice.fleeTo = fleePoint(ctx.selfPos, ctx.foePos);
  }
  return advice;
}

/**
 * A point FLEE_M metres from `self` directly AWAY from `foe` (metres). Coincident bodies fall back
 * to self's own bearing from the origin, so the result is always finite.
 */
export function fleePoint(self: XY, foe: XY): XY {
  let dx = self.x - foe.x;
  let dz = self.z - foe.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-9) {
    const b = Math.atan2(self.z, self.x);
    dx = Math.cos(b);
    dz = Math.sin(b);
    len = 1;
  }
  dx /= len;
  dz /= len;
  return { x: self.x + dx * FLEE_M, z: self.z + dz * FLEE_M };
}
