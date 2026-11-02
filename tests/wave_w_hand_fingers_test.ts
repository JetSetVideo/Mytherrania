// Wave W lane H — the hands have fingers that close on the handle, the mitten is gone from the render
// (the physics keeps it), no holes at the wrist, and the elbow crease no longer collapses.
// @deno-types="@types/three"
import * as THREE from "three";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import {
  buildHandMesh, contactReport, DIGIT_SIDES, DIGITS, gripPose, handSize, handTopology, handTriangleCount, handVertexCount,
  PALM_SIDES, relaxedPose, segSegDistance,
} from "../src/graphics/body/Hands.ts";
import { handBasis, WRIST_CUT } from "../src/graphics/body/HandRig.ts";
import { boneIndex } from "../src/graphics/body/Sdf.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";
import type { BodySpec, Vec3 } from "../src/graphics/body/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }

const SPECS: Record<string, BodySpec> = {
  human: { race: "human", subrace: null, className: "Warrior", height: 1.76, weight: 76, seed: 7, sex: "male" },
  elf: { race: "elf", subrace: null, className: "Warrior", height: 1.75, weight: 56, seed: 7, sex: "female" },
  dwarf: { race: "dwarf", subrace: null, className: "Warrior", height: 1.38, weight: 78, seed: 7, sex: "male" },
  ork: { race: "ork", subrace: null, className: "Warrior", height: 1.98, weight: 118, seed: 7, sex: "male" },
};
const look = (s: BodySpec): Appearance => ({ body: "#c98a63", accent: "#dfaa55", height: s.height, weight: s.weight, hair: "#172128", eyes: "#2f6fb5", race: s.race, subrace: s.subrace } as Appearance);
/** Lane G's measured guard grip Euler (artifacts/qa-grip/after/report.json, every archetype at guard). */
const GUARD: [number, number] = [2.4537, -0.3138];
function rigWith(id: ArchetypeId, race = "human") {
  const ws = weaponFromSeed(id, 11), spec = SPECS[race];
  return buildSkinnedHumanoid(toGeneratedWeapon(ws), look(spec), "fire", spec, { weaponSpec: ws });
}

