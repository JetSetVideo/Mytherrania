// Wave FALL (C-FALL, agent M): the per-fighter stumble / fall / down / rise state machine, the
// get-up time law, the edge (teeter) rule, the back-step and ledge triggers, and the downed penalties.
// Pure module: no THREE, no DOM, no Math.random (the caller passes a roll in [0, 1)). Units: s, m, kg.
//
// Phases and legal transitions (SPEC FALL-F10, LEGAL below):
//   stand    -> stagger | stumble | falling
//   stagger  -> stand (timer) | stumble | falling
//   stumble  -> stand (recovered) | falling (the roll at the trigger said so)
//   falling  -> down (FALL_SECONDS, the body reaches the floor)
//   down     -> rising (plan.down seconds)
//   rising   -> stand (plan.rise seconds) | falling (knocked over again while getting up)
// Only `stand` may act; `stagger`/`stumble` may not act; `down`/`rising` are DOWNED (penalties apply);
// a rising fighter may only guard (the get-up ends in guard).
//
// Triggers (triggerFall): a balance loss L in [0, 1] from a collision or a blow (Collision.ts), plus
// EXHAUSTION_BALANCE when stamina is at or under EXHAUSTION_STAMINA:
//   L >= FALL_THRESHOLD      -> falling
//   L >= STUMBLE_THRESHOLD   -> stumble; it ends in a fall when roll < fallChance(L, agility, stamina)
//   L >= STAGGER_THRESHOLD or a stagger time > 0 -> stagger
// Edge (teeterCheck): a body whose centre is within TEETER_MARGIN of an OPEN rim (or beyond it by less
// than its footprint — ring-out still owns "really outside") moving outward faster than TEETER_SPEED
// teeters (a stumble, cause "edge"); agility and stamina decide recover vs fall. Back-step
// (backstepCheck): a backward step whose rear foot finds a drop deeper than the step height or a solid
// obstacle -> stumble, cause "backstep". Ledge (ledgeCheck): pushed (not walking) over a drop deeper
// than the step height inside the arena -> falling, cause "ledge".
//
// Get-up time law (riseSeconds, SPEC FALL-F12): total seconds on the floor (down + rising)
//   T = RISE_BASE · √(bodyMass / RISE_MASS_REF) · (1 + RISE_ARMOUR · armourMass) / agilityFactor(agility)
//       · (1 + RISE_WOUND · (1 − hp01)) · (1 + RISE_TIRED · (1 − stamina01)),  clamped [RISE_MIN, RISE_MAX];
//   rising = clamp((1 − DOWN_SHARE)·T, RISE_PHASE_MIN, T − DOWN_MIN), down = T − rising (RISE_MIN >= RISE_PHASE_MIN + DOWN_MIN).

/** Downed penalty: damage taken × this while down or rising. */
export const DOWNED_DAMAGE_TAKEN = 1.3;
/** Downed penalty: crit chance + this (absolute) against a downed body. */
export const DOWNED_CRIT_BONUS = 0.15;
/** Downed penalty: control/status durations (and stuns) × this. */
export const DOWNED_STATUS_DURATION = 1.4;
/** Downed penalty: knockback × this (and stability ÷ this in Collision.ts). */
export const DOWNED_KNOCKBACK = 1.25;

export const STAGGER_THRESHOLD = 0.1;
export const STUMBLE_THRESHOLD = 0.4;
export const FALL_THRESHOLD = 0.8;
/** Stamina share at or under which the body is exhausted and loses balance easily. */
export const EXHAUSTION_STAMINA = 0.1;
export const EXHAUSTION_BALANCE = 0.2;
/** Seconds of a stumble at agility factor 1 (÷ agility factor, clamped [0.35, 0.9]). */
export const STUMBLE_SECONDS = 0.55;
/** Seconds from losing the feet to the body on the floor (A's fall animation length). */
export const FALL_SECONDS = 0.5;
/** Get-up law constants (module header). */
export const RISE_BASE = 1.5, RISE_MASS_REF = 75, RISE_ARMOUR = 0.02, RISE_WOUND = 0.5, RISE_TIRED = 0.4;
export const RISE_MIN = 1.2, RISE_MAX = 3.5;
/** Share of the get-up time spent lying before the get-up sequence starts (when the rising floor allows). */
export const DOWN_SHARE = 0.45;
/**
 * Shortest rising phase, s: a get-up from lying (roll, hands and knees, kneel, stand) faster than this hits
 * the animation's joint speed limits and slides the planted foot (lane A measured 83 mm at 0.44 s vs
 * 4-15 mm at >= 1.3 s, docs/wave-fall/ANIMATION.md). Shortest down phase: DOWN_MIN.
 */
