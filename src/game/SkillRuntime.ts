// Per-fighter skill state: cooldowns, the skill currently animating, the buffs a
// stance is holding up, and any damage-over-time burning on the target. Pure
// logic so the rules can be asserted without a renderer.

import type { Skill, SkillKind } from "./Skills.ts";
import type { CombatStats } from "./Stats.ts";

export interface SkillRuntime {
  skills: Skill[];
  /** Remaining cooldown per skill, seconds. */
  cooldowns: number[];
  /** Index of the skill currently animating, or -1. */
  active: number;
  /** Buffs from the active stance; 1 means "no change". */
  armorMul: number;
  speedMul: number;
  attackIntervalMul: number;
  /** Damage-over-time applied to whoever this fighter hit. */
  dot: { dps: number; remaining: number } | null;
  /** Seconds left on the active stance's buffs. */
  buffRemaining: number;
}

export function createRuntime(skills: Skill[]): SkillRuntime {
  return {
    skills,
    cooldowns: skills.map(() => 0),
    active: -1,
    armorMul: 1, speedMul: 1, attackIntervalMul: 1,
    dot: null, buffRemaining: 0,
  };
}

/** Advance timers. Returns true if a stance expired this tick. */
export function tickRuntime(rt: SkillRuntime, dt: number): boolean {
  let expired = false;
  for (let i = 0; i < rt.cooldowns.length; i++) rt.cooldowns[i] = Math.max(0, rt.cooldowns[i] - dt);
  if (rt.buffRemaining > 0) {
    rt.buffRemaining = Math.max(0, rt.buffRemaining - dt);
    if (rt.buffRemaining === 0) {
      rt.armorMul = 1; rt.speedMul = 1; rt.attackIntervalMul = 1;
      expired = true;
    }
  }
  if (rt.dot) {
    rt.dot.remaining = Math.max(0, rt.dot.remaining - dt);
    if (rt.dot.remaining === 0) rt.dot = null;
  }
  return expired;
}

export function isReady(rt: SkillRuntime, index: number): boolean {
  return index >= 0 && index < rt.skills.length && rt.cooldowns[index] <= 0;
}

/** True when the skill can start: off cooldown, not stunned, nothing animating. */
export function canUse(rt: SkillRuntime, index: number, stunned: boolean): boolean {
  return !stunned && rt.active < 0 && isReady(rt, index);
}

/**
 * Start a skill. Applies its cooldown and stance buffs immediately; the damage
 * itself lands later, on the animation's hit frame.
 */
export function beginSkill(rt: SkillRuntime, index: number): Skill | null {
  if (index < 0 || index >= rt.skills.length || rt.cooldowns[index] > 0 || rt.active >= 0) return null;
  const skill = rt.skills[index];
  rt.active = index;
  rt.cooldowns[index] = skill.cooldown;
  const p = skill.payload;
  rt.armorMul = p.armorMul ?? 1;
  rt.speedMul = p.speedMul ?? 1;
  rt.attackIntervalMul = p.attackIntervalMul ?? 1;
  rt.buffRemaining = (p.armorMul !== undefined || p.speedMul !== undefined || p.attackIntervalMul !== undefined)
    ? skill.animation.duration + 0.35
    : 0;
  return skill;
}

/** The animation finished: the fighter is free to act again (buffs persist). */
export function endSkill(rt: SkillRuntime): void {
  rt.active = -1;
}

/** Combat stats with the active stance's multipliers folded in. */
export function effectiveStats(base: CombatStats, rt: SkillRuntime): CombatStats {
  return {
    ...base,
    armor: base.armor * rt.armorMul,
    attackInterval: base.attackInterval * rt.attackIntervalMul,
  };
}

export function movementMul(rt: SkillRuntime): number {
  return rt.speedMul;
}

export interface SkillView {
  distance: number;
  selfReach: number;
  selfHpRatio: number;
  enemyHpRatio: number;
  nearEdge: boolean;
}

/**
 * Which skill an AI fighter should reach for. Dash to close a gap, power when it
 * has the target in reach, defence when it is hurt — the same triage a player
 * would apply, and never a skill that is on cooldown.
 */
export function chooseAiSkill(rt: SkillRuntime, view: SkillView, stunned: boolean): number {
  if (rt.active >= 0 || stunned) return -1;
  const idx = (k: SkillKind) => rt.skills.findIndex((s) => s.kind === k);
  const inReach = view.distance <= view.selfReach + 0.4;
  const far = view.distance > view.selfReach + 1.4;
  const hurt = view.selfHpRatio < 0.42;

  // Defence first when badly hurt: the armour is worth more than the damage lost.
  if (hurt && canUse(rt, idx("defense"), stunned)) return idx("defense");
  if (inReach && canUse(rt, idx("power"), stunned)) return idx("power");
  if (far && canUse(rt, idx("dash"), stunned)) return idx("dash");
  // Nothing ideal: use whatever is up, preferring the power strike.
  for (const kind of ["power", "dash", "defense"] as SkillKind[]) {
    const i = idx(kind);
    if (canUse(rt, i, stunned)) return i;
  }
  return -1;
}