Deno.test("hands: four fingers of three phalanges and a thumb, a fixed topology, a stated triangle cost", () => {
  const S = handSize({ hand: 0.188, palmHalfWidth: 0.0453, palmHalfThickness: 0.0249, wrist: 0.0295, thumb: 1 });
  const pose = relaxedPose(S);
  assert(pose.digits.length === 5 && DIGITS.join() === "index,middle,ring,little,thumb", "five digits");
  for (const d of pose.digits) assert(d.joints.length === 4 && d.dirs.length === 3 && d.angles.length === 3, `${d.name}: 3 segments`);
  const m = buildHandMesh(S, pose), t = handTopology();
  assert(m.positions.length === handVertexCount() * 3 && m.indices.length === handTriangleCount() * 3, "counts match the topology");
  const parts = new Set(t.part);
  assert(parts.size === 6, `palm + 5 digits (${[...parts]})`);
  // Each digit's tube has its own vertices; the four fingers are separated (no two fingertips within a finger radius).
  const tips = pose.digits.slice(0, 4).map((d) => d.joints[3]);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const d = Math.hypot(tips[i][0] - tips[j][0], tips[i][1] - tips[j][1], tips[i][2] - tips[j][2]);
    assert(d > S.fingerR[i], `fingertips ${i}/${j} ${d.toFixed(4)} apart`);
  }
  // Every vertex finite; the nail plates exist on the five tips.
  for (const x of m.positions) assert(Number.isFinite(x), "finite positions");
  const nails = new Set<number>();
  for (let v = 0; v < m.kind.length; v++) if (m.kind[v] === 1) nails.add(m.part[v]);
  assert(nails.size === 5, `nail plates on ${nails.size} digits`);
  // Open ends are only the buried ones: the palm's forearm ring and the five digit roots.
  const uses = new Map<string, number>();
  for (let k = 0; k < m.indices.length; k += 3) for (let e = 0; e < 3; e++) {
    const a = m.indices[k + e], b = m.indices[k + (e + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const boundary = [...uses.values()].filter((u) => u === 1).length, nonManifold = [...uses.values()].filter((u) => u > 2).length;
  assert(boundary === PALM_SIDES + 5 * DIGIT_SIDES && nonManifold === 0, `boundary ${boundary}, non-manifold ${nonManifold}`);
  console.log(`hand: ${handVertexCount()} vertices, ${handTriangleCount()} triangles per hand`);
});

Deno.test("hands: the weapon hand closes on the handle at the guard — every finger touches and wraps it", () => {
  const rows: string[] = [];
  for (const race of Object.keys(SPECS)) {
    for (const id of ["axe", "dagger", "longsword", "spear"] as ArchetypeId[]) {
      const rig = rigWith(id, race);
      rig.setGrip(GUARD[0], GUARD[1]);
      const H = rig.hands!;
      assert(H.pose(1).kind === "grip", `${race}/${id}: the weapon hand is not gripping`);
      assert(H.pose(0).kind === "relaxed", `${race}/${id}: the free hand should stay relaxed (no handle in reach)`);
      const c = H.liveContact(1)!;
      // Fingers: the capsule surface within 3 mm of the handle surface (0 = touching), MCP curled.
      for (const d of c.digits.slice(0, 4)) {
        // Touching: within 1.5 mm either way (measured: 0 on every finger but the ork's index, −0.16…−0.54 mm).
        assert(Math.abs(d.gapMm) <= 1.5, `${race}/${id} ${d.name}: gap ${d.gapMm} mm`);
        assert(d.angles[0] + d.angles[1] + d.angles[2] > 1.5, `${race}/${id} ${d.name}: not curled (${d.angles})`);
      }
      // Measured (seed 7): human 154–175°, elf 182–216°, ork ~138°, dwarf 115–123° (short fingers).
      assert(c.wrapDeg >= 110, `${race}/${id}: the middle finger wraps only ${c.wrapDeg}°`);
      // The handle may press into the palm's soft heel by PALM_PRESS (4 mm) before the wrist extends;
      // the dwarf's short thick hand reaches the tilt bound first (−8…−13 mm, a stated gap).
      assert(c.palmClearMm >= (race === "dwarf" ? -14 : -8), `${race}/${id}: the handle runs ${c.palmClearMm} mm into the palm`);
      rows.push(`${race}/${id}: gaps ${c.digits.map((d) => d.gapMm).join("/")} mm, wrap ${c.wrapDeg}°, palm ${c.palmClearMm} mm, tilt ${c.tilt}, dev ${c.deviation}`);
    }
  }
  console.log(rows.join("\n"));
});

Deno.test("hands: the grip follows the handle — a square handle sits in a channel the fingers close round", () => {
  const S = handSize({ hand: 0.188, palmHalfWidth: 0.0453, palmHalfThickness: 0.0249, wrist: 0.0295, thumb: 1 });
  const h = { p: [0.45 * S.H, 0, 0] as Vec3, u: [0, 0, 1] as Vec3, r: 0.0155 };
  const pose = gripPose(S, h);
  const c = contactReport(S, pose, h, buildHandMesh(S, pose));
  for (const d of c.digits.slice(0, 4)) assert(d.gapMm >= -0.5 && d.gapMm <= 1.5 && d.touching >= 1, `${d.name}: ${JSON.stringify(d)}`);
  // The channel: the handle axis passes inside the closed fist — every finger's joints sit at least the
  // handle radius from the axis (nothing runs through it) and the middle finger goes round its far side.
  const a: Vec3 = [h.p[0], h.p[1], -0.2], b: Vec3 = [h.p[0], h.p[1], 0.2];
  for (const d of pose.digits.slice(0, 4)) for (const j of d.joints) assert(segSegDistance(j, j, a, b) >= h.r, `${d.name} joint inside the handle`);
  assert(c.wrapDeg >= 170, `wrap ${c.wrapDeg}`);
  // Mesh gaps stay small (the hexagonal tube flats sit inside the capsule radius).
  for (const d of c.digits.slice(0, 4)) assert(d.meshGapMm >= -1 && d.meshGapMm <= 4, `${d.name} mesh gap ${d.meshGapMm}`);
  // A thinner handle (a dagger's 13.5 mm) closes tighter: the fingers flex more in total.
  const thin = gripPose(S, { ...h, r: 0.0135 }), sumFlex = (p: typeof pose) => p.digits.slice(0, 4).reduce((s, d) => s + d.angles.reduce((x, y) => x + y, 0), 0);
  assert(sumFlex(thin) > sumFlex(pose), `thin ${sumFlex(thin).toFixed(3)} vs ${sumFlex(pose).toFixed(3)}`);
});

Deno.test("hands: the mitten leaves the RENDER only — the physics body keeps it, the render skin is closed at the wrist", () => {
  const rig = rigWith("axe");
  const geo = rig.skin.geometry, idx = geo.index!.array as ArrayLike<number>, P = geo.getAttribute("position").array as ArrayLike<number>;
  const body = generateBody(SPECS.human);
  // The body DATA (what the plan, hitboxes and ragdoll read) still has its hands: same triangles as ever.
  assert(rig.meshStats.triangles === body.mesh.indices.length / 3 && rig.meshStats.boundaryEdges === 0, "body data untouched");
  // No render triangle keeps a forearm-bone vertex past the wrist cut.
  const H = rig.plan.proportions.hand;
  for (const i of [0, 1] as const) {
    const B = handBasis(rig.plan, i), bi = boneIndex(i === 0 ? "elbowL" : "elbowR");
    for (let k = 0; k < idx.length; k++) {
      const v = idx[k];
      if (v >= body.mesh.positions.length / 3 || body.mesh.bone![v] !== bi) continue;
      const x = (P[v * 3] - B.o[0]) * B.X[0] + (P[v * 3 + 1] - B.o[1]) * B.X[1] + (P[v * 3 + 2] - B.o[2]) * B.X[2];
      assert(x <= -WRIST_CUT * H + 1e-9, `arm ${i}: a mitten vertex survived (x ${x.toFixed(4)})`);
    }
  }
  // Closed: every render edge used exactly twice (the rims are capped), no hole at either wrist.
  const uses = new Map<number, number>(), nv = P.length / 3;
  for (let k = 0; k < idx.length; k += 3) for (let e = 0; e < 3; e++) {
    const a = idx[k + e], b = idx[k + (e + 1) % 3], key = a < b ? a * nv + b : b * nv + a;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const open = [...uses.values()].filter((u) => u !== 2).length;
  assert(open === 0, `${open} render edges are not used twice (hole or fin)`);
  // The rig counts what it draws.
  assert(rig.hands!.triangles === 2 * handTriangleCount(), "both hands counted");
  // The hand meshes ride the forearm bones.
  for (const [k, m] of rig.hands!.meshes.entries()) {
    let p: THREE.Object3D | null = m;
    while (p && p.name !== (k === 0 ? "elbowL" : "elbowR")) p = p.parent;
    assert(p, `hand ${k} is not under its forearm bone`);
  }
});