export const RISE_PHASE_MIN = 1.0, DOWN_MIN = 0.2;
/** Edge rule. */
export const TEETER_MARGIN = 0.2, TEETER_SPEED = 0.6, TEETER_BALANCE = 0.45, TEETER_PER_SPEED = 0.08;
/** Back-step rule: balance loss of a back-step into a drop / an obstacle. */
export const BACKSTEP_BALANCE = 0.5;

export type FallPhase = "stand" | "stagger" | "stumble" | "falling" | "down" | "rising";
export type FallCause = "collision" | "hit" | "edge" | "backstep" | "ledge" | "exhaustion";
export type FallPose = "back" | "front" | "side";

export interface FallState {
  phase: FallPhase;
  /** Seconds in the current phase. */
  t: number;
  /** Duration of the current phase, s. */
  duration: number;
  /** Fall direction, world xz (unit). */
  dir: [number, number];
  cause: FallCause | null;
  pose: FallPose;
  /** A stumble that ends in a fall (decided by the trigger's roll). */
  willFall?: boolean;
  /** The get-up plan fixed when the fall began: seconds down, seconds rising. */
  plan?: { down: number; rise: number };
}

/** The body as the get-up law and the triggers read it. */
export interface FallBody {
  armourMass: number;
  bodyMass: number;
  /** Runtime Stats.agility. */
  agility: number;
  hp01: number;
  stamina01: number;
}

export interface FallRequest {
  balanceLoss: number;
  cause: FallCause;
  /** Direction the body is thrown (world xz). */
  dir: [number, number];
  /** Facing (world xz), for the pose. */
  facing: [number, number];
  /** Stagger seconds requested (a collision's / blow's stagger), 0 = none. */
  stagger?: number;
  /** Uniform roll in [0, 1) (seeded by the caller). */
  roll: number;
  body: FallBody;
}

export const LEGAL: Readonly<Record<FallPhase, readonly FallPhase[]>> = {
  stand: ["stagger", "stumble", "falling"],
  stagger: ["stand", "stumble", "falling"],
  stumble: ["stand", "falling"],
  falling: ["down"],
  down: ["rising"],
  rising: ["stand", "falling"],
};

const fin = (v: number, d = 0) => (Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, fin(v, lo)));
const c01 = (v: number) => clamp(v, 0, 1);
/** Collision.agilityFactor (repeated here to keep the import one-way: Collision imports Fall). */
const agiK = (agility: number) => clamp(1 + 0.06 * (fin(agility, 5) - 5), 0.6, 1.5);

export function standing(): FallState {
  return { phase: "stand", t: 0, duration: 0, dir: [0, 0], cause: null, pose: "back" };
}

export function isLegal(from: FallPhase, to: FallPhase): boolean { return LEGAL[from].includes(to); }
/** Only a standing fighter acts (moves, swings, casts). */
export function canActIn(s: FallState): boolean { return s.phase === "stand"; }
/** On the floor: the downed penalties apply. */
export function isDowned(s: FallState): boolean { return s.phase === "down" || s.phase === "rising"; }
/** Off balance: stagger, stumble or falling (the brain's "unbalanced"). */
export function isUnbalanced(s: FallState): boolean { return s.phase === "stagger" || s.phase === "stumble" || s.phase === "falling"; }
/** A rising fighter may still raise its guard. */
export function canGuardIn(s: FallState): boolean { return s.phase === "stand" || s.phase === "rising"; }
/** Progress 0..1 through the current phase. */
export function t01(s: FallState): number { return s.duration > 0 ? c01(s.t / s.duration) : 1; }

/** Get-up time law (module header), s. */
export function riseSeconds(armourMass: number, bodyMass: number, agility: number, hp01: number, stamina01: number): number {
  const T = RISE_BASE * Math.sqrt(Math.max(20, fin(bodyMass, RISE_MASS_REF)) / RISE_MASS_REF) * (1 + RISE_ARMOUR * Math.max(0, fin(armourMass)))
    / agiK(agility) * (1 + RISE_WOUND * (1 - c01(fin(hp01, 1)))) * (1 + RISE_TIRED * (1 - c01(fin(stamina01, 1))));
  return clamp(T, RISE_MIN, RISE_MAX);
}

