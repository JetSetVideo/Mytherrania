// NavPilot (Wave N, lane N-A) — the layer between a path and a body.
//
// A route answers "which way around the props". The pilot answers the three questions a route
// alone cannot, and that a 300 s timeout exposes when they are answered badly:
//
//   1. Is the body MAKING PROGRESS, or grinding against a prop / running in place / orbiting?
//      The basis is `progressToward` — the METRES CLOSED toward the goal in `dt` seconds — so a
//      body that is moving fast but not getting closer still reads as stuck ("moving is not
//      progress"). A stall of `stuckS` seconds trips a bounded ESCAPE.
//   2. When must a route toward a MOVING opponent be re-planned? A bounded cadence: at most every
//      `replanS` seconds, and at once when the goal has moved more than `REPLAN_DIST_M` metres or
//      the body has strayed more than `STRAY_M` off the planned line. A stale path is never chased
//      beyond that distance.
//   3. When has the body ARRIVED so it stops instead of orbiting or overrunning the target?
//
// Pure module: no DOM, no THREE, no Math.random, no clock. Every bound is a named constant with
// units (m = metres, s = seconds, m/s). `step(dt, self)` is allocation-free (one reused Steer and
// one reused goal); the only allocation is a fresh route on a re-plan.
import { distanceToPolyline, steerAlongPath, type Obstacle, type PathCursor, type PathPoint, type Steer } from "../world/PathFinder.ts";

/** A ground point, world metres. */
export interface XY { x: number; z: number }

/** A body this tick: position (m) and velocity (m/s). */
export interface NavSelf extends XY { vx: number; vz: number }

/** Within this of the goal the body has ARRIVED and must stop, m. */
export const ARRIVE_M = 0.35;
/** A moving goal is re-planned at least this often even when it barely moves, s. */
export const REPLAN_S = 0.4;
/** ...and at once when the goal has moved this far from the last plan, m. */
export const REPLAN_DIST_M = 1.0;
/** Closure must stall this long to call the body STUCK, s (the option `stuckS` default). */
export const STUCK_S = 0.35;
/** Closing slower than this counts as NO progress, m/s. */
export const STUCK_PROGRESS_MPS = 0.25;
/** One escape burst is held this long before the route is tried again, s. */
export const ESCAPE_BURST_S = 0.4;
/** Escape directions tried in one cycle: right-perp, left-perp, reverse, then two diagonals. */
export const ESCAPE_CANDIDATES = 5;
/** One escape cycle is bounded to this: ESCAPE_CANDIDATES bursts of ESCAPE_BURST_S, s. */
export const ESCAPE_MAX_S = ESCAPE_BURST_S * ESCAPE_CANDIDATES;
/** The body is off its planned line (or the route is stale) beyond this, m — re-plan. */
export const STRAY_M = 1.2;
/** Body clearance kept from an obstacle when bending a local route, m. */
export const NAV_CLEAR_M = 0.4;
/** The body is done with an intermediate waypoint within this of it, m. */
export const PASS_M = 0.3;

/** A right angle in radians — the escape sidestep is perpendicular to the goal line. */
const HALF_PI = Math.PI / 2;

/**
 * The pilot. A caller drives it: every tick it calls `plan` toward the (possibly moving) opponent
 * and passes the result of `step` to whatever integrator moves the body. `stuckS` is the running
 * stall timer and `replans` how many routes have been computed — both are the numbers the timeout
 * measurement reports ("the AI's own").
 */
export interface NavPilot {
  /** The current route, start included (metres). Empty until the first `plan`. */
  readonly route: readonly PathPoint[];
  /** The goal the route leads to, or null before the first `plan`. */
  readonly goal: XY | null;
  /** Seconds the body has been stalling on the current goal (NO closure), s. */
  stuckS: number;
  /** How many routes have been computed (a bounded cadence). */
  replans: number;
  /** True while the pilot is executing an escape burst rather than following the route. */
  readonly escaping: boolean;
  /** Point the pilot at `target` from `from`, bending a local route around `obstacles`. */
  plan(target: XY, from: XY, obstacles: readonly Obstacle[]): void;
  /** Advance one tick and return this tick's steering (unit direction, or done on arrival). */
  step(dt: number, self: NavSelf): Steer;
}

class NavPilotImpl implements NavPilot {
  readonly arriveM: number;
  readonly replanS: number;
  readonly stuckThresholdS: number;

  #goal: XY | null = null;
  #route: PathPoint[] = [];
  #cursor: PathCursor = { index: 0 };
  #out: Steer = { dirX: 0, dirZ: 0, done: true };
  #vel: XY = { x: 0, z: 0 };
  #lastPlanGoal: XY | null = null;
  #lastPlanT = Number.NEGATIVE_INFINITY;
  #tS = 0;
  #escaping = false;
  #escapeIdx = 0;
  #burstS = 0;
  #escapeAngle = 0;
  #obstacles: readonly Obstacle[] = [];

