// Lane P-C: the body builds and the muscle. Three explicit builds (fit / bulky / heavy) with
// MEASURABLE silhouette differences, every ancestry mapped onto one, the lofted torso geometry
// carrying the anatomy (the muscle term scales the SDF masses), and the paint's definition pass
// following it. Every assertion here is a l(number a tool prints), not an adjective.
import {
  BUILDS, BUILD_FOR, buildFor, RACE_SILHOUETTE, SUBRACE_SILHOUETTE, type BuildType,
} from "../src/game/BodyProfile.ts";
import { buildMuscleTerm, proportionsFor } from "../src/graphics/body/Proportions.ts";
import { torsoNode } from "../src/graphics/body/AnatomyParts.ts";
import { compileSdf } from "../src/graphics/body/Sdf.ts";
import type { BodySpec, SdfSample } from "../src/graphics/body/contracts.ts";
import { DEFINITION_GAIN, definitionLayers } from "../src/graphics/paint/Definition.ts";
import { stackFor } from "../src/graphics/paint/Recipes.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
function approx(a: number, b: number, eps = 1e-9): boolean { return Math.abs(a - b) <= eps; }

const BUILD_TYPES: BuildType[] = ["fit", "bulky", "heavy"];
const TERMS = ["shoulder", "chest", "waist", "hip", "limb", "muscle", "fat"] as const;

/** A held spec: race/height/weight fixed, so a build override isolates the build. */
const HUMAN: BodySpec = { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 };

Deno.test("builds: three explicit rows, each ordered fit < bulky < heavy on every measured term", () => {
  const rows = BUILD_TYPES.map((b) => ({ b, r: BUILDS[b] }));
  console.log("build      shoulder  chest   waist   hip     limb    muscle  fat");
  for (const { b, r } of rows) {
    const f = (v: number) => v.toFixed(3).padStart(6);
    console.log(`${b.padEnd(9)} ${f(r.shoulder)} ${f(r.chest)} ${f(r.waist)} ${f(r.hip)} ${f(r.limb)} ${f(r.muscle)} ${f(r.fat)}`);
  }
  for (const k of TERMS) {
    const [fit, bulky, heavy] = BUILD_TYPES.map((b) => BUILDS[b][k]);
    // Non-decreasing fit -> bulky -> heavy, and strictly larger fit -> heavy (fat may equal the
    // neutral term at both fit and bulky: neither adds fat, only the heavy build does).
    assert(fit <= bulky && bulky <= heavy && fit < heavy, `${k}: fit ${fit} <= bulky ${bulky} <= heavy ${heavy}`);
  }
});

Deno.test("builds: every one of the 16 ancestry nodes maps onto a build, and the brief's pairings hold", () => {
  const nodes = [...Object.keys(RACE_SILHOUETTE), ...Object.keys(SUBRACE_SILHOUETTE)];
  assert(Object.keys(BUILD_FOR).length === nodes.length, `BUILD_FOR has ${Object.keys(BUILD_FOR).length} keys, expected ${nodes.length}`);
  for (const id of nodes) {
    assert(BUILD_TYPES.includes(BUILD_FOR[id]), `${id} -> ${BUILD_FOR[id]}`);
  }
  console.log("ancestry -> build:");
  console.log(nodes.map((id) => `${id}=${BUILD_FOR[id]}`).join("  "));
  // The brief: orks heavy, dwarves bulky, elves bulky with strong muscle, some humans heavy.
  assert(buildFor("ork", null) === "heavy", "ork heavy");
  assert(buildFor("dwarf", null) === "bulky" && buildFor("elf", null) === "bulky", "dwarf/elf bulky");
  const heavyHumans = ["islander"].filter((s) => buildFor("human", s) === "heavy");
  assert(heavyHumans.length > 0, "some humans (the islander) are heavy");
  assert(buildFor("elf", "high") === "fit" && buildFor("human", "imperial") === "fit", "the slim lines are fit");
  // An unknown ancestry falls back to the neutral build, never to undefined.
  assert(buildFor("unknown", null) === "bulky", "unknown -> bulky");
});

