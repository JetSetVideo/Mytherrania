// Lane R (V02): continuous, radius-aware wall collision with segment normals.
import { stepArenaBody, wallRestitution, WALL_FRICTION_BASE, type ArenaState } from "../src/physics/ArenaPhysics.ts";
import {
  createSweep, insideDistance, segmentDistance, sweepCircleWall, WALL_THICKNESS, wallPolygon, wallPolygonOf, reflectVelocity,
} from "../src/physics/WallCollision.ts";
import { insideRing, makeArena, ringRadiusAt, type ArenaConfig } from "../src/game/ArenaConfig.ts";
import { REFERENCE_BODIES, totalMass } from "../src/game/Physics.ts";
import { body as createBody } from "../src/physics/SmashPhysics.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const H = WALL_THICKNESS / 2;
const R_BODY = 0.35;
const state = (cfg: ArenaConfig, walled = true): ArenaState => ({ cfg, walled, integrity: 1, props: [] });
const heavyWall = (over: Partial<ArenaConfig> = {}) =>
  makeArena({ size: 16, walls: 1, wallHeight: 3, wallResistance: 20000, wallBounce: 0.4, outsideHeight: -3, objects: 0, ...over });
/** Free gap of a body's footprint to the inner wall face (negative = penetration), m. */
const gap = (cfg: ArenaConfig, x: number, z: number, r = R_BODY) => insideDistance(wallPolygonOf(cfg), x, z) - H - r;

Deno.test("WALL: the polygon's corners sit ON the outline (exact for polygons, chord for curves)", () => {
  for (let shape = 0; shape < 8; shape++) {
    const cfg = makeArena({ size: 20, shape, aspect: 1.4, rotation: 17 });
    const p = wallPolygon(cfg);
    for (let i = 0; i < p.n; i++) {
      const a = Math.atan2(p.az[i], p.ax[i]);
      const err = Math.abs(Math.hypot(p.ax[i], p.az[i]) - ringRadiusAt(cfg, a));
      assert(err < 1e-9, `shape ${shape}: vertex ${i} off the outline by ${err}`);
      // Mid-edge points stay inside the outline (convex) and within the chord tolerance for curves.
      const mx = p.ax[i] + p.ex[i] / 2, mz = p.az[i] + p.ez[i] / 2;
      assert(insideRing(cfg, mx * (1 - 1e-9), mz * (1 - 1e-9)), `shape ${shape}: mid-edge ${i} outside`);
      const sag = ringRadiusAt(cfg, Math.atan2(mz, mx)) - Math.hypot(mx, mz);
      assert(sag < 0.0101, `shape ${shape}: chord sagitta ${sag.toFixed(4)} m`);
    }
  }
});

Deno.test("WALL: no tunnelling at 40 m/s on every arena shape (64 bearings, 60 Hz)", () => {
  let worst = Infinity, frames = 0;
  for (let shape = 0; shape < 8; shape++) {
    const cfg = heavyWall({ shape, aspect: shape === 6 || shape === 7 ? 1.4 : 1, rotation: 17 });
    for (let k = 0; k < 64; k++) {
      const st = state(cfg);
      const b = createBody(0, R_BODY, 0); b.radius = R_BODY;
      const a = (k / 64) * Math.PI * 2 + 0.013;
      b.vx = 40 * Math.cos(a); b.vz = 40 * Math.sin(a);
      for (let i = 0; i < 120; i++) {
        const prev = { x: b.x, z: b.z };
        stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, 0, prev, R_BODY);
        const g = gap(cfg, b.x, b.z);
        if (g < worst) worst = g;
        frames++;
        assert(g > -1e-3, `shape ${shape} bearing ${k}: tunnelled, gap ${g.toFixed(4)} m at frame ${i}`);
      }
      assert(st.integrity === 1 || st.integrity > 0, "the heavy wall holds");
    }
  }
  console.log(`  40 m/s x 64 bearings x 8 shapes: ${frames} frames, worst gap ${(worst * 1000).toFixed(3)} mm`);
});

