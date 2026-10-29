// Lane S (V04): Surroundings physics — the wave function shared with the shader, still water,
// growth with agitation, the dispersion relation, media table, kill planes, canopy and hills.
import { rng32 } from "../src/core/MathCore.ts";
import { makeArena } from "../src/game/ArenaConfig.ts";
import { generateArenaTerrain } from "../src/world/Heightfield.ts";
import { chooseBiome, createSurroundings } from "../src/world/biomes/Biomes.ts";
import { MAX_HILL_SLOPE, MEDIA, MEDIUMS } from "../src/world/biomes/BiomeTables.ts";
import type { BiomeKind, BiomeSpec } from "../src/world/biomes/contracts.ts";
import {
  BREAKING_STEEPNESS, deriveWaves, evaluatePackedWaves, gerstnerAt, packWaveUniforms, WAVE_COUNT, WAVE_GLSL, WAVE_GRAVITY,
  wavePhasesAt, waveHeightAt,
} from "../src/world/biomes/Waves.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

const spec = (kind: BiomeKind, over: Partial<BiomeSpec> = {}): BiomeSpec => ({ kind, seed: 4242, surfaceDrop: -6, extent: 900, agitation: 0.6, windAngle: 0.5, ...over });

Deno.test("still water (agitation 0) is exactly flat at every point and time", () => {
  const s = createSurroundings(spec("water", { agitation: 0 }), null, 20);
  const rng = rng32(9);
  for (let i = 0; i < 500; i++) {
    const x = (rng() - 0.5) * 400, z = (rng() - 0.5) * 400, t = rng() * 1e4;
    assert(s.surfaceAt(x, z, t) === -6, `still water moved at (${x}, ${z}, ${t})`);
  }
  assert(s.waves && s.waves.maxElevation === 0, "still water has zero amplitude");
});

Deno.test("waves grow with agitation (amplitude, measured RMS elevation and peak wavelength)", () => {
  let lastRms = -1, lastMax = -1, lastPeak = -1;
  for (const a of [0, 0.25, 0.5, 0.75, 1]) {
    const s = createSurroundings(spec("water", { agitation: a }), null, 20);
    let sum = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const y = s.surfaceAt(25 + i * 1.7, -30 + j * 1.7, 3.3) + 6;
        sum += y * y;
        n++;
      }
    }
    const rms = Math.sqrt(sum / n), w = s.waves!;
    console.log(`agitation ${a}: maxElevation ${w.maxElevation.toFixed(3)} m, RMS ${rms.toFixed(3)} m, peak lambda ${w.peakWavelength.toFixed(2)} m, sum kA ${w.totalSteepness.toFixed(3)}`);
    assert(w.maxElevation > lastMax || (a === 0 && w.maxElevation === 0), `max elevation must grow at ${a}`);
    assert(rms > lastRms || a === 0, `RMS must grow at ${a}`);
    assert(w.peakWavelength >= lastPeak, `peak wavelength must not shrink at ${a}`);
    lastRms = rms; lastMax = w.maxElevation; lastPeak = w.peakWavelength;
  }
});

Deno.test("deep-water dispersion omega^2 = g k for water; magma slowed by its speed scale; steepness below breaking", () => {
  for (const a of [0.1, 0.5, 1]) {
    const water = deriveWaves(a, 0.3, 7, { minWavelength: 2 });
    for (const w of water.waves) {
      assert(Math.abs(w.omega * w.omega - WAVE_GRAVITY * w.k) < 1e-9 * WAVE_GRAVITY * w.k, "omega^2 = g k");
      assert(Math.abs(w.k * w.wavelength - 2 * Math.PI) < 1e-12, "k = 2 pi / lambda");
    }
    assert(water.totalSteepness < BREAKING_STEEPNESS, `sum kA ${water.totalSteepness} below the Stokes limit`);
    assert(water.totalSteepness < 1, "inversion contracts");
    const magma = deriveWaves(a, 0.3, 7, { minWavelength: 2, speedScale: 0.25 });
    magma.waves.forEach((w, i) => assert(Math.abs(w.omega - 0.25 * water.waves[i].omega) < 1e-12, "magma speed scale"));
  }
});

Deno.test("surfaceAt agrees with the GPU's forward Gerstner map at displaced vertices (<= 2 mm)", () => {
  const s = createSurroundings(spec("water", { agitation: 1 }), null, 18);
  const train = s.waves!;
  const phases = new Float64Array(WAVE_COUNT);
  const rng = rng32(77);
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const r = 18 + rng() * 250, a = rng() * Math.PI * 2, t = rng() * 600;
    const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r;
    wavePhasesAt(train, t, phases);
    const g = gerstnerAt(train, x0, z0, phases);
    const physics = s.surfaceAt(g.x, g.z, t) - s.spec.surfaceDrop;
    worst = Math.max(worst, Math.abs(physics - g.y));
  }
  console.log(`worst |surfaceAt - vertex height| = ${(worst * 1000).toFixed(3)} mm over 400 displaced vertices (storm)`);
  assert(worst <= 0.002, `GPU/physics mismatch ${worst} m`);
});

