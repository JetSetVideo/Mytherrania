// Kinematic bodies and the Smash-style impact/stun rules. The per-frame movement of
// a body through the arena (floor, wall, outside ground, props) lives in
// ArenaPhysics.stepArenaBody, which replaced the old square-ring steppers.

/**
 * A kinematic body: where a fighter is and how fast it is moving. Distinct from
 * Physics.Body, which is the MASS model (parts with mass, volume, area).
 */
export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  radius: number;
}

export function body(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, radius: 0.6 };
}

export function impact(target: Body, dx: number, dz: number, power: number): void {
  const length = Math.hypot(dx, dz) || 1;
  target.vx += dx / length * power;
  target.vz += dz / length * power;
  target.vy = Math.max(target.vy, power * 0.35);
}

/**
 * Stun_total = (Damage × Force_impact) × 1.5^WallBounce   (brief, verbatim)
 * returned in seconds at 10 ms per unit. Callers pass damage in the brief's original
 * units (scaled damage / DAMAGE_SCALE).
 */
export function stunDuration(damage: number, strength: number, wallBounces: number): number {
  return damage * strength * 1.5 ** wallBounces * 0.01;
}
