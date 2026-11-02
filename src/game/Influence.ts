// Wave X (lane L): the attribute INFLUENCE GRAPH — what moves what, in which direction.
//
// The user's ask, decoded: game logic influences "upward, downward and sideways".
//   down  ancestry / class / birthsign / level  ->  an attribute (where the numbers come from)
//   up    an attribute  ->  a derived stat, an animation coefficient, a technique number, a resource
//   side  attribute <-> attribute trade-offs (strength vs agility via body mass; focus <-> intelligence
//         for casting) and the derived trade-offs they cause
//
// DATA ONLY (contract C-INFL): no function here computes anything. Every edge is TRUE in code:
// tests/wave_x_influence_test.ts perturbs each edge's `from` in the REAL functions (Stats, Races,
// Agility, MotionStyle, PowerCost, Skills, Cast, Resources, MatchRules, SpectateGen) and asserts that
// `to` moves with `sign` (SPEC X10..X13). docs/wave-x/LOGIC.md's table is GENERATED from this list.
//
// `from` / `to` vocabulary:
//   attributes          vitality resilience focus reflex strength intelligence agility
//   down sources        class:<Class>  race:<id>  subrace:<race>/<id>  birthsign:<id>  level
//   derived (combat)    maxHealth attackPower armor attackInterval critChance critTaken damageTaken
//                       bodyMass knockback agility.effective moveSpeed turnRate dashDistance
//   resources           manaMax manaRegen staminaMax staminaRegen
//   animation           anim.<MotionStyle coefficient> (windupTime recoverTime settleTime overshoot
//                       strikeTime chainLag windupDepth breathAmp sway anticipation) and anim.jitter
//   technique           technique.castSeconds technique.duration technique.manaCost technique.cooldown
//                       technique.amplitude[<attribute>] technique.recoveryTail cast.channel cast.pushback
//   casting side nodes  focus.cast (PowerCost.castFocus)  intelligence.mana (PowerCost.manaIntelligence)
//   potential (Wave Y)  potential.woundTaken potential.woundDealt potential.manaFatigue potential.staminaFatigue
//                       (Potential.ts: health potential lost to a reference blow; mana / stamina potential
//                       lost to a reference over-paced burst). Race ENDURANCE also softens stamina fatigue,
//                       but it is a race affinity, not a stat block field: tests/wave_y_potential_test.ts Y5.
// `weight` is a NOMINAL strength 0..1 for display (how much of `to` this edge drives); the test
// checks the sign, not the weight.

export interface Influence {
  from: string;
  to: string;
  sign: 1 | -1;
  weight: number;
  why: string;
  dir: "up" | "down" | "side";
}

export const ATTRIBUTE_NODES = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"] as const;

