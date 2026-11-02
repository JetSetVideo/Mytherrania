import { bodyFromStats, physicsMultiplier, type Body } from "./Physics.ts";
export type ClassName =
  | "Barbarian" | "Warrior" | "Rogue" | "Assassin"
  | "Mage" | "Necromancer" | "Archer" | "Priest";

export const CLASSES: readonly ClassName[] = [
  "Barbarian", "Warrior", "Rogue", "Assassin",
  "Mage", "Necromancer", "Archer", "Priest",
];

export interface CombatStats {
  vitality: number; resilience: number; focus: number;
  reflex: number; strength: number; intelligence: number; agility: number;
  maxHealth: number; attackPower: number; attackInterval: number; armor: number;
}

// Combat: HP=45, armor=4, attackInterval=1.0, attackPower=9.0.
// Crit is reflex-based and reduced by defender resilience (mirrors the spec's
// criticalChance = f(reflex)/f(resilience) ratio, clamped to a sane band).
// Primary stats shape the 3D mesh independently.
// Primary attributes per class (they also shape the 3D mesh). Combat stats are
// DERIVED from them so the eight archetypes actually differ in a duel; before,
// every class shared HP 45 / power 9 / interval 1.0 / armor 4, which made the
// arena harness measure coin flips instead of balance.
const PRIMARY: Record<ClassName, { vitality: number; resilience: number; focus: number; reflex: number; strength: number; intelligence: number; agility: number }> = {
  Barbarian:   { vitality: 9, resilience: 7, focus: 2, reflex: 2, strength: 9, intelligence: 1, agility: 4 },
  Warrior:     { vitality: 7, resilience: 8, focus: 4, reflex: 4, strength: 7, intelligence: 3, agility: 4 },
  Rogue:       { vitality: 5, resilience: 4, focus: 3, reflex: 8, strength: 5, intelligence: 4, agility: 8 },
  Assassin:    { vitality: 3, resilience: 3, focus: 2, reflex: 9, strength: 4, intelligence: 4, agility: 9 },
  Mage:        { vitality: 4, resilience: 3, focus: 8, reflex: 4, strength: 2, intelligence: 10, agility: 3 },
  Necromancer: { vitality: 3, resilience: 4, focus: 9, reflex: 3, strength: 2, intelligence: 8, agility: 3 },
  Archer:      { vitality: 4, resilience: 4, focus: 3, reflex: 9, strength: 5, intelligence: 3, agility: 7 },
  Priest:      { vitality: 6, resilience: 5, focus: 9, reflex: 3, strength: 3, intelligence: 7, agility: 3 },
};

// Tuning coefficients for the shape of each archetype. HP, attack speed and
// armour come from the primary attributes so a barbarian really is a slow tank
// and an assassin a fast skirmisher.
const COEF = {
  hpBase: 33.0, hpPerVit: 1.7, hpPerStr: 0.55,
  intervalBase: 1.33, intervalPerReflex: 0.046,
  armorBase: 2.2, armorPerRes: 0.32,
};

// Every archetype is tuned to the same DPS x effective-HP product. With a
// deterministic duel the higher product wins, so equal products are what makes
// the win matrix land near 50%; a linear power model could not hit that, so
// damage is SOLVED for instead of fitted.
export const TARGET_POWER_INDEX = 450;
const CRIT_MULT = 1.4;

// Wave J ("reduce the HPs because overall there is too much AP"): the default health is
// multiplied by 500 (was 1000), so every life bar is half as tall and one strike is a
// bigger share of it. DAMAGE_SCALE still derives from HEALTH_SCALE / FIGHT_LENGTH.
export const HEALTH_SCALE = 500;
// Health alone would make every fight 100x longer, so damage is scaled by
// HEALTH_SCALE / FIGHT_LENGTH instead. FIGHT_LENGTH is the duel-length knob (hits-to-kill
// and the fight clock both scale with it); at 10 the arena's median decisive duel now runs
// ~37 s, inside Wave J's 25-55 s band, because the steeper closing-speed term
// (Physics.physicsMultiplier) adds ~40% damage at the arena's 1 m/s representative speed.
export const FIGHT_LENGTH = 10;
/** How much bigger damage numbers get, so health rises faster than damage. */
export const DAMAGE_SCALE = HEALTH_SCALE / FIGHT_LENGTH;
/**
 * The numerator factor for the damage solve. The health multiplier divides derived
 * damage by HEALTH_SCALE (effective HP grows with it), so the numerator must
 * compensate for that AND for the longer fight: HEALTH_SCALE * DAMAGE_SCALE.
 * Getting this wrong pins every class to the damage floor and silently erases all
 * archetype differentiation.
 */
const POWER_SCALE = HEALTH_SCALE * DAMAGE_SCALE;
/** The old absolute damage band, scaled by the damage factor only. */
const POWER_MIN = 5 * DAMAGE_SCALE;
const POWER_MAX = 14 * DAMAGE_SCALE;

/** Expected crit chance against an average defender (used to price crit in). */
function expectedCrit(reflex: number): number {
  return criticalChance(reflex, 5);
}

function shape(p: typeof PRIMARY[ClassName]) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    maxHealth: clamp(COEF.hpBase + p.vitality * COEF.hpPerVit + p.strength * COEF.hpPerStr, 34, 58) * HEALTH_SCALE,
    attackInterval: clamp(COEF.intervalBase - p.reflex * COEF.intervalPerReflex, 0.85, 1.35),
    armor: clamp(COEF.armorBase + p.resilience * COEF.armorPerRes, 2, 6.5),
  };
}