Deno.test("WALL: resting contact — 200 frames of pushing leave zero penetration (> −1 mm), no jitter", () => {
  for (const shape of [0, 2, 4, 6, 7]) {
    for (const into of ["face", "corner"] as const) {
      if (into === "corner" && (shape === 0 || shape === 6)) continue; // curves have no real corner
      const cfg = heavyWall({ shape, rotation: 11 });
      const poly = wallPolygonOf(cfg);
      const st = state(cfg);
      const b = createBody(0, R_BODY, 0); b.radius = R_BODY;
      // Push straight at the middle of face 0 (along its outward normal) or straight at vertex 0.
      const dir = into === "face" ? { x: -poly.nx[0], z: -poly.nz[0] }
        : { x: poly.ax[0] / Math.hypot(poly.ax[0], poly.az[0]), z: poly.az[0] / Math.hypot(poly.ax[0], poly.az[0]) };
      if (into === "face") { b.x = poly.ax[0] + poly.ex[0] / 2 + poly.nx[0] * 2; b.z = poly.az[0] + poly.ez[0] / 2 + poly.nz[0] * 2; }
      let events = 0, minGap = Infinity;
      const tailGap: number[] = [], tailX: number[] = [], tailZ: number[] = [];
      for (let i = 0; i < 200; i++) {
        const prev = { x: b.x, z: b.z };
        // Walking moves x directly (6.5 m/s) AND a steady shove keeps velocity into the wall.
        b.x += dir.x * 6.5 / 60; b.z += dir.z * 6.5 / 60;
        b.vx += dir.x * 2; b.vz += dir.z * 2;
        const s = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, 6.5, prev, R_BODY);
        if (s.wall) events++;
        const g = gap(cfg, b.x, b.z);
        minGap = Math.min(minGap, g);
        if (i >= 180) { tailGap.push(g); tailX.push(b.x); tailZ.push(b.z); }
      }
      const tag = `shape ${shape} ${into}`;
      assert(minGap > -1e-3, `${tag}: penetration ${(minGap * 1000).toFixed(3)} mm`);
      // At rest against the wall: within 2 mm of the face and not moving (no jitter).
      assert(tailGap.every((g) => g >= -1e-3 && g < 2e-3), `${tag}: gap drifts ${Math.min(...tailGap)}..${Math.max(...tailGap)}`);
      const spread = Math.hypot(Math.max(...tailX) - Math.min(...tailX), Math.max(...tailZ) - Math.min(...tailZ));
      assert(spread < 2e-3, `${tag}: resting body jitters by ${(spread * 1000).toFixed(3)} mm`);
      // The first contact is one blow per face at most; a sustained lean is never a blow.
      assert(events <= 2, `${tag}: ${events} wall blows from one lean`);
    }
  }
});

Deno.test("WALL: walking obliquely into a face SLIDES along it at a constant rate", () => {
  const cfg = heavyWall({ shape: 2, rotation: 45 }); // square inscribed in r = 8, turned 45°: faces at x = ±8·cos45°
  const st = state(cfg);
  st.wallImpactSpeed = 7; // walking never counts as a blow
  const b = createBody(3, R_BODY, -3); b.radius = R_BODY;
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < 90; i++) {
    const prev = { x: b.x, z: b.z };
    b.x += Math.cos(0.5) * 5 / 60; b.z += Math.sin(0.5) * 5 / 60;
    const s = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, 5 * Math.cos(0.5), prev, R_BODY);
    assert(!s.wall, "a walk is not a blow");
    xs.push(b.x); zs.push(b.z);
  }
  const face = 8 * Math.cos(Math.PI / 4) - H - R_BODY; // apothem = circumradius·cos(π/4)
  const late = xs.slice(40);
  assert(late.every((x) => Math.abs(x - (face - 0.001)) < 2e-3), `pinned to the face x = ${face - 0.001}, got ${late[0]}..${late.at(-1)}`);
  const dz = zs.slice(41).map((z, i) => z - zs[40 + i]);
  const want = Math.sin(0.5) * 5 / 60;
  assert(dz.every((d) => Math.abs(d - want) < 1e-6), `tangential progress must stay ${want.toFixed(5)} m/frame`);
});

