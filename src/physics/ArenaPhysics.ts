// Arena physics for one body per frame: the SHAPED ring floor, the perimeter wall
// (which resists, rebounds or breaks according to the body's momentum), the solid
// outside ground, and solid props. Pure — no Three.js, no DOM — so every rule here
// is unit-tested and the engine only calls it.
//
// Units: metres, seconds, kilograms. The two body types meet here:
//   KinematicBody  — position/velocity/radius (the fighter's `body`, SmashPhysics)
//   Body (Physics) — parts with mass/volume/area, used for momentum and toughness
import { hitWall, totalMass, type Body } from "../game/Physics.ts";
import { insideRing, objectSize, ringRadiusAt, wallFor, type ArenaConfig, type ArenaObject } from "../game/ArenaConfig.ts";
import type { Body as KinematicBody } from "./SmashPhysics.ts";
import { settleOnFloor, type FloorContact } from "../world/TerrainGround.ts";
import {
  createSweep, reflectVelocity, sweepCircleWall, WALL_CONTACT_SLOP, WALL_SKIN, wallOverlap, wallPolygonOf, type WallOverlap,
} from "./WallCollision.ts";
import { WALL_BLOCK_HEIGHT, type WallPlan } from "../game/arena/contracts.ts";
import { segmentIndexAt } from "../game/arena/walls.ts";

/** Gravity used for every free body in the arena, m/s². */
export const ARENA_GRAVITY = 24;

/** Reused floor-contact result, so the per-frame step allocates nothing. */
const FLOOR_CONTACT: FloorContact = { grounded: false, blocked: false, floorY: 0 };

/** Mutable per-match arena state: the wall wears down as it is hit. */
export interface ArenaState {
  cfg: ArenaConfig;
  /** cfg.walls, rolled ONCE per match by randomArena; never re-rolled per frame. */
  walled: boolean;
  /** 1 = intact, 0 = broken through. Shared by the whole perimeter. */
  integrity: number;
  props: ArenaObject[];
  /** Terrain floor height at (x, z), m (TerrainMeshBuild.floorHeightAt). Absent = flat floor at y 0. */
  floorAt?: (x: number, z: number) => number;
  /** Highest ledge a walker steps up without being blocked, m (TerrainRules.base.stepHeight). */
  stepHeight?: number;
  /** Steepest climbable gradient, rise/run (TerrainRules.maxClimbTan = tan(maxSlope)). */
  maxClimbTan?: number;
  /** The outside ground follows the terrain (drawn): floorAt is valid outside the ring too. */
  outsideFollowsTerrain?: boolean;
  /** Bodies passing through a breach right now: the wall ignores them until they clear its band. */
  passing?: Set<KinematicBody>;
  /** Approach speed (m/s) under which a new wall contact is a lean, not a blow. Default WALL_IMPACT_SPEED. */
  wallImpactSpeed?: number;
  /**
   * Wave J: the per-segment wall plan (src/game/arena/walls.ts). Present = the wall's HEIGHT,
   * RESISTANCE and BOUNCE are read per segment at the contact's bearing (an opening has height 0);
   * absent = the legacy single wall at cfg.wallHeight. The collision SHAPE stays the outline polygon.
   */
  wallPlan?: WallPlan;
  /** Wave J: integrity per plan segment (1 intact, 0 breached = an opening). `integrity` is their minimum. */
  segIntegrity?: Float64Array;
}

/** Wave J: a hard knock at least this fast topples a body over a wall below its centre of mass, m/s. */
export const KNOCK_OVER_SPEED = 6;
/** Wave J: a wall at least this tall is above a standing body's centre of mass (≈ 0.55 × 1.75 m), m. */
export const COM_HEIGHT = 0.95;
/** Speed a body keeps tripping over a curb / toppling over a mid wall. */
export const TRIP_KEEP = 0.7, TOPPLE_KEEP = 0.6;

