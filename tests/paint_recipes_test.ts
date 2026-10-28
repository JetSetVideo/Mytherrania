// Lane B paint: recipes are deterministic, characterful per race, use every pattern,
// and every race x subrace x birth sign (x class) stays inside the stated colour bounds.
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";
import { PRESETS } from "../src/game/Characters.ts";
import { RACES } from "../src/game/Races.ts";
import { CLASSES } from "../src/game/Stats.ts";
import type { PaintStack, PatternKind } from "../src/graphics/body/contracts.ts";
import { hexToHsl } from "../src/graphics/paint/Blend.ts";
import { paintVertices } from "../src/graphics/paint/Layers.ts";
import { mannequinMesh } from "../src/graphics/paint/Mannequin.ts";
import { buildPatternEnv, PATTERN_KINDS } from "../src/graphics/paint/Patterns.ts";
import {
  DEFAULT_VERTEX_SPACING, NYQUIST, type PaintSubject, skinToneFor, stackFor, subjectFromProfile,
} from "../src/graphics/paint/Recipes.ts";
import { CLASS_PAINT, SIGN_PAINT } from "../src/graphics/paint/RecipeData.ts";
import {
  insideBounds, relevanceReport, SKIN_BOUNDS, SKIN_MEDIAN_BOUNDS, SKIN_SPREAD, VERTEX_BOUNDS,
} from "../src/graphics/paint/Relevance.ts";
import { rng32 } from "../src/core/MathCore.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

const mesh = mannequinMesh(1.8, 24);
const env = buildPatternEnv(mesh);
const HEX = /^#[0-9a-f]{6}$/i;

/** Every (race, subrace | null, birth sign | null) combination, classes cycled through. */
function matrix(): PaintSubject[] {
  const out: PaintSubject[] = [];
  let n = 0;
  for (const race of RACES) {
    for (const subrace of [null, ...race.subspecies.map((s) => s.id)]) {
      for (const birthsign of [...BIRTHSIGNS.map((b) => b.id), null]) {
        out.push({ race: race.id, subrace, birthsign, className: CLASSES[n % CLASSES.length], accent: "#9b72cf", seed: 9000 + n });
        n++;
      }
    }
  }
  return out;
}

Deno.test("recipes: deterministic per seed; a new seed gives a new individual", () => {
  const s: PaintSubject = { race: "dwarf", subrace: "forge", birthsign: "flame", className: "Warrior", seed: 1234 };
  assert(JSON.stringify(stackFor(s)) === JSON.stringify(stackFor(s)), "same subject -> same stack");
  assert(JSON.stringify(stackFor(s)) !== JSON.stringify(stackFor({ ...s, seed: 1235 })), "seed varies the stack");
});

Deno.test("recipes: every layer is well-formed and no pattern is finer than the mesh can show", () => {
  const minFeature = NYQUIST * DEFAULT_VERTEX_SPACING;
  for (const subject of matrix()) {
    const stack = stackFor(subject);
    assert(stack.layers[0].pattern === "solid" && stack.layers[0].opacity === 1 && !stack.layers[0].regions, "an opaque skin coat first");
    for (const l of stack.layers) {
      assert(HEX.test(l.colour) && (!l.colour2 || HEX.test(l.colour2)), `${l.name}: hex colours`);
      assert(l.opacity > 0 && l.opacity <= 1, `${l.name}: opacity ${l.opacity}`);
      if (l.pattern !== "solid" && l.pattern !== "gradient") assert(l.scale >= minFeature - 1e-12, `${l.name}: scale ${l.scale} >= ${minFeature}`);
      for (const v of Object.values(l.params ?? {})) assert(Number.isFinite(v), `${l.name}: finite params`);
    }
  }
  const coarse = stackFor({ race: "ork", seed: 5, vertexSpacing: 0.05 });
  for (const l of coarse.layers) if (l.pattern !== "solid" && l.pattern !== "gradient") assert(l.scale >= 0.1 - 1e-12, `coarse mesh -> coarser ${l.name}`);
});

Deno.test("recipes: the base skin tone of every race/subrace/seed sits in SKIN_BOUNDS", () => {
  for (const race of RACES) for (const sub of [null, ...race.subspecies.map((s) => s.id)]) {
    for (let seed = 0; seed < 25; seed++) {
      const tone = skinToneFor(race.id, sub, 0, rng32(seed));
      assert(insideBounds(tone, SKIN_BOUNDS), `${race.id}/${sub} seed ${seed}: ${tone}`);
    }
  }
});

Deno.test("recipes: each race reads as itself", () => {
  const has = (st: PaintStack, name: string) => st.layers.some((l) => l.name === name);
  const avgL = (race: string) => {
    let sum = 0;
    for (let seed = 0; seed < 30; seed++) sum += hexToHsl(stackFor({ race, seed }).layers[0].colour).l;
    return sum / 30;
  };
  for (let seed = 0; seed < 10; seed++) {
    const ork = stackFor({ race: "ork", birthsign: "storm", seed });
    const h = hexToHsl(ork.layers[0].colour).h;
    assert(h > 0.17 && h < 0.4, `ork skin is green (hue ${h.toFixed(3)} turns)`);
    assert(has(ork, "mottling") && has(ork, "hide") && has(ork, "sign-warpaint"), "ork: mottling, hide scales, sign warpaint");
    const dwarf = stackFor({ race: "dwarf", birthsign: "storm", seed });
    assert(has(dwarf, "flush") && has(dwarf, "freckles"), "dwarf: ruddy flush and freckles");
    const elf = stackFor({ race: "elf", birthsign: "storm", seed });
    assert(has(elf, "veins") && has(elf, "sign-tattoo") && !has(elf, "hide"), "elf: veins, a sign tattoo, no hide");
    const human = stackFor({ race: "human", seed });
    assert(has(human, "mottling") && has(human, "countershade"), "human: mottling and countershading");
  }
  assert(avgL("elf") > avgL("human") && avgL("human") > avgL("ork"), "elves lighter than humans, humans lighter than orks");
});

