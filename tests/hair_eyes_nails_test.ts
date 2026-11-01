// Lane R-B (wave R): hair that SITS on the skull, eyes that pop (round globe, a wet glint, a
// painted iris with fine flecks), and painted nails. Every claim here is a NUMBER: the hair's
// clearance to the head's own surface in head heights, a roundness measure, the glint size and
// position, the iris fleck density and size in mm, and the nail-region coverage share.
// @deno-types="@types/three"
import * as THREE from "three";
import { ancestryOf } from "../src/game/Ancestry.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import {
  buildFaceParts, EYE, HAIR_FIT, hairSegments, irisColour, irisFleckColours, roundnessOf, skullBackZ, skullClearance,
} from "../src/graphics/body/FaceParts.ts";
import { type FaceAnchors } from "../src/graphics/body/AnatomyParts.ts";
import { hairFall, hairLengthM, isBald, lookSeed } from "../src/graphics/body/Proportions.ts";
import { mannequinMesh } from "../src/graphics/paint/Mannequin.ts";
import { buildPatternEnv, REGION_INDEX } from "../src/graphics/paint/Patterns.ts";
import { paintVertices } from "../src/graphics/paint/Layers.ts";
import {
  NAIL_GLOSS_TINT, NAIL_GLOSS_WIDTH, NAIL_TINT, stackFor,
} from "../src/graphics/paint/Recipes.ts";
import { hexToRgb, shiftHsl, tintHex } from "../src/graphics/paint/Blend.ts";
import type { BodySpec, PaintLayer, PaintStack, Vec3 } from "../src/graphics/body/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";
import type { FaceRig } from "../src/graphics/body/FaceParts.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

/** The three ancestries the clearance table is printed for, and three seeds each. */
const ANCS: [string, string | null][] = [["human", null], ["elf", null], ["dwarf", null]];
const SEEDS = [3, 8, 15];

/** Build the face parts for one (ancestry, seed) against its REAL generated head anchors. */
function buildFace(race: string, sub: string | null, seed: number): { rig: FaceRig; head: THREE.Group; face: FaceAnchors; h: number; a: Appearance } {
  // Stature and build vary with the seed, so the skull (and thus the fit) really differs per seed.
  const height = 1.6 + (seed % 8) * 0.02, weight = 60 + (seed % 5) * 8;
  const spec: BodySpec = { race, subrace: sub, className: "Warrior", height, weight, seed };
  const plan = anatomyFor(spec);
  const h = plan.proportions.head;
  const node = ancestryOf(race, sub);
  // The character-look draw (lookSeed) decides bald/curl; pick the first appearance tone in a
  // deterministic list that is NOT bald, so each (ancestry, seed) actually carries a hair fall.
  const base: Appearance = {
    body: node.skin.base, accent: "#6b4130", height, weight,
    hair: "#1a1a1a", eyes: "#2f6fb5", race, subrace: sub,
  };
  let a = base;
  for (let k = 0; k < 64; k++) {
    const cand: Appearance = { ...base, hair: `#${(0x1a1a00 + k * 0x111111).toString(16).padStart(6, "0").slice(0, 6)}` };
    if (!isBald(node, lookSeed(cand))) { a = cand; break; }
  }
  const head = new THREE.Group();
  const rig = buildFaceParts(head, plan.face, [0, 0, 0], h, a);
  return { rig, head, face: plan.face, h, a };
}

/** World-space vertices of every skull-hugging hair mesh in the rig (origin 0 -> model space). */
function hairVertices(rig: FaceRig): Vec3[] {
  const out: Vec3[] = [];
  const v = new THREE.Vector3();
  for (const obj of rig.hairParts) {
    const mesh = obj as THREE.Mesh;
    mesh.updateMatrix();
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrix);
      out.push([v.x, v.y, v.z]);
    }
  }
  return out;
}

/** Count MESH-LAMBERT meshes (the eye parts) in the whole head whose material colour is one of `colours`. */
function countMeshesByColour(head: THREE.Object3D, colours: string[]): number {
  const want = new Set(colours.map((c) => new THREE.Color(c).getHexString()));
  let n = 0;
  head.traverse((o: THREE.Object3D) => {
    const mat = (o as THREE.Mesh).material;
    if (o instanceof THREE.Mesh && mat instanceof THREE.MeshLambertMaterial && want.has(new THREE.Color(mat.color).getHexString())) n++;
  });
  return n;
}

