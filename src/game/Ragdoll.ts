// Ragdoll: what a body becomes once it is thrown out of the ring.
//
// A thrown fighter stops being an animated skeleton and becomes a small particle
// system — a handful of nodes joined by distance constraints, integrated with
// Verlet so it is stable at the frame rates this game actually runs at, and
// colliding with the ground so it settles instead of sinking through it.
//
// Pure module: no Three.js, no DOM.

export interface RagdollNode {
  x: number; y: number; z: number;
  /** Previous position, for Verlet integration. */
  px: number; py: number; pz: number;
  mass: number;
  /** Radius, for the ground contact test. */
  radius: number;
}

export interface RagdollLink {
  a: number; b: number;
  rest: number;
  /** 0..1 — how hard the link tries to hold its rest length. */
  stiffness: number;
}

export interface Ragdoll {
  nodes: RagdollNode[];
  links: RagdollLink[];
  /** Seconds since the throw, for the settle animation. */
  age: number;
  /** Set once the body has stopped moving. */
  settled: boolean;
  /**
   * Squared movement of the CENTRE OF MASS over the last step. Per-node Verlet
   * deltas cannot be used: gravity re-injects a displacement every step and the
   * constraints push back, so a perfectly still body shows a constant residual.
   * The centre only moves when the body as a whole moves.
   */
  energy: number;
  /** Previous centre of mass. */
  cx: number; cy: number; cz: number;
}

/** A humanoid-ish ragdoll: head, chest, hips, two arms, two legs. */
export interface RagdollSeed {
  x: number; y: number; z: number;
  /** Height in metres; the layout scales from it. */
  height: number;
  /** Initial velocity of the whole body. */
  vx?: number; vy?: number; vz?: number;
}

export function createRagdoll(seed: RagdollSeed): Ragdoll {
  const h = seed.height;
  const vx = seed.vx ?? 0, vy = seed.vy ?? 0, vz = seed.vz ?? 0;
  // Node layout as fractions of height, measured from the feet upward.
  const layout: [number, number, number, number][] = [
    // [yFraction, xOffset, zOffset, radius]
    [0.94, 0, 0, 0.10],   // head
    [0.72, 0, 0, 0.13],   // chest
    [0.50, 0, 0, 0.13],   // hips
    [0.68, -0.20, 0, 0.07], // left shoulder
    [0.40, -0.24, 0, 0.06], // left hand
    [0.68, 0.20, 0, 0.07],  // right shoulder
    [0.40, 0.24, 0, 0.06],  // right hand
    [0.26, -0.11, 0, 0.08], // left knee
    [0.02, -0.12, 0, 0.07], // left foot
    [0.26, 0.11, 0, 0.08],  // right knee
    [0.02, 0.12, 0, 0.07],  // right foot
  ];
  const nodes: RagdollNode[] = layout.map(([fy, ox, oz, r]) => {
    const x = seed.x + ox, y = seed.y + fy * h, z = seed.z + oz;
    return { x, y, z, px: x - vx * 0.016, py: y - vy * 0.016, pz: z - vz * 0.016, mass: 1, radius: r };
  });
  // Links: a spine, two arms, two legs, plus a couple of cross-braces so the body
  // does not fold flat.
  const pairs: [number, number, number][] = [
    [0, 1, 1.0], [1, 2, 1.0],            // spine
    [1, 3, 0.9], [3, 4, 0.9],            // left arm
    [1, 5, 0.9], [5, 6, 0.9],            // right arm
    [2, 7, 0.9], [7, 8, 0.9],            // left leg
    [2, 9, 0.9], [9, 10, 0.9],           // right leg
    [3, 5, 0.5], [7, 9, 0.5],            // cross-braces
  ];
  const links: RagdollLink[] = pairs.map(([a, b, s]) => {
    const A = nodes[a], B = nodes[b];
    return { a, b, rest: Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z), stiffness: s };
  });
  const rd: Ragdoll = { nodes, links, age: 0, settled: false, energy: 0, cx: 0, cy: 0, cz: 0 };
  const c = ragdollCentre(rd);
  rd.cx = c.x; rd.cy = c.y; rd.cz = c.z;
  return rd;
}

const GRAVITY = 22;

/**
 * One integration step. `groundY` is the surface height; `bounce` 0..1 and
 * `friction` 0..1 govern how the body behaves when it lands.
 */
export function stepRagdoll(rd: Ragdoll, dt: number, groundY: number, bounce = 0.18, friction = 0.62): void {
  rd.age += dt;
  const d = Math.min(dt, 1 / 30); // a long frame must not explode the solver
  // Progressive damping: a real body stops moving once it has come to rest. Without
  // this the constraint solver and gravity reach a small limit cycle and the
  // ragdoll never settles.
  const extra = Math.max(0.5, 1 - rd.age * 0.2);
  const damp = friction * extra;
  // Verlet integration.
  for (const n of rd.nodes) {
    const vx = (n.x - n.px) * damp, vy = (n.y - n.py) * damp, vz = (n.z - n.pz) * damp;
    n.px = n.x; n.py = n.y; n.pz = n.z;
    n.x += vx;
    n.y += vy - GRAVITY * d * d * 60;
    n.z += vz;
  }
  // Distance constraints, solved a few times per step for stiffness.
  for (let iter = 0; iter < 4; iter++) {
    for (const l of rd.links) {
      const A = rd.nodes[l.a], B = rd.nodes[l.b];
      const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
      const dist = Math.hypot(dx, dy, dz) || 1e-6;
      const diff = (dist - l.rest) / dist * 0.5 * l.stiffness;
      A.x += dx * diff; A.y += dy * diff; A.z += dz * diff;
      B.x -= dx * diff; B.y -= dy * diff; B.z -= dz * diff;
    }
    // Ground contact: push out, then kill the velocity. Gravity is applied as a
    // position delta, so a resting node would otherwise be pumped downward every
    // step and the energy would never decay — the body would never settle.
    for (const n of rd.nodes) {
      const floor = groundY + n.radius;
      if (n.y < floor) {
        n.y = floor;
        const vy = n.y - n.py;
        if (vy < -0.4) {
          n.py = n.y + vy * bounce; // a real impact bounces
        } else {
          n.py = n.y;               // resting contact: zero vertical velocity
        }
        // Horizontal friction against the ground.
        n.px = n.x - (n.x - n.px) * 0.85;
        n.pz = n.z - (n.z - n.pz) * 0.85;
      }
    }
  }
  // Settle test: has the body as a whole stopped moving? The threshold is a drift
  // of under 0.3 mm per step — for a game, motion that small is at rest. (The decay
  // is asymptotic, so an exact-zero test would never fire.)
  const c = ragdollCentre(rd);
  const dx = c.x - rd.cx, dy = c.y - rd.cy, dz = c.z - rd.cz;
  rd.energy = dx * dx + dy * dy + dz * dz;
  rd.cx = c.x; rd.cy = c.y; rd.cz = c.z;
  if (rd.energy < 1e-7 && rd.age > 0.6) rd.settled = true;
}

/** Centre of mass, for placing the mesh that follows the ragdoll. */
export function ragdollCentre(rd: Ragdoll): { x: number; y: number; z: number } {
  let x = 0, y = 0, z = 0, m = 0;
  for (const n of rd.nodes) { x += n.x * n.mass; y += n.y * n.mass; z += n.z * n.mass; m += n.mass; }
  return { x: x / m, y: y / m, z: z / m };
}
