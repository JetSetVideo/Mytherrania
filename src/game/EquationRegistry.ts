// The equation registry: every combat, physics, animation, AI and world formula
// the game runs, expressed as DATA that names its variables and its bounds.
//
// Each entry binds one formula to what it reads (`inputs`: parameter ids) and
// what it produces (`output`), so the model is inspectable rather than buried in
// code. The variables a formula reads are the SAME ids ParameterBounds.ts declares
// ranges for; `unknownInputs()` cross-checks the two, so a formula that reads a
// parameter nobody bounded is reported instead of silently defaulting.
//
// The engine calls `equation(id)` to resolve a single formula (the codex/validator
// path) and `unknownInputs()` once at boot to assert every formula's variables are
// declared. `equationsTouching(parameterId)` answers "what breaks if I retune this
// bound?" for the tuning UI; `equationsByCategory(cat)` and `inputsOf(id)` are the
// read helpers. HEALTH_SCALE and DAMAGE_SCALE are scale constants (Stats.ts), not
// bounded arena parameters, so they are treated as declared.
//
// Pure module: no Three.js, no DOM.

import { bound } from "./ParameterBounds.ts";

/** The functional family a formula belongs to. */
export type EquationCategory =
  | "combat"       // hit points, crit, damage, stun, regen, buffs
  | "physics"      // mass, density, toughness, impulse, collisions, balance
  | "animation"    // shape lofting, stance and grip motion
  | "ai"           // Elo / MMR ranking
  | "perception"   // senses and their lens
  | "environment"  // sky and light
  | "presentation"; // camera and effects

/** One formula as data: what it is, what it reads, what it produces. */
export interface Equation {
  /** Stable identifier, unique across the registry. */
  id: string;
  category: EquationCategory;
  /** The formula as a readable string, using the ids in `inputs`. */
  expression: string;
  /** Parameter ids the formula reads (bound by ParameterBounds.ts). */
  inputs: string[];
  /** The value the formula produces. */
  output: string;
  /** One line on what the formula does and where it lives. */
  note: string;
}

/**
 * Every equation in the game. Ordering is by category, then by the order the
 * engine evaluates them within a frame.
 */
