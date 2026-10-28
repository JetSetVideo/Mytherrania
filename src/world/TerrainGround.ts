// TerrainGround: how a body meets a terrain floor (R07 integration helper for ArenaPhysics).
//
// The flat arena only ever snapped a body up to y = radius. On terrain three cases matter:
//   step up      the floor under the new position rose by at most `stepHeight` above the
//                feet and the ground ahead is walkable: the body is lifted onto it.
//   blocked      it rose by MORE than `stepHeight`, or the ground one body radius ahead
//                climbs steeper than `maxClimbTan` (a cliff face, a hole wall seen from the
//                bottom): the horizontal move is undone and the horizontal velocity is
//                cancelled, exactly like a wall; without this the body would sink into the
//                terrain or creep up a cliff in small per-frame steps.
//   falling      the floor is below the feet (walking off a cliff top, into a hole): no
//                snap; gravity, already applied by the caller, takes over.
// Pure module: no Three.js, no DOM.

/** The fields of a kinematic body this helper reads and writes (SmashPhysics Body fits). */
export interface FloorBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Body radius, m; the body's centre rests `radius` above the floor. */
  radius: number;
}

/** What happened at the floor this step. */
export interface FloorContact {
  /** The body rests on the floor (snapped this step). */
  grounded: boolean;
  /** The horizontal move was undone because the floor rose by more than a step. */
  blocked: boolean;
  /** Floor height under the body after resolution, m. */
  floorY: number;
}

/**
 * Resolve one body against `floorAt` after the caller has integrated its motion.
 * `prevX`/`prevZ` are its position before this step's horizontal move. `floorAt(x, z)`
 * may return NaN (no floor there, e.g. a void outside the ring): nothing is done then.
 *
 * Blocking rule, applied only to a body near the floor (feet at most `stepHeight` above it)
 * that moved horizontally:
 *   rise  = floor(new) - feet            > stepHeight    a ledge taller than a step, or
 *   climb = (floor(new + u r) - floor(new)) / r  > maxClimbTan
 * where u is the unit move direction and r the body radius (the probe reaches the front of
 * the body). The climb test is what stops a body creeping up a cliff face in small per-frame
 * steps on a smoothed mesh: on this terrain every unflagged slope is <= tan(maxSlope), so
 * pass maxClimbTan = TerrainRules.maxClimbTan = tan(maxSlope) / g (25% head-room for the
 * triangulation) and only holes,
 * cliffs and ramp side walls exceed it. Writes into `out` (allocation-free) and returns it.
 */
export function settleOnFloor(
  b: FloorBody, prevX: number, prevZ: number, floorAt: (x: number, z: number) => number,
  stepHeight: number, maxClimbTan: number,
  out: FloorContact = { grounded: false, blocked: false, floorY: 0 },
): FloorContact {
  out.grounded = false;
  out.blocked = false;
  let floor = floorAt(b.x, b.z);
  out.floorY = floor;
  if (Number.isNaN(floor)) return out;
  const feet = b.y - b.radius;
  const mx = b.x - prevX, mz = b.z - prevZ, moved = Math.hypot(mx, mz);
  if (moved > 1e-9 && feet - floor <= stepHeight) {
    const probe = b.radius;
    const ahead = floorAt(b.x + (mx / moved) * probe, b.z + (mz / moved) * probe);
    const climb = Number.isNaN(ahead) ? 0 : (ahead - floor) / probe;
    if (floor - feet > stepHeight || climb > maxClimbTan) {
      const back = floorAt(prevX, prevZ);
      if (!Number.isNaN(back)) {
        b.x = prevX;
        b.z = prevZ;
        b.vx = 0;
        b.vz = 0;
        out.blocked = true;
        floor = back;
        out.floorY = floor;
      }
    }
  }
  if (b.y <= floor + b.radius) {
    b.y = floor + b.radius;
    if (b.vy < 0) b.vy = 0;
    out.grounded = true;
  }
  return out;
}