/** The fall's NEAR-surface gap (m -> head heights) to the skull, per segment, over the band window. */
function fallNearGap(h: number, sc: Vec3, sr: Vec3, race: string, sub: string | null): { min: number; max: number; segs: number } {
  const node = ancestryOf(race, sub);
  const fall = hairFall(node.hair.curl, node.hair.density, hairLengthM(node, h), h);
  const topR = Math.min(fall.topRadius, HAIR_FIT.fallRadiusTopPerHead * h);
  const botR = Math.min(fall.botRadius, HAIR_FIT.fallRadiusBotPerHead * h);
  const segs = hairSegments(h, sc, sr, topR, botR, fall.drop);
  let mn = Infinity, mx = -Infinity, n = 0;
  for (const s of segs) {
    for (let k = 0; k <= 6; k++) {
      const y = s.y1 + (s.y0 - s.y1) * (k / 6);
      if (Math.abs((y - sc[1]) / sr[1]) > HAIR_FIT.bandWindowPerRadius) continue;
      const sb = skullBackZ(sc, sr, y);
      if (sb === null) continue;
      const gap = (sb - (s.z + s.r)) / h;
      mn = Math.min(mn, gap); mx = Math.max(mx, gap); n++;
    }
  }
  return { min: mn, max: mx, segs: n };
}

Deno.test("hair fits the head: the fall sits ON the skull in a stated clearance band, for 3 ancestries x 3 seeds", () => {
  const rows: string[] = [];
  for (const [race, sub] of ANCS) {
    for (const seed of SEEDS) {
      const { rig, face, h } = buildFace(race, sub, seed);
      const sc = face.skullCentre, sr = face.skullRadii;
      const verts = hairVertices(rig);
      assert(verts.length > 0, `${race}/${sub} seed ${seed}: no hair vertices`);
      // No hair vertex may sit INSIDE the skull (clearance to the cranium surface > 0).
      let inside = 0;
      for (const p of verts) if (skullClearance(p, sc, sr) <= 0) inside++;
      assert(inside === 0, `${race}/${sub} seed ${seed}: ${inside} hair vertices inside the skull`);
      // The fall's NEAR surface rides the skull's back: its gap stays in the stated band.
      const band = fallNearGap(h, sc, sr, race, sub);
      assert(band.min >= HAIR_FIT.minClearancePerHead - 1e-9, `${race}/${sub} seed ${seed}: near gap ${band.min.toFixed(4)}h < ${HAIR_FIT.minClearancePerHead}h (sunk in)`);
      assert(band.max <= HAIR_FIT.maxClearancePerHead + 1e-9, `${race}/${sub} seed ${seed}: near gap ${band.max.toFixed(4)}h > ${HAIR_FIT.maxClearancePerHead}h (floating)`);
      // The hair must not cross the brow line: every hair vertex on the front side (z > skull centre)
      // stays above the brow ridge's height.
      const browY = face.brow[0][1];
      let minFrontY = Infinity;
      for (const p of verts) if (p[2] > sc[2]) minFrontY = Math.min(minFrontY, p[1]);
      assert(minFrontY > browY, `${race}/${sub} seed ${seed}: front hairline ${(minFrontY / h).toFixed(3)}h must stay above the brow ${(browY / h).toFixed(3)}h`);
      rows.push(`${(race + "/" + (sub ?? "-")).padEnd(14)} seed=${String(seed).padStart(2)}  verts=${String(verts.length).padStart(4)}  nearGap=${band.min.toFixed(4)}..${band.max.toFixed(4)}h  inside=${inside}  hairline=${(minFrontY / h).toFixed(3)}h  brow=${(browY / h).toFixed(3)}h`);
    }
  }
  console.log(`hair fall clearance band (${HAIR_FIT.minClearancePerHead}..${HAIR_FIT.maxClearancePerHead}h, 3 ancestries x 3 seeds):\n  ` + rows.join("\n  ") + `\n  (the band is normalised in head heights; the fit is scale-invariant, so the 3 seeds — different statures/masses/look draws — give the same band per ancestry: it holds for every body size)`);
});