export const EQUATIONS: Equation[] = [
  // --- combat -------------------------------------------------------------
  {
    id: "health",
    category: "combat",
    expression: "clamp(33 + 1.7*VIT + 0.55*STR, 34, 58) * HEALTH_SCALE",
    inputs: ["VIT", "STR", "HEALTH_SCALE"],
    output: "maxHealth",
    note: "Derived combat stat (Stats.ts): clamped to 34..58 base units, then scaled to RPG numbers.",
  },
  {
    id: "attackInterval",
    category: "combat",
    expression: "clamp(1.33 - 0.046*REF, 0.85, 1.35)",
    inputs: ["REF"],
    output: "attackInterval",
    note: "Seconds between swings; reflex is the only input (Stats.ts).",
  },
  {
    id: "armor",
    category: "combat",
    expression: "clamp(2.2 + 0.32*RES, 2, 6.5)",
    inputs: ["RES"],
    output: "armor",
    note: "Flat armour rating; resilience drives it (Stats.ts).",
  },
  {
    id: "crit",
    category: "combat",
    expression: "clamp(REF*0.008 / (RES*0.010 + 0.1), 0.03, 0.15)",
    inputs: ["REF", "RES"],
    output: "critChance",
    note: "Critical strike chance, floored at 3% and capped at 15% (Stats.criticalChance).",
  },
  {
    id: "damage",
    category: "combat",
    expression: "attackPower * crit * variance / (1 + armor*0.04)",
    inputs: ["attackPower", "crit", "variance", "armor"],
    output: "damage",
    note: "One hit's HP damage (Stats.attackDamage); crit in {1, 1.4}, variance = 1 + 0.35*(2*roll - 1).",
  },
  {
    id: "stun",
    category: "combat",
    expression: "damage * strength * 1.5 ** wallBounces * 0.01",
    inputs: ["damage", "strength", "wallBounces"],
    output: "stunDuration",
    note: "The brief's form, (damage * forceImpact) * 1.5 / wallBounce, divides by the bounce count and is a division by zero at zero bounces. The implementation raises 1.5 to the power of the bounce count instead, so every wall hit multiplies the stun; 0.01 converts to seconds. Source: src/physics/SmashPhysics.ts stunDuration.",
  },
  {
    id: "regen",
    category: "combat",
    expression: "rate * dt",
    inputs: ["rate", "dt"],
    output: "healthRestored",
    note: "Health regained this frame: the regen rate times the frame time.",
  },
  {
    id: "buffMultiplier",
    category: "combat",
    expression: "product of active buffs",
    inputs: ["buffs"],
    output: "buffMul",
    note: "Buffs compose multiplicatively: every active buff's multiplier is folded together.",
  },
  // --- physics ------------------------------------------------------------
  {
    id: "bodyMass",
    category: "physics",
    expression: "42 + 3.5*STR + 1.4*VIT + 1.1*RES",
    inputs: ["STR", "VIT", "RES"],
    output: "mass",
    note: "Body mass in kg from the attributes (Physics.bodyFromStats); strength adds fastest.",
  },
  {
    id: "bodyVolume",
    category: "physics",
    expression: "0.055 + 0.0016*STR",
    inputs: ["STR"],
    output: "volume",
    note: "Body volume in m^3; strength raises mass faster than volume, so strong bodies are denser.",
  },
  {
    id: "density",
    category: "physics",
    expression: "totalMass / totalVolume",
    inputs: ["totalMass", "totalVolume"],
    output: "density",
    note: "Composite density in kg/m^3: parts are summed, then divided (Physics.density).",
  },
  {
    id: "toughness",
    category: "physics",
    expression: "density * (0.4 + 0.6*armour) * sqrt(area)",
    inputs: ["density", "armour", "area"],
    output: "toughness",
    note: "Impulse a body absorbs per unit of damage; dense and armoured bodies shrug blows (Physics.toughness).",
  },
  {
    id: "reducedMass",
    category: "physics",
    expression: "m1*m2 / (m1 + m2)",
    inputs: ["m1", "m2"],
    output: "reducedMass",
    note: "Two-body reduced mass: equal bodies give m/2, an immovable wall gives m1 (Physics.reducedMass).",
  },
  {
    id: "impulse",
    category: "physics",
    expression: "reducedMass * (1 + restitution) * abs(deltaV)",
    inputs: ["reducedMass", "restitution", "deltaV"],
    output: "impulse",
    note: "Collision impulse in N*s; restitution is the pair's maximum (Physics.resolveImpact).",
  },
  {
    id: "momentum",
    category: "physics",
    expression: "mass * abs(speed)",
    inputs: ["mass", "speed"],
    output: "momentum",
    note: "Linear momentum in kg*m/s (Physics.momentum).",
  },
  {
    id: "knockback",
    category: "physics",
    expression: "impulse / mass * 0.12",
    inputs: ["impulse", "mass"],
    output: "knockback",
    note: "Metres a body is pushed: a light body is thrown, a heavy one barely shifts (Physics.resolveImpact).",
  },
  {
    id: "fallDamage",
    category: "physics",
    expression: "0.9 * (0.5*mass*speed^2) / toughness",
    inputs: ["mass", "speed", "toughness"],
    output: "fallDamage",
    note: "Landing damage: scales with mass and the square of impact speed, resisted by toughness (Physics.fallDamage).",
  },
  {
    id: "wallImpulse",
    category: "physics",
    expression: "mass * abs(exitSpeed)",
    inputs: ["mass", "exitSpeed"],
    output: "wallImpulse",
    note: "Momentum a body carries into a wall; breached when it exceeds 1.05 * wallResistance * integrity (Physics.hitWall).",
  },
  {
    id: "physicsMultiplier",
    category: "physics",
    expression: "clamp((0.55 + 0.30*(massA/massD) + 0.25*(densityA/densityD)) * (0.85 + 0.15*min(2, abs(attackerSpeed))), 0.6, 1.8)",
    inputs: ["massA", "massD", "densityA", "densityD", "attackerSpeed"],
    output: "physicsMul",
    note: "The bounded factor physics applies to every blow. Bounds and speed term come from src/game/Physics.ts (PHYSICS_MUL_MIN 0.6, PHYSICS_MUL_MAX 1.8); the engine uses the attacker's absolute speed, not a closing speed.",
  },
  {
    id: "balanceSway",
    category: "physics",
    expression: "A * e^(-gamma*t) * sin(omega*t + phi) + balancePoint",
    inputs: ["A", "gamma", "t", "omega", "phi", "balancePoint"],
    output: "lateralOffset",
    note: "Damped-sinusoid sway back toward the balance point after an impact (Balance.ts, SPEC 11.2).",
  },
  {
    id: "balanceAmplitude",
    category: "physics",
    expression: "clamp(hit / (fitness * condition * inertia), 0, 1.2) * sign(impactSide)",
    inputs: ["hit", "fitness", "condition", "inertia", "impactSide"],
    output: "amplitude",
    note: "The sway's amplitude from the unified status equation: fitter, healthier, lighter bodies sway less (Balance.balanceParams).",
  },
  // --- animation ----------------------------------------------------------
  {
    id: "moveStep",
    category: "animation",
    expression: "speed * dt * tightening",
    inputs: ["speed", "dt", "tightening"],
    output: "stepDistance",
    note: "Metres moved this frame; `tightening` folds stance and status speed multipliers into the step.",
  },
  {
    id: "stanceInstability",
    category: "animation",
    expression: "abs(offset) / STAGGER_OFFSET",
    inputs: ["offset", "STAGGER_OFFSET"],
    output: "instability",
    note: "Ratio of the balance offset to the stagger threshold; 1 means stagger, higher means knockdown (BalancePlates.ts).",
  },
  {
    id: "gripRestPitch",
    category: "animation",
    expression: "atan2(0, 1) = 0",
    inputs: ["forwardAxis", "upAxis"],
    output: "restPitch",
    note: "Blade rests vertical up +z: the pitch of the forward axis measured from up is atan2(0,1) = 0 (GripStance.ts).",
  },
  {
    id: "taper",
    category: "animation",
    expression: "tip + (root - tip) * (1 - t)^bias",
    inputs: ["tip", "root", "t", "bias"],
    output: "radius",
    note: "Radius along a body part: root at the base easing to tip; bias < 1 stays full longer (ShapeEquations.taper).",
  },
  {
    id: "muscleBulge",
    category: "animation",
    expression: "amp * e^(-((t - c)/w)^2)",
    inputs: ["amp", "t", "c", "w"],
    output: "bulgeGain",
    note: "A Gaussian muscle bulge centred at c with width w, peaking at amp (ShapeEquations.bulge).",
  },
  {
    id: "waistPinch",
    category: "animation",
    expression: "1 - depth * e^(-((t - c)/w)^2)",
    inputs: ["depth", "t", "c", "w"],
    output: "pinchGain",
    note: "A waist pinch narrowing the section around c by depth (ShapeEquations.pinch).",
  },
  {
    id: "superellipse",
    category: "animation",
    expression: "|x/a|^n + |z/b|^n = 1",
    inputs: ["x", "z", "a", "b", "n"],
    output: "sectionPoint",
    note: "Organic cross-section; n in 1.75..2.45, never a circle and never a square (ShapeEquations.superellipse).",
  },
  {
    id: "blendSmoothstep",
    category: "animation",
    expression: "a*(1 - s) + b*s, s = u^2*(3 - 2u)",
    inputs: ["a", "b", "u"],
    output: "blendedGain",
    note: "Smoothstep blend between two sections so a connector has matched tangents and no crease (ShapeEquations.blendGain).",
  },
  // --- ai -----------------------------------------------------------------
  {
    id: "eloExpected",
    category: "ai",
    expression: "1 / (1 + 10^((rb - ra)/400))",
    inputs: ["ra", "rb"],
    output: "expectedScore",
    note: "Elo logistic: the expected score of A against B (Ranking.expectedScore).",
  },
  {
    id: "mmr",
    category: "ai",
    expression: "rating + K * (score - expected)",
    inputs: ["rating", "K", "score", "expected"],
    output: "newRating",
    note: "New MMR after a result; score 1 win, 0.5 draw, 0 loss; K = 32 (Ranking.mmrAfter).",
  },
  {
    id: "eloUpsetDelta",
    category: "ai",
    expression: "K * (1 - expected)",
    inputs: ["K", "expected"],
    output: "upsetDelta",
    note: "MMR a full upset moves; larger than an expected win's K*score (Ranking, SPEC AI3).",
  },
  // --- perception ---------------------------------------------------------
  {
    id: "senseRange",
    category: "perception",
    expression: "base * falloff^distance",
    inputs: ["base", "falloff", "distance"],
    output: "range",
    note: "How far a sense reaches; base and falloff are per-sense (Senses.ts, SPEC 6.3).",
  },
  {
    id: "lensFactor",
    category: "perception",
    expression: "(1 - flatten*abs(sin(elevation))) * (1 + forward*cos(azimuth)*agitation) * (1 + flare*tan(min(elevation, cap))*agitation*0.5)",
    inputs: ["elevation", "azimuth", "agitation", "flatten", "forward", "flare", "cap"],
    output: "lensFactor",
    note: "The directional shape of a sense's coverage: flat on the ground, forward-biased when agitated (Senses.lensFactor).",
  },
  // --- environment --------------------------------------------------------
  {
    id: "luminosity",
    category: "environment",
    expression: "clamp(0.04 + 0.96*smoothstep(-0.105, 0.35, elevation), 0, 1) * (1 - 0.45*cloud)",
    inputs: ["elevation", "cloud"],
    output: "luminosity",
    note: "Ambient light from sun elevation: 0.04 starlight floor, saturates by 20 deg, dimmed by cloud (SPEC 6.4).",
  },
  // --- presentation -------------------------------------------------------
  {
    id: "occlusionAlpha",
    category: "presentation",
    expression: "clamp((d - dmin)/(dmax - dmin), 0, 1)",
    inputs: ["d", "dmin", "dmax"],
    output: "alpha",
    note: "Opacity an occluder fades to so the viewed character is never hidden (CameraOcclusion.occlusionAlpha, SPEC 11.3).",
  },
];