/** Derive combat stats from primary attributes (pure, so it is unit-testable). */
export function deriveCombatStats(p: typeof PRIMARY[ClassName], className?: ClassName): CombatStats {
  const { maxHealth, attackInterval, armor } = shape(p);
  const ehp = maxHealth * (1 + armor * 0.04);
  // Damage that gives this class the target index, adjusted for its crit rate.
  const raw = TARGET_POWER_INDEX * POWER_SCALE * attackInterval / ehp;
  // ...and for its BODY. Physics multiplies every blow by mass/density ratios, so a
  // heavy class both deals and avoids extra damage. Price that edge in against the
  // average body, exactly as crit is priced in: the matchup still feels the physics
  // (a barbarian still hits a mage harder than a warrior), but no class wins the
  // field just by being heavy.  edge = phys(c -> avg) / phys(avg -> c).
  const body = bodyFromStats({ ...p, armor });
  const edge = physicsMultiplier(body, AVERAGE_BODY, 0) / physicsMultiplier(AVERAGE_BODY, body, 0);
  const attackPower = raw / (1 + expectedCrit(p.reflex) * (CRIT_MULT - 1)) / edge;
  const cal = className ? POWER_CALIBRATION[className] ?? 0 : 0;
  return { ...p, maxHealth, attackPower: Math.max(POWER_MIN, Math.min(POWER_MAX, attackPower * (1 + cal))), attackInterval, armor };
}

/** DPS x effective HP — the quantity the tuner equalises. */
export function powerIndex(s: CombatStats): number {
  return (s.attackPower / s.attackInterval) * s.maxHealth * (1 + s.armor * 0.04);
}

// Per-class damage calibration fitted by tools/tune-balance.ts against the
// arena harness (3 seeds x 1500 fights/pair). Applied on top of the solved
// power so each archetype's win rate against the field lands near 50%.
export const POWER_CALIBRATION: Record<ClassName, number> = {
  Barbarian: 0.0101,
  Warrior: 0.0163,
  Rogue: 0.0010,
  Assassin: -0.0091,
  Mage: -0.0095,
  Necromancer: -0.0079,
  Archer: -0.0032,
  Priest: 0.0024,
};

// The field-average body every class's physics edge is priced against. Declared
// BEFORE PRESETS, which calls deriveCombatStats at module load (TDZ otherwise).
const AVERAGE_BODY: Body = (() => {
  const keys = ["strength", "vitality", "resilience", "reflex", "focus", "intelligence", "agility"] as const;
  const mean = Object.fromEntries(keys.map((k) => [k, CLASSES.reduce((s, c) => s + PRIMARY[c][k], 0) / CLASSES.length])) as typeof PRIMARY[ClassName];
  return bodyFromStats({ ...mean, armor: shape(mean).armor });
})();

const PRESETS: Record<ClassName, CombatStats> = Object.fromEntries(
  CLASSES.map((c) => [c, deriveCombatStats(PRIMARY[c], c)]),
) as Record<ClassName, CombatStats>;

export function criticalChance(attackerReflex: number, defenderResilience: number): number {
  return Math.min(0.15, Math.max(0.03, attackerReflex * 0.008 / (defenderResilience * 0.010 + 0.1)));
}

export function createStats(name: ClassName): CombatStats {
  return { ...PRESETS[name] };
}

/**
 * Wave J: what a LEVEL is worth by itself. Before this a level was only a stat-point budget, and
 * points spent in intelligence/focus move no combat stat (statDelta), so a level-20 mage was a
 * level-1 mage; the budget is also clamped into the 30–60 k HP / 500–1 400 power window, so even a
 * strength build stopped growing by level ~8. A level now grows health and attack power by
 * LEVEL_GROWTH per level ON TOP of that window (level 20 = ×1.57 each), so progression is real for
 * every build. Level is clamped to [1, LEVEL_CAP] (SpectateGen.MAX_LEVEL, pinned in a test).
 */
export const LEVEL_GROWTH = 0.03;
export const LEVEL_CAP = 20;

/** The pool/power multiplier of a level: 1 + LEVEL_GROWTH · (level − 1), level clamped. */
export function levelScale(level: number): number {
  const l = Number.isFinite(level) ? Math.max(1, Math.min(LEVEL_CAP, Math.round(level))) : 1;
  return 1 + LEVEL_GROWTH * (l - 1);
}

/** Scale a stat block's health and attack power by its level (pure; level 1 is the identity). */
export function applyLevel(stats: CombatStats, level: number): CombatStats {
  const k = levelScale(level);
  return { ...stats, maxHealth: stats.maxHealth * k, attackPower: stats.attackPower * k };
}

// Per-hit damage spread. Without it a duel is a step function: whichever class
// has slightly more DPS wins essentially always, so no win-rate band can exist.
// The spread makes near-equal archetypes genuinely uncertain (48-52%).
// Wave J: widened from 0.35 to 0.55 so an average duel's damage p80/p20 clears the
// brief's 1.9x (a strike rolls 1 +/- 0.55 about its power instead of +/- 0.35); the
// wider band also keeps the mirror matrix inside 48-52%.
export const DAMAGE_SPREAD = 0.55;

export function attackDamage(attacker: CombatStats, defender: CombatStats, critRoll: number, damageRoll = 0.5): number {
  const crit = critRoll < criticalChance(attacker.reflex, defender.resilience) ? 1.40 : 1;
  const variance = 1 + DAMAGE_SPREAD * (damageRoll - 0.5) * 2;
  return attacker.attackPower * crit * variance / (1 + defender.armor * 0.04);
}