Deno.test("recipes: the birth sign picks the mark; the class adds its accent", () => {
  const glyphs = new Set<number>(), motifs = new Set<number>();
  for (const sign of BIRTHSIGNS) {
    const tattoo = stackFor({ race: "human", subrace: "imperial", birthsign: sign.id, seed: 3 }).layers.find((l) => l.name === "sign-tattoo");
    const paint = stackFor({ race: "ork", birthsign: sign.id, seed: 3 }).layers.find((l) => l.name === "sign-warpaint");
    assert(tattoo && paint, `${sign.id}: a tattoo on the human, warpaint on the ork`);
    glyphs.add(tattoo.params!.symbol); motifs.add(paint.params!.motif);
    assert(SIGN_PAINT[sign.id], `${sign.id} has a paint entry`);
  }
  assert(glyphs.size === BIRTHSIGNS.length && motifs.size === BIRTHSIGNS.length, "six signs, six glyphs, six motifs");
  for (const cls of CLASSES) {
    assert(CLASS_PAINT[cls], `${cls} has an accent`);
    const st = stackFor({ race: "human", className: cls, seed: 4 });
    assert(st.layers.some((l) => l.name.startsWith("class-")), `${cls}: accent layer present`);
  }
});

Deno.test("recipes: every PatternKind is used by some recipe and visibly paints the mannequin", () => {
  const used = new Map<PatternKind, number>();
  for (const subject of matrix()) {
    const stack = stackFor(subject);
    for (const [i, l] of stack.layers.entries()) {
      if ((used.get(l.pattern) ?? 0) > 0) continue;
      const without = paintVertices(mesh, { layers: stack.layers.filter((_, j) => j !== i) }, { env });
      const withIt = paintVertices(mesh, stack, { env });
      let diff = 0;
      for (let k = 0; k < withIt.length; k++) if (Math.abs(withIt[k] - without[k]) > 1e-4) diff++;
      if (diff > 0) used.set(l.pattern, diff);
    }
  }
  for (const kind of PATTERN_KINDS) assert((used.get(kind) ?? 0) > 0, `${kind} used and visible (${used.get(kind) ?? 0} channels changed)`);
});

Deno.test(`recipes: race x subrace x birth sign x class stay relevant: vertex C <= ${VERTEX_BOUNDS.chroma[1]}, Y ${VERTEX_BOUNDS.luminance.join("..")}; skin median C ${SKIN_MEDIAN_BOUNDS.chroma.join("..")}, Y ${SKIN_MEDIAN_BOUNDS.luminance.join("..")}; spread ${SKIN_SPREAD.min}..${SKIN_SPREAD.max}`, () => {
  const failures: string[] = [];
  let worstSpread = 0, worstChroma = 0;
  for (const subject of matrix()) {
    const report = relevanceReport(mesh, paintVertices(mesh, stackFor(subject), { env }));
    worstSpread = Math.max(worstSpread, report.skinSpread); worstChroma = Math.max(worstChroma, report.maxChroma);
    if (report.violations.length) failures.push(`${subject.race}/${subject.subrace}/${subject.birthsign}/${subject.className}: ${report.violations.join("; ")}`);
  }
  // Every class on every race, too (the matrix only cycles them).
  for (const race of RACES) for (const cls of CLASSES) {
    const report = relevanceReport(mesh, paintVertices(mesh, stackFor({ race: race.id, className: cls, birthsign: "void", accent: "#00ff00", seed: 77 }), { env }));
    if (report.violations.length) failures.push(`${race.id}/${cls}: ${report.violations.join("; ")}`);
  }
  assert(failures.length === 0, `out of bounds:\n${failures.join("\n")}`);
  assert(worstSpread > SKIN_SPREAD.min && worstChroma > 0, "the measures are live");
});

Deno.test("recipes: saved characters paint, with the palette as an optional garment", () => {
  for (const profile of PRESETS) {
    const plain = stackFor(subjectFromProfile(profile));
    const dressed = stackFor(subjectFromProfile(profile, { garment: true }));
    assert(!plain.layers.some((l) => l.name === "garment"), "no garment unless asked");
    const garment = dressed.layers.find((l) => l.name === "garment");
    assert(garment && insideBounds(garment.colour, { chroma: [0, 0.45], luminance: [0.012, 0.62] }), "the palette garment is bounded");
    const report = relevanceReport(mesh, paintVertices(mesh, dressed, { env }), "linear", []);
    assert(report.maxChroma <= VERTEX_BOUNDS.chroma[1] && report.maxLuminance <= VERTEX_BOUNDS.luminance[1], `${profile.name}: dressed paint bounded`);
  }
});
