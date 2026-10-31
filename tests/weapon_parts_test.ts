// Lane P-D: the bow's closed tip, the sword's junction and the per-weapon materials.
//
// The three claims of the lane, each with a NUMBER a test can check:
//   * the bow's limb tip is CLOSED around the string: the tip is a capped nock block whose bore
//     (channel) the string enters, so the string's end sits INSIDE the tip (beyond the limb end)
//     and the tip keeps `wall` m of solid material past the bore — no through-hole;
//   * the sword's guard/grip/blade junction is rebuilt with stated OVERLAPS in metres (no gap, no
//     interpenetration beyond the stated tolerance);
//   * the materials are per-weapon: metal blades metallic (low roughness, hard specular), a bow or
//     staff wood, from a stated table; the mesh carries the roughness and the cel material uses it.

import type { WeaponSpec } from "../src/combat/contracts.ts";
import { weaponFromSeed, weaponForm } from "../src/game/weapons/Generate.ts";
import {
  BOW_STRING_RADIUS, BOW_TIP, bowTip, generateClassWeapon, generateWeapon, JUNCTION, MATERIAL_KINDS,
  swordJunction, weaponMaterial, WEAPON_MATERIALS, type MaterialKind, type WeaponType,
} from "../src/game/WeaponGen.ts";
import { GRIP_WRAPS } from "../src/game/weapons/Form.ts";
import { MeshKit } from "../src/graphics/weapons/MeshKit.ts";
import { paletteOf, weaponKit } from "../src/graphics/weapons/WeaponModel.ts";
import { blade, bowLimb, haft, hiltJunction, HILT_OVERLAP } from "../src/graphics/weapons/WeaponParts.ts";
import { createWeaponCelMaterial, materialSpecular } from "../src/graphics/weapons/WeaponMaterial.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const TYPES: WeaponType[] = ["axe", "sword", "dagger", "staff", "scythe", "bow", "mace"];
const SEEDS = 40;
const seedOf = (i: number) => (i * 2246822519) >>> 0;

/** Raw vertex x/y/z of the triangles tagged with one part label. */
function partVerts(kit: MeshKit, part: string): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < kit.parts.length; t++) {
    if (kit.parts[t] !== part) continue;
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      out.push([kit.pos[o], kit.pos[o + 1], kit.pos[o + 2]]);
    }
  }
  return out;
}

// --- the bow's closed tip -----------------------------------------------------------------------

Deno.test("bow: the tip is a CLOSED cap around the string (pure BOW_TIP / bowTip numbers)", () => {
  const tip: [number, number, number] = [0.28, 0.45, 0];
  const t = bowTip(tip, tip);
  assert(t.wall > 0, `the tip has no solid material past the channel (wall ${t.wall}) -> a through-hole`);
  assert(t.depth > 0, `channel depth ${t.depth} must be positive`);
  assert(t.channelRadius > BOW_STRING_RADIUS, `channel ${t.channelRadius} must exceed the string radius ${BOW_STRING_RADIUS}`);
  // The nock (where the string/arrow is held) is INSIDE the channel, not on the tip face.
  const along = Math.hypot(t.nock[0] - tip[0], t.nock[1] - tip[1], t.nock[2] - tip[2]);
  assert(along > 0 && along <= t.depth + 1e-9, `nock is ${along.toFixed(4)} m along the tip, channel depth ${t.depth}`);
  assert(near(t.channelRadius, BOW_TIP.channelRadius) && t.wall === BOW_TIP.wall, "bowTip reports the stated BOW_TIP numbers");
});