/** The down / rising split of the get-up time. */
export function risePlan(b: FallBody): { down: number; rise: number } {
  const T = riseSeconds(b.armourMass, b.bodyMass, b.agility, b.hp01, b.stamina01);
  const rise = Math.min(T - DOWN_MIN, Math.max(RISE_PHASE_MIN, (1 - DOWN_SHARE) * T));
  return { down: T - rise, rise };
}

/** Stumble seconds: an agile body catches (or loses) its feet sooner. */
export function stumbleSeconds(agility: number): number { return clamp(STUMBLE_SECONDS / agiK(agility), 0.35, 0.9); }

/**
 * Chance a stumble ends in a fall: the loss's share of the stumble..fall band, scaled down by agility
 * and up by fatigue: clamp(((L − STUMBLE)/(FALL − STUMBLE)) · (1.5 − 0.5·agiK)·(1.3 − 0.3·stamina01) + 0.15, 0, 1).
 * Monotone: more loss / less agility / less stamina -> more falls.
 */
export function fallChance(loss: number, agility: number, stamina01: number): number {
  const band = c01((fin(loss) - STUMBLE_THRESHOLD) / (FALL_THRESHOLD - STUMBLE_THRESHOLD));
  return c01(band * (1.5 - 0.5 * agiK(agility)) * (1.3 - 0.3 * c01(stamina01)) + 0.15);
}

/** Pose of a fall: thrown along `dir` while facing `facing` -> backward / forward / sideways. */
export function poseFor(dir: [number, number], facing: [number, number]): FallPose {
  const dl = Math.hypot(dir[0], dir[1]), fl = Math.hypot(facing[0], facing[1]);
  if (dl < 1e-9 || fl < 1e-9) return "back";
  const c = (dir[0] * facing[0] + dir[1] * facing[1]) / (dl * fl);
  return c <= -0.5 ? "back" : c >= 0.5 ? "front" : "side";
}

function unit(d: [number, number]): [number, number] {
  const l = Math.hypot(fin(d[0]), fin(d[1]));
  return l < 1e-9 ? [0, 0] : [d[0] / l, d[1] / l];
}

function enter(s: FallState, phase: FallPhase, duration: number): void {
  s.phase = phase; s.t = 0; s.duration = Math.max(0, fin(duration));
}

/**
 * Apply a trigger (module header). Mutates and returns `s`. Ignored while falling or down (a body
 * already going to the floor cannot fall further); a rising body knocked hard enough falls again.
 */
export function triggerFall(s: FallState, r: FallRequest): FallState {
  if (s.phase === "falling" || s.phase === "down") return s;
  const exhausted = c01(r.body.stamina01) <= EXHAUSTION_STAMINA;
  let loss = c01(r.balanceLoss);
  let cause: FallCause = r.cause;
  if (exhausted && (loss > 0 || (r.stagger ?? 0) > 0)) {
    const before = loss;
    loss = c01(loss + EXHAUSTION_BALANCE);
    if (before < STUMBLE_THRESHOLD && loss >= STUMBLE_THRESHOLD) cause = "exhaustion";
  }
  const dir = unit(r.dir);
  const pose = poseFor(dir, r.facing);
  if (s.phase === "rising") {
    if (loss < STUMBLE_THRESHOLD) return s;
    startFalling(s, cause, dir, pose, r.body);
    return s;
  }
  if (loss >= FALL_THRESHOLD) { startFalling(s, cause, dir, pose, r.body); return s; }
  if (loss >= STUMBLE_THRESHOLD) {
    if (s.phase === "stumble") return s;
    enter(s, "stumble", stumbleSeconds(r.body.agility));
    s.cause = cause; s.dir = dir; s.pose = pose;
    s.willFall = fin(r.roll, 1) < fallChance(loss, r.body.agility, r.body.stamina01);
    s.plan = s.willFall ? risePlan(r.body) : undefined;
    return s;
  }
  const st = Math.max(0, fin(r.stagger ?? 0));
  if (loss >= STAGGER_THRESHOLD || st > 0) {
    if (s.phase === "stumble") return s;
    const want = Math.max(st, loss >= STAGGER_THRESHOLD ? 0.2 + 0.5 * loss : 0);
    if (s.phase === "stagger") { s.duration = Math.max(s.duration, s.t + want); return s; }
    enter(s, "stagger", want);
    s.cause = cause; s.dir = dir; s.pose = pose; s.willFall = false; s.plan = undefined;
  }
  return s;
}

