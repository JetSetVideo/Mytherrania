import { clockFromDate, cloudDensity, environmentAt, fbm, moonPositions, PLACES, solarPosition } from "../src/graphics/Environment.ts";

function assert(ok: boolean, message = "assertion failed") { if (!ok) throw new Error(message); }
function assertAlmostEquals(a: number, b: number, eps: number) { assert(Math.abs(a - b) <= eps, `${a} != ${b} ± ${eps}`); }

const DEG = 180 / Math.PI;
const equator = { ...PLACES[0], latitude: 0, cloudiness: 0 };

Deno.test("H-sun-1: equinox noon at the equator puts the sun near zenith", () => {
  const s = solarPosition(80, 12, 0);
  assert(s.elevation * DEG > 85, `elevation ${s.elevation * DEG}`);
});

Deno.test("H-sun-2 (inverse): morning and evening at equal offsets from noon are symmetric", () => {
  for (const off of [2, 4, 5.5]) {
    const am = solarPosition(172, 12 - off, 45).elevation;
    const pm = solarPosition(172, 12 + off, 45).elevation;
    assertAlmostEquals(am, pm, 1e-9);
  }
});

Deno.test("H-sun-3 (compare, refined): north of the solar declination, higher latitude lowers the noon sun", () => {
  // Original hypothesis "always monotonic in latitude" was FALSIFIED in June:
  // decl=+23.4° puts the sun overhead at 23°N, so 12°N (78.6°) < 34°N (79.4°).
  // Refined: monotonic only for latitudes ≥ declination — test in December (decl −23.4°).
  const sorted = [...PLACES].sort((a, b) => a.latitude - b.latitude).map((p) => solarPosition(355, 12, p.latitude).elevation);
  for (let i = 1; i < sorted.length; i++) assert(sorted[i] < sorted[i - 1], "monotonic in latitude (December)");
  const june = (lat: number) => solarPosition(172, 12, lat).elevation;
  assert(june(12) < june(23.4) && june(34) < june(23.4), "June: peak near the Tropic of Cancer");
  assert(PLACES.every((p) => june(p.latitude) > 0), "noon is daytime everywhere in June");
});

Deno.test("H-phase: midnight is night with stars, 06h dawn, 12h day, 18h dusk", () => {
  assert(environmentAt(0, 80, equator).phase === "night");
  assert(environmentAt(0, 80, equator).starAlpha > 0.95);
  assert(environmentAt(6.2, 80, equator).phase === "dawn");
  assert(environmentAt(12, 80, equator).phase === "day");
  assert(environmentAt(12, 80, equator).starAlpha < 0.01);
  assert(environmentAt(17.8, 80, equator).phase === "dusk");
});

Deno.test("H-colour (oppose): twilight horizon is redder than both noon and midnight", () => {
  const redness = (h: number) => {
    const c = environmentAt(h, 80, equator).horizon;
    return c[0] / (c[2] + 1e-3);
  };
  assert(redness(18) > redness(12) * 1.3, `dusk ${redness(18)} vs noon ${redness(12)}`);
  assert(redness(18) > redness(0), "dusk vs midnight");
  // The sun itself reddens near the horizon (Rayleigh).
  const sunNoon = environmentAt(12, 80, equator).sunColor, sunDusk = environmentAt(17.9, 80, equator).sunColor;
  assert(sunDusk[2] < sunNoon[2] * 0.7);
});

Deno.test("H-light: sun intensity is zero at night, maximal near noon; moons light the night", () => {
  assert(environmentAt(0, 80, equator).sunIntensity === 0);
  const noon = environmentAt(12, 80, equator).sunIntensity;
  for (const h of [8, 10, 14, 16]) assert(environmentAt(h, 80, equator).sunIntensity < noon);
  // Over a full day at least one moon is up during night hours.
  const nightMoon = [20, 22, 0, 2, 4].map((h) => environmentAt(h, 80, equator).moonIntensity);
  assert(nightMoon.some((m) => m > 0), "some moonlight at night");
  assert(environmentAt(12, 80, equator).moonIntensity === 0, "no moonlight at noon");
});

Deno.test("H-cloud: occlusion is bounded and dims the sun relative to a clear sky", () => {
  const cloudy = { ...equator, cloudiness: 1 };
  let dimmed = 0;
  for (let t = 0; t < 400; t += 7) {
    const e = environmentAt(12, 80, cloudy, t);
    assert(e.sunOcclusion >= 0 && e.sunOcclusion <= 1);
    if (e.sunIntensity < environmentAt(12, 80, equator, t).sunIntensity - 1e-6) dimmed++;
  }
  assert(dimmed > 0, "clouds passing over the sun dim it at least sometimes");
  assert(cloudDensity([0, -1, 0], 0, 1, 0.01) === 0, "no cloud below the horizon");
});

Deno.test("H-noise: fbm stays inside [0,1] and is deterministic", () => {
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37, y = i * 1.13;
    const v = fbm(x, y);
    assert(v >= 0 && v <= 1);
    assert(v === fbm(x, y));
  }
});

Deno.test("H-moons: the two moons follow different periods and stay unit vectors", () => {
  const [a0, b0] = moonPositions(0, 80), [a6, b6] = moonPositions(6, 80);
  for (const m of [a0, b0, a6, b6]) assertAlmostEquals(Math.hypot(...m.dir), 1, 1e-9);
  assert(Math.abs((a6.elevation - a0.elevation) - (b6.elevation - b0.elevation)) > 1e-3, "different motion");
});

Deno.test("clockFromDate: local hour and day of year", () => {
  const c = clockFromDate(new Date(2026, 9, 10, 19, 30));
  assertAlmostEquals(c.hour, 19.5, 1e-9);
  assert(c.dayOfYear === 283, `day ${c.dayOfYear}`);
});
