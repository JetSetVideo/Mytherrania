// What a ragdoll touches (V03): the solid world (ring floor, the platform's side, the wall,
// the outside ground) and the fluids (water, magma, canopy) — behind one small interface so the
// solver stays generic. Flat-ground and void worlds are provided for tests and fallbacks; the
// arena world composes the ring (ArenaState + the wall polygon) with lane S's Surroundings.
// Pure: no Three.js. Queries allocate nothing.
import type { Medium, Surroundings } from "../../world/biomes/contracts.ts";
import { insideRing, type ArenaConfig } from "../../game/ArenaConfig.ts";
import { ARENA_GRAVITY, type ArenaState } from "../ArenaPhysics.ts";
import { insideDistance, wallOverlap, wallPolygonOf, type WallOverlap, type WallPolygon } from "../WallCollision.ts";
import { FALLBACK_KILL_PLANE_Y } from "../../game/RingOut.ts";

/** Deepest solid contact of a sphere: push `depth` metres along the unit normal n. */
export interface SolidContact { depth: number; nx: number; ny: number; nz: number; friction: number; restitution: number }

/** A fluid layer under a point: immersed where y < surfaceY. */
export interface FluidSample {
  medium: Medium;
  surfaceY: number;
  /** Linear drag inside the fluid, 1/s. */
  drag: number;
  /** Upward acceleration when fully immersed, as a fraction of gravity. */
  buoyancy: number;
}

/** The world as the ragdoll solver queries it. */
export interface RagdollWorld {
  /** Gravity, m/s² (the arena uses ARENA_GRAVITY). */
  gravity: number;
  /** World clock, s (waves move with it); the owner advances it. */
  time: number;
  /** Below this centre-of-mass height the body is lost for good, m. */
  killPlaneY: number;
  /** Deepest solid contact of the sphere (x, y, z, r) into `out`; false when free. */
  sphereContact(x: number, y: number, z: number, r: number, out: SolidContact): boolean;
  /** The fluid layer under (x, z) into `out`; false when none. */
  fluidAt(x: number, z: number, out: FluidSample): boolean;
}

/** Friction of a body (cloth/skin) on ground at friction = 1, and its restitution (a body thuds). */
export const GROUND_FRICTION = 0.8, GROUND_RESTITUTION = 0.1;

/** A flat solid plane at `y` (a stand-in when there are no surroundings). */
export function flatGroundWorld(y = 0, friction = GROUND_FRICTION, gravity = ARENA_GRAVITY): RagdollWorld {
  return {
    gravity, time: 0, killPlaneY: y - 50,
    sphereContact(_x, py, _z, r, out) {
      const depth = y - (py - r);
      if (depth <= 0) return false;
      out.depth = depth; out.nx = 0; out.ny = 1; out.nz = 0; out.friction = friction; out.restitution = GROUND_RESTITUTION;
      return true;
    },
    fluidAt: () => false,
  };
}

/** Nothing at all: the body falls to the kill plane. */
export function voidWorld(killPlaneY = FALLBACK_KILL_PLANE_Y, gravity = ARENA_GRAVITY): RagdollWorld {
  return { gravity, time: 0, killPlaneY, sphereContact: () => false, fluidAt: () => false };
}

/** Depth of the solid ground below a canopy when the spec does not say, m (tall tree tops). */
export const CANOPY_GROUND_DEPTH = 12;

/**
 * The outside world from Surroundings alone (everything is "outside"): solid ground at
 * surfaceAt for "ground"; water/magma/canopy as fluids (canopy: a drag layer down to the
 * ground groundDepth below its top); cloud/void: nothing.
 */
export function surroundingsWorld(s: Surroundings, friction = GROUND_FRICTION, gravity = ARENA_GRAVITY): RagdollWorld {
  const w: RagdollWorld = {
    gravity, time: 0, killPlaneY: s.killPlaneY,
    sphereContact(x, y, z, r, out) { return outsideContact(s, w.time, x, y, z, r, friction, out); },
    fluidAt(x, z, out) { return outsideFluid(s, w.time, x, z, out); },
  };
  return w;
}

function outsideContact(s: Surroundings, t: number, x: number, y: number, z: number, r: number, friction: number, out: SolidContact): boolean {
  const m = s.mediumAt(x, z);
  let ground: number;
  if (m === "ground") ground = s.surfaceAt(x, z, t);
  else if (m === "canopy" || m === "water" || m === "magma") {
    // Under a canopy the ground lies groundDepth below; under a liquid, a bed at the kill plane.
    const top = s.surfaceAt(x, z, t);
    ground = m === "canopy" ? top - (s.spec.groundDepth ?? CANOPY_GROUND_DEPTH) : s.killPlaneY;
  } else return false;
  if (!Number.isFinite(ground)) return false;
  const depth = ground - (y - r);
  if (depth <= 0) return false;
  out.depth = depth; out.nx = 0; out.ny = 1; out.nz = 0; out.friction = friction; out.restitution = GROUND_RESTITUTION;
  return true;
}

function outsideFluid(s: Surroundings, t: number, x: number, z: number, out: FluidSample): boolean {
  const m = s.mediumAt(x, z);
  if (m !== "water" && m !== "magma" && m !== "canopy") return false;
  const top = s.surfaceAt(x, z, t);
  if (!Number.isFinite(top)) return false;
  out.medium = m; out.surfaceY = top; out.drag = s.drag(m); out.buoyancy = s.buoyancy(m);
  return true;
}

/** Scratch for the arena world's wall query. */
const OV: WallOverlap = { depth: 0, nx: 0, nz: 0 };

