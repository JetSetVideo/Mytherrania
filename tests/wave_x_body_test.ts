// Wave X lane B: the body + viewer pins (SPEC X50-X59). Relationships and measured bands, not literals.
//   NO_COLOR=1 deno test -A tests/wave_x_body_test.ts
import { FAT_BELLY_AMOUNT, FAT_BELLY_CHANCE, fatBellyFor, randomSilhouette, rollFatBelly } from "../src/game/BodyProfile.ts";
import { seededRng } from "../src/game/Items.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { meshPlan, skinField } from "../src/graphics/body/BodyMesh.ts";
import { measurePhysique, shoulderProfile } from "../src/graphics/body/Physique.ts";
import { meshStats } from "../src/graphics/body/MeshStats.ts";
import type { BodySpec } from "../src/graphics/body/contracts.ts";
import { BODY_DETAIL_GAIN, CEL_SKINNED_SHADERS, createCelSkinnedSurfaceMaterial } from "../src/graphics/shaders/CelSkinned.ts";
import {
  CONTACT_SHADOW, PEDESTAL_FRAME_PER_RADIUS, PEDESTAL_RADIUS, PREVIEW_KEY_DIR, pedestalStonePixels, previewFraming,
} from "../src/graphics/PreviewScene.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
// @deno-types="@types/three"
import type * as THREE from "three";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }

const SPECS: Record<string, BodySpec> = {
  human: { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 },
  elf: { race: "elf", subrace: "wood", className: "Warrior", height: 1.77, weight: 60, seed: 7 },
  dwarf: { race: "dwarf", subrace: "mountain", className: "Warrior", height: 1.39, weight: 70, seed: 7 },
  ork: { race: "ork", subrace: "ironhide", className: "Warrior", height: 1.95, weight: 120, seed: 7 },
};
const mm = (m: number) => (m * 1000).toFixed(1);

Deno.test("SPEC X50: a fat belly is RARE, dwarves > orks > humans > elves (2000 seeded rolls per race), elves never", () => {
  const N = 2000, rate: Record<string, number> = {};
  for (const race of ["dwarf", "ork", "human", "elf"]) {
    let hits = 0;
    for (let i = 0; i < N; i++) if (fatBellyFor(1000 + i * 7919, race) > 0) hits++;
    rate[race] = hits / N;
  }
  console.log(`fat belly frequency over ${N} seeds: ${Object.entries(rate).map(([r, f]) => `${r} ${(100 * f).toFixed(2)} %`).join(", ")}`);
  assert(rate.dwarf > rate.ork && rate.ork > rate.human && rate.human > rate.elf, `order ${JSON.stringify(rate)}`);
  assert(rate.elf === 0, `elves never: ${rate.elf}`);
  // Each measured rate within ~3.5 sd of its stated chance (binomial sd = sqrt(p(1-p)/N)).
  for (const race of ["dwarf", "ork", "human"]) {
    const p = FAT_BELLY_CHANCE[race], sd = Math.sqrt((p * (1 - p)) / N);
    assert(Math.abs(rate[race] - p) < 3.5 * sd, `${race}: ${rate[race]} vs ${p} ± ${(3.5 * sd).toFixed(4)}`);
    assert(rate[race] <= 0.15, `${race}: a fat belly must stay rare (${rate[race]})`);
  }
});

Deno.test("SPEC X51: the belly roll is its own stream — two draws, deterministic, and randomSilhouette is untouched", () => {
  let draws = 0;
  const rng = () => { draws++; return 0.01; };
  const a = rollFatBelly(rng, "dwarf");
  assert(draws === 2, `two draws always (got ${draws})`);
  assert(a >= FAT_BELLY_AMOUNT[0] && a <= FAT_BELLY_AMOUNT[1], `amount ${a}`);
  draws = 0;
  assert(rollFatBelly(rng, "elf") === 0 && draws === 2, "an elf draws the same two values and never wears one");
  for (const seed of [1, 7, 42, 99991]) assert(fatBellyFor(seed, "ork") === fatBellyFor(seed, "ork"), `seed ${seed} not deterministic`);
  // The silhouette roll does not see the belly stream (same draws as before the wave).
  const s1 = randomSilhouette(seededRng(7 ^ 0x2545f491), "dwarf", null), s2 = randomSilhouette(seededRng(7 ^ 0x2545f491), "dwarf", null);
  assert(JSON.stringify(s1) === JSON.stringify(s2) && !("belly" in s1), "randomSilhouette is unchanged and carries no belly key");
});

