import { CLASS_WEAPON_PARAMS, generateClassWeapon, generateWeapon, METALS, weaponName, type MetalName, type WeaponType } from "../src/game/WeaponGen.ts";
import { CLASSES } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

Deno.test("every class generates a weapon with real parts and sane combat numbers", () => {
  for (const c of CLASSES) {
    const w = generateClassWeapon(c);
    assert(w.parts.length >= 2, `${c} weapon has only ${w.parts.length} parts`);
    assert(w.damage > 0 && w.cooldown > 0 && w.reach > 0, `${c} has a non-positive combat stat`);
    assert(w.weight >= 1 && w.weight <= 10, `${c} weight ${w.weight} out of range`);
    assert(w.name.length > 3, `${c} weapon has no name`);
    // Every part must carry a real colour, or the mesh renders black.
    for (const p of w.parts) {
      assert(/^#[0-9a-f]{6}$/i.test(p.color), `${c} part ${p.kind} colour ${p.color} is not a hex colour`);
      assert(p.h > 0, `${c} part ${p.kind} has no length`);
    }
  }
});

Deno.test("sharper cuts harder, heavier swings slower: the parameter effects hold", () => {
  const dull = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, sharpness: 0.2 });
  const keen = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, sharpness: 1.0 });
  assert(keen.damage > dull.damage, `sharpness must raise damage: ${dull.damage} -> ${keen.damage}`);
  const light = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, weight: 2 });
  const heavy = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, weight: 9 });
  assert(heavy.cooldown > light.cooldown, "heavier must be slower");
  assert(heavy.knockback > light.knockback, "heavier must hit harder");
  // Inverse: a tip-heavy weapon reaches further than a hilt-heavy one.
  const hilt = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, balance: 0.05 });
  const tip = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, balance: 0.95 });
  assert(tip.reach > hilt.reach, "tip-heavy must reach further");
});

Deno.test("metal changes the look and the heft, never the part structure", () => {
  const metals: MetalName[] = ["steel", "iron", "bronze", "gold", "silver", "obsidian"];
  const shapes = metals.map((m) => generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, metal: m }));
  for (const w of shapes) {
    assert(w.parts.length === shapes[0].parts.length, "metal must not change the part count");
    assert(w.parts.every((p, i) => p.kind === shapes[0].parts[i].kind), "metal must not change part kinds");
  }
  // Colours must actually differ between metals, or the material system is decorative.
  const blades = shapes.map((w) => w.parts.find((p) => p.kind === "blade")!.color);
  assert(new Set(blades).size === metals.length, `expected ${metals.length} distinct blade colours, got ${new Set(blades).size}`);
  // And the heft differs: gold is heavy, silver is light.
  const gold = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, metal: "gold" });
  const silver = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, metal: "silver" });
  assert(gold.weight > silver.weight, `gold ${gold.weight} should out-weigh silver ${silver.weight}`);
  assert(METALS.gold.blade !== METALS.steel.blade, "gold and steel must not share a colour");
});

Deno.test("the curve parameter bends the blade and lengthens the name", () => {
  const straight = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, curve: 0 });
  const curved = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, curve: 1 });
  const straightBend = Math.abs(straight.parts.find((p) => p.kind === "blade")!.bend);
  const curvedBend = Math.abs(curved.parts.find((p) => p.kind === "blade")!.bend);
  assert(curvedBend >= straightBend, "curve must bend the blade");
  assert(curved.name.includes("Curved"), `expected "Curved" in "${curved.name}"`);
  assert(!straight.name.includes("Curved"), `unexpected "Curved" in "${straight.name}"`);
});

Deno.test("length scales the weapon and the name calls it out", () => {
  const short = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, length: 0.7 });
  const great = generateWeapon({ ...CLASS_WEAPON_PARAMS.Warrior, length: 1.5 });
  assert(great.reach > short.reach, "a longer weapon must reach further");
  assert(great.name.includes("Great"), `expected "Great" in "${great.name}"`);
  assert(short.name.includes("Short"), `expected "Short" in "${short.name}"`);
});

Deno.test("every weapon type produces a coherent part set", () => {
  const types: WeaponType[] = ["axe", "sword", "dagger", "staff", "scythe", "bow", "mace"];
  for (const t of types) {
    const w = generateWeapon({ type: t, weight: 5, balance: 0.5, sharpness: 0.6, length: 1, curve: 0.4, metal: "steel", fitting: "bronze", grip: "#5a3b22" });
    assert(w.parts.length > 0, `${t} produced no parts`);
    const kinds = new Set(w.parts.map((p) => p.kind));
    if (t === "sword" || t === "dagger") {
      assert(kinds.has("blade") && kinds.has("guard") && kinds.has("pommel"), `${t} missing blade furniture`);
    }
    if (t === "axe" || t === "mace" || t === "staff") assert(kinds.has("head"), `${t} missing a head`);
    if (t === "bow") assert(kinds.has("limb") && kinds.has("string"), "bow missing limbs or string");
    if (t === "scythe") assert(kinds.has("blade"), "scythe missing its blade");
    // No part may sit behind the grip, except a pommel or a bow's lower limb.
    for (const p of w.parts) if (p.kind !== "pommel" && p.kind !== "limb") assert(p.y > -0.2, `${t} part ${p.kind} sits behind the grip at y=${p.y}`);
  }
});

Deno.test("mace flanges are placed radially, evenly, and the bow curves both ways", () => {
  const mace = generateWeapon({ type: "mace", weight: 6, balance: 0.6, sharpness: 0.5, length: 1, curve: 0, metal: "gold", fitting: "gold", grip: "#4a3a20" });
  const flanges = mace.parts.filter((p) => p.radial !== undefined);
  assert(flanges.length === 6, `expected 6 flanges, got ${flanges.length}`);
  const angles = flanges.map((f) => f.radial!).sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++) assert(near(angles[i] - angles[i - 1], Math.PI / 3, 1e-9), "flanges not evenly spaced");
  const bow = generateWeapon({ type: "bow", weight: 3, balance: 0.4, sharpness: 0.4, length: 1, curve: 0.5, metal: "bronze", fitting: "bronze", grip: "#5a3b22" });
  const limbs = bow.parts.filter((p) => p.kind === "limb");
  assert(limbs.length >= 2, "bow needs at least two limbs");
  // The arc comes from opposite TILTS: a same-side bend alone reads as a plank.
  assert(
    limbs.some((p) => (p.tilt ?? 0) > 0.2) && limbs.some((p) => (p.tilt ?? 0) < -0.2),
    "bow limbs must tilt in opposite directions to form an arc",
  );
  assert(bow.parts.some((p) => p.kind === "string"), "bow needs a string");
  assert(bow.parts.some((p) => p.kind === "head"), "bow needs a riser at the grip");
});

Deno.test("naming is driven by the parameters, and the class weapons do not collide", () => {
  // The name follows the BLADE metal, not the fittings.
  assert(weaponName({ ...CLASS_WEAPON_PARAMS.Warrior, metal: "gold" }).startsWith("Gilded"), "gold should read as Gilded");
  assert(weaponName({ ...CLASS_WEAPON_PARAMS.Assassin }).includes("Obsidian"), "the assassin's blade is obsidian");
  assert(weaponName({ ...CLASS_WEAPON_PARAMS.Necromancer }).includes("Iron"), "the necromancer's blade is iron");
  const names = new Set(CLASSES.map((c) => generateClassWeapon(c).name));
  assert(names.size === CLASSES.length, `class weapons collide on names: ${[...names].join(", ")}`);
});
