// Lane C (R04): the phase-driven gait — derived stride, planted feet, swing arc, bob and sway.
import { DEFAULT_GAIT, frac, Gait, gaitShape } from "../src/game/anim/Gait.ts";
import { legacyLegGeometryFor } from "../src/game/anim/LegacyGeometry.ts";
import { legLength } from "../src/game/anim/Rig.ts";

function near(a: number, b: number, eps: number, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a} (eps ${eps})`);
}
function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const GEOM = legacyLegGeometryFor("human", null, 1.75, 75);
const L = legLength(GEOM);

Deno.test("gaitShape derives stride = L(a + b·ŝ) with ŝ = v/sqrt(gL); cadence = v/stride; run blend rises with speed", () => {
  let prevRun = -1, prevStride = 0;
  for (const v of [0, 0.5, 1, 2, 3, 4.2, 6.5]) {
    const s = gaitShape(v, L);
    const sNorm = v / Math.sqrt(DEFAULT_GAIT.gravity * L);
    near(s.speedNorm, sNorm, 1e-12, "ŝ");
    near(s.stride, L * (DEFAULT_GAIT.strideAtRest + DEFAULT_GAIT.strideGain * sNorm), 1e-12, "stride equation");
    near(s.cadence, v / s.stride, 1e-12, "cadence");
    assert(s.duty > 0 && s.duty < 1, "duty in (0, 1)");
    assert(s.stanceLength <= 2 * L * Math.sin(DEFAULT_GAIT.maxStanceAngle) + 1e-12, "stance sweep capped by θmax");
    assert(s.runBlend >= prevRun && s.stride > prevStride, "monotonic in speed");
    prevRun = s.runBlend; prevStride = s.stride;
  }
  assert(gaitShape(0.5, L).runBlend === 0 && gaitShape(6.5, L).runBlend === 1, "walk at 0.5 m/s, run at 6.5 m/s");
  assert(gaitShape(2, L, DEFAULT_GAIT, undefined, 0.26).stride < gaitShape(2, L).stride, "slopes shorten the stride");
});

/** Walk the gait straight ahead at constant speed; returns per-frame snapshots. */
function walk(v: number, seconds: number, hz = 60) {
  const g = new Gait(GEOM);
  const dt = 1 / hz;
  let z = 0;
  g.reset(0, 0, 0);
  const frames: { t: number; z: number; phase: number; feet: { planted: boolean; x: number; z: number; lift: number }[]; bob: number; roll: number }[] = [];
  for (let f = 0; f < seconds * hz; f++) {
    z += v * dt;
    g.update(dt, { x: 0, z, yaw: 0, speed: v, moveDirLocal: 0, grounded: true, stagger: 0, turnRate: 0 });
    frames.push({ t: f * dt, z, phase: g.phase, feet: g.feet.map((ft) => ({ planted: ft.planted, x: ft.x, z: ft.z, lift: ft.lift })), bob: g.bob, roll: g.roll });
  }
  return { g, frames };
}

Deno.test("phase advances by distance travelled / stride once the speed has settled", () => {
  const v = 1.6;
  const { g, frames } = walk(v, 4);
  const a = frames[180], b = frames[239]; // 3.0 s -> ~4.0 s, speed filter settled
  const cycles = frac(b.phase - a.phase + 1);
  near(cycles, frac((b.z - a.z) / g.shape.stride), 1e-6, "Δphase = Δdistance / stride");
});

Deno.test("a planted foot never moves in the world while planted (latched), so it cannot skate", () => {
  const { frames } = walk(2.1, 4);
  for (let i = 0; i < 2; i++) {
    let anchor: [number, number] | null = null, worst = 0, stances = 0;
    for (const f of frames) {
      const ft = f.feet[i];
      if (ft.planted) {
        if (!anchor) { anchor = [ft.x, ft.z]; stances++; }
        worst = Math.max(worst, Math.hypot(ft.x - anchor[0], ft.z - anchor[1]));
        assert(ft.lift === 0, "planted feet have no lift");
      } else anchor = null;
    }
    assert(stances >= 4, `leg ${i} took steps (${stances})`);
    near(worst, 0, 1e-12, `leg ${i} planted drift`);
  }
});

Deno.test("swing arc: lift reaches the derived apex and both ends are on the ground", () => {
  const { g, frames } = walk(1.4, 3);
  const apex = g.shape.swingApex;
  let maxLift = 0;
  for (const f of frames.slice(120)) for (const ft of f.feet) maxLift = Math.max(maxLift, ft.lift);
  assert(maxLift > 0.9 * apex && maxLift <= apex + 1e-12, `max lift ${maxLift} vs apex ${apex}`);
});

Deno.test("pelvis bob has 2 periods per cycle and sway 1 (sign changes over one cycle)", () => {
  const { g, frames } = walk(1.4, 4);
  const T = 1 / g.shape.cadence, hz = 60;
  const win = frames.slice(150, 150 + Math.round(T * hz));
  let bobFlips = 0, rollFlips = 0;
  for (let k = 1; k < win.length; k++) {
    if (Math.sign(win[k].bob) !== Math.sign(win[k - 1].bob)) bobFlips++;
    if (Math.sign(win[k].roll) !== Math.sign(win[k - 1].roll)) rollFlips++;
  }
  assert(bobFlips >= 3 && bobFlips <= 5, `bob sign changes per cycle ${bobFlips} (expect 4)`);
  assert(rollFlips >= 1 && rollFlips <= 3, `roll sign changes per cycle ${rollFlips} (expect 2)`);
});

Deno.test("standing still settles: the phase stops with both feet planted; turning on the spot re-plants", () => {
  const g = new Gait(GEOM);
  g.reset(0, 0, 0);
  const dt = 1 / 60;
  for (let f = 0; f < 120; f++) g.update(dt, { x: 0, z: 0, yaw: 0, speed: 0, moveDirLocal: 0, grounded: true, stagger: 0, turnRate: 0 });
  const p0 = g.phase;
  g.update(dt, { x: 0, z: 0, yaw: 0, speed: 0, moveDirLocal: 0, grounded: true, stagger: 0, turnRate: 0 });
  near(g.phase, p0, 1e-12, "phase frozen when idle");
  assert(g.feet[0].planted && g.feet[1].planted, "both planted when idle");
  let yaw = 0, steps = 0, wasPlanted = true;
  for (let f = 0; f < 120; f++) {
    yaw += 2 * dt;
    g.update(dt, { x: 0, z: 0, yaw, speed: 0, moveDirLocal: 0, grounded: true, stagger: 0, turnRate: 2 });
    if (wasPlanted && !g.feet[0].planted) steps++;
    wasPlanted = g.feet[0].planted;
  }
  assert(steps >= 1, "turning in place makes the feet step");
});