Deno.test("builds: the muscle term scales with the build (SDF mass), and a heavy body beats a fit one", () => {
  const sil = RACE_SILHOUETTE.human;
  const fit = buildMuscleTerm(sil, "fit"), bulky = buildMuscleTerm(sil, "bulky"), heavy = buildMuscleTerm(sil, "heavy");
  console.log(`human muscle term: fit ${fit.toFixed(4)}  bulky ${bulky.toFixed(4)}  heavy ${heavy.toFixed(4)}`);
  assert(fit < bulky && bulky < heavy, "muscle term ordered");
  assert(approx(bulky, 1), `bulky is the neutral reference (got ${bulky})`);
});

Deno.test("silhouette delta fit vs heavy (human): a named half-width at a named height, in metres", () => {
  const fit = proportionsFor(HUMAN, "fit");
  const heavy = proportionsFor(HUMAN, "heavy");
  const yNip = fit.y.nipple, yWaist = fit.y.waist;
  const rows: [string, number, number][] = [
    ["chest half-width @ nipple", fit.halfWidth.chest, heavy.halfWidth.chest],
    ["chest half-depth @ nipple", fit.halfDepth.chest, heavy.halfDepth.chest],
    ["waist half-width @ waist", fit.halfWidth.waist, heavy.halfWidth.waist],
    ["belly half-depth (fat)", fit.halfDepth.belly, heavy.halfDepth.belly],
    ["shoulder half-width", fit.halfWidth.shoulderJoint, heavy.halfWidth.shoulderJoint],
    ["deltoid radius", fit.radius.deltoid, heavy.radius.deltoid],
    ["thigh-top radius", fit.radius.thighTop, heavy.radius.thighTop],
  ];
  console.log(`human fit vs heavy (height ${HUMAN.height} m); nipple y ${yNip.toFixed(3)} m, waist y ${yWaist.toFixed(3)} m:`);
  for (const [name, f, h] of rows) console.log(`  ${name.padEnd(28)} fit ${f.toFixed(4)}  heavy ${h.toFixed(4)}  x${(h / f).toFixed(3)}`);
  for (const [name, f, h] of rows) assert(h > f * 1.03, `${name}: heavy ${h} must exceed fit ${f} by >3%`);
  // The measured silhouette delta the report quotes (named radius at a named height).
  const dChest = heavy.halfWidth.chest - fit.halfWidth.chest;
  console.log(`DELTA: chest half-width @ y=${yNip.toFixed(3)} m  fit ${fit.halfWidth.chest.toFixed(4)} m -> heavy ${heavy.halfWidth.chest.toFixed(4)} m  (+${(dChest * 1000).toFixed(1)} mm, +${(100 * dChest / fit.halfWidth.chest).toFixed(1)}%)`);
  assert(dChest > 0, "the delta is a positive number, not an adjective");
});

/** The +z surface of an SDF along a ray at (x, y): bisection between an inside z and an outside z. */
function frontZ(node: ReturnType<typeof torsoNode>["node"], x: number, y: number, zOut: number): number {
  const f = compileSdf(node), s: SdfSample = { d: 0, region: 0, bone: 0 };
  let lo = 0, hi = zOut;
  assert(f.sample(x, y, lo, s).d < 0, "the ray starts inside the torso");
  assert(f.sample(x, y, hi, s).d > 0, "the ray ends outside the torso");
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (f.sample(x, y, mid, s).d < 0) lo = mid; else hi = mid; }
  return lo;
}

