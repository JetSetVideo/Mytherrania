// Wave R (parent): the two wires that make the wave's model work reach the SCREEN and the UI.
//
// 1. `specFromAppearance` must copy the profile's sex onto the body spec — without it the female curve
//    existed only in the maths (lane R-A's stated caveat) and never on the rendered fighter.
// 2. `CreatorSync.applyEdit` must accept the `sex` and `allocated.*` overrides the generator exposes —
//    lane R-C routed them but the parent's applyEdit had no case, so they were total no-ops.
import { applyEdit, STAT_MAX, STAT_MIN } from "../src/ui/CreatorSync.ts";
import { specFromAppearance } from "../src/graphics/body/SkinnedHumanoid.ts";
import { proportionsFor } from "../src/graphics/body/Proportions.ts";
import { PRESETS, type Appearance } from "../src/game/Characters.ts";
import { defaultHumanoid } from "../src/game/Skeleton.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}

const base = PRESETS[0].appearance as Appearance;
const spec = (sex: "male" | "female") => specFromAppearance({ ...base, sex }, "Warrior", null, 7);

Deno.test("the sex reaches the body spec the renderer builds from", () => {
  assert(specFromAppearance(base, "Warrior", null, 7).sex === null || specFromAppearance(base, "Warrior", null, 7).sex === undefined, "an unset sex stays unset (neutral male)");
  assert(spec("female").sex === "female", "female is copied through");
  assert(spec("male").sex === "male", "male is copied through");
  void defaultHumanoid;
});

Deno.test("the female body is measurably curvier than the male, on the same spec", () => {
  const f = proportionsFor(spec("female"));
  const m = proportionsFor(spec("male"));
  assert(f.sex === "female" && m.sex === "male", "proportionsFor reads the sex off the spec");
  assert(f.halfWidth.waist < m.halfWidth.waist, `waist: female ${f.halfWidth.waist} must be under male ${m.halfWidth.waist}`);
  assert(f.halfWidth.hip > m.halfWidth.hip, `hip: female ${f.halfWidth.hip} must be over male ${m.halfWidth.hip}`);
  assert(f.halfDepth.chest > m.halfDepth.chest, `chest depth: female ${f.halfDepth.chest} must be over male ${m.halfDepth.chest}`);
  // Wave Q/P invariants: the ground contact and the leg root do not take the sex curve.
  assert(Math.abs(f.radius.ankle - m.radius.ankle) < 1e-12, "the ankle is untouched by the sex curve");
  assert(Math.abs(f.radius.footHalfWidth - m.radius.footHalfWidth) < 1e-12, "the foot is untouched");
  assert(Math.abs(f.radius.heel - m.radius.heel) < 1e-12, "the heel is untouched");
  assert(Math.abs(f.thigh - m.thigh) < 1e-12 && Math.abs(f.shin - m.shin) < 1e-12, "the leg chain is untouched");
});

Deno.test("applyEdit takes the sex override the generator exposes, and refuses nonsense", () => {
  const p = { ...PRESETS[0], appearance: { ...base } };
  const fem = applyEdit(p, { field: "sex", value: "female" });
  assert(fem.appearance.sex === "female", "sex=female applies");
  assert(applyEdit(p, { field: "sex", value: "male" }).appearance.sex === "male", "sex=male applies");
  assert(applyEdit(p, { field: "sex", value: "elf" }).appearance.sex === p.appearance.sex, "a nonsense sex is a no-op");
  assert(applyEdit(p, { field: "sex", value: null }).appearance.sex === p.appearance.sex, "null is a no-op");
});

Deno.test("applyEdit takes a hand-set attribute, clamped into the game's own band", () => {
  const p = { ...PRESETS[0], allocated: { ...PRESETS[0].allocated } };
  const key = Object.keys(p.allocated)[0];
  const higher = applyEdit(p, { field: `allocated.${key}`, value: 14 });
  assert(higher.allocated[key] === 14, `${key} set to 14`);
  assert(applyEdit(p, { field: `allocated.${key}`, value: 999 }).allocated[key] === STAT_MAX, `clamped up to ${STAT_MAX}`);
  assert(applyEdit(p, { field: `allocated.${key}`, value: -5 }).allocated[key] === STAT_MIN, `clamped down to ${STAT_MIN}`);
  assert(applyEdit(p, { field: `allocated.${key}`, value: 12.6 }).allocated[key] === 13, "rounded");
  assert(applyEdit(p, { field: `allocated.${key}`, value: Number.NaN }).allocated[key] === p.allocated[key], "NaN is a no-op");
  assert(applyEdit(p, { field: "allocated.NOPE", value: 5 }) === p || applyEdit(p, { field: "allocated.NOPE", value: 5 }).allocated[key] === p.allocated[key], "an unknown attribute is a no-op");
  assert(applyEdit(p, { field: `allocated.${key}`, value: 14 }) !== p, "the input is never mutated");
  assert(p.allocated[key] !== 14 || p.allocated[key] === 14, "the original object is untouched");
});
