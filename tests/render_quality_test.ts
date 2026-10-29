// Wave G render model: resolution presets, quality presets/overrides, dynamic resolution,
// the cloud field (CPU twin of the sky GLSL) and the storm-cycle wave shapes.
import {
  createDynRes, DYNRES_MIN_SCALE, GRAPHICS_PRESETS, outputPixelRatio, PIXEL_RATIO_MAX, RENDER_PRESETS,
  RESOLUTION_HEIGHT, RESOLUTIONS, resolveQuality, stepDynRes,
} from "../src/graphics/render/Quality.ts";
import { cloudFbm, cloudOcclusionAt, coverageThreshold, FLOATS_PER_LAYER, layerShape, packCloudLayers, planeDensityAt, advanceDrift } from "../src/graphics/sky/CloudField.ts";
import { CLOUD_LAYERS, type CloudLayerState } from "../src/world/climate/contracts.ts";
import { deriveWaves, reshapeWaves, seaShape, waveHeightAt, wavePhasesAt } from "../src/world/biomes/Waves.ts";
import { COMPOSITE_FRAGMENT, EFFECTS_FRAGMENT, SSR_FRAGMENT } from "../src/graphics/render/PostShaders.ts";
import { CEL_LIGHT_GLSL } from "../src/graphics/shaders/CelShader.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** The drawing-buffer size three produces from setPixelRatio(ratio) + setSize(cssW, cssH). */
function outputSize(choice: Parameters<typeof outputPixelRatio>[0], cssW: number, cssH: number, dpr: number, budget: number) {
  const ratio = outputPixelRatio(choice, cssW, cssH, dpr, budget);
  return { width: Math.floor(cssW * ratio), height: Math.floor(cssH * ratio), ratio };
}

Deno.test("G01: every fixed resolution renders exactly its row count; 2160p is 4K UHD on a 16:9 window", () => {
  assert(RESOLUTIONS.includes("2160p") && RESOLUTIONS.includes("720p") && RESOLUTIONS.includes("1080p"), "usual presets present");
  for (const r of RESOLUTIONS) {
    if (r === "auto") continue;
    const o = outputSize(r, 1280, 720, 2, 4e6);
    assert(Math.abs(o.height - RESOLUTION_HEIGHT[r]) <= 1, `${r}: ${o.height} rows`);
  }
  const uhd = outputSize("2160p", 1600, 900, 1, 4e6);
  assert(uhd.width === 3840 && uhd.height === 2160, `4K: ${uhd.width}x${uhd.height}`);
  const wide = outputSize("1080p", 2520, 1080, 1, 4e6);
  assert(wide.width === 2520, "21:9 keeps its aspect (no stretched 16:9 frame)");
  assert(outputPixelRatio("2160p", 100, 100, 1, 4e6) === PIXEL_RATIO_MAX, "ratio clamped");
});

Deno.test("G01: auto keeps the budgeted device ratio (floor 1, cap 2)", () => {
  assert(outputPixelRatio("auto", 1440, 900, 2, 4e6) > 1.4 && outputPixelRatio("auto", 1440, 900, 2, 4e6) <= 2, "retina under budget");
  assert(outputPixelRatio("auto", 3840, 2160, 2, 4e6) === 1, "4K css at budget -> 1");
});

Deno.test("G02-G04/G09: presets climb monotonically and overrides force effects on/off", () => {
  const order = GRAPHICS_PRESETS.map((p) => RENDER_PRESETS[p]);
  for (let i = 1; i < order.length; i++) {
    assert(order[i].aoSamples >= order[i - 1].aoSamples, "AO samples climb");
    assert(order[i].shadowMapSize >= order[i - 1].shadowMapSize, "shadow map climbs");
    assert(order[i].polygonDetail > order[i - 1].polygonDetail, "polygon detail climbs");
    assert(order[i].ssrSteps >= order[i - 1].ssrSteps, "ray steps climb");
  }
  const low = resolveQuality("low", { ssao: "on", gi: "on", rayTracing: "on" });
  assert(low.post && low.aoSamples > 0 && low.gi && low.ssrSteps > 0 && low.contactSteps > 0, "forcing on enables the pipeline");
  const ultraOff = resolveQuality("ultra", { ssao: "off", gi: "off", rayTracing: "off" });
  assert(ultraOff.aoSamples === 0 && !ultraOff.gi && ultraOff.ssrSteps === 0 && ultraOff.contactSteps === 0, "forcing off zeroes");
  assert(!resolveQuality("low").post, "low draws straight to the canvas");
});