Deno.test("bow: the drawn string is held INSIDE the closed tips (mesh numbers, 40 seeds)", () => {
  const rows: string[] = [];
  for (let i = 1; i <= SEEDS; i++) {
    const spec: WeaponSpec = weaponFromSeed("bow", seedOf(i));
    const half = spec.length / 2;
    const kit = weaponKit(spec);
    const sv = partVerts(kit, "string");
    assert(sv.length > 0, `bow seed ${i}: no string vertices`);
    const maxY = Math.max(...sv.map((v) => v[1]));
    const depth = BOW_TIP.length - BOW_TIP.wall;
    // The string end reaches PAST the limb end (y = half) and stays inside the cap: held, not proud.
    assert(maxY > half + 0.004, `bow seed ${i}: string end ${maxY.toFixed(4)} is not inside the tip cap (limb end ${half.toFixed(3)})`);
    assert(maxY < half + BOW_TIP.length, `bow seed ${i}: string end ${maxY.toFixed(4)} pokes past the cap`);
    const t = bowTip([0, half, 0], [0, 1, 0]);
    assert(t.channelRadius > BOW_STRING_RADIUS, "the string fits inside the channel (no cut-through)");
    assert(t.depth >= depth - 1e-9, "the channel is at least as deep as the nock offset");
    if (i <= 4) rows.push(`seed ${i} | limb end y ${half.toFixed(4)} | string end y ${maxY.toFixed(4)} | inside by ${(maxY - half).toFixed(4)} m`);
  }
  const t = bowTip([0, 0.45, 0], [0, 1, 0]);
  console.log(
    `bow tip (lane P-D): channel radius ${(t.channelRadius * 1000).toFixed(1)} mm, channel depth ${(t.depth * 1000).toFixed(1)} mm, ` +
      `wall past the channel ${(t.wall * 1000).toFixed(1)} mm (closed), string radius ${(BOW_STRING_RADIUS * 1000).toFixed(1)} mm\n` +
      `string radius ${BOW_STRING_RADIUS} < channel radius ${t.channelRadius} -> the string sits in the void bore, not the wall\n` +
      rows.join("\n"),
  );
});

// --- the sword's junction -----------------------------------------------------------------------

Deno.test("sword: the hilt junction is rebuilt with stated overlaps (no gap, no interpenetration)", () => {
  for (const type of ["sword", "dagger"] as const) {
    const j = swordJunction({
      type, gripLen: 0.24, gripR: 0.0225, guardSpan: type === "sword" ? 0.3 : 0.16,
      bladeW: type === "sword" ? 0.085 * 1.1 : 0.055 * 0.95,
      metalBlade: "#e3eaee", fittingBlade: "#c98a4b",
    });
    // Derive the overlaps back out of the PART BOXES, so the numbers are the geometry's, not a copy.
    const gripTop = j.grip.y + j.grip.h / 2, guardBottom = j.guard.y - j.guard.h / 2, guardTop = j.guard.y + j.guard.h / 2;
    const bladeBase = j.blade.y - 0; // blade.y is the BASE here (h is filled in by the caller)
    const pommelTop = j.pommel.y + j.pommel.h / 2;
    const gripGuard = gripTop - guardBottom;
    const guardBlade = guardTop - bladeBase;
    const pommelGrip = pommelTop - 0; // grip bottom is y = 0
    for (const [name, ov] of [["grip<->guard", gripGuard], ["guard<->blade", guardBlade], ["pommel<->grip", pommelGrip]] as const) {
      assert(ov >= -1e-9, `${type}: ${name} has a GAP of ${(-ov).toFixed(4)} m`);
      assert(ov <= JUNCTION.tolerance, `${type}: ${name} interpenetrates by ${ov.toFixed(4)} m > tolerance ${JUNCTION.tolerance}`);
    }
    assert(j.guard.w > j.blade.w * 1.5, `${type}: the guard (${j.guard.w} m) must span across the blade (${j.blade.w} m)`);
    assert(guardTop > j.grip.y, `${type}: the guard sits at the grip's top, not floating near its base`);
    assert(j.overlaps.gripGuard > 0 && j.overlaps.guardBlade > 0 && j.overlaps.pommelGrip > 0, `${type}: stated overlaps are positive`);
  }
});

