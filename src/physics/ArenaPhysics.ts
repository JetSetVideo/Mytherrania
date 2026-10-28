// Arena physics for one body per frame: the SHAPED ring floor, the perimeter wall
// (which resists, rebounds or breaks according to the body's momentum), the solid
// outside ground, and solid props. Pure — no Three.js, no DOM — so every rule here
// is unit-tested and the engine only calls it.
//
// Units: metres, seconds, kilograms. The two body types meet here:
//   KinematicBody  — position/velocity/radius (the fighter's `body`, SmashPhysics)
//   Body (Physics) — parts with mass/volume/area, used for momentum and toughness
import { hitWall, type Body } from "../game/Physics.ts";
import { insideRing, objectSize, ringRadiusAt, wallFor, type ArenaConfig, type ArenaObject } from "../game/ArenaConfig.ts";
import type { Body as KinematicBody } from "./SmashPhysics.ts";

/** Gravity used for every free body in the arena, m/s². */
export const ARENA_GRAVITY = 24;

/** Mutable per-match arena state: the wall wears down as it is hit. */
export interface ArenaState {
  cfg: ArenaConfig;
  /** cfg.walls, rolled ONCE per match by randomArena; never re-rolled per frame. */
  walled: boolean;
  /** 1 = intact, 0 = broken through. Shared by the whole perimeter. */
  integrity: number;
  props: ArenaObject[];
}

/** What happened to a body this step, for the engine to turn into damage and FX. */
export interface ArenaStep {
  /** The body's centre is over the ring floor. */
  onRing: boolean;
  /** Impact speed (m/s) if the body landed on the outside ground this step, else 0. */
  landedOutside: number;
  /** Non-null when the body struck the wall this step. */
  wall: { breached: boolean; selfDamage: number; speed: number } | null;
}

/**
 * Advance one kinematic body by dt.
 *
 *   v_y ← v_y − g·dt;  x ← x + v·dt
 *   floor:   inside outline and y < r  →  y = r, v_y = 0
 *   wall:    was inside, now outside, y < wallHeight, wall intact
 *            → hitWall(body, v_out, wall, integrity):
 *              held  → clamp to 0.98·R(θ), reflect radial velocity: v_r ← −retained
 *              broken → integrity drops, the body carries on out
 *   outside: outsideGround ∧ outsideCollision ∧ y < h_out + r
 *            → y = h_out + r, landing speed reported, v_y = 0
 *   props:   solid prop within (r_prop·scale + r_body) → pushed out radially
 *
 * `outwardSpeed` is the body's true speed along the outward normal, measured by the
 * engine (walking moves x directly, so v_x alone under-reports it).
 */
export function stepArenaBody(
  b: KinematicBody, phys: Body, dt: number, st: ArenaState, outwardSpeed: number,
  prev?: { x: number; z: number },
): ArenaStep {
  const cfg = st.cfg;
  // "Was inside" must use LAST frame's position: walking, AI steering and skill
  // lunges move x/z directly before this step, so the current position may already
  // be past the outline — checking it would let every walker straight through.
  const wasInside = prev ? insideRing(cfg, prev.x, prev.z) : insideRing(cfg, b.x, b.z);
  b.vy -= ARENA_GRAVITY * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let wall: ArenaStep["wall"] = null;

  // Perimeter wall: only stops bodies that were inside and are low enough to hit it.
  if (st.walled && st.integrity > 0 && wasInside && !insideRing(cfg, b.x, b.z) && b.y < cfg.wallHeight) {
    const angle = Math.atan2(b.z, b.x);
    const nx = Math.cos(angle), nz = Math.sin(angle);
    const speed = Math.max(0.5, outwardSpeed, b.vx * nx + b.vz * nz);
    const hit = hitWall(phys, speed, wallFor(cfg), st.integrity);
    st.integrity = hit.wallIntegrity;
    if (!hit.breached) {
      const R = ringRadiusAt(cfg, angle) * 0.98;
      b.x = nx * R;
      b.z = nz * R;
      // Replace the outward component of velocity with the rebound.
      const vr = b.vx * nx + b.vz * nz;
      b.vx += (-hit.retainedSpeed - vr) * nx;
      b.vz += (-hit.retainedSpeed - vr) * nz;
    }
    wall = { breached: hit.breached, selfDamage: hit.selfDamage, speed };
  }

  const onRing = insideRing(cfg, b.x, b.z);
  if (onRing && b.y < b.radius && b.y > -b.radius * 2) {
    b.y = b.radius;
    b.vy = 0;
  }

  let landedOutside = 0;
  if (!onRing && cfg.outsideGround >= 1 && cfg.outsideCollision >= 1) {
    const floor = cfg.outsideHeight + b.radius;
    if (b.y < floor) {
      if (b.vy < -0.5) landedOutside = -b.vy;
      b.y = floor;
      b.vy = 0;
    }
  }

  // Solid props: push the body out of each prop's footprint.
  for (const p of st.props) {
    if (!p.solid) continue;
    const r = objectSize(p.kind).r * p.scale + b.radius;
    const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
    if (d < r && b.y < p.y + objectSize(p.kind).h * p.scale) {
      const k = d < 1e-6 ? 1 : 1 / d;
      b.x = p.x + (d < 1e-6 ? r : dx * k * r);
      b.z = p.z + dz * k * r;
      const vn = b.vx * dx * k + b.vz * dz * k;
      if (vn < 0) { b.vx -= vn * dx * k; b.vz -= vn * dz * k; }
    }
  }

  const damping = Math.exp(-1.2 * dt);
  b.vx *= damping;
  b.vz *= damping;
  return { onRing, landedOutside, wall };
}

/**
 * Distance from a point to the ring outline along its bearing, metres. Positive
 * inside, negative outside. The AI's "near the edge" test uses this, so it works
 * for every ring shape, not just the old square.
 */
export function edgeDistance(cfg: ArenaConfig, x: number, z: number): number {
  return ringRadiusAt(cfg, Math.atan2(z, x)) - Math.hypot(x, z);
}

/**
 * The outline sampled as a closed polygon (n points), for rendering the floor and
 * the wall segments. Points are in world x/z.
 */
export function outline(cfg: ArenaConfig, n = 96): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = ringRadiusAt(cfg, a);
    pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return pts;
}