  stuckS = 0;
  replans = 0;

  constructor(o: { arriveM?: number; replanS?: number; stuckS?: number }) {
    this.arriveM = Number.isFinite(o.arriveM) && (o.arriveM as number) > 0 ? (o.arriveM as number) : ARRIVE_M;
    this.replanS = Number.isFinite(o.replanS) && (o.replanS as number) > 0 ? (o.replanS as number) : REPLAN_S;
    this.stuckThresholdS = Number.isFinite(o.stuckS) && (o.stuckS as number) > 0 ? (o.stuckS as number) : STUCK_S;
  }

  get route(): readonly PathPoint[] { return this.#route; }
  get goal(): XY | null { return this.#goal; }
  get escaping(): boolean { return this.#escaping; }

  plan(target: XY, from: XY, obstacles: readonly Obstacle[]): void {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.z) || !Number.isFinite(from.x) || !Number.isFinite(from.z)) return;
    const first = this.#goal === null;
    const moved = this.#lastPlanGoal === null ||
      Math.hypot(target.x - this.#lastPlanGoal.x, target.z - this.#lastPlanGoal.z) > REPLAN_DIST_M;
    const due = this.#tS - this.#lastPlanT >= this.replanS;
    const stale = this.#route.length === 0 || distanceToPolyline(this.#route, from.x, from.z) > STRAY_M;
    if (!(first || moved || due || stale)) return;
    this.#goal = { x: target.x, z: target.z };
    this.#obstacles = obstacles;
    this.#route = planLocalRoute(from, target, obstacles);
    this.#cursor.index = 0;
    this.#lastPlanGoal = { x: target.x, z: target.z };
    this.#lastPlanT = this.#tS;
    this.replans++;
    // A new goal (or a big jump) is a fresh start: forget the stall and any escape.
    if (first || moved) {
      this.stuckS = 0;
      this.#escaping = false;
      this.#escapeIdx = 0;
      this.#burstS = 0;
    }
  }

  step(dt: number, self: NavSelf): Steer {
    const out = this.#out;
    if (!(dt > 0) || !Number.isFinite(dt)) { out.dirX = 0; out.dirZ = 0; out.done = false; return out; }
    this.#tS += dt;
    const g = this.#goal;
    if (!g) { out.dirX = 0; out.dirZ = 0; out.done = true; return out; }

    // Arrival: stop inside arriveM rather than orbiting the target.
    if (!this.#escaping && Math.hypot(g.x - self.x, g.z - self.z) <= this.arriveM) {
      out.dirX = 0; out.dirZ = 0; out.done = true; return out;
    }

    // An escape burst is an open-loop sidestep: it is judged only when it ends, because a sidestep
    // does not close on the goal by construction.
    if (this.#escaping) {
      this.#burstS += dt;
      out.dirX = Math.cos(this.#escapeAngle);
      out.dirZ = Math.sin(this.#escapeAngle);
      out.done = false;
      if (this.#burstS >= ESCAPE_BURST_S) { this.#escaping = false; this.#burstS = 0; }
      return out;
    }

    this.#vel.x = self.vx;
    this.#vel.z = self.vz;
    const rate = progressToward(self, g, this.#vel, dt) / dt;
    if (rate <= STUCK_PROGRESS_MPS) this.stuckS += dt;
    else this.stuckS = 0;

    if (this.stuckS >= this.stuckThresholdS) {
      this.#startBurst(self, g);
      this.stuckS = 0;
      out.dirX = Math.cos(this.#escapeAngle);
      out.dirZ = Math.sin(this.#escapeAngle);
      out.done = false;
      return out;
    }
    const st = steerAlongPath(this.#route, this.#cursor, self.x, self.z, PASS_M, out);
    // steerAlongPath ends on the LAST vertex within PASS_M of it, but the pilot's arrival band is
    // arriveM. When the goal is still outside arriveM, steer straight at it instead of stopping
    // (otherwise a small arriveM could never be honoured — PASS_M would end the run first).
    if (st.done) {
      const d = Math.hypot(g.x - self.x, g.z - self.z);
      if (d > 1e-9 && d > this.arriveM) {
        out.dirX = (g.x - self.x) / d;
        out.dirZ = (g.z - self.z) / d;
        out.done = false;
      }
    }
    return out;
  }

  /** Pick and begin the next escape direction in the cycle (a bounded sweep). */
  #startBurst(self: XY, g: XY): void {
    const base = Math.atan2(g.z - self.z, g.x - self.x);
    // Right/left perpendicular first; the side with more obstacle clearance leads. Then reverse,
    // then the two 45° splay directions, so a straight wall, a circular prop and a curved rim are
    // all covered by a finite sweep.
    const perp = clearanceSideSign(self, g, this.#obstacles);
    const offsets = [perp * HALF_PI, -perp * HALF_PI, Math.PI, perp * HALF_PI * 0.5, -perp * HALF_PI * 0.5];
    this.#escapeAngle = base + offsets[this.#escapeIdx % ESCAPE_CANDIDATES];
    this.#escapeIdx++;
    this.#escaping = true;
    this.#burstS = 0;
    // A full cycle of failed directions is itself a signal the route is wrong: re-plan.
    if (this.#escapeIdx > ESCAPE_CANDIDATES) {
      this.#escapeIdx = 1;
      this.#route = planLocalRoute(self, g, this.#obstacles);
      this.#cursor.index = 0;
      this.replans++;
    }
  }
}

/** A fresh pilot. `arriveM` (m), the re-plan cadence `replanS` (s) and the stall threshold `stuckS` (s). */
export function createNavPilot(o: { arriveM?: number; replanS?: number; stuckS?: number } = {}): NavPilot {
  return new NavPilotImpl(o);
}

/**
 * Metres CLOSED toward `to` in `dt` seconds thanks to `vel`: the distance before minus the distance
 * after. Positive = got closer, negative = fell behind, ~0 = running in place or sideways. This is
 * the stuck detector's basis — motion alone is not progress. Total: dt = 0 or a degenerate segment
 * yields 0, and a non-finite input yields 0 (never NaN).
 */
export function progressToward(from: XY, to: XY, vel: XY, dt: number): number {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.z) || !Number.isFinite(to.x) || !Number.isFinite(to.z) ||
    !Number.isFinite(vel.x) || !Number.isFinite(vel.z) || !Number.isFinite(dt)) return 0;
  const before = Math.hypot(to.x - from.x, to.z - from.z);
  const after = Math.hypot(to.x - (from.x + vel.x * dt), to.z - (from.z + vel.z * dt));
  return before - after;
}

/**
 * A local route from `from` to `to`: the straight line, bent around every obstacle circle it
 * crosses (each bend is a point on the circle boundary pushed out by NAV_CLEAR_M to the side the
 * circle bulges), re-checked until no bend is needed or 8 passes have run. Never longer than
 * necessary, never through a circle the caller named. Pure.
 */
export function planLocalRoute(from: XY, to: XY, obstacles: readonly Obstacle[]): PathPoint[] {
  const pts: PathPoint[] = [{ x: from.x, z: from.z, y: 0 }, { x: to.x, z: to.z, y: 0 }];
  // Each obstacle is bent around AT MOST once: bending the same circle again on the child segment
  // pushed the point to the other side and the two bends ping-ponged forever.
  const bent = new Set<Obstacle>();
  for (let pass = 0; pass < 8; pass++) {
    let inserted = false;
    for (let k = 0; k < pts.length - 1 && !inserted; k++) {
      const a = pts[k], b = pts[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-9) continue;
      const ux = dx / len, uz = dz / len;
      let bestT = Infinity, bestO: Obstacle | null = null;
      for (const o of obstacles) {
        if (bent.has(o)) continue;
        const r = o.radius + NAV_CLEAR_M;
        const t = Math.max(0, Math.min(1, ((o.x - a.x) * ux + (o.z - a.z) * uz) / len));
        const cx = a.x + ux * t * len, cz = a.z + uz * t * len;
        if (Math.hypot(o.x - cx, o.z - cz) < r && t < bestT) { bestT = t; bestO = o; }
      }
      if (bestO) {
        const o = bestO;
        bent.add(o);
        const r = o.radius + NAV_CLEAR_M;
        // Push the bend to the side the circle centre lies on (perp = the line's right normal).
        const s = (o.x - a.x) * -uz + (o.z - a.z) * ux >= 0 ? 1 : -1;
        // Apex along the span (nearest approach) plus the sideways offset, so both child spans
        // clear the circle by construction.
        pts.splice(k + 1, 0, { x: a.x + ux * bestT * len + -uz * s * r, z: a.z + uz * bestT * len + ux * s * r, y: 0 });
        inserted = true;
      }
    }
    if (!inserted) break;
  }
  return pts;
}

/**
 * Which way to sidestep: +1 for the goal's right-hand side, -1 for its left. With obstacles named,
 * the side whose ray stays clearer of them leads; with none, "right" leads (deterministic).
 */
function clearanceSideSign(self: XY, g: XY, obstacles: readonly Obstacle[]): number {
  if (obstacles.length === 0) return 1;
  const dx = g.x - self.x, dz = g.z - self.z, len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  let right = 0, left = 0;
  for (const o of obstacles) {
    const rx = o.x - self.x, rz = o.z - self.z;
    const side = rx * -uz + rz * ux; // + = obstacle on the right
    const ahead = rx * ux + rz * uz;
    const w = Math.max(0, 1 - Math.abs(side) / (o.radius + 1e-6)) * (ahead > 0 ? 1 : 0.3);
    if (side >= 0) right += w; else left += w;
  }
  return right <= left ? 1 : -1;
}
