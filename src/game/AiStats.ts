// Per-AI identity + combat telemetry recorder.
//
// Every AI combatant has a stable id and name (from Identity.ts) plus a
// Telemetry record that accumulates the fight: distances travelled, distance
// to the enemy, damage dealt/prevented/missed, technique usage, and position
// on the x/y/z axes. digest() folds the raw samples into min/max/mean/median
// so a neural policy and a decision tree can adapt from what actually happened.
//
// Pure module: no Three.js, no DOM. All data lives here; the Engine only calls
// the record* hooks.

import { makeIdentity, type Identity } from "./Identity.ts";

// Re-export the descriptive fold so callers need one import site.
export interface Stats {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  sd: number;
}

/** Fold raw samples into min/max/mean/median/sd. Empty input returns zeros. */
export function fold(values: number[]): Stats {
  // Drop non-finite samples: a body that left the world (NaN position) must not
  // poison the whole digest — the statistics stay clean for the models.
  const n0 = values.length;
  if (!n0) return { n: 0, mean: 0, median: 0, min: 0, max: 0, sd: 0 };
  const clean = values.filter((v) => Number.isFinite(v));
  const n = clean.length;
  if (!n) return { n: 0, mean: 0, median: 0, min: 0, max: 0, sd: 0 };
  const s = [...clean].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, median, min: s[0], max: s[n - 1], sd };
}

/** Technique usage counts, so the digest knows which skill was tried most/least. */
export interface TechniqueTally {
  dash: number;
  power: number;
  defense: number;
}

/** One hit's outcome for the prevented/missed digest. */
export interface HitSample {
  dealt: number;      // damage the defender took
  prevented: number;  // damage absorbed by block/armour
  missed: number;     // damage that would have landed on a whiff (0 if it connected)
}

/** Raw per-fight accumulation. Series are capped so memory stays bounded. */
const CAP = 4096;

export class Telemetry {
  /** Straight-line metres moved this fight (per-frame displacement summed). */
  distanceTravelled = 0;
  /** Distance to the enemy sampled once per tick. */
  #distToEnemy: number[] = [];
  /** Damage the enemy took, per landed hit. */
  #dealt: number[] = [];
  /** Damage absorbed by this AI's block/armour, per enemy hit. */
  #prevented: number[] = [];
  /** Damage a whiffed enemy hit would have dealt (a dodge), per whiff. */
  #missed: number[] = [];
  /** Altitude samples (y). */
  #altitude: number[] = [];
  /** World x and z samples. */
  #x: number[] = [];
  #z: number[] = [];
  /** Closing speed at each landed hit (m/s) — the physics calibration data. */
  #closing: number[] = [];
  /** Technique usage. */
  techniques: TechniqueTally = { dash: 0, power: 0, defense: 0 };
  /** Fastest kill (s) this AI ever recorded; +inf until the first win. */
  fastestWin = Infinity;
  /** HP% thresholds already recorded (80/50/20), so each fires once. */
  #thresholdsFired = new Set<number>();
  /** The state at each threshold crossing. */
  thresholds: { hpRatio: number; t: number; distToEnemy: number; dealtSoFar: number }[] = [];
  /** Damage per 5-second bucket, for the "most damage on a period" digest. */
  #damageWindows = new Map<number, number>();
  /** Last position, for the distance-travelled delta. */
  #lastX: number | null = null;
  #lastZ: number | null = null;

  /** Per-frame movement + position sample. Call once per tick with the fight clock. */
  tick(x: number, y: number, z: number, distToEnemy: number, t: number, hpRatio: number, dealtSoFar: number): void {
    // Guard the corpus: a non-finite position (a body that left the world) is a
    // physics event, not a data point — skip the sample rather than fold a NaN in.
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(distToEnemy)) {
      this.#lastX = null; this.#lastZ = null;
      return;
    }
    if (this.#lastX !== null) {
      this.distanceTravelled += Math.hypot(x - this.#lastX, z - (this.#lastZ ?? 0));
    }
    this.#lastX = x;
    this.#lastZ = z;
    this.#push(this.#distToEnemy, distToEnemy);
    this.#push(this.#altitude, Number.isFinite(y) ? y : 0);
    this.#push(this.#x, x);
    this.#push(this.#z, z);
    for (const th of [0.8, 0.5, 0.2]) {
      if (hpRatio <= th && !this.#thresholdsFired.has(th)) {
        this.#thresholdsFired.add(th);
        this.thresholds.push({ hpRatio: th, t, distToEnemy, dealtSoFar });
      }
    }
  }