export const INFLUENCES: readonly Influence[] = [
  // ─── DOWN: class -> attribute (Stats.ts PRIMARY, against the eight-class mean) ───────────────
  { dir: "down", from: "class:Barbarian", to: "strength", sign: 1, weight: 1, why: "the archetype's sheet: a barbarian is built on strength" },
  { dir: "down", from: "class:Barbarian", to: "vitality", sign: 1, weight: 1, why: "the barbarian's tank of a body" },
  { dir: "down", from: "class:Barbarian", to: "agility", sign: -1, weight: 0.4, why: "a heavy fighter, below the field's agility" },
  { dir: "down", from: "class:Warrior", to: "resilience", sign: 1, weight: 1, why: "armour drill" },
  { dir: "down", from: "class:Rogue", to: "agility", sign: 1, weight: 0.8, why: "light feet" },
  { dir: "down", from: "class:Assassin", to: "agility", sign: 1, weight: 1, why: "the most agile archetype" },
  { dir: "down", from: "class:Assassin", to: "reflex", sign: 1, weight: 1, why: "reaction is the assassin's craft" },
  { dir: "down", from: "class:Archer", to: "reflex", sign: 1, weight: 1, why: "the draw-and-loose reflex" },
  { dir: "down", from: "class:Mage", to: "intelligence", sign: 1, weight: 1, why: "the scholar's mind" },
  { dir: "down", from: "class:Mage", to: "agility", sign: -1, weight: 0.5, why: "a study-bound body" },
  { dir: "down", from: "class:Necromancer", to: "focus", sign: 1, weight: 1, why: "the long channel of the dead arts" },
  { dir: "down", from: "class:Priest", to: "focus", sign: 1, weight: 1, why: "devotion is focus" },
  // ─── DOWN: race / sub-race -> attribute (Races.ts mods + tweaks, through applyRaceBonus) ──────
  { dir: "down", from: "race:human", to: "agility", sign: 1, weight: 0.3, why: "humans: +1 to everything" },
  { dir: "down", from: "race:elf", to: "agility", sign: 1, weight: 0.6, why: "elves are light and quick (+2)" },
  { dir: "down", from: "race:elf", to: "strength", sign: -1, weight: 0.3, why: "a slender frame (−1)" },
  { dir: "down", from: "race:dwarf", to: "resilience", sign: 1, weight: 0.6, why: "stone-boned (+2)" },
  { dir: "down", from: "race:dwarf", to: "agility", sign: -1, weight: 0.3, why: "short-legged and heavy (−1)" },
  { dir: "down", from: "race:ork", to: "strength", sign: 1, weight: 0.9, why: "ork brawn (+3)" },
  { dir: "down", from: "race:ork", to: "focus", sign: -1, weight: 0.6, why: "an ork's restless mind (−2)" },
  { dir: "down", from: "subrace:human/nomad", to: "agility", sign: 1, weight: 0.3, why: "wind-walkers of the plains" },
  { dir: "down", from: "subrace:elf/wood", to: "agility", sign: 1, weight: 0.3, why: "forest-silent movers" },
  { dir: "down", from: "subrace:ork/bloodfang", to: "agility", sign: 1, weight: 0.3, why: "swift killers of the steppe" },
  { dir: "down", from: "subrace:dwarf/mountain", to: "resilience", sign: 1, weight: 0.6, why: "stone-boned clans" },
  { dir: "down", from: "subrace:dwarf/deep", to: "focus", sign: 1, weight: 0.6, why: "they hear the stone whisper" },
  { dir: "down", from: "subrace:elf/high", to: "intelligence", sign: 1, weight: 0.6, why: "star-touched scholars" },
  // ─── DOWN: birthsign -> attribute (Birthsight.ts mods, through applyRaceBonus) ───────────────
  { dir: "down", from: "birthsign:serpent", to: "agility", sign: 1, weight: 0.3, why: "the Serpent is supple" },
  { dir: "down", from: "birthsign:mountain", to: "resilience", sign: 1, weight: 0.9, why: "carved from the world's spine" },
  { dir: "down", from: "birthsign:flame", to: "strength", sign: 1, weight: 0.6, why: "your blood runs hot" },
  { dir: "down", from: "birthsign:moon", to: "intelligence", sign: 1, weight: 0.9, why: "the deep tide's secrets" },
  { dir: "down", from: "birthsign:void", to: "focus", sign: 1, weight: 0.9, why: "your will outlasts the flesh" },
  // ─── DOWN: level -> attribute points and pools ───────────────────────────────────────────────
  { dir: "down", from: "level", to: "agility", sign: 1, weight: 0.8, why: "each level is 6 points, spent along the class lean (an assassin leans agility)" },
  { dir: "down", from: "level", to: "maxHealth", sign: 1, weight: 0.6, why: "applyLevel: +3 % health per level" },

  // ─── UP: vitality ────────────────────────────────────────────────────────────────────────────
  { dir: "up", from: "vitality", to: "maxHealth", sign: 1, weight: 1, why: "2 health units per point (statDelta)" },
  { dir: "up", from: "vitality", to: "staminaMax", sign: 1, weight: 0.8, why: "stamina pool: 6 per point" },
  { dir: "up", from: "vitality", to: "bodyMass", sign: 1, weight: 0.4, why: "1.4 kg per point (Physics.bodyFromStats)" },
  { dir: "up", from: "vitality", to: "anim.breathAmp", sign: -1, weight: 0.4, why: "fitter lungs breathe shallower" },
  // ─── UP: resilience ──────────────────────────────────────────────────────────────────────────
  { dir: "up", from: "resilience", to: "armor", sign: 1, weight: 1, why: "+1 armour per 2 points" },
  { dir: "up", from: "resilience", to: "critTaken", sign: -1, weight: 0.6, why: "crit chance divides by the defender's resilience" },
  { dir: "up", from: "resilience", to: "staminaRegen", sign: 1, weight: 0.5, why: "the stamina pool's recovery stat" },
  { dir: "up", from: "resilience", to: "anim.sway", sign: -1, weight: 0.4, why: "a sturdier stance sways less" },
  // ─── UP: focus ───────────────────────────────────────────────────────────────────────────────
  { dir: "up", from: "focus", to: "technique.castSeconds", sign: -1, weight: 1, why: "the channel shortens 1/(1 + 0.03·focus)" },
  { dir: "up", from: "focus", to: "cast.channel", sign: -1, weight: 1, why: "the live cast bar (Engine castSpec) reads the same law" },
  { dir: "up", from: "focus", to: "technique.duration", sign: 1, weight: 0.8, why: "an aura / self-buff holds 2 %/point longer" },
  { dir: "up", from: "focus", to: "manaRegen", sign: 1, weight: 0.8, why: "mana's recovery stat (+3 %/point)" },
  { dir: "up", from: "focus", to: "anim.jitter", sign: -1, weight: 0.5, why: "a steadier body: less seeded jitter" },
  // ─── UP: reflex (REACTION) ───────────────────────────────────────────────────────────────────
  { dir: "up", from: "reflex", to: "attackInterval", sign: -1, weight: 1, why: "the swing cadence: −0.02 s per point" },
  { dir: "up", from: "reflex", to: "critChance", sign: 1, weight: 1, why: "crit chance = f(attacker reflex)" },
  { dir: "up", from: "reflex", to: "technique.cooldown", sign: -1, weight: 0.8, why: "cooldown / (1 + 0.02·reflex)" },
  { dir: "up", from: "reflex", to: "anim.strikeTime", sign: -1, weight: 0.5, why: "a snappier strike phase" },
  { dir: "up", from: "reflex", to: "anim.chainLag", sign: -1, weight: 0.5, why: "a tighter kinetic chain" },
  // ─── UP: strength ────────────────────────────────────────────────────────────────────────────
  { dir: "up", from: "strength", to: "attackPower", sign: 1, weight: 1, why: "+1 damage unit per 2 points" },
  { dir: "up", from: "strength", to: "bodyMass", sign: 1, weight: 1, why: "3.5 kg per point" },
  { dir: "up", from: "strength", to: "knockback", sign: 1, weight: 0.8, why: "the blow's impulse scales with strength" },
  { dir: "up", from: "strength", to: "anim.windupDepth", sign: 1, weight: 0.5, why: "a deeper cock: more mass thrown" },
  { dir: "up", from: "strength", to: "technique.amplitude[strength]", sign: 1, weight: 1, why: "strength-scaled powers (Cleave, Crushing Blow)" },
  // ─── UP: intelligence ────────────────────────────────────────────────────────────────────────
  { dir: "up", from: "intelligence", to: "manaMax", sign: 1, weight: 1, why: "mana pool: 8 per point" },
  { dir: "up", from: "intelligence", to: "technique.manaCost", sign: -1, weight: 0.8, why: "mana / (1 + 0.025·int)" },
  { dir: "up", from: "intelligence", to: "anim.anticipation", sign: -1, weight: 0.4, why: "economical: telegraphs less" },
  { dir: "up", from: "intelligence", to: "technique.amplitude[intelligence]", sign: 1, weight: 1, why: "intelligence-scaled powers (Fireball, Soul Bolt)" },
  // ─── UP: agility (BODY SPEED and EVASION) ────────────────────────────────────────────────────
  { dir: "up", from: "agility", to: "moveSpeed", sign: 1, weight: 0.6, why: "Agility.moveSpeed: Engine #speedMul and MatchSim's step" },
  { dir: "up", from: "agility", to: "turnRate", sign: 1, weight: 0.6, why: "Agility.turnRate: the walk's turn response" },
  { dir: "up", from: "agility", to: "dashDistance", sign: 1, weight: 0.6, why: "Agility.dash: every lunge / dash / roll, engine and MatchSim" },
  { dir: "up", from: "agility", to: "damageTaken", sign: -1, weight: 0.5, why: "Agility.dodge grazes incoming blows (Stats.attackDamage)" },
  { dir: "up", from: "agility", to: "attackInterval", sign: -1, weight: 0.3, why: "a small share of the cadence (reflex stays its driver)" },
  { dir: "up", from: "agility", to: "anim.windupTime", sign: -1, weight: 1, why: "wind-up ÷ Agility.animSpeed (MotionStyle -> SwingDriver phases)" },
  { dir: "up", from: "agility", to: "anim.recoverTime", sign: -1, weight: 1, why: "recovery ÷ Agility.recovery" },
  { dir: "up", from: "agility", to: "anim.settleTime", sign: -1, weight: 0.6, why: "settle ÷ Agility.recovery" },
  { dir: "up", from: "agility", to: "anim.overshoot", sign: -1, weight: 0.6, why: "a nimble body brakes the weapon sooner" },
  { dir: "up", from: "agility", to: "technique.amplitude[agility]", sign: 1, weight: 1, why: "Whirlwind, Sprint, Vanish, Shadow Sprint, Killing Spree scale on agility" },
  { dir: "up", from: "agility", to: "technique.recoveryTail", sign: -1, weight: 0.5, why: "a power's release-and-return tail ÷ Agility.recovery" },
  { dir: "up", from: "agility", to: "cast.pushback", sign: -1, weight: 0.5, why: "a shoved channel recovers sooner (Cast.pushbackSeconds)" },
  // ─── UP (Wave Y): the pool POTENTIAL law (Potential.ts) ──────────────────────────────────────
  { dir: "up", from: "vitality", to: "potential.woundTaken", sign: -1, weight: 0.5, why: "a sturdy body takes shallower wounds (Potential.woundFactor)" },
  { dir: "up", from: "resilience", to: "potential.woundTaken", sign: -1, weight: 0.5, why: "hardened flesh: less health potential lost per blow" },
  { dir: "up", from: "strength", to: "potential.woundDealt", sign: 1, weight: 0.6, why: "a strong enemy wounds deeper (+4 %/point)" },
  { dir: "up", from: "focus", to: "potential.manaFatigue", sign: -1, weight: 0.6, why: "a steady mind tires less from fast casting (Potential.fatigueResist)" },
  { dir: "up", from: "vitality", to: "potential.staminaFatigue", sign: -1, weight: 0.6, why: "fit lungs: less stamina potential burnt by over-paced effort" },

  // ─── SIDE: strength vs agility (body mass); focus <-> intelligence (casting) ──────────────────
  { dir: "side", from: "strength", to: "agility.effective", sign: -1, weight: 0.6, why: "muscle is mass: 0.05 agility per kg above 70 kg" },
  { dir: "side", from: "vitality", to: "agility.effective", sign: -1, weight: 0.3, why: "a bigger frame is a heavier frame" },
  { dir: "side", from: "resilience", to: "agility.effective", sign: -1, weight: 0.2, why: "dense bone and hide weigh" },
  { dir: "side", from: "strength", to: "moveSpeed", sign: -1, weight: 0.3, why: "the mass drag reaches the walk" },
  { dir: "side", from: "strength", to: "anim.windupTime", sign: 1, weight: 0.2, why: "...and the wind-up tempo (through agility)" },
  { dir: "side", from: "intelligence", to: "focus.cast", sign: 1, weight: 0.25, why: "knowing the form steadies the channel (castFocus)" },
  { dir: "side", from: "intelligence", to: "technique.castSeconds", sign: -1, weight: 0.25, why: "so a scholar casts a little faster" },
  { dir: "side", from: "focus", to: "intelligence.mana", sign: 1, weight: 0.25, why: "a steady mind wastes less mana (manaIntelligence)" },
  { dir: "side", from: "focus", to: "technique.manaCost", sign: -1, weight: 0.25, why: "so a focused caster pays a little less" },
];
