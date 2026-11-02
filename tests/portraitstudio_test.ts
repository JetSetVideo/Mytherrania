// Lane O-A — PortraitStudio: one renderer, a cached PNG per profile, built through the SAME rig
// path the arena runs. No WebGL exists under `deno test`, so the studio is driven through an
// injected fake renderer here (the default THREE.WebGLRenderer needs a real browser); the rig
// build itself is pure geometry and runs for real.
// @deno-types="@types/three"
import * as THREE from "three";
import { PortraitStudio, type PortraitRenderer } from "../src/graphics/PortraitStudio.ts";
import { buildPreviewRig, previewKey } from "../src/graphics/PreviewScene.ts";
import { renderPortrait } from "../src/graphics/Portrait.ts";
import { CLASSES, type ClassName } from "../src/game/Stats.ts";
import { PRESETS, type CharacterProfile } from "../src/game/Characters.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

/** A deterministic stand-in for the offscreen renderer: its data URL is a function of the profile
 * key the studio tags the render root with, so a fresh render of one profile equals a cached one. */
class FakeRenderer implements PortraitRenderer {
  renders = 0;
  disposals = 0;
  sized = 0;
  lastKey = "";
  #size = 0;

  readonly domElement = { toDataURL: (): string => `data:image/png;base64,${encodeURIComponent(this.lastKey)}` };

  setSize(w: number): void {
    this.sized++;
    this.#size = w;
  }
  setPixelRatio(): void {}
  setClearColor(): void {}
  get size(): number {
    return this.#size;
  }
  render(scene: THREE.Scene): void {
    this.renders++;
    const root = scene.children.find((c) => c.userData?.portraitKey !== undefined);
    this.lastKey = String(root?.userData.portraitKey ?? "");
  }
  dispose(): void {
    this.disposals++;
  }
}

/** 12 DISTINCT profiles: varied name, class, race and height, each changing the build key. */
function twelveDistinct(): CharacterProfile[] {
  const races = ["human", "elf", "dwarf", "ork"];
  return Array.from({ length: 12 }, (_, i) => {
    const base = PRESETS[i % PRESETS.length];
    return {
      ...base,
      name: `Fighter ${i}`,
      className: CLASSES[i % CLASSES.length] as ClassName,
      race: races[i % races.length],
      subrace: null,
      appearance: { ...base.appearance, height: 1.5 + i * 0.03, weight: 55 + i * 3 },
    };
  });
}

const ACTUAL_CLASSES = CLASSES.length;

// ---------------------------------------------------------------- the shared rig builder

Deno.test("OA1: buildPreviewRig builds the skinned rig the arena builds, shared with PreviewScene", () => {
  assert(ACTUAL_CLASSES >= 8, "the class list is the game's real one");
  const profile = PRESETS[0];
  const { rig, fighter } = buildPreviewRig(profile);
  assert(rig.group.name === "skinned-humanoid", `the rig is the skinned humanoid (got ${rig.group.name})`);
  assert(rig.triangleCount > 1000, `a real rig has real triangles (got ${rig.triangleCount})`);
  assert(rig.skin !== undefined && rig.outline !== undefined, "the rig carries its skin and ink hull");
  assert(fighter.name === profile.name && fighter.className === profile.className, "the fighter matches the profile");
  assert(rig.bones.size > 10, `the skeleton has the full bone set (${rig.bones.size})`);
  // Deterministic: same profile, same rig shape.
  const again = buildPreviewRig(profile);
  assert(again.rig.triangleCount === rig.triangleCount, "the same profile builds the same rig");
});

Deno.test("OA2: previewKey is the build key both the studio and PreviewScene cache on", () => {
  const a = PRESETS[0];
  assert(previewKey(a) === previewKey({ ...a }), "an equal profile has the equal key");
  assert(previewKey(a) !== previewKey({ ...a, name: "Other" }), "a different name is a different key");
  assert(previewKey(a) !== previewKey({ ...a, appearance: { ...a.appearance, height: a.appearance.height + 0.1 } }), "a different height is a different key");
});

// ---------------------------------------------------------------- the studio: one renderer, a cache

Deno.test("OA3: one renderer behind every profile, and a second call is a cache HIT", () => {
  let factoryCalls = 0;
  const fake = new FakeRenderer();
  const studio = new PortraitStudio({ size: 256, createRenderer: () => (factoryCalls++, fake) });
  const profiles = twelveDistinct();
  const keys = new Set(profiles.map(previewKey));
  assert(keys.size === 12, `the 12 profiles are distinct by build key (${keys.size})`);

  const first = profiles.map((p) => studio.portraitOf(p));
  const afterFirst = studio.stats();
  console.log(`stats() after 12 distinct renders: ${JSON.stringify(afterFirst)}`);
  assert(afterFirst.renders === 12 && afterFirst.cacheHits === 0 && afterFirst.cached === 12,
    `12 renders, no hits, 12 cached (got ${JSON.stringify(afterFirst)})`);
  assert(factoryCalls === 1, `ONE renderer for all 12 (factory called ${factoryCalls} times)`);
  assert(first.every((u) => u.length > 0), "every portrait produced a data URL");
  assert(new Set(first).size === 12, "twelve distinct profiles give twelve distinct strings");

  const second = profiles.map((p) => studio.portraitOf(p));
  const afterSecond = studio.stats();
  console.log(`stats() after re-rendering the same 12: ${JSON.stringify(afterSecond)}`);
  assert(afterSecond.renders === 12 && afterSecond.cacheHits === 12 && afterSecond.cached === 12,
    `still 12 renders, now 12 hits (got ${JSON.stringify(afterSecond)})`);
  assert(fake.renders === 12, `the renderer drew 12 frames, not 24 (got ${fake.renders})`);
  assert(second.every((u, i) => u === first[i]), "the cached string is the identical string");
});

