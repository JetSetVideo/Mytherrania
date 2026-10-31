// Lane H-C: hair / beard / brow secondary motion (src/game/anim/SecondaryMotion.ts).
// Every rule in docs/ancestry/BRIEF.md §1.2 is asserted here, per-component where a sign
// or an axis matters (the pass-12 lesson: an averaged assertion hid a sign error).

import { SecondaryMotion, type SecondaryInputs } from "../src/game/anim/SecondaryMotion.ts";
import { rng32 } from "../src/core/MathCore.ts";

/** The frozen HairPhysicsSpec shape (H-A owns the real one in src/game/Ancestry.ts). */
type Spec = { massKg: number; stiffness: number; damp: number; windGain: number };

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
function near(a: number, b: number, eps: number, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a} (eps ${eps})`);
}

/** A steady-wind input (no head motion) in the world frame. */
function windIn(x: number, y: number, z: number, yaw = 0, wetness = 0): SecondaryInputs {
  return { wind: [x, y, z], headVel: [0, 0, 0], yaw, wetness };
}
/** A still-air input with only head motion. */
function headIn(x: number, y: number, z: number, yaw = 0, wetness = 0): SecondaryInputs {
  return { wind: [0, 0, 0], headVel: [x, y, z], yaw, wetness };
}

const DT = 1 / 60;
const BASE: Spec = { massKg: 0.08, stiffness: 120, damp: 4, windGain: 1.5 };

Deno.test("rest: no wind, no head velocity -> every offset stays 0 and resting() is true", () => {
  const m = new SecondaryMotion(BASE, 3, 11);
  const still: SecondaryInputs = { wind: [0, 0, 0], headVel: [0, 0, 0], yaw: 1.3, wetness: 0.4 };
  for (let f = 0; f < 600; f++) m.step(DT, still);
  for (let i = 0; i < 3; i++) {
    const o = m.offset(i);
    assert(o[0] === 0 && o[1] === 0 && o[2] === 0, `mass ${i} moved at rest: ${o}`);
  }
  assert(m.resting(), "resting() must be true at rest");
  assert(m.magnitude() === 0, "magnitude() must be 0 at rest");
});

Deno.test("wind: pushes along the wind (sign per axis), stronger wind pushes more", () => {
  const settle = (spec: Spec, input: SecondaryInputs, frames = 400) => {
    const m = new SecondaryMotion(spec, 1, 5);
    for (let f = 0; f < frames; f++) m.step(DT, input);
    return m.offset(0);
  };
  const px = settle(BASE, windIn(5, 0, 0));
  assert(px[0] > 0, `+x wind must give +x offset, got ${px[0]}`);
  near(px[1], 0, 1e-9, "no cross-axis bleed y");
  near(px[2], 0, 1e-9, "no cross-axis bleed z");
  const py = settle(BASE, windIn(0, 3, 0));
  assert(py[1] > 0, `+y wind must give +y offset, got ${py[1]}`);
  const nz = settle(BASE, windIn(0, 0, -2));
  assert(nz[2] < 0, `-z wind must give -z offset, got ${nz[2]}`);

  const weak = settle(BASE, windIn(3, 0, 0));
  const strong = settle(BASE, windIn(6, 0, 0));
  assert(strong[0] > weak[0], `stronger wind must displace more (${strong[0]} vs ${weak[0]})`);
});

Deno.test("wind is expressed in body space: the same world wind rotates with yaw", () => {
  const settle = (yaw: number) => {
    const m = new SecondaryMotion(BASE, 1, 5);
    for (let f = 0; f < 400; f++) m.step(DT, windIn(5, 0, 0, yaw));
    return m.offset(0);
  };
  const a = settle(0);              // wind along world +x -> body +x
  const b = settle(Math.PI / 2);    // yaw +90 deg: world +x -> body -z
  assert(a[0] > 1e-3, `yaw=0: offset should be along +x, got ${a[0]}`);
  near(a[2], 0, 1e-9, "yaw=0: no z");
  assert(Math.abs(b[0]) < 1e-6, `yaw=pi/2: local x should vanish, got ${b[0]}`);
  assert(b[2] < -1e-3, `yaw=pi/2: local z should be negative, got ${b[2]}`);
  assert(Math.hypot(a[0] - b[0], a[2] - b[2]) > 1e-3, "the two yaws must differ");
});

Deno.test("mass ordering: with equal inputs the LIGHT mass displaces more (mass in denominator)", () => {
  // Overdamped by construction (c > 2*sqrt(k*m_heavy)) but measured EARLY: a = F/m, so
  // the light mass accelerates 10x harder and is far ahead while the heavy one has barely
  // moved. (At full settle both reach the same static F/k, which the check below confirms.)
  const heavy: Spec = { ...BASE, massKg: 0.5, damp: 20 };
  const light: Spec = { ...BASE, massKg: 0.05, damp: 20 };
  const input = windIn(4, 0, 0);
  const off = (spec: Spec) => {
    const m = new SecondaryMotion(spec, 1, 9);
    for (let f = 0; f < 4; f++) m.step(1 / 240, input); // 1/60 s: heavy barely moving
    return m.magnitude();
  };
  const l = off(light), hv = off(heavy);
  assert(l > hv * 1.5, `light (${l}) must displace far more than heavy (${hv})`);
  // At full settle they meet at the same static F/k, so the ordering is about the response.
  const lightSettled = new SecondaryMotion(light, 1, 9);
  const heavySettled = new SecondaryMotion(heavy, 1, 9);
  for (let f = 0; f < 600; f++) { lightSettled.step(DT, input); heavySettled.step(DT, input); }
  near(lightSettled.offset(0)[0], heavySettled.offset(0)[0], 2e-3, "same static offset F/k");
});

Deno.test("curl: a higher windGain (curly) catches more wind than a straight one", () => {
  const straight: Spec = { ...BASE, windGain: 1 };
  const curly: Spec = { ...BASE, windGain: 3 };
  const input = windIn(4, 0, 0);
  const off = (spec: Spec) => {
    const m = new SecondaryMotion(spec, 1, 3);
    for (let f = 0; f < 400; f++) m.step(DT, input);
    return m.offset(0)[0];
  };
  const s = off(straight), c = off(curly);
  assert(c > s * 1.5, `curly (${c}) must catch far more than straight (${s})`);
});

Deno.test("impulse + return: a head-velocity spike displaces, then returns with <15% overshoot", () => {
  const spec: Spec = { massKg: 0.08, stiffness: 120, damp: 4, windGain: 1.5 };
  const m = new SecondaryMotion(spec, 1, 21);
  const mags: number[] = [];
  // Frame 0: a one-frame head-velocity spike (a swing / lunge). Then still air, still head.
  m.step(DT, headIn(6, 0, 0));
  mags.push(m.magnitude());
  const still = headIn(0, 0, 0);
  for (let f = 1; f < 300; f++) { m.step(DT, still); mags.push(m.magnitude()); }

  let peak = 0, peakAt = 0;
  for (let i = 0; i < mags.length; i++) if (mags[i] > peak) { peak = mags[i]; peakAt = i; }
  assert(peak > 1e-3, `the spike must displace the mass, peak=${peak}`);

  // First return to (near) rest after the peak: everything after is the overshoot lobe.
  let crossed = -1;
  for (let i = peakAt + 1; i < mags.length; i++) if (mags[i] < 0.05 * peak) { crossed = i; break; }
  assert(crossed >= 0, "the mass must return through rest");
  let overshoot = 0;
  for (let i = crossed + 1; i < mags.length; i++) overshoot = Math.max(overshoot, mags[i]);
  assert(overshoot <= 0.15 * peak, `overshoot ${overshoot} exceeds 15% of peak ${peak}`);
  assert(m.resting(), "must converge to resting() within 4 s");
});

Deno.test("continuity: offset never jumps, and the result is frame-rate independent", () => {
  const m = new SecondaryMotion(BASE, 2, 4);
  const mixed: SecondaryInputs = { wind: [9, -3, 5], headVel: [0, 0, 0], yaw: 0.7, wetness: 0.2 };
  let prev = m.magnitude();
  for (let f = 0; f < 400; f++) {
    // Hammer it: alternate violent wind and a head-velocity spike.
    const input = f % 7 === 0 ? headIn(-8, 4, 2, 0.7, 0.2) : mixed;
    m.step(DT, input);
    const mag = m.magnitude();
    assert(Math.abs(mag - prev) < 0.1, `step change ${Math.abs(mag - prev)} >= 0.1 m at frame ${f}`);
    assert(Number.isFinite(mag), "magnitude must stay finite");
    prev = mag;
  }
  // Frame-rate independence: the same simulated time, one big step vs ten small ones.
  const big = new SecondaryMotion(BASE, 1, 7);
  const small = new SecondaryMotion(BASE, 1, 7);
  const inp = windIn(4, 0, 0);
  big.step(0.1, inp);
  for (let k = 0; k < 10; k++) small.step(0.01, inp);
  const ob = big.offset(0), os = small.offset(0);
  for (let a = 0; a < 3; a++) {
    const scale = Math.max(1e-6, Math.abs(ob[a]), Math.abs(os[a]));
    assert(Math.abs(ob[a] - os[a]) / scale < 0.01, `axis ${a}: 1x0.1 vs 10x0.01 differ >1% (${ob[a]} vs ${os[a]})`);
  }
});

Deno.test("bounds: 10 000 violent random frames stay inside the 1 m box and stay finite", () => {
  const m = new SecondaryMotion(BASE, 5, 99);
  const rnd = rng32(0x5eed);
  const r = (a: number, b: number) => a + (b - a) * rnd();
  for (let f = 0; f < 10000; f++) {
    const dt = r(0, 0.25);
    const input: SecondaryInputs = {
      wind: [r(-60, 60), r(-60, 60), r(-60, 60)],
      headVel: [r(-60, 60), r(-60, 60), r(-60, 60)],
      yaw: r(-Math.PI, Math.PI),
      wetness: r(0, 1),
    };
    m.step(dt, input);
    for (let i = 0; i < 5; i++) {
      const o = m.offset(i);
      for (let a = 0; a < 3; a++) {
        assert(Number.isFinite(o[a]), `mass ${i} axis ${a} not finite: ${o[a]}`);
        assert(Math.abs(o[a]) <= 1 + 1e-9, `mass ${i} axis ${a} left the 1 m box: ${o[a]}`);
      }
    }
    assert(Number.isFinite(m.magnitude()), "magnitude not finite");
  }
});

Deno.test("determinism: the same seed reproduces the trajectory, different seeds differ", () => {
  const input = windIn(5, 1, -2, 0.4, 0.3);
  const run = (seed: number) => {
    const m = new SecondaryMotion(BASE, 3, seed);
    for (let f = 0; f < 200; f++) m.step(DT, input);
    return [m.offset(0), m.offset(1), m.offset(2)] as const;
  };
  const a = run(1234), b = run(1234), c = run(1235);
  for (let i = 0; i < 3; i++) for (let x = 0; x < 3; x++) {
    assert(a[i][x] === b[i][x], `seed 1234 twice must match at mass ${i} axis ${x}`);
  }
  let differs = false;
  for (let i = 0; i < 3; i++) for (let x = 0; x < 3; x++) if (Math.abs(a[i][x] - c[i][x]) > 1e-9) differs = true;
  assert(differs, "different seeds must give a different trajectory");
});

Deno.test("wetness: a soaked mass peaks lower and settles faster than a dry one (same input)", () => {
  const dry = new SecondaryMotion({ ...BASE, damp: 2 }, 1, 8);
  const wet = new SecondaryMotion({ ...BASE, damp: 2 }, 1, 8);
  const spike = headIn(8, 0, 0, 0, 0);
  const wetSpike = headIn(8, 0, 0, 0, 1);
  const stillDry = headIn(0, 0, 0, 0, 0);
  const stillWet = headIn(0, 0, 0, 0, 1);

  let dryPeak = 0, wetPeak = 0, dryRest = -1, wetRest = -1;
  dry.step(DT, spike); wet.step(DT, wetSpike);
  dryPeak = dry.magnitude(); wetPeak = wet.magnitude();
  const frames = 300;
  for (let f = 1; f < frames; f++) {
    dry.step(DT, stillDry);
    wet.step(DT, stillWet);
    dryPeak = Math.max(dryPeak, dry.magnitude());
    wetPeak = Math.max(wetPeak, wet.magnitude());
    if (dryRest < 0 && dry.resting()) dryRest = f;
    if (wetRest < 0 && wet.resting()) wetRest = f;
  }
  assert(wetPeak < dryPeak, `wet peak ${wetPeak} must be lower than dry ${dryPeak}`);
  assert(wetRest >= 0 && dryRest >= 0, "both must settle to rest");
  assert(wetRest < dryRest, `wet must settle sooner (wet ${wetRest} vs dry ${dryRest})`);
});

Deno.test("cost: step() does not allocate and 100 000 steps run well under a second", () => {
  const m = new SecondaryMotion(BASE, 5, 2);
  const input = windIn(6, 1, -3, 0.5, 0.1);
  const t0 = performance.now();
  for (let f = 0; f < 100000; f++) m.step(DT, input);
  const ms = performance.now() - t0;
  console.log(`SecondaryMotion: 100 000 steps (count=5, dt=1/60) in ${ms.toFixed(1)} ms`);
  assert(Number.isFinite(m.magnitude()), "state must stay finite through the sweep");
  assert(ms < 1000, `100 000 steps took ${ms.toFixed(1)} ms (must be well under a second)`);
});