/**
 * The arena: the ring platform is a solid prism (the outline × everything below the floor,
 * floorAt or y 0) with a rounded rim edge, the standing wall a band on its rim up to
 * wallHeight, and beyond the outline the Surroundings (or, without them, the arena config's
 * outside ground at outsideHeight / a void). `friction` scales with ArenaConfig.friction.
 */
export function arenaWorld(st: ArenaState, s: Surroundings | null, gravity = ARENA_GRAVITY): RagdollWorld {
  const cfg = st.cfg;
  const poly = wallPolygonOf(cfg);
  // Radial bounds of the outline: deep inside / far outside skip the polygon loops.
  let rIn = Infinity, rOut = 0;
  for (let i = 0; i < poly.n; i++) {
    rIn = Math.min(rIn, -(poly.nx[i] * -poly.ax[i] + poly.nz[i] * -poly.az[i]) * -1);
    rOut = Math.max(rOut, Math.hypot(poly.ax[i], poly.az[i]));
  }
  const friction = GROUND_FRICTION * cfg.friction, outFriction = GROUND_FRICTION * cfg.outsideFriction;
  const w: RagdollWorld = {
    gravity, time: 0, killPlaneY: s ? s.killPlaneY : FALLBACK_KILL_PLANE_Y,
    sphereContact(x, y, z, r, out) {
      let best = 0;
      const rho = Math.hypot(x, z);
      const reach = poly.halfThickness + r;
      const nearRim = rho > rIn - reach - 0.05 && rho < rOut + reach + 0.05;
      const floorY = st.floorAt ? st.floorAt(x, z) : 0;
      // 1. Platform prism.
      if (rho < rOut + r + 0.05) {
        if (platformContact(poly, nearRim, cfg, x, y, z, r, floorY, out)) { best = out.depth; out.friction = friction; out.restitution = GROUND_RESTITUTION; }
      }
      // 2. The standing wall band on the rim.
      if (nearRim && st.walled && st.integrity > 0) {
        const rimY = st.floorAt ? st.floorAt(x * 0.98, z * 0.98) : 0;
        if (y - r < rimY + cfg.wallHeight && y + r > rimY - 0.5 && wallOverlap(poly, r, x, z, OV) && OV.depth > best) {
          best = OV.depth;
          out.depth = OV.depth; out.nx = OV.nx; out.ny = 0; out.nz = OV.nz; out.friction = 0.4 * cfg.friction; out.restitution = cfg.wallBounce;
        }
      }
      // 3. Outside: the surroundings (beyond the outline only).
      if (rho > rIn - r && !insideRing(cfg, x, z)) {
        const was = best > 0 ? out.depth : 0;
        if (s) {
          if (outsideContact(s, w.time, x, y, z, r, outFriction, SC) && SC.depth > was) { copy(SC, out); best = SC.depth; }
        } else if (cfg.outsideGround >= 1 && cfg.outsideCollision >= 1) {
          const depth = cfg.outsideHeight - (y - r);
          if (depth > was && depth > 0) {
            out.depth = depth; out.nx = 0; out.ny = 1; out.nz = 0; out.friction = outFriction; out.restitution = GROUND_RESTITUTION; best = depth;
          }
        }
      }
      return best > 0;
    },
    fluidAt(x, z, out) {
      if (!s || insideRing(cfg, x, z)) return false;
      return outsideFluid(s, w.time, x, z, out);
    },
  };
  return w;
}

const SC: SolidContact = { depth: 0, nx: 0, ny: 1, nz: 0, friction: 0, restitution: 0 };
function copy(a: SolidContact, b: SolidContact): void {
  b.depth = a.depth; b.nx = a.nx; b.ny = a.ny; b.nz = a.nz; b.friction = a.friction; b.restitution = a.restitution;
}

/**
 * Sphere vs the platform prism {inside the outline, y ≤ floorY}. Signed distance:
 *   d_h = horizontal distance outside the outline (negative inside), d_v = y − floorY;
 *   inside (both ≤ 0): max(d_h, d_v); the rim edge region (both > 0): √(d_h² + d_v²); else max.
 */
function platformContact(poly: WallPolygon, nearRim: boolean, cfg: ArenaConfig, x: number, y: number, z: number, r: number, floorY: number, out: SolidContact): boolean {
  const dv = y - floorY;
  if (dv > r) return false;
  let dh: number, hx = 0, hz = 0;
  if (!nearRim) { dh = -Infinity; }
  else {
    const inside = insideDistance(poly, x, z);
    if (inside >= 0) {
      dh = -inside;
      // Outward horizontal normal of the nearest face.
      let best = Infinity;
      for (let i = 0; i < poly.n; i++) {
        const sd = poly.nx[i] * (x - poly.ax[i]) + poly.nz[i] * (z - poly.az[i]);
        if (sd < best) { best = sd; hx = -poly.nx[i]; hz = -poly.nz[i]; }
      }
    } else {
      dh = -inside; // conservative distance outside (max over faces of −s_i)
      const rho = Math.hypot(x, z) || 1;
      hx = x / rho; hz = z / rho;
      if (!insideRing(cfg, x, z) && dh > r) return false;
    }
  }
  let sdf: number, nx: number, ny: number, nz: number;
  if (dh <= 0 || dv <= 0) {
    if (dh > dv) { sdf = dh; nx = hx; ny = 0; nz = hz; } else { sdf = dv; nx = 0; ny = 1; nz = 0; }
  } else {
    sdf = Math.hypot(dh, dv);
    nx = hx * dh / sdf; ny = dv / sdf; nz = hz * dh / sdf;
  }
  if (sdf >= r) return false;
  out.depth = r - sdf; out.nx = nx; out.ny = ny; out.nz = nz;
  return true;
}