function startFalling(s: FallState, cause: FallCause, dir: [number, number], pose: FallPose, b: FallBody): void {
  enter(s, "falling", FALL_SECONDS);
  s.cause = cause; s.dir = dir; s.pose = pose; s.willFall = true; s.plan = risePlan(b);
}

/** A phase change made by stepFall (for telemetry / combat text). */
export interface FallTransition { from: FallPhase; to: FallPhase; cause: FallCause | null }

/**
 * Advance the timers by dt. Mutates `s`; returns the transition that happened (at most one per call
 * unless dt spans several phases — then the LAST one; callers sub-step at <= 1/30 s), else null.
 */
export function stepFall(s: FallState, dt: number): FallTransition | null {
  if (s.phase === "stand") return null;
  s.t += Math.max(0, fin(dt));
  let last: FallTransition | null = null;
  for (let guard = 0; guard < 6 && s.t >= s.duration && (s.phase as FallPhase) !== "stand"; guard++) {
    const over = s.t - s.duration, from = s.phase, cause = s.cause;
    let to: FallPhase;
    if (from === "stagger") to = "stand";
    else if (from === "stumble") to = s.willFall ? "falling" : "stand";
    else if (from === "falling") to = "down";
    else if (from === "down") to = "rising";
    else to = "stand";
    const dur = to === "falling" ? FALL_SECONDS : to === "down" ? (s.plan?.down ?? DOWN_MIN) : to === "rising" ? (s.plan?.rise ?? RISE_PHASE_MIN) : 0;
    enter(s, to, dur);
    s.t = to === "stand" ? 0 : over;
    if (to === "stand") { s.cause = null; s.willFall = undefined; s.plan = undefined; }
    last = { from, to, cause };
  }
  return last;
}

/** Seconds a fall started now keeps the body unable to act (falling + down + rising). */
export function fallDowntime(s: FallState): number {
  return s.plan ? FALL_SECONDS + s.plan.down + s.plan.rise : 0;
}

// --- edge / back-step / ledge -----------------------------------------------------------------

export interface EdgeProbe {
  /** RingOut.beyondDistance: centre beyond the outline, m (<= 0 inside). */
  beyond: number;
  /** Footprint radius, m. */
  footprint: number;
  /** Velocity component toward the rim, m/s. */
  outwardSpeed: number;
  /** The rim here is open (no standing wall). */
  open: boolean;
}

/**
 * The edge rule: null when the body is safely inside, walled, really outside (ring-out owns that), or
 * not moving outward fast enough; else the balance loss of a teeter (stumble band, rising with speed).
 */
export function teeterLoss(p: EdgeProbe): number | null {
  if (!p.open) return null;
  const beyond = fin(p.beyond, -Infinity);
  if (beyond > p.footprint) return null;                 // really outside: the ring-out rule
  if (beyond < -TEETER_MARGIN) return null;              // safely inside
  if (!(fin(p.outwardSpeed) > TEETER_SPEED)) return null;
  return c01(TEETER_BALANCE + TEETER_PER_SPEED * (p.outwardSpeed - TEETER_SPEED));
}

/** Back-step: moving backward with the rear foot over a drop deeper than the step height or onto an obstacle. */
export function backstepLoss(backward: boolean, rearDrop: number, stepHeight: number, rearBlocked: boolean): number | null {
  if (!backward) return null;
  if (rearBlocked || fin(rearDrop) > Math.max(0.05, fin(stepHeight, 0.3))) return BACKSTEP_BALANCE;
  return null;
}

/** Ledge: a PUSHED body (knock speed > 1 m/s) whose floor dropped more than a step this step -> fall. */
export function ledgeFall(drop: number, stepHeight: number, pushSpeed: number): boolean {
  return fin(pushSpeed) > 1 && fin(drop) > Math.max(0.05, fin(stepHeight, 0.3));
}

// --- downed penalties ---------------------------------------------------------------------------

export function downedDamageMul(s: FallState): number { return isDowned(s) ? DOWNED_DAMAGE_TAKEN : 1; }
export function downedCritBonus(s: FallState): number { return isDowned(s) ? DOWNED_CRIT_BONUS : 0; }
export function downedStatusMul(s: FallState): number { return isDowned(s) ? DOWNED_STATUS_DURATION : 1; }
export function downedKnockMul(s: FallState): number { return isDowned(s) ? DOWNED_KNOCKBACK : 1; }