Deno.test("torso geometry carries the anatomy: the pectoral bulge at the nipple is deeper on a heavy body", () => {
  const fit = proportionsFor(HUMAN, "fit");
  const heavy = proportionsFor(HUMAN, "heavy");
  const zOut = 3 * heavy.halfDepth.chest;
  // Probe the pectoral mass: its centre sits at x = +0.3 h, y = nipple + 0.12 h.
  const probes: [string, number, number][] = [
    ["centre-line @ nipple", 0, fit.y.nipple],
    ["pectoral @ nipple+0.12h", 0.3 * fit.head, fit.y.nipple + 0.12 * fit.head],
  ];
  console.log("torso front surface (+z), fit vs heavy:");
  for (const [name, x, y] of probes) {
    const zf = frontZ(torsoNode(fit).node, x, y, zOut);
    const zh = frontZ(torsoNode(heavy).node, x, y, zOut);
    console.log(`  ${name.padEnd(26)} y ${y.toFixed(3)} m  fit ${zf.toFixed(4)} m  heavy ${zh.toFixed(4)} m  (+${((zh - zf) * 1000).toFixed(1)} mm)`);
    assert(zh > zf + 0.002, `${name}: the heavy torso surface must protrude by >2 mm (got ${((zh - zf) * 1000).toFixed(2)} mm)`);
  }
});

Deno.test("paint definition pass follows the muscle term: a heavy body's stack carries creases, a fit one's does not", () => {
  const sil = RACE_SILHOUETTE.human;
  const input = (b: BuildType) => ({ muscle: buildMuscleTerm(sil, b), fat: BUILDS[b].fat, skin: "#c88858", minFeature: 0.05, height: 1.7, seed: 7 });
  const fit = definitionLayers(input("fit"));
  const heavy = definitionLayers(input("heavy"));
  console.log(`definition layers: fit ${fit.length}, heavy ${heavy.length} (${heavy.map((l) => l.name).join(", ")})`);
  assert(fit.length === 0, "a build with no added muscle paints no definition");
  assert(heavy.length === 5, `heavy paints the five anatomy creases (got ${heavy.length})`);
  assert(heavy.every((l) => l.name.startsWith("def-")), "every crease is a def- layer");
  assert(heavy.every((l) => l.opacity > 0 && l.opacity <= 1), "opacity is in (0,1]");
  assert(heavy.every((l) => l.regions && l.regions.length > 0), "every crease is region-masked");
  assert(heavy.some((l) => l.regions!.includes("torso")) && heavy.some((l) => l.regions!.includes("upperArm")), "torso and arm creases");
  // Strength is monotone in the muscle term (plus a fat-softening), and deterministic per seed.
  const mid = definitionLayers({ ...input("heavy"), muscle: (buildMuscleTerm(sil, "heavy") + 1) / 2 });
  const total = (ls: ReturnType<typeof definitionLayers>) => ls.reduce((s, l) => s + l.opacity, 0);
  assert(total(heavy) > total(mid), `more muscle -> more crease (${total(heavy)} vs ${total(mid)})`);
  assert(JSON.stringify(definitionLayers(input("heavy"))) === JSON.stringify(heavy), "deterministic");
  // The recipe wires it in: a heavy ancestry's real stack contains the creases.
  const orkStack = stackFor({ race: "ork", seed: 7 });
  const names = orkStack.layers.map((l) => l.name);
  console.log(`ork stack crease layers: ${names.filter((n) => n.startsWith("def-")).join(", ")}`);
  assert(names.includes("def-abs") && names.includes("def-pec"), "the ork's painted stack carries the definition pass");
});

Deno.test("builds: the definition gain is what turns the muscle term into crease strength", () => {
  // At muscle 1.0 the strength is 0; the layer set appears exactly when the term exceeds 1.
  assert(definitionLayers({ muscle: 1.0, fat: 1, skin: "#c88858", minFeature: 0.05, height: 1.7, seed: 1 }).length === 0, "no crease at the neutral term");
  assert(DEFINITION_GAIN > 0 && definitionLayers({ muscle: 1.05, fat: 1, skin: "#c88858", minFeature: 0.05, height: 1.7, seed: 1 }).length === 5, "creases appear above the term");
});