/** The formula with this id, or null when the registry has no such equation. */
export function equation(id: string): Equation | null {
  return EQUATIONS.find((e) => e.id === id) ?? null;
}

/** Every formula in one functional family. */
export function equationsByCategory(category: EquationCategory): Equation[] {
  return EQUATIONS.filter((e) => e.category === category);
}

/** How many formulas the registry holds. */
export function equationCount(): number {
  return EQUATIONS.length;
}

/**
 * The parameter ids one formula reads, as a copy so a caller cannot mutate the
 * registry. Empty when the id is unknown.
 */
export function inputsOf(id: string): string[] {
  const eq = equation(id);
  return eq ? [...eq.inputs] : [];
}

/**
 * The parameter ids referenced by some formula but with NO declared bound in
 * ParameterBounds.ts. HEALTH_SCALE and DAMAGE_SCALE are scale constants, not
 * bounded parameters, so they are treated as declared. The engine calls this once
 * at boot: a non-empty result means a formula reads an unbounded variable.
 */
export function unknownInputs(): string[] {
  const missing = new Set<string>();
  for (const eq of EQUATIONS) {
    for (const id of eq.inputs) {
      if (id === "HEALTH_SCALE" || id === "DAMAGE_SCALE") continue;
      if (!bound(id)) missing.add(id);
    }
  }
  return [...missing];
}

/** Every formula that reads a parameter — the inverse of `inputsOf`. */
export function equationsTouching(parameterId: string): Equation[] {
  return EQUATIONS.filter((e) => e.inputs.includes(parameterId));
}
