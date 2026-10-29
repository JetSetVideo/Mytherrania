// Lane C: the two moons — synodic phase cycles, illumination law, motion with the hour, and the
// atmospheric reddening/dimming near the horizon.
import { absoluteDays, airMass, angleBetween, moonPhase, MOONS, moonStates } from "../src/world/climate/Moons.ts";
import { solarPosition } from "../src/graphics/Environment.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("moons: phases cycle with their synodic periods; illumination = (1 - cos 2 pi p) / 2", () => {
  for (const def of MOONS) {
    const d0 = absoluteDays(1, 40, 6);
    const p0 = moonPhase(def, d0);
    const pHalf = moonPhase(def, d0 + def.synodicDays / 2);
    const pFull = moonPhase(def, d0 + def.synodicDays);
    assert(Math.abs(pFull - p0) < 1e-9 || Math.abs(Math.abs(pFull - p0) - 1) < 1e-9, `${def.name} returns to its phase after one synodic period`);
    const dh = Math.abs(pHalf - p0);
    assert(Math.abs(dh - 0.5) < 1e-9, `${def.name} half a period = half a cycle`);
    // count new moons over a year: ~365 / synodic
    let news = 0, prev = moonPhase(def, d0);
    for (let h = 1; h <= 365 * 24; h++) {
      const p = moonPhase(def, d0 + h / 24);
      if (p < prev) news++;
      prev = p;
    }
    const want = 365 / def.synodicDays;
    assert(Math.abs(news - want) <= 1, `${def.name}: ${news} new moons a year (want ~${want.toFixed(1)})`);
    const [a] = moonStates(1, 40, 6, 48).filter((m) => m.id === def.id);
    assert(Math.abs(a.illumination - (1 - Math.cos(2 * Math.PI * a.phase)) / 2) < 1e-12, "illumination law");
  }
  assert(MOONS[0].angularRadius > MOONS[1].angularRadius, "Ilun is the larger");
  assert(Math.abs(MOONS[0].synodicDays - 29.5) < 0.1 && Math.abs(MOONS[1].synodicDays - 11) < 0.1, "synodic ~29.5 d and ~11 d");
});

Deno.test("moons: lit fraction agrees with the observed moon-sun angle (elongation)", () => {
  let worst = 0;
  for (let d = 1; d <= 365; d += 7) {
    for (const h of [3, 9, 15, 21]) {
      const sun = solarPosition(d, h, 34);
      for (const m of moonStates(2, d, h, 34)) {
        const el = angleBetween(m.dir, sun.dir);
        worst = Math.max(worst, Math.abs(m.illumination - (1 - Math.cos(el)) / 2));
      }
    }
  }
  console.log(`  moons: max |illumination - (1 - cos elongation)/2| = ${worst.toFixed(3)} (inclination + obliquity offsets)`);
  assert(worst < 0.15, `illumination consistent with elongation (worst ${worst})`);
});

Deno.test("moons: they move across the sky with the hour (rise and set), unit dirs, +y up", () => {
  for (const idx of [0, 1]) {
    let minEl = 9, maxEl = -9, prev: readonly number[] | null = null, moved = 0;
    for (let h = 0; h < 24; h += 0.5) {
      const m = moonStates(1, 120, h, 48)[idx];
      const len = Math.hypot(m.dir[0], m.dir[1], m.dir[2]);
      assert(Math.abs(len - 1) < 1e-9, "unit dir");
      assert(Math.abs(Math.sin(m.elevation) - m.dir[1]) < 1e-9, "elevation matches +y");
      minEl = Math.min(minEl, m.elevation); maxEl = Math.max(maxEl, m.elevation);
      if (prev) moved = Math.max(moved, Math.hypot(m.dir[0] - prev[0], m.dir[1] - prev[1], m.dir[2] - prev[2]));
      prev = [...m.dir];
    }
    assert(minEl < 0 && maxEl > 0, `moon ${idx} rises and sets over a day`);
    assert(moved > 0.05, "moves with the hour");
  }
  // a full Ilun transits near midnight (opposite the sun)
  const def = MOONS[0];
  let fullDay = 1;
  for (let d = 1; d <= 60; d++) {
    if (Math.abs(moonPhase(def, absoluteDays(1, d, 0)) - 0.5) < Math.abs(moonPhase(def, absoluteDays(1, fullDay, 0)) - 0.5)) fullDay = d;
  }
  const midnight = moonStates(1, fullDay, 0, 34)[0], noon = moonStates(1, fullDay, 12, 34)[0];
  assert(midnight.elevation > 0 && noon.elevation < 0, "full moon up at midnight, down at noon");
});

Deno.test("moons: near the horizon the colour is redder (R/B up), dimmer and the disc larger", () => {
  assert(airMass(90) < 1.01 && airMass(0) > 30, `air mass 1 at zenith, ~36 at horizon (got ${airMass(0)})`);
  for (const idx of [0, 1]) {
    let hi = null as null | ReturnType<typeof moonStates>[0], lo = null as null | ReturnType<typeof moonStates>[0];
    for (let d = 1; d <= 60 && !(hi && lo); d++) {
      for (let h = 0; h < 24; h += 0.1) {
        const m = moonStates(1, d, h, 34)[idx];
        const e = m.elevation * 180 / Math.PI;
        if (!hi && e > 55) hi = m;
        if (!lo && e > 1 && e < 4) lo = m;
      }
    }
    assert(hi && lo, "found high and low positions");
    const rb = (c: readonly number[]) => c[0] / Math.max(1e-9, c[2]);
    const name = MOONS[idx].name;
    console.log(`  ${name}: R/B zenith-ish ${rb(hi.skyColor).toFixed(2)} vs horizon ${rb(lo.skyColor).toFixed(2)}; radius ${hi.angularRadius.toFixed(4)} -> ${lo.angularRadius.toFixed(4)}`);
    assert(rb(lo.skyColor) > rb(hi.skyColor) * 1.5, `${name} redder near the horizon`);
    assert(lo.skyColor[1] < hi.skyColor[1], `${name} dimmer near the horizon`);
    assert(lo.angularRadius > hi.angularRadius, `${name} looks larger near the horizon`);
    assert(hi.brightness <= hi.illumination * MOONS[idx].relativeLight + 1e-12, "brightness <= illumination");
  }
  const below = moonStates(1, 10, 12, 48).find((m) => m.elevation < -0.05);
  if (below) assert(below.brightness === 0, "no moonlight below the horizon");
  const [ilun, vesh] = moonStates(1, 1, 0, 48);
  assert(ilun.baseColor[2] > ilun.baseColor[0] && vesh.baseColor[0] > vesh.baseColor[2], "Ilun silver-blue, Vesh amber-rose");
});