Deno.test("the packed float32 uniforms (shader arithmetic) reproduce gerstnerAt (<= 5 mm), and WAVE_GLSL is that function", () => {
  const train = deriveWaves(0.8, 1.1, 99, { minWavelength: 3, segments: 128 });
  const { a, b } = packWaveUniforms(train);
  const phases = new Float64Array(WAVE_COUNT);
  const rng = rng32(3);
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const x0 = (rng() - 0.5) * 600, z0 = (rng() - 0.5) * 600;
    wavePhasesAt(train, rng() * 3600, phases);
    const cpu = gerstnerAt(train, x0, z0, phases);
    const gpu = evaluatePackedWaves(a, b, Float32Array.from(phases), x0, z0);
    worst = Math.max(worst, Math.abs(cpu.y - gpu.y), Math.abs(cpu.x - gpu.x), Math.abs(cpu.z - gpu.z), Math.abs(cpu.jacobian - gpu.jacobian));
  }
  console.log(`worst float32-uniform deviation ${(worst * 1000).toFixed(3)} mm`);
  assert(worst <= 0.005, `packed deviation ${worst}`);
  for (const piece of [
    "float fade = 1.0 - smoothstep(B.y, B.z, r0);", "float amp = A.w * fade;",
    "float theta = A.z * (A.x * p0.x + A.y * p0.y) + uWavePhase[i];", "d.x -= B.x * amp * A.x * s;", "d.z -= B.x * amp * A.y * s;",
    "d.y += amp * c;", "compression += B.x * A.z * amp * c;", `for (int i = 0; i < ${WAVE_COUNT}; i++)`,
  ]) assert(WAVE_GLSL.includes(piece), `WAVE_GLSL lost: ${piece}`);
});

Deno.test("wave phases stay exact at large t (double precision on the CPU, wrapped to [0, 2 pi))", () => {
  const train = deriveWaves(0.7, 0, 5, { minWavelength: 2 });
  const phases = wavePhasesAt(train, 123456.789);
  train.waves.forEach((w, i) => {
    assert(phases[i] >= 0 && phases[i] < 2 * Math.PI, "wrapped");
    const expect = w.phase0 - w.omega * 123456.789;
    assert(Math.abs(Math.cos(phases[i]) - Math.cos(expect)) < 1e-6, "same angle");
  });
  assert(Math.abs(waveHeightAt(train, 10, 20, 123456.789)) <= train.maxElevation + 1e-9, "bounded");
});

Deno.test("media table complete; drag/buoyancy/hazard match it for every biome", () => {
  for (const m of MEDIUMS) {
    const e = MEDIA[m];
    assert(e && e.drag >= 0 && e.buoyancy >= 0 && e.hazardDps >= 0 && e.why.length > 0, `medium ${m}`);
  }
  assert(MEDIA.water.drag === 2 && MEDIA.water.buoyancy === 0.9 && MEDIA.water.hazardDps === 0, "water ~ contract");
  assert(MEDIA.magma.drag === 4 && MEDIA.magma.buoyancy === 1.1 && MEDIA.magma.hazardDps > 0, "magma ~ contract");
  assert(MEDIA.canopy.drag === 1.5 && MEDIA.ground.drag === 0 && MEDIA.void.drag === 0, "canopy/ground/void ~ contract");
  assert(Math.max(...MEDIUMS.map((m) => MEDIA[m].hazardDps)) === MEDIA.magma.hazardDps, "magma burns hardest");
  for (const kind of ["water", "meadow", "hills", "magma", "clouds", "canopy", "void"] as BiomeKind[]) {
    const s = createSurroundings(spec(kind, { relief: 8, density: 0.7, groundDepth: 20 }), null, 20);
    for (const m of MEDIUMS) {
      assert(s.drag(m) === MEDIA[m].drag && s.buoyancy(m) === MEDIA[m].buoyancy && s.hazardDps(m) === MEDIA[m].hazardDps, `${kind}/${m}`);
    }
  }
});

Deno.test("media and kill planes per biome: liquids/clouds/void, kill plane below every surface sample", () => {
  const expect: Record<string, string> = { water: "water", magma: "magma", clouds: "cloud", void: "void", meadow: "ground", hills: "ground" };
  for (const kind of ["water", "magma", "clouds", "void", "meadow", "hills", "canopy"] as BiomeKind[]) {
    const s = createSurroundings(spec(kind, { relief: 10, density: 0.7, groundDepth: 25 }), null, 20);
    const rng = rng32(11);
    for (let i = 0; i < 300; i++) {
      const r = 22 + rng() * 300, a = rng() * 2 * Math.PI, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = s.surfaceAt(x, z, 5), m = s.mediumAt(x, z);
      if (expect[kind]) assert(m === expect[kind], `${kind}: medium ${m}`);
      if (kind === "clouds" || kind === "void") assert(Number.isNaN(y), `${kind} has no support`);
      else assert(Number.isFinite(y) && y > s.killPlaneY, `${kind}: surface ${y} above kill plane ${s.killPlaneY}`);
    }
    assert(Number.isFinite(s.killPlaneY) && s.killPlaneY < s.spec.surfaceDrop, `${kind}: kill plane below the surface`);
  }
});

