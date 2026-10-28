// Lane W2: weapon readability at gameplay distance. Encodes the silhouette and value rules of
// docs/overhaul/lane-W2.md: every archetype's distinguishing feature spans >= 6 px at 7 m in the
// third-person view, heads separate from hafts in value, blades taper to their point, the rapier
// is long with a swept (cup + knuckle bow) hilt, and the ink keeps a constant screen width up close.

import { ARCHETYPE_IDS, ARCHETYPES } from "../src/game/weapons/Archetypes.ts";
import { GRIP_WRAPS, WOODS, type WoodName } from "../src/game/weapons/Form.ts";
import { weaponForm, weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { METALS, type MetalName } from "../src/game/WeaponGen.ts";
import { createWeaponOutlineMaterial, INK_REF_DISTANCE } from "../src/graphics/weapons/WeaponMaterial.ts";
import {
  GAMEPLAY_VIEW, minFeatureSize, paletteOf, READABLE_PARTS, weaponKit,
} from "../src/graphics/weapons/WeaponModel.ts";
import { lookHalfWidth, RAPIER_CUP_RADIUS } from "../src/graphics/weapons/WeaponParts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok {
  if (!ok) throw new Error(m);
}
const SEEDS = 60;
const seedOf = (i: number) => (i * 2246822519) >>> 0;
const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Bounding box of the triangles tagged with one of `parts`, weapon-local metres. */
function partBox(kit: ReturnType<typeof weaponKit>, parts: readonly string[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < kit.parts.length; t++) {
    if (!parts.includes(kit.parts[t])) continue;
    for (let k = 0; k < 9; k++) {
      const a = k % 3, v = kit.pos[t * 9 + k];
      lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v);
    }
  }
  return { dx: hi[0] - lo[0], dy: hi[1] - lo[1], dz: hi[2] - lo[2], lo, hi };
}

Deno.test("readability: the minimum feature size follows from the gameplay camera (6 px at 7 m)", () => {
  const m = minFeatureSize();
  // 577 px over 2 * 7 m * tan(25 deg) = 6.53 m of view height: 88.4 px per metre.
  assert(Math.abs(m - 0.0679) < 5e-4, `min feature ${m.toFixed(4)} m`);
  assert(GAMEPLAY_VIEW.fovDeg === 50 && GAMEPLAY_VIEW.heightPx === 577, "the view the rules are written for");
});

Deno.test("readability: every archetype's distinguishing feature spans >= 6 px at 7 m (60 seeds each)", () => {
  const min = minFeatureSize();
  const rows: string[] = [];
  for (const id of ARCHETYPE_IDS) {
    let lo = Infinity, loAlong = Infinity;
    for (let i = 1; i <= SEEDS; i++) {
      const box = partBox(weaponKit(weaponFromSeed(id, seedOf(i))), READABLE_PARTS[id]);
      // Across = the larger of the two extents off the weapon axis; along = the extent on it.
      const across = Math.max(box.dx, box.dz);
      if (id === "staff") {
        assert(box.dy >= 1.6, `staff: the bare pole is its feature (${box.dy.toFixed(2)} m)`);
      } else {
        assert(across >= min && box.dy >= min, `${id} seed ${i}: feature ${across.toFixed(3)} x ${box.dy.toFixed(3)} m < ${min.toFixed(3)} m`);
      }
      lo = Math.min(lo, across); loAlong = Math.min(loAlong, box.dy);
    }
    rows.push(`${id} | ${READABLE_PARTS[id].join("+")} | ${(lo * 88.4).toFixed(1)} px | ${(loAlong * 88.4).toFixed(1)} px`);
  }
  console.log("archetype | feature parts | min across | min along  (px at 7 m, 577 px / 50 deg)\n" + rows.join("\n"));
});

Deno.test("readability: heads separate from hafts in value; the edge band is brighter than the flat", () => {
  const metals = Object.keys(METALS) as MetalName[];
  const woods = Object.keys(WOODS) as WoodName[];
  let worst = Infinity, worstEdge = Infinity;
  for (const m of metals) {
    for (const w of woods) {
      const pal = paletteOf(m, m, w, GRIP_WRAPS[0]);
      const head = lum(pal.flat), haft = lum(pal.wood);
      const ratio = Math.max(head, haft) / Math.min(head, haft);
      worst = Math.min(worst, ratio);
      assert(ratio >= 1.8, `${m} on ${w}: head/haft luminance ratio ${ratio.toFixed(2)} < 1.8`);
    }
    const pal = paletteOf(m, m, "ash", GRIP_WRAPS[0]);
    const edge = lum(pal.edge) / lum(pal.flat);
    worstEdge = Math.min(worstEdge, edge);
    assert(edge >= 1.4, `${m}: edge band only ${edge.toFixed(2)}x the flat`);
  }
  console.log(`value contrast: worst head/haft ratio ${worst.toFixed(2)}, worst edge/flat ${worstEdge.toFixed(2)}`);
});