/** One wall segment as the collision reads it (reused: the step allocates nothing). */
export interface SegView { k: number; height: number; resistance: number; bounce: number; integrity: number }
const SEG: SegView = { k: -1, height: 0, resistance: 0, bounce: 0, integrity: 1 };

/**
 * The wall at bearing `angle` (rad): the plan's segment (height 0 when it is an opening or its
 * integrity is spent) or, without a plan, the legacy single wall. Fills and returns `out`.
 */
export function wallAt(st: ArenaState, angle: number, out: SegView = SEG): SegView {
  const plan = st.wallPlan;
  if (plan && plan.segments.length > 0) {
    const k = segmentIndexAt(plan, angle);
    const s = plan.segments[k];
    const integ = st.segIntegrity ? st.segIntegrity[k] : st.integrity;
    out.k = k; out.integrity = integ;
    out.height = integ > 0 ? s.height : 0;
    out.resistance = s.resistance; out.bounce = s.bounce;
  } else {
    out.k = -1; out.integrity = st.integrity;
    out.height = st.integrity > 0 ? st.cfg.wallHeight : 0;
    out.resistance = st.cfg.wallResistance; out.bounce = st.cfg.wallBounce;
  }
  return out;
}

/** Wall height (m above the rim) at the bearing of (x, z), 0 = no wall there (Wave J). */
export function wallHeightAtXZ(st: ArenaState, x: number, z: number): number {
  if (!st.walled) return 0;
  return wallAt(st, Math.atan2(z, x)).height;
}

/** What happened to a body this step, for the engine to turn into damage and FX. */
export interface ArenaStep {
  /** The body's centre is over the ring floor. */
  onRing: boolean;
  /** Impact speed (m/s) if the body landed on the outside ground this step, else 0. */
  landedOutside: number;
  /**
   * Non-null when the body STRUCK the wall this step (a new contact at ≥ the impact speed).
   * `nx/nz` is the contact normal (from the wall toward the body), for FX.
   */
  wall: { breached: boolean; selfDamage: number; speed: number; nx: number; nz: number } | null;
  /** The body touched the wall this step: a blow, or a sustained lean/slide along it. */
  wallContact: boolean;
}

/**
 * Normal approach speed (m/s) under which a NEW wall contact is a lean, not a blow: no
 * hitWall, no self-damage, no wear. 1 m/s ≈ a slow step; the engine may raise it to its walk
 * speed so walking into the wall only ever slides (ArenaState.wallImpactSpeed).
 */
export const WALL_IMPACT_SPEED = 1;
/** Coulomb friction of the wall face at friction = 1 (dressed stone on cloth/leather ≈ 0.4). */
export const WALL_FRICTION_BASE = 0.4;
/** Slides resolved per frame (face, then a second face in a corner, then a spare). */
export const WALL_MAX_SLIDES = 4;

/**
 * Restitution of a held blow: e = wallBounce · (1 − min(1, J / R_eff)), with J = m·v the
 * blow's momentum and R_eff = wallResistance · integrity. A tap bounces at the material's
 * full wallBounce; a blow near the breach threshold is soaked up by the deforming wall.
 */
export function wallRestitution(cfg: ArenaConfig, mass: number, approachSpeed: number, integrity: number): number {
  return restitutionOf(cfg.wallResistance, cfg.wallBounce, mass, approachSpeed, integrity);
}

/** wallRestitution for explicit resistance / bounce (a Wave J plan segment's own values). */
export function restitutionOf(resistance: number, bounce: number, mass: number, approachSpeed: number, integrity: number): number {
  const eff = resistance * Math.max(0, integrity);
  if (eff <= 0) return 0;
  return bounce * (1 - Math.min(1, (mass * approachSpeed) / eff));
}

/** Reused per-step scratch (the step allocates nothing unless a blow is reported). */
const SWEEP = createSweep();
const OVERLAP: WallOverlap = { depth: 0, nx: 0, nz: 0 };
const VEL = { vx: 0, vz: 0 };