Deno.test("hair: the fall's segments ride the skull's back surface at the stated shell gap", () => {
  const { face, h } = buildFace("human", null, 7);
  const sc = face.skullCentre, sr = face.skullRadii;
  const node = ancestryOf("human", null);
  const len = hairLengthM(node, h);
  const fall = hairFall(node.hair.curl, node.hair.density, len, h);
  const topR = Math.min(fall.topRadius, HAIR_FIT.fallRadiusTopPerHead * h);
  const botR = Math.min(fall.botRadius, HAIR_FIT.fallRadiusBotPerHead * h);
  const segs = hairSegments(h, sc, sr, topR, botR, fall.drop);
  const gap = HAIR_FIT.shellGapPerHead * h;
  // Every segment with cranium beneath it keeps its near surface (axis z + its radius) behind the
  // skull's own surface by at least the shell gap, all along the segment.
  let checked = 0;
  for (const s of segs) {
    let hasSkull = false;
    for (let k = 0; k <= 6; k++) {
      const y = s.y1 + (s.y0 - s.y1) * (k / 6);
      const sb = skullBackZ(sc, sr, y);
      if (sb === null) continue;
      hasSkull = true;
      const front = s.z + s.r;
      assert(front <= sb - gap + 1e-9, `segment front ${front.toFixed(4)} must be behind ${(sb - gap).toFixed(4)} at y=${y.toFixed(4)}`);
    }
    if (hasSkull) checked++;
  }
  assert(checked >= 2, `expected >= 2 skull-riding segments, got ${checked}`);
});

Deno.test("eyes: the globe and iris are ROUND (roundness measure), not faceted squares", () => {
  // Roundness = area(polygon)/area(circle) = (n/2π) sin(2π/n). The iris is the part that reads as
  // the coloured eye (was a 16-gon disc); its edge count is what keeps it from drawing as a square.
  const irisBefore = roundnessOf(16), irisNow = roundnessOf(EYE.irisSegments);
  const globe = roundnessOf(EYE.globeLon);
  console.log(`roundness  iris: 16 edges -> ${irisBefore.toFixed(4)}, ${EYE.irisSegments} edges -> ${irisNow.toFixed(4)} | globe (sphere ${EYE.globeLon}x${EYE.globeLat}): ${globe.toFixed(4)}`);
  assert(irisNow > irisBefore, `iris roundness must improve (${irisBefore} -> ${irisNow})`);
  assert(irisNow >= 0.98, `iris roundness ${irisNow} must be >= 0.98`);
  assert(globe >= 0.96, `the globe must stay round (${globe} >= 0.96: a sphere, not a square)`);
  assert(1 - irisNow < 0.02 && 1 - globe < 0.04, "both stay within the stated facet error");
});

Deno.test("eyes: a WET GLINT sits on the globe at a stated size and position", () => {
  const d = Math.hypot(EYE.glintX, EYE.glintY);
  assert(EYE.glintRadius > 0 && d + EYE.glintRadius <= 1, `glint (d=${d}, r=${EYE.glintRadius}) must sit within the globe`);
  const d2 = Math.hypot(EYE.glint2X, EYE.glint2Y);
  assert(EYE.glint2Radius > 0 && d2 + EYE.glint2Radius <= 1, "secondary glint within the globe");
  assert(EYE.glintRadius > EYE.glint2Radius, "the main glint is the larger of the two");
  const { head, face, h } = buildFace("human", null, 7);
  const r = face.eyeRadius;
  const glintMeshes = countMeshesByColour(head, ["#ffffff", "#eef4ff"]);
  assert(glintMeshes === 4, `expected 2 glints per eye x 2 eyes = 4, got ${glintMeshes}`);
  console.log(`wet glint: radius ${(EYE.glintRadius * r * 1000).toFixed(2)} mm at +${EYE.glintX}r,+${EYE.glintY}r (squash ${EYE.glintSquash}); secondary ${(EYE.glint2Radius * r * 1000).toFixed(2)} mm; globe r = ${(r * 1000).toFixed(2)} mm (h=${h.toFixed(4)} m)`);
});

Deno.test("eyes: the iris is PAINTED with fine flecks of a stated density and size", () => {
  const { head, face, h, a } = buildFace("human", null, 7);
  const r = face.eyeRadius, irisR = r * EYE.irisRadius, fleckR = irisR * EYE.fleckRadius;
  const density = EYE.fleckCount / (Math.PI * irisR * irisR); // flecks per m^2
  const maxReach = 0.22 + 0.58 + EYE.fleckRadius; // largest fleck centre offset + its own radius, in iris radii
  assert(maxReach <= 1 + 1e-9, `a fleck can run past the iris edge (reach ${maxReach})`);
  assert(fleckR > 0 && fleckR < irisR, `fleck size ${fleckR} inside the iris ${irisR}`);
  const irisHex = irisColour(a);
  const [light, dark] = irisFleckColours(irisHex);
  assert(light !== dark && light !== irisHex && dark !== irisHex, "flecks carry their own colours");
  const fleckMeshes = countMeshesByColour(head, [light, dark]);
  assert(fleckMeshes === EYE.fleckCount * 2, `expected ${EYE.fleckCount * 2} fleck meshes, got ${fleckMeshes}`);
  console.log(`iris flecks: ${EYE.fleckCount} per iris, size ${(fleckR * 1000).toFixed(2)} mm (r=${(fleckR / r).toFixed(3)}r), density ${(density / 1e6).toFixed(3)} per mm^2, iris radius ${(irisR * 1000).toFixed(2)} mm (iris ${irisHex}, h=${h.toFixed(4)} m)`);
  assert(density / 1e6 > 0.01 && density / 1e6 < 0.5, `density ${(density / 1e6).toFixed(2)}/mm^2 in a plausible band`);
});

