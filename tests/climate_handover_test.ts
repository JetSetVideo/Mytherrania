// Lane E: regime handovers — pair-specific durations (exported numbers), a C2 blend, C1-smooth
// state over time (a kink detector that refines dt), and the QA edges: a pin released after a
// mid-handover pin, and setPlace in the middle of a handover.
import { WEATHER_REGIMES, type WeatherRegime } from "../src/world/climate/contracts.ts";
import {
  createWeather, HANDOVER_H, HANDOVER_PAIR_H, handoverBlend, handoverHours, transitionWeights, type WeatherSim,
} from "../src/world/climate/Weather.ts";
import { normalsAt, PLACE_CLIMATES } from "../src/world/climate/RealClimate.ts";
import { smoothstep } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("handover: pair durations are exported, brief (G18) and physically ordered", () => {
  for (const [k, h] of Object.entries(HANDOVER_PAIR_H)) {
    const [a, b] = k.split(">") as [WeatherRegime, WeatherRegime];
    assert(WEATHER_REGIMES.includes(a) && WEATHER_REGIMES.includes(b), `pair ${k} names real regimes`);
    assert(handoverHours(a, b) === h && h > 0 && h <= 0.6, `${k} = ${h} h (0 < h <= 0.6)`);
  }
  assert(handoverHours("lull", "lull") === HANDOVER_H, "unlisted pairs use HANDOVER_H");
  assert(handoverHours("building", "lull") < handoverHours("storm", "clearing"), "building -> lull snaps shut faster than the storm clears");
  assert(handoverHours("storm", "clearing") < handoverHours("clearing", "fair") && handoverHours("clearing", "fair") < handoverHours("clearing", "clear"),
    "the sky dries out slowest");
  // every transition the Markov chain can take has a declared duration
  for (const from of WEATHER_REGIMES) {
    const w = transitionWeights(from, normalsAt(PLACE_CLIMATES.sunspire, 200));
    const w2 = transitionWeights(from, normalsAt(PLACE_CLIMATES.greywall, 15));
    for (const to of WEATHER_REGIMES) if ((w[to] > 0 || w2[to] > 0)) assert(`${from}>${to}` in HANDOVER_PAIR_H, `${from}>${to} has a declared duration`);
  }
});