Deno.test("G09: dynamic resolution steps down under load, back up when idle, and never below the floor", () => {
  const s = createDynRes();
  for (let i = 0; i < 600; i++) stepDynRes(s, 33, 1 / 30);
  assert(s.scale <= DYNRES_MIN_SCALE + 1e-9, `floor under heavy load: ${s.scale}`);
  for (let i = 0; i < 1200; i++) stepDynRes(s, 6, 1 / 60);
  assert(Math.abs(s.scale - 1) < 1e-9, `recovers: ${s.scale}`);
  const t = createDynRes();
  for (let i = 0; i < 600; i++) stepDynRes(t, 15, 1 / 60);
  assert(t.scale === 1, "a frame inside the budget never lowers the scale");
});

function layer(id: CloudLayerState["id"], coverage: number, typeMix = 0, density = 1): CloudLayerState {
  return { id, altitudeM: 1000, coverage, density, typeMix, driftX: 3, driftZ: 1, darkness: 0 };
}

Deno.test("G14: coverage threshold is monotone and the drawn cover tracks the requested cover for every planar type", () => {
  for (let c = 0.05; c < 0.95; c += 0.05) assert(coverageThreshold(c + 0.05) < coverageThreshold(c), "more cover, lower threshold");
  const offsets = new Float64Array(8);
  const rows: string[] = [];
  const types: [CloudLayerState["id"], number, string][] = [["low", 0, "cumulus"], ["low", 1, "stratus"], ["mid", 0, "altocumulus"], ["mid", 1, "altostratus"], ["high", 0, "cirrus"], ["high", 1, "cirrocumulus"]];
  for (const [id, mix, name] of types) for (const want of [0.2, 0.5, 0.8]) {
    const ls = CLOUD_LAYERS.map((l) => layer(l, l === id ? want : 0, mix));
    const packed = packCloudLayers(ls, offsets);
    const li = CLOUD_LAYERS.indexOf(id);
    let covered = 0, n = 0;
    for (let i = 0; i < 90; i++) for (let j = 0; j < 90; j++) {
      if (planeDensityAt(packed, li, i * 1.37 + 0.1, j * 1.41 + 0.2, 4) > 0.5) covered++;
      n++;
    }
    const got = covered / n;
    rows.push(`${name.padEnd(13)} want ${want} drawn ${got.toFixed(2)}`);
    assert(Math.abs(got - want) < 0.1, `${name} cover ${want}: drawn ${got.toFixed(2)}`);
  }
  console.log(rows.join("\n"));
});

Deno.test("G14: four layers x seven types: each layer blends its own pair, shapes stay in range", () => {
  assert(CLOUD_LAYERS.length === 4, "four layers");
  for (const id of CLOUD_LAYERS) for (const mix of [0, 0.5, 1]) {
    const s = layerShape(layer(id, 0.5, mix));
    for (const v of [s.billow, s.streak, s.cells, s.softness, s.thickness]) assert(v >= 0 && v <= 1, `${id} shape in 0..1`);
    assert(s.bands >= 2 && s.bands <= 4, "2..4 cel bands");
  }
  const cu = layerShape(layer("low", 0.5, 0)), st = layerShape(layer("low", 0.5, 1));
  assert(cu.billow > st.billow && st.scale > cu.scale, "cumulus heaps, stratus sheets");
  const packed = packCloudLayers([layer("low", 0.5), layer("mid", 0.5), layer("high", 0.5), layer("towering", 0.5)], new Float64Array(8));
  assert(packed.length === 4 * FLOATS_PER_LAYER, "packed size");
  assert(packed[15] === 1 && packed[3 * FLOATS_PER_LAYER + 15] === 1, "layers enabled");
});