Deno.test("canopy: crowns break the fall (canopy) and gaps drop to the forest floor (ground)", () => {
  const s = createSurroundings(spec("canopy", { surfaceDrop: -5, density: 0.7, groundDepth: 30 }), null, 20);
  assert(s.crownCount > 50, `crowns ${s.crownCount}`);
  let canopy = 0, ground = 0;
  const rng = rng32(4);
  for (let i = 0; i < 2000; i++) {
    const r = s.crownZone[0] + rng() * (s.crownZone[1] - s.crownZone[0]), a = rng() * 2 * Math.PI;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, m = s.mediumAt(x, z), y = s.surfaceAt(x, z, 0);
    if (m === "canopy") { canopy++; assert(y > s.groundY + 10, "a crown stands far above the floor"); }
    else { ground++; assert(y === s.groundY, "a gap shows the floor"); }
  }
  console.log(`canopy samples: ${canopy} crown hits, ${ground} gaps (density 0.7)`);
  assert(canopy > 300 && ground > 100, "both crowns and gaps occur");
  const top = s.surfaceAt(s.crowns[0], s.crowns[1], 0);
  assert(Math.abs(top - s.crowns[3]) < 1e-4 || top > s.crowns[3], "a crown's centre reaches its top height");
  assert(s.mediumAt(5000, 0) === "canopy" && s.surfaceAt(5000, 0, 0) === s.carpetY, "carpet beyond the crown zone");
});

Deno.test("hills continue the field's outside ground and stay under the scenery slope limit", () => {
  const cfg = makeArena({ size: 40, outsideGround: 1, outsideHeight: -3 });
  const field = generateArenaTerrain(77, cfg);
  const sp = chooseBiome(cfg, "verdant", rng32(2));
  const hills: BiomeSpec = { ...sp, kind: "hills", relief: 14 };
  const s = createSurroundings(hills, field, 20);
  assert(s.nearRadius > 20, `near radius ${s.nearRadius}`);
  // Inside the solid outside: the field-following ground (outsideHeight + field height).
  const inside = s.surfaceAt(s.nearRadius - 2, 0, 0);
  assert(Number.isFinite(inside) && s.mediumAt(s.nearRadius - 2, 0) === "ground", "near ground");
  // Continuity at the seam: the land starts where the drawn outside ends (same bearing), no step.
  for (let j = 0; j < 32; j++) {
    const a = (j / 32) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a);
    const yIn = s.surfaceAt(c * (s.nearRadius - 0.02), sn * (s.nearRadius - 0.02), 0);
    const yOut = s.surfaceAt(c * (s.nearRadius + 0.02), sn * (s.nearRadius + 0.02), 0);
    assert(Math.abs(yOut - yIn) < 0.05, `seam jump ${yOut - yIn} at bearing ${j}`);
  }
  // Far out the land has eased onto edgeY + relief * shape.
  const far = s.surfaceAt(s.nearRadius + 400, 0, 0);
  assert(far >= s.edgeY - 0.36 * 14 - 1e-9 && far <= s.edgeY + 14 + 1e-9, `far land ${far} outside edgeY + relief band`);
  // Slope beyond the seam.
  let worst = 0;
  const h = 0.5;
  for (let i = 0; i < 4000; i++) {
    const rng = rng32(i + 1);
    const r = s.nearRadius + 1 + rng() * 400, a = rng() * 2 * Math.PI, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = s.surfaceAt(x, z, 0);
    const g = Math.hypot(s.surfaceAt(x + h, z, 0) - y, s.surfaceAt(x, z + h, 0) - y) / h;
    worst = Math.max(worst, g);
  }
  console.log(`hills relief 14 m: worst sampled slope ${(Math.atan(worst) * 180 / Math.PI).toFixed(1)} deg (limit ${(MAX_HILL_SLOPE * 180 / Math.PI).toFixed(0)})`);
  assert(worst <= Math.tan(MAX_HILL_SLOPE) * 1.02, `slope ${worst}`);
});

Deno.test("determinism: two surroundings from one spec agree everywhere", () => {
  for (const kind of ["water", "canopy", "hills", "magma"] as BiomeKind[]) {
    const sp = spec(kind, { relief: 9, density: 0.6, groundDepth: 22 });
    const a = createSurroundings(sp, null, 25), b = createSurroundings(sp, null, 25);
    for (let i = 0; i < 100; i++) {
      const x = 30 + i * 2.3, z = -40 + i * 1.1;
      assert(Object.is(a.surfaceAt(x, z, i), b.surfaceAt(x, z, i)) && a.mediumAt(x, z) === b.mediumAt(x, z), `${kind} differs`);
    }
  }
});