Deno.test("SPEC X52: the viewer frames by the PEDESTAL — one radius, one distance for every model under the frame top", () => {
  assert(PEDESTAL_RADIUS > 0.4 && PEDESTAL_RADIUS < 1, `radius ${PEDESTAL_RADIUS}`);
  const top = PEDESTAL_FRAME_PER_RADIUS * PEDESTAL_RADIUS;
  const base = previewFraming(1.35);
  for (const h of [0.6, 1.35, 1.7, 2.0, 2.36, top - 1e-6]) {
    const f = previewFraming(h);
    assert(f.distance === base.distance && f.targetY === base.targetY && !f.clipped, `height ${h}: distance ${f.distance} vs ${base.distance}`);
  }
  // The distance is a function of the radius (and the fov): a bigger base frames from farther.
  assert(previewFraming(1.7, 360 / 440, 38, PEDESTAL_RADIUS * 1.2).distance > base.distance, "distance grows with the radius");
  // The clip rule fires only above the frame top and only ever pulls the camera back.
  const giant = previewFraming(top + 0.3);
  assert(giant.clipped && giant.distance > base.distance, "a model above the frame top is framed by its height");
  // A narrow canvas keeps the base's width in frame (same for every model).
  assert(previewFraming(1.35, 0.4).distance === previewFraming(2.2, 0.4).distance && previewFraming(1.35, 0.4).distance > base.distance, "narrow canvas rule");
  console.log(`pedestal R ${PEDESTAL_RADIUS} m, frame top ${top.toFixed(2)} m, distance ${base.distance.toFixed(3)} m, target y ${base.targetY.toFixed(3)} m`);
});

Deno.test("SPEC X53: the key light is overhead (slightly front), the contact shadow is a real darkening, the stone is mid-dark", () => {
  const [x, y, z] = PREVIEW_KEY_DIR, n = Math.hypot(x, y, z);
  const elev = Math.asin(y / n) * 180 / Math.PI;
  console.log(`key elevation ${elev.toFixed(1)} deg (front component ${(z / n).toFixed(3)})`);
  assert(elev > 70 && z > 0, `key elevation ${elev}`);
  assert(CONTACT_SHADOW.strength >= 0.4 && CONTACT_SHADOW.strength < 1 && CONTACT_SHADOW.sigma < PEDESTAL_RADIUS * 0.6, "contact blob under the feet, not over the whole base");
  const px = pedestalStonePixels(64), px2 = pedestalStonePixels(64);
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i + 1];
  const mean = sum / (px.length / 4) / 255;
  assert(px.every((v, i) => v === px2[i]), "the stone is deterministic");
  assert(mean > 0.2 && mean < 0.55, `stone mean green ${mean.toFixed(3)} (mid-dark: never out-shines the fighter)`);
});

Deno.test("SPEC X54: deltoid caps stand ABOVE the clavicle line with a valley between (skin field and built mesh), every race", () => {
  for (const [race, spec] of Object.entries(SPECS)) {
    const after = anatomyFor(spec), before = anatomyFor(spec, { physique: false });
    const prof = (plan: typeof after) => { const f = skinField(plan), s = { d: 0, region: 0, bone: 0 }; return shoulderProfile((x, y, z) => f.sample(x, y, z, s).d, plan.proportions); };
    const pa = prof(after), pb = prof(before);
    const ma = measurePhysique(meshPlan(after).mesh, after.proportions);
    console.log(`${race}: field apex - clavicle ${mm(pb.apexY - pb.clavicleY)} -> ${mm(pa.apexY - pa.clavicleY)} mm, valley ${mm(pb.valleyDepth)} -> ${mm(pa.valleyDepth)} mm; mesh apex - clavicle ${mm(ma.deltoidApexY - ma.clavicleY)} mm, mesh valley ${mm(ma.valleyDepth)} mm`);
    assert(pa.apexY - pa.clavicleY >= 0.008, `${race}: the deltoid apex only ${mm(pa.apexY - pa.clavicleY)} mm above the clavicle line`);
    assert(pa.valleyDepth >= 0.008, `${race}: valley ${mm(pa.valleyDepth)} mm`);
    assert(pa.apexY - pa.clavicleY > pb.apexY - pb.clavicleY, `${race}: the cap rose`);
    assert(ma.deltoidApexY > ma.clavicleY, `${race}: on the built mesh the cap is above the clavicle shelf`);
  }
});

