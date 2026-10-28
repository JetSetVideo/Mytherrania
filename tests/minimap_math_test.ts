// Lane F (R06): minimap mathematics — projection, orientation, edge clamping,
// nice numbers, contours, hillshade, tint, relief bake.
import { rng32 } from "../src/core/MathCore.ts";
import { bearing } from "../src/game/Senses.ts";
import {
  canvasAngleOf, clampToEdge, CONTOUR_TARGET_MAX, CONTOUR_TARGET_MIN, contourInterval, contourLevelCount, createEdgeMarker,
  createFrame, DEFAULT_AMBIENT, fitPixelsPerMetre, followPixelsPerMetre, ghostAlpha, headingOf, hillshade, HYPSOMETRIC_RAMP,
  hypsometricTint, isNiceNumber, lightDirection, mapToWorld, niceFloor, normalFromHeights, pingProgress, rotationFor,
  scaleBarMetres, setFrame, worldToMap, type RGB, type Vec3,
} from "../src/ui/minimap/MapMath.ts";
import { bakeRelief, FEATURE_CLIFF, FEATURE_HOLE, flatTerrain, samplerFromGrid, type TerrainSampler } from "../src/ui/minimap/Relief.ts";

function near(a: number, b: number, eps = 1e-9, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a}`);
}
function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
/** Angle difference wrapped into (−π, π]. */
function angleGap(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

Deno.test("projection: world → map → world round-trips in both orientations", () => {
  const rng = rng32(11);
  const f = createFrame(), p = { x: 0, y: 0 }, w = { x: 0, y: 0 };
  for (let k = 0; k < 500; k++) {
    const orientation = k % 2 ? "player-up" : "north-up";
    setFrame(f, 100 + rng() * 400, 100 + rng() * 400, (rng() - 0.5) * 80, (rng() - 0.5) * 80, 0.5 + rng() * 20,
      rotationFor(orientation, rng() * Math.PI * 2));
    const x = (rng() - 0.5) * 200, z = (rng() - 0.5) * 200;
    worldToMap(f, x, z, p);
    mapToWorld(f, p.x, p.y, w);
    near(w.x, x, 1e-9, "x");
    near(w.y, z, 1e-9, "z");
  }
});

Deno.test("projection: north-up puts north (−z) straight up and east to the right", () => {
  const f = setFrame(createFrame(), 200, 200, 5, -3, 4, rotationFor("north-up", 1.234));
  const p = { x: 0, y: 0 };
  worldToMap(f, 5, -3, p);
  near(p.x, 100, 1e-12, "centre x");
  near(p.y, 100, 1e-12, "centre y");
  worldToMap(f, 5, -13, p); // 10 m north
  near(p.x, 100, 1e-12, "north x");
  near(p.y, 60, 1e-12, "north y");
  worldToMap(f, 15, -3, p); // 10 m east
  near(p.x, 140, 1e-12, "east x");
  near(p.y, 100, 1e-12, "east y");
});

Deno.test("headingOf agrees with Senses.bearing and names the four cardinal points", () => {
  near(headingOf(0, -1), 0, 1e-12, "N");
  near(headingOf(1, 0), Math.PI / 2, 1e-12, "E");
  near(headingOf(0, 1), Math.PI, 1e-12, "S");
  near(headingOf(-1, 0), (3 * Math.PI) / 2, 1e-12, "W");
  near(headingOf(0, 0), 0, 0, "zero vector");
  const rng = rng32(5);
  for (let k = 0; k < 200; k++) {
    const dx = rng() - 0.5, dz = rng() - 0.5;
    near(Math.abs(angleGap((headingOf(dx, dz) * 180) / Math.PI, bearing(dx, dz))) % 360, 0, 1e-9, "bearing");
  }
});

Deno.test("player-up: the player's facing points straight up for every heading", () => {
  const rng = rng32(3);
  const f = createFrame(), p = { x: 0, y: 0 };
  for (let k = 0; k < 360; k++) {
    const fx = Math.sin(k) * (0.2 + rng()), fz = Math.cos(k * 1.7) * (0.2 + rng());
    const h = headingOf(fx, fz);
    const px = (rng() - 0.5) * 50, pz = (rng() - 0.5) * 50;
    setFrame(f, 220, 220, px, pz, 3, rotationFor("player-up", h));
    // The arrow angle of the facing is −π/2 (canvas "up")…
    near(angleGap(canvasAngleOf(f, h), -Math.PI / 2), 0, 1e-9, "canvas angle");
    // …and a point 8 m ahead lands directly above the centre.
    const len = Math.hypot(fx, fz);
    worldToMap(f, px + (fx / len) * 8, pz + (fz / len) * 8, p);
    near(p.x, 110, 1e-9, "ahead x");
    near(p.y, 110 - 24, 1e-9, "ahead y");
  }
});

Deno.test("edge clamp: on-map points pass through, off-map points sit on the inset rim along the same ray", () => {
  const f = setFrame(createFrame(), 200, 160, 0, 0, 1, 0), e = createEdgeMarker();
  clampToEdge(f, 120, 90, 8, e);
  assert(!e.offMap, "inside is on-map");
  near(e.x, 120, 0, "x kept");
  near(e.y, 90, 0, "y kept");
  const rng = rng32(9);
  for (let k = 0; k < 300; k++) {
    const a = rng() * Math.PI * 2, d = 200 + rng() * 2000;
    const px = 100 + Math.cos(a) * d, py = 80 + Math.sin(a) * d;
    clampToEdge(f, px, py, 8, e);
    assert(e.offMap, "far point is off-map");
    const onVertical = Math.abs(Math.abs(e.x - 100) - 92) < 1e-9 && Math.abs(e.y - 80) <= 72 + 1e-9;
    const onHorizontal = Math.abs(Math.abs(e.y - 80) - 72) < 1e-9 && Math.abs(e.x - 100) <= 92 + 1e-9;
    assert(onVertical || onHorizontal, `rim point (${e.x}, ${e.y}) not on the inset rectangle`);
    // Collinear with centre→target, same direction.
    const cross = (e.x - 100) * (py - 80) - (e.y - 80) * (px - 100);
    near(cross / (d * d), 0, 1e-9, "collinear");
    assert((e.x - 100) * (px - 100) + (e.y - 80) * (py - 80) > 0, "same side");
    near(angleGap(e.angle, a), 0, 1e-9, "arrow angle");
  }
});

Deno.test("zoom: overview fits the ring; follow zoom derives from sight range and never zooms out past overview", () => {
  const fit = fitPixelsPerMetre(400, 50, 0.04);
  near(fit * 50, 200 * 0.96, 1e-9, "ring radius fills 96% of the half-size");
  near(followPixelsPerMetre(400, 10, 1.6, fit), 200 / 16, 1e-12, "half-size shows 1.6 sight radii");
  near(followPixelsPerMetre(400, 1000, 1.6, fit), fit, 0, "clamped to overview");
});

Deno.test("nice numbers: niceFloor returns 1/2/5×10^n ≤ x, and the next nice number is > x", () => {
  near(niceFloor(7.3), 5, 1e-12);
  near(niceFloor(19.99), 10, 1e-12);
  near(niceFloor(0.3), 0.2, 1e-12);
  near(niceFloor(2), 2, 1e-12);
  near(niceFloor(1000), 1000, 1e-9);
  near(niceFloor(-1), 0, 0);
  const rng = rng32(21);
  for (let k = 0; k < 1000; k++) {
    const x = 0.01 * 10 ** (rng() * 7);
    const n = niceFloor(x);
    assert(isNiceNumber(n), `${n} not nice`);
    assert(n <= x * (1 + 1e-9), `${n} > ${x}`);
    assert(n * 2.5 > x, `${n} is not the largest nice ≤ ${x}`);
  }
  assert(!isNiceNumber(3) && !isNiceNumber(25) && !isNiceNumber(0), "3, 25, 0 are not nice");
});

Deno.test("scale bar: a nice number of metres that fits the allowed width and is at least 40 % of it", () => {
  const rng = rng32(4);
  for (let k = 0; k < 500; k++) {
    const ppm = 0.2 * 10 ** (rng() * 3), maxPx = 40 + rng() * 120;
    const m = scaleBarMetres(ppm, maxPx);
    assert(isNiceNumber(m), `${m} m not nice`);
    assert(m * ppm <= maxPx + 1e-9, "bar overflows");
    assert(m * ppm >= maxPx * 0.4 - 1e-9, "bar is needlessly short (1/2/5 steps are ≤ 2.5× apart)");
  }
});

Deno.test(`contours: interval is nice; ≥80 % of 5000 random ranges give ${CONTOUR_TARGET_MIN}-${CONTOUR_TARGET_MAX} lines, none outside 4-11`, () => {
  const rng = rng32(7);
  let inWindow = 0;
  const N = 5000;
  for (let k = 0; k < N; k++) {
    const range = 0.5 * 10 ** (rng() * 4); // 0.5 m .. 5 km
    const min = (rng() - 0.5) * range * 2;
    const interval = contourInterval(min, min + range);
    assert(isNiceNumber(interval), `interval ${interval} for range ${range} is not nice`);
    const lines = contourLevelCount(min, min + range, interval);
    assert(lines >= 4 && lines <= 11, `range ${min}..${min + range}: ${lines} lines`);
    if (lines >= CONTOUR_TARGET_MIN && lines <= CONTOUR_TARGET_MAX) inWindow++;
  }
  assert(inWindow / N >= 0.8, `only ${(inWindow / N * 100).toFixed(1)} % in window`);
  // Typical arena relief ranges land in the window.
  for (const [lo, hi] of [[0, 8], [0, 40], [12, 95], [-3, 17], [0, 11]]) {
    const n = contourLevelCount(lo, hi, contourInterval(lo, hi));
    assert(n >= CONTOUR_TARGET_MIN && n <= CONTOUR_TARGET_MAX, `${lo}..${hi}: ${n} lines`);
  }
  near(contourInterval(3, 3), 0, 0, "flat: no contours");
});

Deno.test("hillshade: brightest when the surface faces the light, ambient when it faces away", () => {
  const light = lightDirection((315 * Math.PI) / 180, Math.PI / 4);
  near(Math.hypot(light.x, light.y, light.z), 1, 1e-12, "unit light");
  assert(light.x < 0 && light.z < 0 && light.y > 0, "NW light points north-west and up");
  near(hillshade(light.x, light.y, light.z, light), 1, 1e-12, "facing the light");
  near(hillshade(-light.x, -light.y, -light.z, light), DEFAULT_AMBIENT, 1e-12, "facing away");
  // Over a sweep of unit normals, the brightest one is the light direction itself.
  let best = -1, bestDot = -2;
  for (let a = 0; a < 72; a++) {
    for (let e = 1; e <= 18; e++) {
      const az = (a / 72) * Math.PI * 2, el = (e / 18) * (Math.PI / 2);
      const n = lightDirection(az, el);
      const s = hillshade(n.x, n.y, n.z, light);
      if (s > best) { best = s; bestDot = n.x * light.x + n.y * light.y + n.z * light.z; }
    }
  }
  near(bestDot, 1, 1e-9, "argmax normal = light");
  // A slope rising to the east has a normal tilted west, so it is darker under a NW sun than one rising to the west.
  const n: Vec3 = { x: 0, y: 0, z: 0 };
  normalFromHeights(0, 2, 1, 1, 1, 1, n);
  assert(n.x < 0 && Math.abs(n.z) < 1e-12, "rises east → normal tilts west");
  const westFacing = hillshade(n.x, n.y, n.z, light);
  normalFromHeights(2, 0, 1, 1, 1, 1, n);
  assert(westFacing > hillshade(n.x, n.y, n.z, light), "west-facing slope is lit by a NW sun");
});

Deno.test("hypsometric tint: endpoints are the ramp's ends; input is clamped", () => {
  const c: RGB = { r: 0, g: 0, b: 0 };
  const lo = HYPSOMETRIC_RAMP[0], hi = HYPSOMETRIC_RAMP[HYPSOMETRIC_RAMP.length - 1];
  hypsometricTint(-3, c);
  assert(c.r === lo.r && c.g === lo.g && c.b === lo.b, "below 0 clamps to the lowest stop");
  hypsometricTint(1, c);
  assert(c.r === hi.r && c.g === hi.g && c.b === hi.b, "1 is the highest stop");
  hypsometricTint(0.3, c);
  assert(c.r === 77 && c.g === 107 && c.b === 69, "an exact stop");
});

Deno.test("fading: ghost alpha holds at its floor; pings expire", () => {
  near(ghostAlpha(0, 12, 0.2), 1, 0);
  near(ghostAlpha(6, 12, 0.2), 0.5, 1e-12);
  near(ghostAlpha(100, 12, 0.2), 0.2, 0);
  near(pingProgress(0.6, 1.2), 0.5, 1e-12);
  near(pingProgress(1.2, 1.2), -1, 0);
  near(pingProgress(-0.1, 1.2), -1, 0);
});

Deno.test("relief bake: a NW-facing slope is brighter than a SE-facing one; contours appear; flat has none", () => {
  // A pyramid 20 m high over a 64 m square.
  const pyramid: TerrainSampler = {
    bounds: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 },
    heightAt: (x, z) => Math.max(0, 20 - (20 / 32) * Math.max(Math.abs(x), Math.abs(z))),
  };
  const N = 64, rgba = new Uint8ClampedArray(N * N * 4), scratch = new Float32Array(N * N);
  const sum = bakeRelief(pyramid, -32, -32, 1, N, N, rgba, scratch);
  near(sum.minHeight, 0, 1, "min");
  near(sum.maxHeight, 20, 1, "max");
  assert(isNiceNumber(sum.contourInterval), "nice interval");
  assert(sum.contourLines >= CONTOUR_TARGET_MIN && sum.contourLines <= CONTOUR_TARGET_MAX, `${sum.contourLines} lines`);
  const lum = (i: number, j: number) => { const p = (j * N + i) * 4; return rgba[p] + rgba[p + 1] + rgba[p + 2]; };
  // West face (x<0) at the centre row vs east face; north face (z<0) vs south face.
  assert(lum(16, 33) > lum(47, 33), "west face brighter than east face under a NW sun");
  assert(lum(33, 16) > lum(33, 47), "north face brighter than south face under a NW sun");
  // Flat: one colour, no contour lines.
  const flat = bakeRelief(flatTerrain(pyramid.bounds), -32, -32, 1, N, N, rgba, scratch);
  near(flat.contourInterval, 0, 0, "flat interval");
  for (let p = 4; p < rgba.length; p += 4) assert(rgba[p] === rgba[0] && rgba[p + 1] === rgba[1] && rgba[p + 3] === 255, "flat is uniform");
});

Deno.test("samplerFromGrid: bilinear is exact on a plane, clamps outside, maps feature bits", () => {
  const cols = 9, rows = 7, cell = 2, originX = -8, originZ = -6;
  const heights = new Float32Array(cols * rows), mask = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) heights[j * cols + i] = 0.5 * (originX + i * cell) - 0.25 * (originZ + j * cell) + 3;
  mask[3 * cols + 4] = 4; // lane-specific "cliff" bit
  mask[0] = 8; // lane-specific "hole" bit
  const s = samplerFromGrid({ cols, rows, cell, originX, originZ, heights, featureMask: mask }, { cliff: 4, hole: 8 });
  const rng = rng32(2);
  for (let k = 0; k < 200; k++) {
    const x = originX + rng() * (cols - 1) * cell, z = originZ + rng() * (rows - 1) * cell;
    near(s.heightAt(x, z), 0.5 * x - 0.25 * z + 3, 1e-4, "plane");
  }
  near(s.heightAt(-100, -6), 0.5 * -8 - 0.25 * -6 + 3, 1e-4, "clamped west");
  assert(s.featureAt!(originX + 4 * cell, originZ + 3 * cell) === FEATURE_CLIFF, "cliff bit");
  assert(s.featureAt!(originX, originZ) === FEATURE_HOLE, "hole bit");
  assert(s.featureAt!(6.2, 4.1) === 0, "no feature away from the flagged samples");
});

Deno.test("lane E contract: feature bits match, and a real generated heightfield adapts and bakes", async () => {
  const E = await import("../src/world/TerrainFeatures.ts");
  assert(FEATURE_HOLE === E.FEATURE_HOLE && FEATURE_CLIFF === E.FEATURE_CLIFF, "minimap feature bits must equal lane E's");
  const { generateArenaTerrain } = await import("../src/world/Heightfield.ts");
  const { makeArena } = await import("../src/game/ArenaConfig.ts");
  const field = generateArenaTerrain(20261028, makeArena({ size: 40 }));
  const s = samplerFromGrid(field); // default bits: no mapping needed
  let flagged = 0;
  for (let j = 0; j < field.rows; j++) {
    for (let i = 0; i < field.cols; i++) {
      const n = j * field.cols + i, x = field.originX + i * field.cell, z = field.originZ + j * field.cell;
      near(s.heightAt(x, z), field.heights[n], 1e-4, `node ${i},${j}`);
      const m = field.featureMask[n];
      const want = (m & E.FEATURE_HOLE ? FEATURE_HOLE : 0) | (m & E.FEATURE_CLIFF ? FEATURE_CLIFF : 0);
      assert(s.featureAt!(x, z) === want, `feature at node ${i},${j}: mask ${m}`);
      if (want) flagged++;
    }
  }
  const N = 128, half = Math.max(-field.originX, -field.originZ);
  const sum = bakeRelief(s, -half, -half, (2 * half) / N, N, N, new Uint8ClampedArray(N * N * 4), new Float32Array(N * N));
  assert(sum.contourInterval === 0 || (isNiceNumber(sum.contourInterval) && sum.contourLines >= 4 && sum.contourLines <= 11),
    `real field: interval ${sum.contourInterval}, ${sum.contourLines} lines over ${sum.minHeight.toFixed(2)}..${sum.maxHeight.toFixed(2)} m`);
  console.log(`lane E field ${field.cols}x${field.rows} @${field.cell} m: ${flagged} flagged nodes; relief ${sum.minHeight.toFixed(2)}..${sum.maxHeight.toFixed(2)} m, interval ${sum.contourInterval} m, ${sum.contourLines} lines, ${sum.featurePixels} feature px`);
});