Deno.test("WALL: the bounce reflects about the SEGMENT normal on a hexagon (not the radial line)", () => {
  const cfg = heavyWall({ shape: 4, rotation: 0, friction: 0, wallBounce: 0.6 });
  const poly = wallPolygonOf(cfg);
  // Face 0 runs from vertex 0 (θ=0) to vertex 1 (θ=60°); its inward normal points at −30°+180°.
  const n = { x: poly.nx[0], z: poly.nz[0] };
  // Aim at a point 70% along face 0 (well off its middle, so radial ≠ normal there) at 45° incidence.
  const tx = poly.ex[0] / Math.sqrt(poly.len2[0]), tz = poly.ez[0] / Math.sqrt(poly.len2[0]);
  const target = { x: poly.ax[0] + poly.ex[0] * 0.7 + n.x * (H + R_BODY), z: poly.az[0] + poly.ez[0] * 0.7 + n.z * (H + R_BODY) };
  const inc = { x: (-n.x + tx) / Math.SQRT2, z: (-n.z + tz) / Math.SQRT2 };
  const speed = 12, steps = 90;
  const b = createBody(target.x - inc.x * speed * 0.25, R_BODY, target.z - inc.z * speed * 0.25); b.radius = R_BODY;
  b.vx = inc.x * speed; b.vz = inc.z * speed;
  const st = state(cfg);
  let hitAt = -1, vBefore = { x: 0, z: 0 }, vAfter = { x: 0, z: 0 };
  for (let i = 0; i < steps && hitAt < 0; i++) {
    const prev = { x: b.x, z: b.z };
    const vb = { x: b.vx, z: b.vz };
    const s = stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 120, st, 0, prev, R_BODY);
    if (s.wall) { hitAt = i; vBefore = vb; vAfter = { x: b.vx, z: b.vz }; }
  }
  assert(hitAt >= 0, "the body must strike face 0");
  const vn0 = vBefore.x * n.x + vBefore.z * n.z, vt0 = vBefore.x * tx + vBefore.z * tz;
  const vn1 = vAfter.x * n.x + vAfter.z * n.z, vt1 = vAfter.x * tx + vAfter.z * tz;
  const damp = Math.exp(-1.2 / 120); // the step's horizontal air damping
  const e = wallRestitution(cfg, totalMass(REFERENCE_BODIES.skirmisher), -vn0, 1);
  assert(Math.abs(vn1 - (-e * vn0) * damp) < 1e-6, `normal: ${vn1.toFixed(4)} vs −e·v_n = ${(-e * vn0 * damp).toFixed(4)}`);
  assert(Math.abs(vt1 - vt0 * damp) < 1e-6, `tangential kept (friction 0): ${vt1.toFixed(4)} vs ${(vt0 * damp).toFixed(4)}`);
  // The old radial normal at that contact differs from the face normal by > 10°.
  const radial = Math.atan2(target.z, target.x) + Math.PI;
  const off = Math.abs(Math.atan2(Math.sin(radial - Math.atan2(n.z, n.x)), Math.cos(radial - Math.atan2(n.z, n.x))));
  assert(off > 0.17, `the test must hit off-centre (radial vs normal ${off.toFixed(3)} rad)`);
});

Deno.test("WALL: inner corner — a body driven into a hexagon vertex stops clear of BOTH faces", () => {
  const cfg = heavyWall({ shape: 4, rotation: 0 });
  const st = state(cfg);
  const b = createBody(0, R_BODY, 0); b.radius = R_BODY;
  for (let i = 0; i < 120; i++) {
    const prev = { x: b.x, z: b.z };
    b.x += 30 / 60; // straight at vertex 0 (θ = 0)
    stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 60, st, 30, prev, R_BODY);
  }
  const poly = wallPolygonOf(cfg);
  const s0 = segmentDistance(poly, 0, b.x, b.z) - H - R_BODY, s5 = segmentDistance(poly, 5, b.x, b.z) - H - R_BODY;
  assert(s0 > -1e-3 && s5 > -1e-3, `corner penetration: face0 ${s0.toFixed(4)}, face5 ${s5.toFixed(4)}`);
  assert(s0 < 0.01 && s5 < 0.01, `the body should rest IN the corner, gaps ${s0.toFixed(4)}, ${s5.toFixed(4)}`);
});

