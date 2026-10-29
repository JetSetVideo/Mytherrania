// Ring-out = ELIMINATION (V03). A body ejected from the arena loses the match: the other
// fighter wins with the reason "ringout", and the eliminated body becomes a ragdoll.
//
// Definition (contract: src/world/biomes/contracts.ts, RingOutEvent):
//   A body is RINGED OUT when the wall did not stop it this step AND it is BEYOND the ring
//   — its centre lies outside the outline by more than its footprint radius (no part of the
//   footprint is still over the ring floor) — AND at least one of:
//     (a) it has DROPPED more than RING_OUT_DROP below the rim: drop = rimY − bottomY,
//         RING_OUT_DROP = RING_OUT_DROP_HEIGHTS × standing height (a ledge as tall as the
//         fighter cannot be climbed back: one body height);
//     (b) it TOUCHES the outside world: its lowest point reaches the surface below
//         (Surroundings.surfaceAt) — a liquid (water, magma), a canopy, or solid ground.
//         Solid ground counts too (the sumo rule): a body that lands beyond the ring cannot
//         come back through a standing wall, and an open edge reads as a ring-out line;
//     (c) it falls below the kill plane (void, cloud).
//   Units: metres, seconds; frame +y up, ring centred on the origin.
//
// Double ring-out (both bodies qualify in the same step): the body whose centre left the
// outline FIRST (earlier exit time) was ejected first and loses — the same rule as "the first
// ring-out ends the match" applied inside one frame. An exact tie falls to the lower HP
// fraction, then (fully symmetric) to the player, so the result is deterministic.
// Pure module: no Three.js, no DOM.
import type { Medium, RingOutEvent, Surroundings } from "../world/biomes/contracts.ts";
import type { ArenaConfig } from "./ArenaConfig.ts";
import { insideDistance, wallPolygonOf } from "../physics/WallCollision.ts";

/** Ring-out drop in standing heights (one body height: a ledge you cannot climb back up). */
export const RING_OUT_DROP_HEIGHTS = 1;
/** Standing height used when a body's own height is unknown, m (the default Appearance height). */
export const REFERENCE_BODY_HEIGHT = 1.7;
/** Kill plane used when there are no Surroundings: well below the deepest outside ground (−20 m). */
export const FALLBACK_KILL_PLANE_Y = -40;

/** RING_OUT_DROP for a body of `bodyHeight` metres: RING_OUT_DROP_HEIGHTS · bodyHeight. */
export function ringOutDrop(bodyHeight: number = REFERENCE_BODY_HEIGHT): number {
  return RING_OUT_DROP_HEIGHTS * bodyHeight;
}

/**
 * The world outside the ring, with or without lane S's Surroundings. Without them the arena
 * config decides: solid ground at `outsideHeight` (outsideGround = 1) or a void.
 */
export interface OutsideProbe {
  medium: Medium;
  /** Surface height below (x, z), m; NaN where there is nothing. */
  surfaceY: number;
  /** Below this world y the body is lost for good, m. */
  killPlaneY: number;
}

/** Fill `out` with what lies below (x, z) at time t. Allocates nothing. */
export function outsideAt(cfg: ArenaConfig, s: Surroundings | null, x: number, z: number, t: number, out: OutsideProbe): OutsideProbe {
  if (s) {
    out.medium = s.mediumAt(x, z);
    out.surfaceY = s.surfaceAt(x, z, t);
    out.killPlaneY = s.killPlaneY;
  } else if (cfg.outsideGround >= 1 && cfg.outsideCollision >= 1) {
    out.medium = "ground"; out.surfaceY = cfg.outsideHeight; out.killPlaneY = FALLBACK_KILL_PLANE_Y;
  } else {
    out.medium = "void"; out.surfaceY = NaN; out.killPlaneY = FALLBACK_KILL_PLANE_Y;
  }
  return out;
}

/** One body's state at the end of a physics step, as the ring-out rule reads it. */
export interface RingOutProbe {
  fighter: "player" | "opponent";
  /** Body centre, m. */
  x: number; y: number; z: number;
  /** Velocity, m/s. */
  vx: number; vy: number; vz: number;
  /** Footprint radius (horizontal), m. */
  radius: number;
  /** Lowest point of the body, m (kinematic body: y − radius). */
  bottomY: number;
  /** Standing height, m. */
  bodyHeight: number;
  /** Ring floor height at the rim nearest the body, m (0 on a flat ring). */
  rimY: number;
  /** The wall held this body this step (contact without a breach): never a ring-out. */
  wallStopped: boolean;
  /** Match time, s. */
  time: number;
}

/** How far beyond the outline the centre is, m (≤ 0 while over the ring): max_i(−s_i). */
export function beyondDistance(cfg: ArenaConfig, x: number, z: number): number {
  return -insideDistance(wallPolygonOf(cfg), x, z);
}

const OUTSIDE: OutsideProbe = { medium: "ground", surfaceY: 0, killPlaneY: FALLBACK_KILL_PLANE_Y };

/** Distance above a surface at which a body counts as touching it, m (one contact skin). */
export const TOUCH_TOLERANCE = 0.02;

/**
 * Apply the ring-out rule (module comment) to one body. Returns the event, or null while the
 * body is still in play. `s` is lane S's Surroundings (null: the arena config's fallback).
 */
export function checkRingOut(cfg: ArenaConfig, p: RingOutProbe, s: Surroundings | null): RingOutEvent | null {
  if (p.wallStopped) return null;
  if (beyondDistance(cfg, p.x, p.z) <= p.radius) return null;
  const o = outsideAt(cfg, s, p.x, p.z, p.time, OUTSIDE);
  const dropped = p.rimY - p.bottomY > ringOutDrop(p.bodyHeight);
  const touched = Number.isFinite(o.surfaceY) && p.bottomY <= o.surfaceY + TOUCH_TOLERANCE;
  const lost = p.y < o.killPlaneY;
  if (!dropped && !touched && !lost) return null;
  return {
    fighter: p.fighter, medium: o.medium,
    x: p.x, z: p.z, speed: Math.hypot(p.vx, p.vy, p.vz), time: p.time,
  };
}

/** When a body's centre left the outline (null while it is over the ring). */
export interface ExitClock { exitTime: number | null }

/** Record the moment the centre first leaves the outline; reset when it is back over the ring. */
export function trackExit(clock: ExitClock, cfg: ArenaConfig, x: number, z: number, time: number): void {
  if (beyondDistance(cfg, x, z) > 0) { if (clock.exitTime === null) clock.exitTime = time; }
  else clock.exitTime = null;
}

/** One ring-out candidate for the tie-break. */
export interface RingOutCandidate { event: RingOutEvent; exitTime: number | null; hpFraction: number }

/**
 * Who LOSES when one or both bodies ring out in the same step (module comment):
 * a single event loses; with two, the earlier exit loses, then the lower HP fraction, then
 * the player. Returns null when neither rang out.
 */
export function ringOutLoser(player: RingOutCandidate | null, opponent: RingOutCandidate | null): "player" | "opponent" | null {
  if (!player && !opponent) return null;
  if (!opponent) return "player";
  if (!player) return "opponent";
  const ep = player.exitTime ?? player.event.time, eo = opponent.exitTime ?? opponent.event.time;
  if (ep !== eo) return ep < eo ? "player" : "opponent";
  if (player.hpFraction !== opponent.hpFraction) return player.hpFraction < opponent.hpFraction ? "player" : "opponent";
  return "player";
}