Deno.test("sword: generateWeapon builds the junction and keeps the SPEC (reach/damage unchanged)", () => {
  // The junction replaced a guard that sat at y = 0.02 (near the grip BUILT base); the combat
  // numbers must not move, so pin them against the documented formulas.
  for (const type of ["sword", "dagger"] as const) {
    const params = generateClassWeapon(type === "sword" ? "Warrior" : "Rogue");
    const w = generateWeapon({ ...params.params, type });
    const kinds = new Set(w.parts.map((p) => p.kind));
    for (const k of ["shaft", "guard", "pommel", "blade"] as const) assert(kinds.has(k), `${type}: missing ${k}`);
    assert(w.parts.filter((p) => p.kind === "guard").length === 1, `${type}: exactly one guard`);
    const base = { sword: { d: 10, cd: 0.85, reach: 1.7 }, dagger: { d: 7, cd: 0.45, reach: 1.1 } }[type];
    const L = Math.min(1.6, Math.max(0.6, params.params.length));
    const expectedReach = base.reach * (0.82 + Math.min(1, Math.max(0, params.params.balance)) * 0.4) * (0.85 + L * 0.15);
    assert(near(w.reach, expectedReach, 1e-9), `${type}: reach changed (${w.reach} vs ${expectedReach})`);
    assert(w.damage === Math.round(base.d * (0.72 + params.params.sharpness * 0.55) * (0.85 + w.weight * 0.045)), `${type}: damage changed`);
  }
});

Deno.test("sword: the drawn hilt (WeaponParts) meets with a stated overlap (mesh geometry, blade archetypes)", () => {
  const rows: string[] = [];
  for (const id of ["dagger", "shortsword", "longsword", "sabre"] as const) {
    const spec = weaponFromSeed(id, 7);
    const form = weaponForm(spec);
    const j = hiltJunction(form);
    assert(near(j.overlaps.gripGuard, HILT_OVERLAP, 1e-9), `${id}: grip<->guard overlap ${j.overlaps.gripGuard} != ${HILT_OVERLAP}`);
    assert(j.overlaps.gripGuard > 0, `${id}: grip does not run through the guard`);
    assert(j.overlaps.guardBlade >= -1e-9, `${id}: guard<->blade has a gap of ${(-j.overlaps.guardBlade).toFixed(5)} m`);
    assert(near(j.guardBottom, form.guardY) && near(j.bladeBase, form.bladeBaseY), `${id}: junction sits at the form's guard/blade`);
    rows.push(`${id} | grip top ${j.gripTop.toFixed(4)} | guard ${j.guardBottom.toFixed(4)}..${j.guardTop.toFixed(4)} | blade base ${j.bladeBase.toFixed(4)} | overlaps g<->guard ${j.overlaps.gripGuard.toFixed(4)}, guard<->blade ${j.overlaps.guardBlade.toFixed(4)} m`);
  }
  console.log("drawn hilt junction (WeaponParts, metres)\n" + rows.join("\n"));
});

// --- the materials ------------------------------------------------------------------------------

Deno.test("materials: metal bl<->non-metal table, and the cel material's damping", () => {
  const kinds: MaterialKind[] = ["metal", "chitin", "bone", "stone", "wood"];
  for (const k of kinds) {
    const p = MATERIAL_KINDS[k];
    assert(p.kind === k && p.roughness >= 0 && p.roughness <= 1 && p.specular >= 0 && p.specular <= 1, `${k}: numbers out of range`);
  }
  assert(MATERIAL_KINDS.metal.metallic && !MATERIAL_KINDS.wood.metallic, "metal metallic, wood not");
  assert(MATERIAL_KINDS.metal.roughness < MATERIAL_KINDS.wood.roughness, "metal smoother than wood");
  assert(MATERIAL_KINDS.metal.specular > MATERIAL_KINDS.wood.specular, "metal specular harder than wood");
  // The shader damps the specular with roughness; metal must keep far more than wood.
  const metalEff = materialSpecular(MATERIAL_KINDS.metal.specular, MATERIAL_KINDS.metal.roughness);
  const woodEff = materialSpecular(MATERIAL_KINDS.wood.specular, MATERIAL_KINDS.wood.roughness);
  assert(metalEff > 0.6, `metal effective specular ${metalEff.toFixed(3)} should read hard`);
  assert(woodEff < 0.05, `wood effective specular ${woodEff.toFixed(3)} should read matte`);
  for (const t of TYPES) assert(weaponMaterial(t) === WEAPON_MATERIALS[t], `${t}: weaponMaterial disagrees with the table`);
  console.log(
    "material kinds (kind | metallic | roughness | specular | effective@cel)\n" +
      kinds.map((k) => {
        const p = MATERIAL_KINDS[k];
        return `${k} | ${p.metallic} | ${p.roughness.toFixed(2)} | ${p.specular.toFixed(2)} | ${materialSpecular(p.specular, p.roughness).toFixed(3)}`;
      }).join("\n") +
      "\nper-weapon (type | kind | metallic | roughness | specular)\n" +
      TYPES.map((t) => {
        const p = weaponMaterial(t);
        return `${t} | ${p.kind} | ${p.metallic} | ${p.roughness.toFixed(2)} | ${p.specular.toFixed(2)}`;
      }).join("\n"),
  );
});

