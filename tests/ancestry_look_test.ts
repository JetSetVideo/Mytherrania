// Lane H-B: the ancestry hierarchy made VISIBLE. Proves numerically — on the queryable report
// (graphics/Humanoid.ts `ancestryLook`) and on the live skinned rig — that every one of the 16
// ancestries builds a finite fighter with its ancestry's hair, brows, beard, tusks, ears, skull
// mass and skin creases, and that the ordering the brief asks for holds (ork tusks, elf thin long
// brows that run past the face, dwarf a full beard that leaves the mouth readable, elf never bald).
import { ancestryLook, type AncestryLookReport } from "../src/graphics/Humanoid.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { ANCESTRY, ancestryOf, RACE_IDS } from "../src/game/Ancestry.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import { beardModeFor, hairColourFor, hairFall, isBald } from "../src/graphics/body/Proportions.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(String(message)); }

/** Every race node (subrace null) and every subrace node (taken over its race). */
const PAIRS: [string, string | null][] = [];
for (const id of Object.keys(ANCESTRY)) {
  const n = ANCESTRY[id];
  PAIRS.push([n.race, n.parent === null ? null : n.id]);
}
const HEX = /^#[0-9a-f]{6}$/i;
const BEARD_MODES = ["none", "chin", "moustache-thin", "moustache", "full"];

Deno.test("all 16 ancestries build a finite rig: positive triangles, feet on the ground, full report", () => {
  assert(PAIRS.length === 16, `expected 16 ancestries, got ${PAIRS.length}`);
  for (const [race, sub] of PAIRS) {
    const r: AncestryLookReport = ancestryLook(race, sub, 7);
    const tag = `${race}/${sub ?? "-"}`;
    assert(r.finite, `${tag}: rig must be finite`);
    assert(Number.isFinite(r.triangleCount) && r.triangleCount > 0, `${tag}: triangleCount ${r.triangleCount}`);
    // The engine rides the rig origin 0.6 above the ground; the sole must not sink below it.
    assert(r.minY >= -0.02 && r.minY < 0.06, `${tag}: feet not on the ground (minY ${r.minY})`);
    assert(HEX.test(r.hairColour), `${tag}: hair colour ${r.hairColour}`);
    assert(HEX.test(r.creaseColour), `${tag}: crease colour ${r.creaseColour}`);
    assert(r.hairCurl >= 0 && r.hairCurl <= 1, `${tag}: curl ${r.hairCurl}`);
    assert(r.hairDensity >= 0 && r.hairDensity <= 1, `${tag}: density ${r.hairDensity}`);
    assert(r.creaseStrength > 0 && r.creaseStrength <= 1, `${tag}: creaseStrength ${r.creaseStrength}`);
    assert(r.creaseSites > 0, `${tag}: no crease bands`);
    assert(r.facePatches >= 0, `${tag}: bad face patch count`);
    assert(BEARD_MODES.includes(r.beardMode), `${tag}: beard mode ${r.beardMode}`);
    assert(r.tuskProtrusion >= 0, `${tag}: tusk protrusion ${r.tuskProtrusion}`);
    assert(r.earLengthM > 0, `${tag}: ear length ${r.earLengthM}`);
    assert(r.earPointed >= 0 && r.earPointed <= 1, `${tag}: ear pointed ${r.earPointed}`);
    assert(r.browLength > 0 && r.browThickness > 0 && r.browProminence >= 0, `${tag}: brow dims`);
    assert(r.browTipPastFace >= 0, `${tag}: brow tipPastFace`);
    assert(r.headMassMul > 0, `${tag}: head mass ${r.headMassMul}`);
    assert(r.secondaryMasses > 0, `${tag}: no secondary masses`);
  }
});

Deno.test("tusks: the ork grows exactly 2, every other ancestry none, sized by protrusion", () => {
  for (const [race, sub] of PAIRS) {
    const r = ancestryLook(race, sub, 1);
    if (race === "ork") assert(r.tuskCount === 2, `${race}/${sub}: ork tusks ${r.tuskCount}`);
    else assert(r.tuskCount === 0, `${race}/${sub}: only orks have tusks (got ${r.tuskCount})`);
  }
  const ork = ancestryLook("ork", null, 1);
  const elf = ancestryLook("elf", null, 1);
  assert(ork.tuskCount === 2 && ork.tuskProtrusion > 0, `ork tusks ${ork.tuskCount} protrusion ${ork.tuskProtrusion}`);
  assert(elf.tuskCount === 0 && elf.tuskProtrusion === 0, `elf must have no tusks`);
  // A deeper subrace protrusion reads larger (bloodfang > default).
  assert(ancestryLook("ork", "bloodfang", 1).tuskProtrusion > ork.tuskProtrusion, "bloodfang deeper tusks");
});

Deno.test("brows: the elf's are the longest-thin, tips run past the face; the others stay inside it", () => {
  const races = RACE_IDS.map((id) => ancestryLook(id, null, 1));
  const elf = races.find((r) => r.race === "elf")!;
  const human = races.find((r) => r.race === "human")!;
  // tipPastFace is the elf's max: its tip runs out past the face silhouette, the others do not.
  for (const r of races) if (r.race !== "elf") assert(r.browTipPastFace < elf.browTipPastFace, `${r.race} tipPastFace ${r.browTipPastFace} < elf ${elf.browTipPastFace}`);
  // elf brow is the THINNEST; the dwarf's is the thickest.
  assert(elf.browThickness === Math.min(...races.map((r) => r.browThickness)), "elf brow thinnest");
  const dwarf = races.find((r) => r.race === "dwarf")!;
  assert(dwarf.browThickness === Math.max(...races.map((r) => r.browThickness)), "dwarf brow thickest");
  assert(elf.browLength > human.browLength, "elf brow longer than human");
  // The skull radius is recoverable from the report (mouthY = -radius/2): the elf's tip passes it.
  const skullR = (r: AncestryLookReport) => -2 * r.mouthY;
  assert(elf.browOuterTipX > skullR(elf), `elf brow tip ${elf.browOuterTipX} must pass the skull radius ${skullR(elf)}`);
  for (const r of races) if (r.race !== "elf") assert(r.browOuterTipX <= skullR(r) + 1e-9, `${r.race} brow tip ${r.browOuterTipX} must stay inside the skull ${skullR(r)}`);
});