Deno.test("nails: their own painted pass — a stated colour relation, a gloss, and a measured coverage share", () => {
  const mesh = mannequinMesh(1.8, 32);
  const env = buildPatternEnv(mesh);
  const nail = REGION_INDEX.nail;
  const nailIds: number[] = [];
  for (let i = 0; i < mesh.region.length; i++) if (mesh.region[i] === nail) nailIds.push(i);
  assert(nailIds.length > 0, "the mannequin carries nail-region vertices");

  const stack = stackFor({ race: "human", seed: 7 });
  const skin = stack.layers[0].colour;
  // The nail plate is the skin tinted toward white (tintHex): each channel c -> c + (1-c)·NAIL_TINT.
  const plate = tintHex(skin, NAIL_TINT), gloss = tintHex(skin, NAIL_GLOSS_TINT);
  const sk = hexToRgb(skin), pl = hexToRgb(plate), gl = hexToRgb(gloss);
  for (let k = 0; k < 3; k++) {
    assert(pl[k] >= sk[k] - 1e-6, `nail plate channel ${k} (${pl[k]}) must be >= skin (${sk[k]})`);
    assert(Math.abs(pl[k] - (sk[k] + (1 - sk[k]) * NAIL_TINT)) < 0.005, `nail plate = tintHex(skin, ${NAIL_TINT})`);
    assert(gl[k] >= pl[k] - 1e-6, "the gloss is lighter than the plate");
  }
  const nailLayers = stack.layers.filter((l) => l.name === "nail-bed" || l.name === "nail-gloss");
  assert(nailLayers.length === 2, `expected the bed + the gloss, got ${nailLayers.length}`);
  for (const l of nailLayers) assert(l.regions?.length === 1 && l.regions[0] === "nail", `${l.name} masks the nail only`);

  const base = paintVertices(mesh, { layers: stack.layers.filter((l) => !l.name.startsWith("nail-")) }, { env });
  const withBed = paintVertices(mesh, { layers: stack.layers.filter((l) => l.name !== "nail-gloss") }, { env });
  const withAll = paintVertices(mesh, stack, { env });
  // Before (wave R): one flat plate layer, no gloss, no distinct colour relation.
  const beforeLayer: PaintLayer = { name: "nails", pattern: "solid", colour: tintHex(shiftHsl(skin, 0, 0.5, 0), 0.2), opacity: 0.85, blend: "normal", scale: 1, regions: ["nail"] };
  const beforeStack: PaintStack = { layers: [stack.layers[0], beforeLayer] };
  const before = paintVertices(mesh, beforeStack, { env });
  const beforeRef = paintVertices(mesh, { layers: [stack.layers[0]] }, { env });

  const changed = (a: Float32Array, b: Float32Array, ids: number[]) => {
    let c = 0;
    for (const i of ids) if (Math.abs(a[i * 3] - b[i * 3]) > 1e-5 || Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) > 1e-5 || Math.abs(a[i * 3 + 2] - b[i * 3 + 2]) > 1e-5) c++;
    return c / ids.length;
  };
  const beforeShare = changed(before, beforeRef, nailIds);
  const bedShare = changed(withBed, base, nailIds);
  const glossShare = changed(withAll, withBed, nailIds);
  console.log(`nail coverage (share of ${nailIds.length} nail vertices): before(flat plate) ${beforeShare.toFixed(3)} -> after bed ${bedShare.toFixed(3)} + gloss ${glossShare.toFixed(3)} (width ${NAIL_GLOSS_WIDTH}); plate=tintHex(skin,${NAIL_TINT}) gloss=tintHex(skin,${NAIL_GLOSS_TINT})`);
  assert(beforeShare > 0.99, `the old flat plate covered every nail vertex (${beforeShare})`);
  assert(bedShare > 0.99, `the nail bed must cover every nail vertex (${bedShare})`);
  assert(glossShare > 0.2 && glossShare < 0.95, `the gloss covers a partial share of the plate (${glossShare})`);
});