Deno.test("WALL: outer corner — a body outside meets the ROUNDED corner (capsule end) with the corner normal", () => {
  const cfg = heavyWall({ shape: 2, rotation: 0 }); // square, vertex 0 at (8, 0)·√2 direction? -> R = 8 at θ = 0
  const poly = wallPolygonOf(cfg);
  const vx = poly.ax[0], vz = poly.az[0];
  const sw = createSweep();
  // Start well outside, beyond the vertex, moving straight back at it.
  const ok = sweepCircleWall(poly, R_BODY, vx + 3, vz + 0.1, vx - 1, vz + 0.1, sw);
  assert(ok && sw.side === "outer", "outer contact expected");
  assert(sw.corner, "the vertex region must be met as a rounded corner");
  const d = Math.hypot(sw.x - vx, sw.z - vz);
  assert(Math.abs(d - (H + R_BODY)) < 1e-9, `contact centre at h + r from the vertex, got ${d}`);
  const nx = (sw.x - vx) / d, nz = (sw.z - vz) / d;
  assert(Math.abs(sw.nx - nx) < 1e-9 && Math.abs(sw.nz - nz) < 1e-9, "normal = corner direction");
});

Deno.test("WALL: a breach is still possible — a juggernaut at 30 m/s breaks a 2200 N·s wall and passes", () => {
  const cfg = makeArena({ size: 12, shape: 0, walls: 1, wallHeight: 2.4, wallResistance: 2200, wallBounce: 0.3, outsideHeight: -3, objects: 0 });
  const st = state(cfg);
  const b = createBody(4, 0.5, 0); b.radius = 0.5;
  b.vx = 30;
  let breached = false;
  for (let i = 0; i < 120; i++) {
    const prev = { x: b.x, z: b.z };
    const s = stepArenaBody(b, REFERENCE_BODIES.juggernaut, 1 / 120, st, b.vx, prev, 0.5);
    if (s.wall?.breached) breached = true;
  }
  assert(breached, "a juggernaut at 30 m/s must breach");
  assert(st.integrity < 1, `integrity drops (${st.integrity})`);
  assert(!insideRing(cfg, b.x, b.z), `the breaching body ends outside, x=${b.x.toFixed(2)}`);
});

Deno.test("WALL: a body above the wall top passes over; one just below it is stopped", () => {
  const cfg = heavyWall({ shape: 0, wallHeight: 1.5 });
  for (const [y, over] of [[1.5 + R_BODY + 0.4, true], [1.0, false]] as const) {
    const st = state(cfg);
    const b = createBody(5, y, 0); b.radius = R_BODY;
    b.vx = 25; b.vy = 4; // a flat, fast throw (gravity pulls it down during the flight)
    for (let i = 0; i < 30; i++) {
      const prev = { x: b.x, z: b.z };
      stepArenaBody(b, REFERENCE_BODIES.skirmisher, 1 / 120, st, 0, prev, R_BODY);
    }
    assert(insideRing(cfg, b.x, b.z) !== over, `y0=${y}: expected ${over ? "over" : "stopped"}, x=${b.x.toFixed(2)}`);
  }
});

Deno.test("WALL: reflectVelocity — e and Coulomb friction, separating bodies untouched", () => {
  const v = { vx: 3, vz: -4 };
  const approach = reflectVelocity(v, 0, 1, 0.5, 0.2);
  assert(approach === 4, "approach speed = −v·n");
  assert(Math.abs(v.vz - 2) < 1e-12, `v_n' = −e·v_n = 2, got ${v.vz}`);
  assert(Math.abs(v.vx - (3 - 0.2 * 1.5 * 4)) < 1e-12, `|v_t'| = |v_t| − μ(1+e)|v_n|, got ${v.vx}`);
  const away = { vx: 1, vz: 2 };
  assert(reflectVelocity(away, 0, 1, 0.5, 0.2) === 0 && away.vz === 2, "separating velocity unchanged");
  assert(WALL_FRICTION_BASE > 0, "friction base defined");
});