Deno.test("SPEC X55: slimmer — the waist tape drops >= 8 % on every race and sex, the race order of the waists survives", () => {
  const waist: Record<string, number> = {};
  for (const [race, spec] of Object.entries(SPECS)) {
    for (const sex of ["male", "female"] as const) {
      const s = { ...spec, sex };
      const a = measurePhysique(meshPlan(anatomyFor(s)).mesh, anatomyFor(s).proportions);
      const b = measurePhysique(meshPlan(anatomyFor(s, { physique: false })).mesh, anatomyFor(s).proportions);
      const ch = a.waistCircumference / b.waistCircumference - 1;
      console.log(`${race}/${sex}: waist ${mm(b.waistCircumference)} -> ${mm(a.waistCircumference)} mm (${(100 * ch).toFixed(1)} %), shoulder ${mm(b.shoulderWidth)} -> ${mm(a.shoulderWidth)} mm`);
      assert(ch <= -0.08, `${race}/${sex}: waist change ${(100 * ch).toFixed(1)} %`);
      assert(a.shoulderWidth >= b.shoulderWidth - 0.002, `${race}/${sex}: the shoulders were not narrowed`);
      if (sex === "male") waist[race] = a.waistCircumference;
    }
  }
  assert(waist.ork > waist.dwarf && waist.dwarf > waist.human && waist.human > waist.elf, `race order ${JSON.stringify(waist)}`);
});

Deno.test("SPEC X56: the male crotch bulge stands clearly proud of its neighbours; the female has none", () => {
  for (const [race, spec] of Object.entries(SPECS)) {
    const male = anatomyFor({ ...spec, sex: "male" }), female = anatomyFor({ ...spec, sex: "female" });
    const noBulge = anatomyFor({ ...spec, sex: "male" }, { physique: { bulge: false } });
    const m = measurePhysique(meshPlan(male).mesh, male.proportions), n0 = measurePhysique(meshPlan(noBulge).mesh, male.proportions);
    console.log(`${race}: bulge +${mm(m.crotchZ - n0.crotchZ)} mm over the same body without it; ${mm(m.crotchVsBelly)} mm ahead of the lower belly, ${mm(m.crotchVsThigh)} mm ahead of the inner thighs`);
    assert(male.physique?.bulge === true && female.physique?.bulge === false, `${race}: bulge male only`);
    assert(m.crotchZ - n0.crotchZ >= 0.02, `${race}: the bulge adds only ${mm(m.crotchZ - n0.crotchZ)} mm`);
    assert(m.crotchVsBelly > 0.003 && m.crotchVsThigh > 0.01, `${race}: not proud of its neighbours (${mm(m.crotchVsBelly)} / ${mm(m.crotchVsThigh)} mm)`);
  }
});

Deno.test("SPEC X57: the physique is RENDER-ONLY — the physics tree and its box are byte-identical with and without it", () => {
  for (const [race, spec] of Object.entries(SPECS)) {
    for (const sex of ["male", "female"] as const) {
      const a = anatomyFor({ ...spec, sex }), b = anatomyFor({ ...spec, sex }, { physique: false });
      assert(JSON.stringify(a.root) === JSON.stringify(b.root), `${race}/${sex}: the physics tree moved`);
      assert(JSON.stringify(a.bounds) === JSON.stringify(b.bounds) && JSON.stringify(a.bones) === JSON.stringify(b.bones), `${race}/${sex}: bounds/bones moved`);
      assert(a.armAbduction === b.armAbduction && a.legAbduction === b.legAbduction && a.cell === b.cell, `${race}/${sex}: a solve moved`);
      const st = meshPlan(a).mesh;
      assert(st.positions.length > 0, "skin builds");
    }
  }
});