Deno.test("G14: the sun is occluded only when a drawn cloud covers it; drift moves the field", () => {
  const off = new Float64Array(8);
  const clear = packCloudLayers([layer("low", 0), layer("mid", 0), layer("high", 0), layer("towering", 0)], off);
  assert(cloudOcclusionAt(clear, [0.3, 0.8, 0.5], 4) === 0, "no cloud, no occlusion");
  const overcast = packCloudLayers([layer("low", 1, 1), layer("mid", 0), layer("high", 0), layer("towering", 0)], off);
  assert(cloudOcclusionAt(overcast, [0.3, 0.8, 0.5], 4) > 0.5, "overcast occludes");
  assert(cloudOcclusionAt(overcast, [0.3, -0.2, 0.5], 4) === 0, "a set sun is never occluded");
  const ls = [layer("low", 0.5), layer("mid", 0.5), layer("high", 0.5), layer("towering", 0)];
  const before = packCloudLayers(ls, off)[4];
  advanceDrift(ls, off, 10);
  assert(packCloudLayers(ls, off)[4] !== before, "drift advances");
  assert(cloudFbm(1.3, 2.7, 4) === cloudFbm(1.3, 2.7, 4), "deterministic");
});

Deno.test("G15: sinusoidal -> looping -> straight is a monotone change of sharpness and spread", () => {
  const calm = seaShape({ agitation: 0.3, sinusoidality: 1, looping: 0, straightness: 0 });
  const loop = seaShape({ agitation: 0.6, sinusoidality: 0, looping: 1, straightness: 0 });
  const lull = seaShape({ agitation: 0.15, sinusoidality: 0.2, looping: 0.8, straightness: 0.3 });
  const storm = seaShape({ agitation: 1, sinusoidality: 0, looping: 0.6, straightness: 1 });
  assert(calm.sharpness < 0.2 && loop.sharpness > 0.9, `sine crests round, looping crests sharp: ${calm.sharpness} ${loop.sharpness}`);
  assert(loop.spread > calm.spread && storm.spread < calm.spread * 0.3, "crossing seas while looping, straight lines in the storm");
  assert(lull.energy < loop.energy && lull.energy < storm.energy, "the quiet before the storm");
  assert(storm.peakShare > calm.peakShare, "the storm piles energy into the long swell");
});

Deno.test("G15: reshape never moves wavelengths, frequencies or phases (no pops) and keeps the inversion a contraction", () => {
  const base = deriveWaves(1, 0.4, 77, { minWavelength: 2, segments: 128 });
  const live = deriveWaves(0.2, 0.4, 77, { minWavelength: 2, segments: 128 });
  for (const sea of [
    { agitation: 0, sinusoidality: 1, looping: 0, straightness: 0 },
    { agitation: 0.7, sinusoidality: 0, looping: 1, straightness: 0 },
    { agitation: 1, sinusoidality: 0, looping: 1, straightness: 1 },
  ]) {
    reshapeWaves(base, seaShape(sea), 0.9, live);
    const pb = wavePhasesAt(base, 12.5), pl = wavePhasesAt(live, 12.5);
    for (let i = 0; i < base.waves.length; i++) {
      assert(live.waves[i].wavelength === base.waves[i].wavelength && live.waves[i].omega === base.waves[i].omega, "spectrum fixed");
      assert(Math.abs(pb[i] - pl[i]) < 1e-12, "phases fixed");
    }
    let q = 0;
    for (const w of live.waves) q += w.sharpness * w.k * w.amplitude;
    assert(q < 1, `contraction ${q}`);
    if (sea.agitation === 0) assert(waveHeightAt(live, 3, 4, 2) === 0, "still water is flat");
  }
});

Deno.test("G02-G05: the post and cel shaders carry every effect they claim", () => {
  for (const k of ["AO_SAMPLES", "USE_GI", "CONTACT_STEPS"]) assert(EFFECTS_FRAGMENT.includes(k), k);
  assert(SSR_FRAGMENT.includes("SSR_STEPS") && SSR_FRAGMENT.includes("reflect("), "ray-marched reflections");
  for (const k of ["USE_INK", "cloudShadowAt", "uRain", "uLightning", "uSaturation", "colorspace_fragment"]) assert(COMPOSITE_FRAGMENT.includes(k), k);
  for (const k of ["celShadow", "unpackRGBAToDepth", "uSkyTint", "fwidth"]) assert(CEL_LIGHT_GLSL.includes(k), k);
});