Deno.test("materials: the mesh carries per-weapon roughness (metal blade vs wood limb)", () => {
  // A blade weapon's blade and a wood haft are drawn with their own roughness, so the shader can
  // tell a hard steel highlight from a matte stick.
  const sword = weaponFromSeed("longsword", 3);
  const form = weaponForm(sword);
  const pal = paletteOf(sword.metal, sword.fitting, form.details.wood, GRIP_WRAPS[0]);
  const metalR = MATERIAL_KINDS.metal.roughness, woodR = MATERIAL_KINDS.wood.roughness;

  const bk = new MeshKit();
  blade(bk, form, pal);
  assert(bk.triangleCount > 0, "the blade built");
  for (const r of bk.rough) assert(near(r, metalR, 1e-9), `blade roughness ${r} != metal ${metalR}`);

  const hk = new MeshKit();
  haft(hk, form, form.shaftTopY, [0], pal);
  assert(hk.triangleCount > 0, "the haft built");
  // The wood haft is drawn wood; only the small iron butt cap is metal.
  assert(near(hk.rough[0], woodR, 1e-9), `haft starts wood (roughness ${hk.rough[0]})`);
  for (const r of hk.rough) assert(near(r, woodR, 1e-9) || near(r, metalR, 1e-9), `haft roughness ${r} is neither wood nor the metal butt cap`);
  const woodShare = hk.rough.filter((r) => near(r, woodR, 1e-9)).length / hk.rough.length;
  assert(woodShare > 0.4, `only ${(woodShare * 100).toFixed(0)}% of the haft is wood`);
  assert(woodShare < 1, "the iron butt cap is metal (roughness differs from the wood)");

  const bowR = new MeshKit();
  bowLimb(bowR, 0.6, form.braceHeight, 0.5, 1, pal);
  assert(near(bowR.rough[0], woodR, 1e-9), `bow limb starts wood (roughness ${bowR.rough[0]})`);

  // Sanity: the roughness is a real buffer, not the same number everywhere.
  const geom = bowR.build();
  const attr = geom.getAttribute("aRoughness");
  assert(attr && attr.count === geom.getAttribute("position").count, "aRoughness present with one value per vertex");
  geom.dispose();
});

Deno.test("materials: the class weapons carry their material (Warrior steel, Archer wood)", () => {
  assert(generateClassWeapon("Warrior").material?.metallic === true, "a Warrior's sword is metal");
  assert(generateClassWeapon("Archer").material?.kind === "wood", "an Archer's bow is wood");
  for (const t of TYPES) {
    const w = generateWeapon({ type: t, weight: 5, balance: 0.5, sharpness: 0.6, length: 1, curve: 0.4, metal: "steel", fitting: "bronze", grip: "#5a3b22" });
    assert(w.material === WEAPON_MATERIALS[t], `${t}: generated weapon material`);
    // The colour contract of the existing generator still holds.
    assert(w.parts.every((p) => /^#[0-9a-f]{6}$/i.test(p.color)), `${t}: part colour`);
  }
});

Deno.test("materials: cel material declares aRoughness and damps the specular with it", () => {
  const m = createWeaponCelMaterial();
  assert(m.vertexShader.includes("attribute float aRoughness"), "the vertex shader reads aRoughness");
  assert(m.vertexShader.includes("varying float vRoughness"), "roughness is passed to the fragment");
  assert(m.fragmentShader.includes("vRoughness"), "the fragment shader uses roughness");
  assert(
    m.fragmentShader.includes(`clamp(vRoughness, 0.0, 1.0)`),
    "the fragment damps the specular with the clamped roughness",
  );
  m.dispose();
  // materialSpecular is the TS mirror of the GLSL; check the endpoints.
  assert(near(materialSpecular(1, 0), 1, 1e-9), "roughness 0 keeps the full specular");
  assert(materialSpecular(1, 1) < 0.2, "roughness 1 nearly kills the specular");
});