  /** A landed hit by this AI: how much damage, at what closing speed. */
  recordHit(dealt: number, closingSpeed: number, t: number): void {
    if (!Number.isFinite(dealt)) return;
    this.#push(this.#dealt, dealt);
    this.#push(this.#closing, Number.isFinite(closingSpeed) ? closingSpeed : 0);
    const bucket = Math.floor(t / 5) * 5;
    this.#damageWindows.set(bucket, (this.#damageWindows.get(bucket) ?? 0) + dealt);
  }

  /** A hit this AI survived: raw incoming vs what it actually took (block/armour). */
  recordDefence(incoming: number, taken: number): void {
    if (!Number.isFinite(incoming) || !Number.isFinite(taken)) return;
    this.#push(this.#prevented, Math.max(0, incoming - taken));
  }

  /** An enemy hit that whiffed (would-be damage, dodged). */
  recordMissed(wouldBe: number): void {
    this.#push(this.#missed, Math.max(0, wouldBe));
  }

  /** A technique was used. */
  recordTechnique(kind: keyof TechniqueTally): void {
    this.techniques[kind]++;
  }

  /** A win at time t (s) updates the fastest-kill record. */
  recordWin(t: number): void {
    if (t < this.fastestWin) this.fastestWin = t;
  }

  #push(arr: number[], v: number): void {
    arr.push(v);
    if (arr.length > CAP) arr.splice(0, arr.length - CAP);
  }

  /** The 5-second window in which this AI dealt the most damage. */
  peakWindow(): { start: number; damage: number } {
    let best = { start: 0, damage: 0 };
    for (const [start, damage] of this.#damageWindows) if (damage > best.damage) best = { start, damage };
    return best;
  }

  /** The folded digest a policy/tree consumes. */
  digest(): TelemetryDigest {
    const tech = this.techniques;
    const techTotal = tech.dash + tech.power + tech.defense;
    return {
      distanceTravelled: this.distanceTravelled,
      distToEnemy: fold(this.#distToEnemy),
      dealt: fold(this.#dealt),
      prevented: fold(this.#prevented),
      missed: fold(this.#missed),
      altitude: fold(this.#altitude),
      x: fold(this.#x),
      z: fold(this.#z),
      closing: fold(this.#closing),
      techniques: { ...tech },
      techniqueTotal: techTotal,
      favouriteTechnique: techTotal === 0 ? "none"
        : tech.dash >= tech.power && tech.dash >= tech.defense ? "dash"
        : tech.power >= tech.defense ? "power" : "defense",
      peakWindow: this.peakWindow(),
      fastestWin: this.fastestWin,
      thresholds: [...this.thresholds],
    };
  }
}

export interface TelemetryDigest {
  distanceTravelled: number;
  distToEnemy: Stats;
  dealt: Stats;
  prevented: Stats;
  missed: Stats;
  altitude: Stats;
  x: Stats;
  z: Stats;
  closing: Stats;
  techniques: TechniqueTally;
  techniqueTotal: number;
  favouriteTechnique: string;
  peakWindow: { start: number; damage: number };
  fastestWin: number;
  thresholds: { hpRatio: number; t: number; distToEnemy: number; dealtSoFar: number }[];
}

/**
 * One AI's standing record: identity, the live fight's telemetry, and the
 * career win/loss counts that drive adaptation.
 */
export class AiProfile {
  readonly identity: Identity;
  /** Career record across matches. */
  wins = 0;
  losses = 0;
  draws = 0;
  /** The current fight's telemetry; reset per match. */
  telemetry = new Telemetry();
  /** Career aggregates that survive across matches. */
  careerDistance = 0;
  careerDealt: number[] = [];

  constructor(seed: number, prefix = "AI") {
    this.identity = makeIdentity(seed, prefix);
  }

  get id(): string { return this.identity.id; }
  get name(): string { return this.identity.full; }

  /** Win rate in [0,1], 0.5 before any match. */
  winRate(): number {
    const n = this.wins + this.losses;
    return n === 0 ? 0.5 : this.wins / n;
  }

  /** Start a fresh fight's telemetry. */
  beginFight(): void {
    this.telemetry = new Telemetry();
  }

  /** Close a fight: fold the career aggregates and record the result. */
  endFight(result: "win" | "loss" | "draw", t: number): void {
    if (result === "win") { this.wins++; this.telemetry.recordWin(t); }
    else if (result === "loss") this.losses++;
    else this.draws++;
    this.careerDistance += this.telemetry.distanceTravelled;
    const d = this.telemetry.digest();
    if (d.dealt.n > 0) this.careerDealt.push(d.dealt.mean);
    if (this.careerDealt.length > 256) this.careerDealt.splice(0, this.careerDealt.length - 256);
  }
}