Deno.test("beards: dwarf always full and leaves the mouth visible; ork chin-only; elf thin moustache only", () => {
  const dwarf = ancestryLook("dwarf", null, 3);
  assert(dwarf.beardMode === "full", `dwarf beard mode ${dwarf.beardMode}`);
  assert(dwarf.beardCoverage < 1, `dwarf beard coverage ${dwarf.beardCoverage} must be < 1`);
  // A coverage < 1 beard's top edge sits AT the mouth line, so the mouth (just below) stays readable.
  assert(dwarf.beardTopY <= dwarf.mouthY + 1e-9, `dwarf beard top ${dwarf.beardTopY} must not bury the mouth ${dwarf.mouthY}`);
  // required = always, whatever the character flag says (report builds with no flag).
  const dwarfNode = ancestryOf("dwarf", null);
  assert(beardModeFor(dwarfNode, false) === "full", "dwarf beard is required");
  // ork chin-only, never a jaw-wrapping mass; elf thin bar only.
  assert(beardModeFor(ancestryOf("ork", null), false) === "none", "ork does not force a beard");
  assert(beardModeFor(ancestryOf("ork", null), true) === "chin", "ork beard is chin-only");
  assert(beardModeFor(ancestryOf("elf", null), true) === "moustache-thin", "elf beard is moustache-thin");
  // allowed === false is never.
  const denied = { ...ancestryOf("human", null), beard: { mode: "full" as const, coverage: 1, lengthMul: 1, required: false, allowed: false } };
  assert(beardModeFor(denied, true) === "none", "allowed=false never grows a beard");
});

Deno.test("bald draw: the elf is never bald across 200 seeds; the ork is bald for some", () => {
  const elf = ancestryOf("elf", null), ork = ancestryOf("ork", null);
  assert(elf.hair.baldChance === 0, "elf baldChance must be 0");
  let orkBald = 0;
  for (let s = 0; s < 200; s++) {
    assert(!isBald(elf, s), `elf must never be bald (seed ${s})`);
    // buildHumanoid/ancestryLook and this draw share one rule; the report agrees.
    if (isBald(ork, s)) orkBald++;
  }
  assert(orkBald > 0 && orkBald < 200, `ork should be bald for some seeds (got ${orkBald}/200)`);
  // A report flagged bald draws no hair mass but still reports the palette colour.
  const bald = [...Array(40).keys()].map((s) => ancestryLook("ork", null, s)).find((r) => r.bald)!;
  assert(!!bald && HEX.test(bald.hairColour), "a bald ork still reports a hair colour");
});

Deno.test("hair: curl widens and SHORTENS the fall; the colour is drawn from the ancestry palette", () => {
  const curly = hairFall(0.7, 0.5, 0.5, 0.18);
  const straight = hairFall(0.15, 0.5, 0.5, 0.18);
  assert(curly.drop < straight.drop, `curly fall drop ${curly.drop} must be shorter than straight ${straight.drop}`);
  assert(curly.topRadius > straight.topRadius, `curly fall ${curly.topRadius} must be wider than straight ${straight.topRadius}`);
  assert(curly.lobes > straight.lobes, "a curled fall has more lobes");
  // Colour is deterministic and drawn from the node's palette.
  const elf = ancestryOf("elf", null);
  assert(hairColourFor(elf, 5) === hairColourFor(elf, 5), "same seed, same colour");
  const seen = new Set([...Array(60).keys()].map((s) => hairColourFor(elf, s)));
  assert(seen.size > 1, "the palette spreads across seeds");
  for (const c of seen) assert(elf.hair.colors.includes(c), `${c} must come from the palette`);
  assert(ancestryLook("elf", null, 5).hairColour === hairColourFor(elf, 5), "the report uses the same draw");
  assert(ancestryLook("elf", null, 5).hairCurl === elf.hair.curl, "the report applies the ancestry's curl");
});

Deno.test("skull mass orders dwarf and ork heavier than elf and human", () => {
  const m = (id: string) => ancestryLook(id, null, 1).headMassMul;
  assert(m("dwarf") > m("human") && m("ork") > m("human"), "dwarf/ork skulls read heavier than human");
  assert(m("elf") <= m("human"), "elf skull is finer than human");
});

Deno.test("the live skinned rig stays under the 12 000-triangle budget for every ancestry", () => {
  const counts: string[] = [];
  for (const [race, sub] of PAIRS) {
    const a: Appearance = { body: "#c98a63", accent: "#6b4130", height: 1.7, weight: 70, hair: "#1a1a1a", eyes: "#2f6fb5", race, subrace: sub };
    const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), a, "fire", { race, subrace: sub, className: "Warrior", height: 1.7, weight: 70, seed: 7 });
    assert(rig.triangleCount > 0, `${race}/${sub}: live rig has no triangles`);
    assert(rig.triangleCount < 12000, `${race}/${sub}: live rig ${rig.triangleCount} over the 12 000 budget`);
    counts.push(`${race}/${sub ?? "-"}=${rig.triangleCount}`);
  }
  console.log("live skinned rig triangles:\n  " + counts.join("\n  "));
});