/**
 * Advance one kinematic body by dt.
 *
 *   v_y ← v_y − g·dt;  path p0 → p1 with p0 = prev (start of frame) and p1 = p + v·dt
 *   wall (V02, continuous): the footprint circle (radius r_c = contactRadius) is swept along
 *     the path against the wall polygon (WallCollision): the EARLIEST contact on any face or
 *     corner stops it there (minus WALL_SKIN). The contact normal is the SEGMENT's normal
 *     (inner faces) or the corner direction (outer, rounded corners). A body whose bottom is
 *     above the wall top at that moment passes over. Then:
 *       new contact at approach ≥ impact speed → hitWall(body, v, wall, integrity):
 *         held   → v_n ← −e·v_n (wallRestitution), tangential friction, the rest of the path SLIDES
 *         broken → integrity drops, the velocity keeps the retained fraction, the body passes
 *       sustained contact (already touching) → inelastic: v_n ← 0, slide, no event
 *   floor:   inside outline and y < r  →  y = r, v_y = 0
 *   outside: outsideGround ∧ outsideCollision ∧ y < h_out + r
 *            → y = h_out + r, landing speed reported, v_y = 0
 *   props:   solid prop within (r_prop·scale + r_body) → pushed out radially
 *   last:    static depenetration from the wall band (props can push a body into it)
 *
 * `outwardSpeed` is the body's measured speed toward the outside (the engine's smoothed
 * velocity: walking and lunges move x directly, so v alone under-reports a blow).
 */