Deno.test("handover: the blend is smootherstep — C2 (zero velocity AND acceleration at both ends)", () => {
  const h = 1e-4;
  const d2 = (f: (x: number) => number, x: number) => (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  const ss = (x: number) => smoothstep(0, 1, x);
  // one-sided at the ends (the blend is held at 0 / 1 outside)
  const endAccel = (f: (x: number) => number) => Math.max(Math.abs(d2(f, h)), Math.abs(d2(f, 1 - h)));
  const before = endAccel(ss), after = endAccel(handoverBlend);
  console.log(`  blend acceleration at the ends: smoothstep ${before.toFixed(3)} -> smootherstep ${after.toFixed(5)}`);
  assert(before > 5 && after < 0.01, "C2 ends");
  assert(handoverBlend(0) === 0 && handoverBlend(1) === 1 && Math.abs(handoverBlend(0.5) - 0.5) < 1e-12, "endpoints and symmetry");
});

/** Run a sim at a fixed game step, recording handovers and selected signals. */
function record(dtH: number, hours: number, seed = 3, place = "sunspire", lat = 12, doy = 200) {
  const w = createWeather({ placeId: place, latitude: lat, seed, dayOfYear: doy, hour: 0 });
  const sig: Record<string, number[]> = { storminess: [], cloudCover: [], temperatureC: [], windSpeedMs: [], pressureHPa: [], towering: [] };
  const handovers: { from: WeatherRegime; to: WeatherRegime; start: number; end: number; declared: number }[] = [];
  let open: { from: WeatherRegime; to: WeatherRegime; start: number; declared: number } | null = null;
  const steps = Math.round(hours / dtH);
  for (let i = 1; i <= steps; i++) {
    // the clock as Climate feeds it: the day rolls over at midnight (so the normals glide on)
    const tt = i * dtH, day = doy + Math.floor(tt / 24), hour = tt - 24 * Math.floor(tt / 24);
    const prevRegime = w.state.regime;
    w.step(dtH, dtH * 60, day, hour);
    const s = w.state, t = i * dtH;
    if (!open && s.transition > 0) open = { from: s.regime, to: s.nextRegime, start: t - s.transition * w.handoverH, declared: w.handoverH };
    if (open && s.regime !== prevRegime) {
      handovers.push({ ...open, end: t - (s.transition > 0 ? s.transition * w.handoverH : 0) });
      open = s.transition > 0 ? { from: s.regime, to: s.nextRegime, start: t - s.transition * w.handoverH, declared: w.handoverH } : null;
    }
    sig.storminess.push(s.storminess); sig.cloudCover.push(s.cloudCover); sig.temperatureC.push(s.temperatureC);
    sig.windSpeedMs.push(s.windSpeedMs); sig.pressureHPa.push(s.pressureHPa); sig.towering.push(s.layers[3].coverage);
  }
  return { sig, handovers };
}

Deno.test("handover: each observed handover lasts its pair's declared duration", () => {
  const dt = 0.002;
  const { handovers } = record(dt, 24 * 4);
  const pairs = new Set<string>();
  for (const h of handovers) {
    const dur = h.end - h.start;
    assert(Math.abs(h.declared - handoverHours(h.from, h.to)) < 1e-12, `declared = handoverHours(${h.from}, ${h.to})`);
    assert(Math.abs(dur - h.declared) < 2 * dt + 1e-9, `${h.from}>${h.to} lasted ${dur.toFixed(4)} h (declared ${h.declared})`);
    pairs.add(`${h.from}>${h.to} ${h.declared}h`);
  }
  console.log(`  ${handovers.length} handovers over 4 game days, pairs: ${[...pairs].join(", ")}`);
  assert(handovers.length >= 10 && pairs.size >= 4, "enough distinct pairs observed");
});

Deno.test("handover: weather signals are C1 over time — the largest velocity change shrinks with dt (no kinks)", () => {
  // For a C1 signal with bounded acceleration, max |v_i - v_(i-1)| <= M dt: refining dt 4x shrinks it ~4x.
  // A kink (C0: velocity jump) keeps it constant. Ratio >= 2.5 required, measured per signal.
  const maxDv = (x: number[], dt: number) => {
    let m = 0;
    for (let i = 2; i < x.length; i++) m = Math.max(m, Math.abs((x[i] - x[i - 1]) - (x[i - 1] - x[i - 2])) / dt);
    return m;
  };
  const hours = 24 * 2;
  const coarse = record(0.004, hours), fine = record(0.001, hours); // sunspire monsoon: full storm cycles
  const lines: string[] = [];
  for (const k of Object.keys(coarse.sig)) {
    const a = maxDv(coarse.sig[k], 0.004), b = maxDv(fine.sig[k], 0.001);
    assert(a > 1e-9, `${k} moves during the run`);
    lines.push(`${k} ${a.toExponential(2)} -> ${b.toExponential(2)} (x${(a / b).toFixed(1)})`);
    assert(a / b >= 2.5, `${k}: velocity jumps do not shrink with dt (${a} -> ${b}): a kink`);
  }
  console.log(`  max velocity change per step (units/h), dt 0.004 -> 0.001 h: ${lines.join("; ")}`);
});

function settleInto(w: WeatherSim, cond: () => boolean, dtH = 0.01, maxH = 24 * 6): number {
  let hour = 0, t = 0;
  while (!cond() && t < maxH) { hour = (hour + dtH) % 24; w.step(dtH, dtH * 60, 200, hour); t += dtH; }
  assert(cond(), "condition reached");
  return hour;
}

Deno.test("handover edge: pin during a handover, then release — settled, no pop on release, the cycle resumes", () => {
  const w = createWeather({ placeId: "sunspire", latitude: 12, seed: 7, dayOfYear: 200, hour: 0 });
  let hour = settleInto(w, () => w.state.transition > 0.4);
  const from = w.state.regime;
  w.pin(w.state.nextRegime);
  assert(w.state.transition === 0 && w.state.regime === w.state.nextRegime && w.remainingH === Infinity, "pinned: settled");
  for (let i = 0; i < 50; i++) { hour = (hour + 0.01) % 24; w.step(0.01, 0.6, 200, hour); }
  const before = structuredClone(w.state);
  w.pin(null);
  const after = w.state;
  assert(JSON.stringify(before) === JSON.stringify(after), "release changes nothing by itself");
  assert(Number.isFinite(w.remainingH) && w.remainingH > 0, "a fresh dwell is drawn");
  let maxStep = 0, prev = w.state.cloudCover, changed = false;
  for (let i = 0; i < 24 * 100 * 3; i++) {
    hour = (hour + 0.01) % 24;
    w.step(0.01, 0.6, 200, hour);
    maxStep = Math.max(maxStep, Math.abs(w.state.cloudCover - prev));
    prev = w.state.cloudCover;
    if (w.state.transition > 0) changed = true;
  }
  assert(changed, `the cycle resumes after the release (was ${from})`);
  assert(maxStep < 0.02, `cloud cover moves smoothly after the release (max step ${maxStep})`);
});

Deno.test("handover edge: setPlace in the middle of a handover — the handover completes on schedule, all finite", () => {
  const w = createWeather({ placeId: "greywall", latitude: 48, seed: 4, dayOfYear: 200, hour: 0 });
  let hour = settleInto(w, () => w.state.transition > 0.3 && w.state.transition < 0.6, 0.002);
  const pair = `${w.state.regime}>${w.state.nextRegime}`, tr0 = w.state.transition, dur = w.handoverH;
  const cover0 = w.state.cloudCover;
  w.setPlace("frostford", 63);
  w.step(0.001, 0.06, 200, hour);
  assert(`${w.state.regime}>${w.state.nextRegime}` === pair, "same handover after the move");
  assert(Math.abs(w.state.cloudCover - cover0) < 0.02, `clouds do not pop on the move (${cover0} -> ${w.state.cloudCover})`);
  let t = 0.001;
  while (`${w.state.regime}>${w.state.nextRegime}` === pair && t < 2) {
    hour = (hour + 0.002) % 24; w.step(0.002, 0.12, 200, hour); t += 0.002;
    for (const k of ["temperatureC", "relativeHumidity", "pressureHPa", "windSpeedMs", "cloudCover", "fog", "rain", "snow"] as const) {
      assert(Number.isFinite(w.state[k]), `${k} finite`);
    }
  }
  const expected = (1 - tr0) * dur;
  assert(Math.abs(t - expected) < 0.005, `handover finished in ${t.toFixed(4)} h (expected ${expected.toFixed(4)})`);
});