Deno.test("readability: blades taper to their point and the drawn tip is the point feature", () => {
  for (const id of ARCHETYPE_IDS.filter((a) => ARCHETYPES[a].family === "blade")) {
    for (const seed of [1, 2, 3]) {
      const w = weaponFromSeed(id, seed), form = weaponForm(w);
      let w0 = 0;
      for (let k = 0; k <= 20; k++) w0 = Math.max(w0, lookHalfWidth(form, (k / 40) * form.bladeLength));
      const w90 = lookHalfWidth(form, 0.9 * form.bladeLength);
      assert(w90 <= 0.45 * w0, `${id}: half-width at 90% ${w90.toFixed(4)} vs widest ${w0.toFixed(4)} (not tapered)`);
      assert(lookHalfWidth(form, form.bladeLength) < 1e-9, `${id}: closes to a point`);
      const tip = w.features.find((f) => f.kind === "point")!.points[0];
      const kit = weaponKit(w);
      let best = Infinity;
      for (let i = 0; i < kit.pos.length; i += 3) best = Math.min(best, Math.hypot(kit.pos[i] - tip[0], kit.pos[i + 1] - tip[1], kit.pos[i + 2] - tip[2]));
      assert(best < 1e-6, `${id}: a mesh vertex sits on the point feature (${best})`);
    }
  }
});

Deno.test("readability: the rapier is long (0.95-1.1 m blade) with a swept hilt (cup + knuckle bow)", () => {
  for (let i = 1; i <= 300; i++) {
    const w = weaponFromSeed("rapier", seedOf(i));
    assert(w.headLength >= 0.95 - 1e-9 && w.headLength <= 1.1 + 1e-9, `rapier blade ${w.headLength.toFixed(3)} m`);
    if (i > SEEDS) continue;
    const kit = weaponKit(w), form = weaponForm(w);
    const guard = partBox(kit, ["guard"]);
    assert(guard.dx >= 1.8 * RAPIER_CUP_RADIUS && guard.dz >= 1.8 * RAPIER_CUP_RADIUS, "cup spans the hand in x and z");
    // Knuckle bow: guard furniture in front of the fingers (+z) well below the guard.
    let bow = false;
    for (let t = 0; t < kit.parts.length && !bow; t++) {
      if (kit.parts[t] !== "guard") continue;
      for (let k = 0; k < 3; k++) {
        const y = kit.pos[t * 9 + k * 3 + 1], z = kit.pos[t * 9 + k * 3 + 2];
        if (y < form.guardY - 0.05 && z > 0.04) bow = true;
      }
    }
    assert(bow, "rapier: a knuckle bow runs down the edge side of the grip");
  }
});

Deno.test("readability: visual-only exaggerations stay bounded (drawn beak tip <= 7.5 cm past the point feature)", () => {
  let worst = 0;
  for (let i = 1; i <= SEEDS; i++) {
    const w = weaponFromSeed("warhammer", seedOf(i));
    const kit = weaponKit(w);
    const p = w.features.find((f) => f.kind === "point")!.points[0];
    let tip = [0, 0, Infinity];
    for (let t = 0; t < kit.parts.length; t++) {
      if (kit.parts[t] !== "head") continue;
      for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3;
        if (kit.pos[o + 2] < tip[2]) tip = [kit.pos[o], kit.pos[o + 1], kit.pos[o + 2]];
      }
    }
    const d = Math.hypot(tip[0] - p[0], tip[1] - p[1], tip[2] - p[2]);
    worst = Math.max(worst, d);
    assert(d <= 0.075, `warhammer seed ${i}: drawn beak tip ${d.toFixed(3)} m past the point feature`);
  }
  console.log(`warhammer: drawn beak tip at most ${(worst * 100).toFixed(1)} cm past the point feature (VISUAL_BEAK)`);
});

Deno.test("readability: the ink keeps a constant screen width closer than INK_REF_DISTANCE", () => {
  const m = createWeaponOutlineMaterial();
  assert(m.uniforms.inkDistance.value === INK_REF_DISTANCE && INK_REF_DISTANCE === GAMEPLAY_VIEW.distance, "ink reference distance = gameplay distance");
  assert(/clamp\(-viewPosition\.z \/ inkDistance, 0\.0, 1\.0\)/.test(m.vertexShader), "outline width scales with view depth");
  m.dispose();
});