Deno.test("OA4: determinism survives a forget, and clear() re-renders everything", () => {
  const fake = new FakeRenderer();
  const studio = new PortraitStudio({ createRenderer: () => fake });
  const profiles = twelveDistinct();
  const before = profiles.map((p) => studio.portraitOf(p));
  const key = previewKey(profiles[3]);
  studio.forget(key);
  assert(studio.stats().cached === 11, "forget drops exactly one entry");
  const rerendered = studio.portraitOf(profiles[3]);
  assert(rerendered === before[3], "a fresh render of the same profile is the same string (deterministic)");
  assert(studio.stats().renders === 13 && studio.stats().cacheHits === 0, "and it counted as a render, not a hit");

  studio.clear();
  assert(studio.stats().cached === 0, "clear() empties the cache");
  profiles.forEach((p) => studio.portraitOf(p));
  assert(studio.stats().renders === 25 && studio.stats().cached === 12, "every profile re-renders after a clear");
});

// ---------------------------------------------------------------- survive the ugly inputs

Deno.test("OA5: an unknown race, a hostile size option, a throwing render and a double dispose all survive", () => {
  const fake = new FakeRenderer();
  const studio = new PortraitStudio({ createRenderer: () => fake });
  const unknownRace: CharacterProfile = { ...PRESETS[0], race: "nobody", subrace: "nowhere" };
  const url = studio.portraitOf(unknownRace);
  assert(typeof url === "string" && url.length > 0, "an unknown race still renders (falls back to a human build)");

  // Zero/negative/NaN/Infinity size: floored to a usable edge, never a thrown error.
  for (const size of [0, -10, NaN, Infinity]) {
    const s = new PortraitStudio({ size, createRenderer: () => fake });
    assert(typeof s.portraitOf(PRESETS[1]) === "string", `size ${size} does not throw`);
  }
  const floor = new PortraitStudio({ size: 0, createRenderer: () => fake });
  floor.portraitOf(PRESETS[2]);
  assert(fake.size >= 16, `a zero-size option is floored to a usable edge (got ${fake.size})`);

  // A renderer whose render() throws: empty string, cached, no re-throw on the second call.
  const boom = new FakeRenderer();
  boom.render = () => {
    throw new Error("no GL context");
  };
  const broken = new PortraitStudio({ createRenderer: () => boom });
  assert(broken.portraitOf(PRESETS[0]) === "", "a throwing render yields an empty string");
  assert(broken.portraitOf(PRESETS[0]) === "", "and the empty result is cached (second call still empty)");
  assert(broken.stats().renders === 1 && broken.stats().cacheHits === 1, "the throw happened once, then a cache hit");

  // dispose() twice is idempotent; the renderer is torn down exactly once; further calls are empty.
  const s = new PortraitStudio({ createRenderer: () => fake });
  s.portraitOf(PRESETS[0]);
  s.dispose();
  s.dispose();
  assert(fake.disposals === 1, `the renderer is disposed exactly once (got ${fake.disposals})`);
  assert(s.portraitOf(PRESETS[0]) === "", "a disposed studio renders nothing rather than throwing");
});

// ---------------------------------------------------------------- the sheet's delegation + house rules

Deno.test("OA6: Portrait, PreviewScene and PortraitStudio obey the house rules (text pins)", async () => {
  const portrait = await Deno.readTextFile(new URL("../src/graphics/Portrait.ts", import.meta.url));
  const preview = await Deno.readTextFile(new URL("../src/graphics/PreviewScene.ts", import.meta.url));
  const studio = await Deno.readTextFile(new URL("../src/graphics/PortraitStudio.ts", import.meta.url));

  // renderPortrait is a thin delegation to ONE module-level studio with an unchanged signature.
  // Wave Z (lane G): the module studio now passes options (a 3:4 PNG for the sheet's png-only <img>); the pin is the
  // delegation to ONE module-level studio, not the empty argument list.
  assert(/const STUDIO = new PortraitStudio\(/.test(portrait) && portrait.includes("portraitOf(profile)"),
    "renderPortrait delegates to a module-level studio");
  assert(/export function renderPortrait\(profile: CharacterProfile\): string/.test(portrait),
    "the export signature is unchanged");

  // PreviewScene's public behaviour is intact and it builds through the shared function.
  assert(preview.includes("export class PreviewScene"), "PreviewScene is still exported");
  assert(preview.includes("export function buildPreviewRig") && preview.includes("export function previewKey"),
    "the shared builder and key are exported");
  assert(preview.includes("const { rig, fighter } = buildPreviewRig(profile)"),
    "setProfile builds through buildPreviewRig");
  assert(preview.includes("PREVIEW_SPIN_RAD_S") && preview.includes("#render(0)"),
    "the build key, turntable and first render are untouched");

  // Framing is documented with units (requirement 6), and no file uses Math.random or `any`.
  assert(/metres, degrees|0\.82 m|1\.58 m/.test(studio), "the portrait framing is stated with units");
  for (const [name, src] of [["Portrait", portrait], ["PreviewScene", preview], ["PortraitStudio", studio]] as const) {
    assert(!/style="/.test(src), `${name}.ts writes no inline style attribute (the page CSP)`);
    assert(!/Math\.random/.test(src), `${name}.ts uses no Math.random`);
    assert(!/:\s*any\b/.test(src) && !/\bas any\b/.test(src), `${name}.ts uses no bare any`);
  }

  // The renderPortrait export at least answers without throwing when no GL context exists.
  assert(renderPortrait(PRESETS[0]) === "", "headless renderPortrait returns an empty string, not a throw");
});