Deno.test("SPEC X58: a rolled fat belly stands well in front of the flat belly and keeps the skin one closed piece", () => {
  for (const [race, spec] of Object.entries(SPECS)) {
    const flat = anatomyFor(spec, { physique: { belly: 0 } }), fat = anatomyFor(spec, { physique: { belly: 1 } });
    const mf = meshPlan(fat).mesh, a = measurePhysique(meshPlan(flat).mesh, flat.proportions), b = measurePhysique(mf, fat.proportions);
    const h = flat.proportions.head;
    console.log(`${race}: belly front ${mm(a.bellyZ)} -> fat ${mm(b.bellyZ)} mm (+${mm(b.bellyZ - a.bellyZ)}); abs band off on the fat belly: ${fat.physique?.abs.halfWidth === 0}`);
    assert(b.bellyZ - a.bellyZ > 0.15 * h, `${race}: a fat belly only ${mm(b.bellyZ - a.bellyZ)} mm proud`);
    assert(fat.physique?.abs.halfWidth === 0 && (flat.physique?.abs.halfWidth ?? 0) > 0, `${race}: the six-pack hides under a fat belly`);
    const st = meshStats(mf);
    assert(st.components === 1 && st.boundaryEdges === 0, `${race}: fat-belly skin ${st.components} components, ${st.boundaryEdges} boundary edges`);
  }
  // The default (no roll) belly never stands deeper than the chest: the pre-wave heavy build did (ork).
  const ork = anatomyFor({ ...SPECS.ork, belly: 0 }), orkPre = anatomyFor(SPECS.ork, { physique: false });
  const a = measurePhysique(meshPlan(ork).mesh, ork.proportions), b = measurePhysique(meshPlan(orkPre).mesh, orkPre.proportions);
  console.log(`ork default belly front ${mm(b.bellyZ)} -> ${mm(a.bellyZ)} mm`);
  assert(a.bellyZ < b.bellyZ - 0.02, "the ork's default belly is flatter than the pre-wave heavy belly");
});

Deno.test("SPEC X59: the sub-grid surface detail is wired — abs band from the plan, garment/trunk attribute, AA fades", () => {
  const frag = CEL_SKINNED_SHADERS.surfaceFragment;
  assert(frag.includes("#ifdef USE_BODY_DETAIL") && frag.includes("dFade(") && frag.includes("absRelief("), "detail chunk in the skinned fragment");
  assert(frag.includes("celShade(baseColor * vPaint,"), "the paint still multiplies the base colour before the shared lighting");
  const plain = createCelSkinnedSurfaceMaterial("#fff");
  assert(!("USE_BODY_DETAIL" in plain.defines), "detail is opt-in: other skinned meshes are unchanged");
  const spec = SPECS.human;
  const rig = buildSkinnedHumanoid(generateClassWeapon("Warrior"), { body: "#4f8490", accent: "#dfaa55", height: spec.height, weight: spec.weight, hair: "#172128", eyes: "#2f6fb5", race: "human", subrace: null }, "fire", spec);
  const mat = rig.skin.material as THREE.ShaderMaterial;
  const abs = mat.uniforms.uAbs.value as THREE.Vector4;
  assert("USE_BODY_DETAIL" in mat.defines, "the body material carries the detail");
  assert(abs.x > abs.y && abs.z > 0, `abs band ${abs.x}/${abs.y}/${abs.z}`);
  const surf = rig.skin.geometry.getAttribute("aSurface");
  let cloth = 0, trunk = 0;
  for (let i = 0; i < surf.count; i++) { cloth += surf.getX(i); trunk += surf.getY(i); }
  console.log(`aSurface: ${cloth} garment vertices, ${trunk} trunk vertices of ${surf.count}; gains ${JSON.stringify(BODY_DETAIL_GAIN)}`);
  assert(cloth > 0 && cloth < surf.count && trunk > 0, "garment and trunk masks present");
});