export function stepArenaBody(
  b: KinematicBody, phys: Body, dt: number, st: ArenaState, outwardSpeed: number,
  prev?: { x: number; z: number }, contactRadius: number = b.radius,
): ArenaStep {
  const cfg = st.cfg;
  // The swept path starts at LAST frame's position: walking, AI steering and skill lunges
  // move x/z directly before this step, so the current position may already be past the wall.
  const x0 = prev ? prev.x : b.x, z0 = prev ? prev.z : b.z, y0 = b.y;
  b.vy -= ARENA_GRAVITY * dt;
  let x1 = b.x + b.vx * dt, z1 = b.z + b.vz * dt;
  b.y += b.vy * dt;
  let wall: ArenaStep["wall"] = null;
  let wallContact = false;

  // With a plan, integrity is per segment (a breach opens one segment, not the whole wall).
  const wallUp = st.walled && (st.wallPlan ? true : st.integrity > 0);
  const poly = wallUp ? wallPolygonOf(cfg) : null;
  if (poly) {
    if (st.passing?.has(b)) {
      // Passing through a breach: the wall ignores this body until it clears the band.
      if (!wallOverlap(poly, contactRadius, x1, z1, OVERLAP)) st.passing.delete(b);
    } else {
      let sx = x0, sz = z0, pnx = 0, pnz = 0;
      const ox = x1 - x0, oz = z1 - z0; // the frame's intended displacement
      for (let iter = 0; iter < WALL_MAX_SLIDES; iter++) {
        if (!sweepCircleWall(poly, contactRadius, sx, sz, x1, z1, SWEEP)) break;
        // The wall stands on the rim of the terrain: "low enough" is measured from the rim.
        const yAt = iter === 0 ? y0 + (b.y - y0) * SWEEP.t : b.y;
        const rimY = st.floorAt ? st.floorAt(SWEEP.x * 0.98, SWEEP.z * 0.98) : 0;
        // Wave J: the wall at the contact's bearing (per plan segment). An opening (height 0, or a
        // segment already breached) is no wall: a straight path leaves a convex outline once.
        const seg = wallAt(st, Math.atan2(SWEEP.z, SWEEP.x));
        if (seg.height <= 0) break;
        if (yAt - b.radius >= rimY + seg.height) break; // over the top
        const nx = SWEEP.nx, nz = SWEEP.nz;
        const fresh = SWEEP.startGap > WALL_CONTACT_SLOP;
        const toward = SWEEP.side === "inner" ? outwardSpeed : -outwardSpeed;
        const approach = Math.max(toward, -(b.vx * nx + b.vz * nz));
        const blow = fresh && !wall && approach >= (st.wallImpactSpeed ?? WALL_IMPACT_SPEED);
        // Wave J: a low wall does not hold a blow. Under WALL_BLOCK_HEIGHT (a curb) a blow TRIPS the
        // body over it; under the centre of mass a hard knock TOPPLES it over. A lean slides as before.
        if (st.wallPlan && SWEEP.side === "inner" && (
          (blow && seg.height < WALL_BLOCK_HEIGHT) || (fresh && !wall && seg.height < COM_HEIGHT && approach >= KNOCK_OVER_SPEED)
        )) {
          const keep = seg.height < WALL_BLOCK_HEIGHT ? TRIP_KEEP : TOPPLE_KEEP;
          b.vx *= keep; b.vz *= keep;
          (st.passing ??= new Set()).add(b);
          break; // over it, along the path
        }
        wallContact = true;
        let e = 0;
        if (blow) {
          const before = seg.integrity;
          const hit = hitWall(phys, approach, seg.k >= 0 ? { resistance: seg.resistance, height: seg.height, restitution: seg.bounce } : wallFor(cfg), before);
          if (seg.k >= 0 && st.segIntegrity) {
            st.segIntegrity[seg.k] = hit.wallIntegrity;
            let m = 1;
            for (let i = 0; i < st.segIntegrity.length; i++) m = Math.min(m, st.segIntegrity[i]);
            st.integrity = m;
          } else st.integrity = hit.wallIntegrity;
          wall = { breached: hit.breached, selfDamage: hit.selfDamage, speed: approach, nx, nz };
          if (hit.breached) {
            // Breaking through costs speed in proportion to the wall that was in the way.
            const k = Math.min(1, hit.retainedSpeed / Math.max(1e-6, approach));
            b.vx *= k; b.vz *= k;
            (st.passing ??= new Set()).add(b);
            break; // carries on along its path
          }
          e = restitutionOf(seg.resistance, seg.bounce, totalMass(phys), approach, before);
        }
        // Stop at the face, bounce (blow) or stop the normal motion (lean), slide the rest.
        VEL.vx = b.vx; VEL.vz = b.vz;
        reflectVelocity(VEL, nx, nz, e, WALL_FRICTION_BASE * cfg.friction);
        b.vx = VEL.vx; b.vz = VEL.vz;
        const cx = SWEEP.x + nx * WALL_SKIN, cz = SWEEP.z + nz * WALL_SKIN;
        let rx = (x1 - sx) * (1 - SWEEP.t), rz = (z1 - sz) * (1 - SWEEP.t);
        const rn = rx * nx + rz * nz;
        if (rn < 0) { rx -= rn * nx; rz -= rn * nz; }
        // Crease: if the ORIGINAL push, slid along this face, would run back into the face it
        // just left, the body is wedged in the corner of the two faces (in 2D the crease is a
        // point) and the rest of the path stops; otherwise it turns the corner and slides on.
        if (iter > 0) {
          const on = Math.min(0, ox * nx + oz * nz);
          if ((ox - on * nx) * pnx + (oz - on * nz) * pnz < 0) { rx = 0; rz = 0; }
        }
        pnx = nx; pnz = nz;
        sx = cx; sz = cz; x1 = cx + rx; z1 = cz + rz;
      }
    }
  }
  b.x = x1; b.z = z1;

  const onRing = insideRing(cfg, b.x, b.z);
  if (st.floorAt && onRing) {
    // Terrain: stand on the drawn floor; a cliff face or an over-steep slope undoes the
    // horizontal move (prev = last frame's position, before walking/AI moved x/z).
    const px = prev ? prev.x : b.x - b.vx * dt, pz = prev ? prev.z : b.z - b.vz * dt;
    settleOnFloor(b, px, pz, st.floorAt, st.stepHeight ?? 0.35, st.maxClimbTan ?? Infinity, FLOOR_CONTACT);
  } else if (onRing && b.y < b.radius && b.y > -b.radius * 2) {
    b.y = b.radius;
    b.vy = 0;
  }

  let landedOutside = 0;
  if (!onRing && cfg.outsideGround >= 1 && cfg.outsideCollision >= 1) {
    if (st.floorAt && st.outsideFollowsTerrain) {
      // Drawn outside terrain: holes are fallen into, outside cliff faces block like the ring's.
      const px = prev ? prev.x : b.x - b.vx * dt, pz = prev ? prev.z : b.z - b.vz * dt;
      const falling = b.vy;
      const c = settleOnFloor(b, px, pz, st.floorAt, st.stepHeight ?? 0.35, st.maxClimbTan ?? Infinity, FLOOR_CONTACT);
      if (c.grounded && falling < -0.5) landedOutside = -falling;
    } else {
      const floor = cfg.outsideHeight + b.radius;
      if (b.y < floor) {
        if (b.vy < -0.5) landedOutside = -b.vy;
        b.y = floor;
        b.vy = 0;
      }
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

  // Final guard: nothing (props, the floor's undo) may leave the body inside the wall band.
  // Wave J: the band's height is the wall's at the body's bearing (0 at an opening: no guard).
  const guardH = poly ? wallAt(st, Math.atan2(b.z, b.x)).height : 0;
  if (poly && guardH > 0 && !st.passing?.has(b) && b.y - b.radius < (st.floorAt ? st.floorAt(b.x * 0.98, b.z * 0.98) : 0) + guardH) {
    for (let k = 0; k < WALL_MAX_SLIDES && wallOverlap(poly, contactRadius, b.x, b.z, OVERLAP); k++) {
      b.x += OVERLAP.nx * (OVERLAP.depth + WALL_SKIN);
      b.z += OVERLAP.nz * (OVERLAP.depth + WALL_SKIN);
      const vn = b.vx * OVERLAP.nx + b.vz * OVERLAP.nz;
      if (vn < 0) { b.vx -= vn * OVERLAP.nx; b.vz -= vn * OVERLAP.nz; }
      wallContact = true;
    }
  }
  return { onRing, landedOutside, wall, wallContact };
}

/** Hitbox zones that make a body's horizontal footprint against a wall (trunk, upper arms, thighs). */
export const FOOTPRINT_ZONES: readonly string[] = ["chest", "abdomen", "pelvis", "upperArm", "thigh"];

/**
 * The body's FOOTPRINT radius for wall contact, m: the farthest reach from the body's vertical
 * axis of its trunk, upper-arm and thigh capsules in the bind pose (HitboxSet straight from
 * hitboxesFromPlan: wa/wb at the bind pose, group at the origin):
 *   r_foot = max over FOOTPRINT_ZONES capsules of (√(x² + z²) of an endpoint + capsule radius).
 * Forearms, hands and the weapon are left out: they bend away from a wall instead of stopping
 * the body. (SmashPhysics' 0.6 m and the engine's 0.5 m are rounder and larger: a body using
 * them stops visibly short of the wall.)
 */
export function footprintRadius(boxes: readonly { zone: string; wa: ArrayLike<number>; wb: ArrayLike<number>; radius: number }[]): number {
  let r = 0;
  for (const b of boxes) {
    if (!FOOTPRINT_ZONES.includes(b.zone)) continue;
    r = Math.max(r, Math.hypot(b.wa[0], b.wa[2]) + b.radius, Math.hypot(b.wb[0], b.wb[2]) + b.radius);
  }
  return r;
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
