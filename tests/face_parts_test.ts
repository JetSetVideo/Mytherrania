// Lane Q-A: the eye — pointed brows, upper AND lower eyelids, a recessed eyeball. Proves by
// NUMBERS in head heights (radii, lid thickness, lid aperture, eye inset) that every ancestry's
// brow tapers to a point, that every model carries an upper and a lower lid band with a stated
// aperture, and that the eyeball's centre and front sit BEHIND the socket's opening plane/rim.
// @deno-types="@types/three"
import * as THREE from "three";
import { ANCESTRY, ancestryOf, LID_MAX_PER_HEAD, validateAncestry, type LidSpec } from "../src/game/Ancestry.ts";
import {
  BROW_RISE_PER_HEAD, browWedge, EYE_FRONT_VS_RIM_PER_HEAD, EYE_INSET_PER_HEAD,
  EYE_RADIUS_PER_HEAD, EYE_Z_PER_HEAD, eyeRecess, lidBands, SOCKET_OPEN_Z_PER_HEAD, SOCKET_RIM_Z_PER_HEAD,
  type FaceAnchors,
} from "../src/graphics/body/AnatomyParts.ts";
import { buildFaceParts } from "../src/graphics/body/FaceParts.ts";
import { anatomyFor } from "../src/graphics/body/Anatomy.ts";
import { compileSdf } from "../src/graphics/body/Sdf.ts";
import type { BodySpec, SdfSample } from "../src/graphics/body/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(String(message)); }
/** Every race node (subrace null) and every subrace node (taken over its race). */
const PAIRS: [string, string | null][] = [];
for (const id of Object.keys(ANCESTRY)) {
  const n = ANCESTRY[id];
  PAIRS.push([n.race, n.parent === null ? null : n.id]);
}
/** The head height every "per head" number is normalised by, for the printed tables (m). */
const HEAD_H = 0.2267;

Deno.test("every node carries a lid block (upper, lower, aperture) and a brow pointedness, validated", () => {
  assert(validateAncestry().length === 0, `validateAncestry problems: ${validateAncestry().join(" | ")}`);
  for (const [race, sub] of PAIRS) {
    const n = ancestryOf(race, sub);
    for (const k of ["upper", "lower", "aperture"] as const) {
      const v = n.lid[k];
      assert(Number.isFinite(v) && v > 0 && v <= LID_MAX_PER_HEAD, `${race}/${sub}: lid.${k} = ${v}`);
    }
    assert(Number.isFinite(n.brow.point) && n.brow.point >= 0 && n.brow.point <= 1, `${race}/${sub}: brow.point = ${n.brow.point}`);
  }
});

Deno.test("the validator REFUSES a node missing a lid field or its pointedness", () => {
  const lid = ANCESTRY.human.lid;
  delete (ANCESTRY.human as { lid?: LidSpec }).lid;
  assert(validateAncestry().some((p) => p.includes("human.lid")), "a node without a lid block must be refused");
  ANCESTRY.human.lid = lid;
  const point = ANCESTRY.human.brow.point;
  delete (ANCESTRY.human.brow as { point?: number }).point;
  assert(validateAncestry().some((p) => p.includes("human.brow.point")), "a node without brow.point must be refused");
  ANCESTRY.human.brow.point = point;
  assert(validateAncestry().length === 0, "restored data validates clean");
});

Deno.test("pointed brows: every ancestry tapers inner→outer to a point, elf sharpest, ork bluntest", () => {
  const rows: string[] = [];
  const point = (id: string) => ancestryOf(id, null).brow.point;
  for (const [race, sub] of PAIRS) {
    const n = ancestryOf(race, sub);
    const w = browWedge(n, HEAD_H, 0);
    // The stated taper: tip radius strictly below the root radius, never negative.
    assert(w.rootR > 0 && w.tipR >= 0 && w.tipR < w.rootR, `${race}/${sub}: taper ${w.rootR} → ${w.tipR}`);
    // The tip sits outward of the inner end, and within the head width it can reach.
    assert(w.tipX > w.innerX && w.innerX > 0, `${race}/${sub}: tipX ${w.tipX} innerX ${w.innerX}`);
    rows.push(`${(race + "/" + (sub ?? "-")).padEnd(16)} point=${n.brow.point.toFixed(2)}  rootR=${(w.rootR / HEAD_H).toFixed(3)}h  tipR=${(w.tipR / HEAD_H).toFixed(4)}h  tipX=${(w.tipX / HEAD_H).toFixed(3)}h  innerX=${(w.innerX / HEAD_H).toFixed(3)}h`);
  }
  console.log("pointed brows (radius in head heights):\n  " + rows.join("\n  "));
  // The point is a data field and it orders the races: elf sharpest, ork bluntest.
  const races = ["elf", "human", "dwarf", "ork"];
  for (let i = 1; i < races.length; i++) assert(point(races[i - 1]) > point(races[i]), `${races[i - 1]} must be more pointed than ${races[i]}`);
  // A sharper point ⇒ a smaller tip radius fraction and a longer reach.
  const elf = browWedge(ancestryOf("elf", null), HEAD_H, 0), ork = browWedge(ancestryOf("ork", null), HEAD_H, 0);
  assert(elf.tipR / elf.rootR < ork.tipR / ork.rootR, `elf tip fraction ${elf.tipR / elf.rootR} < ork ${ork.tipR / ork.rootR}`);
  assert(elf.tipX > ork.tipX, `elf tip runs further out (${elf.tipX}) than ork (${ork.tipX})`);
});

Deno.test("upper AND lower lids on every ancestry: stated thickness and aperture, aperture < globe", () => {
  const rows: string[] = [];
  for (const [race, sub] of PAIRS) {
    const n = ancestryOf(race, sub);
    const lb = lidBands(n, HEAD_H);
    assert(lb.upperThickness > 0 && lb.lowerThickness > 0, `${race}/${sub}: thicknesses ${lb.upperThickness}/${lb.lowerThickness}`);
    assert(lb.aperture > 0, `${race}/${sub}: aperture ${lb.aperture}`);
    // The lids must overlap the globe: the opening is narrower than the eyeball's diameter.
    assert(lb.aperture < 2 * EYE_RADIUS_PER_HEAD * HEAD_H, `${race}/${sub}: aperture ${lb.aperture} must be < the globe diameter ${2 * EYE_RADIUS_PER_HEAD * HEAD_H}`);
    rows.push(`${(race + "/" + (sub ?? "-")).padEnd(16)} upper=${n.lid.upper.toFixed(3)}h  lower=${n.lid.lower.toFixed(3)}h  aperture=${n.lid.aperture.toFixed(3)}h`);
  }
  console.log("eyelid bands (head heights):\n  " + rows.join("\n  "));
  // Heavy-browed ancestries carry the thicker lids and the narrower aperture (dwarf > ork > human > elf).
  const up = (id: string) => ancestryOf(id, null).lid.upper, ap = (id: string) => ancestryOf(id, null).lid.aperture;
  assert(up("dwarf") > up("human") && up("human") > up("elf"), "dwarf lids thickest, elf thinnest");
  assert(ap("elf") > ap("human") && ap("human") > ap("dwarf"), "elf aperture widest, dwarf narrowest");
});

Deno.test("the eyeball is recessed: centre behind the opening plane, front behind the socket rim", () => {
  // Programme constants, head heights (the numbers headNode builds from).
  assert(SOCKET_RIM_Z_PER_HEAD > SOCKET_OPEN_Z_PER_HEAD, "the rim is forward of the opening plane");
  assert(EYE_INSET_PER_HEAD > 0, `inset ${EYE_INSET_PER_HEAD} must be positive`);
  assert(EYE_FRONT_VS_RIM_PER_HEAD > 0, `front-vs-rim ${EYE_FRONT_VS_RIM_PER_HEAD} must be positive`);
  // Per head: the recess in metres (normalised by h below).
  const rows: string[] = [];
  for (const [race, sub] of PAIRS) {
    const spec: BodySpec = { race, subrace: sub, className: "Warrior", height: 1.7, weight: 72, seed: 7 };
    const h = anatomyFor(spec).proportions.head;
    const rec = eyeRecess(h);
    assert(rec.eyeZ < rec.socketOpenZ, `${race}/${sub}: eye centre ${rec.eyeZ} must be behind the opening plane ${rec.socketOpenZ}`);
    assert(rec.eyeFrontZ < rec.rimZ, `${race}/${sub}: eye front ${rec.eyeFrontZ} must be behind the rim ${rec.rimZ}`);
    rows.push(`${(race + "/" + (sub ?? "-")).padEnd(16)} eyeZ=${(rec.eyeZ / h).toFixed(3)}h  eyeFront=${(rec.eyeFrontZ / h).toFixed(3)}h  rim=${(rec.rimZ / h).toFixed(3)}h  inset=${((rec.socketOpenZ - rec.eyeZ) / h).toFixed(3)}h  frontVsRim=${((rec.rimZ - rec.eyeFrontZ) / h).toFixed(3)}h`);
  }
  console.log("recessed eyeball (head heights):\n  " + rows.join("\n  "));
});

Deno.test("the real head field: the eye sits IN the socket, recessed behind its opening plane", () => {
  const spec: BodySpec = { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 };
  const plan = anatomyFor(spec);
  const P = plan.proportions, h = P.head, eyeY = P.y.eye;
  const headField = compileSdf(plan.root);
  const probe: SdfSample = { d: 0, region: 0, bone: 0 };
  const x = 0.2 * h; // the eye anchor's x
  // The socket floor: the deepest solid z along the eye line (the carve's back).
  let floor = -1;
  for (let z = 0; z <= 0.7 * h; z += 0.0005 * h) if (headField.sample(x, eyeY, z, probe).d < 0) floor = z;
  const rec = eyeRecess(h);
  const dFront = headField.sample(x, eyeY, rec.eyeFrontZ, probe).d;
  const browZ = browWedge(ancestryOf("human", null), h, eyeY).z;
  console.log(`head at the eye line (x=0.2h): socket floor z=${(floor / h).toFixed(3)}h  eye front z=${(rec.eyeFrontZ / h).toFixed(3)}h  opening plane ${rec.socketOpenZ / h}h  rim ${rec.rimZ / h}h  brow ${(browZ / h).toFixed(3)}h  (was: eye front 0.405h, floor 0.265h)`);
  // The eye's front point lies in the CARVED cavity (empty space) - it sits in the socket.
  assert(dFront > 0, `the eyeball front is buried in the head (d=${dFront})`);
  // The socket floor is behind the eyeball's front: the eye is carried inside the socket.
  assert(floor < rec.eyeFrontZ, `socket floor ${(floor / h).toFixed(3)}h must be behind the eye front ${(rec.eyeFrontZ / h).toFixed(3)}h`);
  // The eye front is behind the socket's opening plane AND the brow ridge - recessed, not bulging.
  assert(rec.eyeFrontZ < rec.socketOpenZ, `eye front ${(rec.eyeFrontZ / h).toFixed(3)}h behind the opening plane ${rec.socketOpenZ / h}h`);
  assert(rec.eyeFrontZ < browZ, `eye front ${(rec.eyeFrontZ / h).toFixed(3)}h behind the brow ridge ${(browZ / h).toFixed(3)}h`);
});

Deno.test("buildFaceParts gives every ancestry 2 uppers, 2 lowers, 2 pointed brows, finite triangles", () => {
  const spec: BodySpec = { race: "human", subrace: null, className: "Warrior", height: 1.7, weight: 72, seed: 7 };
  const h = anatomyFor(spec).proportions.head, eyeY = 7 * h, r = EYE_RADIUS_PER_HEAD * h;
  for (const [race, sub] of PAIRS) {
    const face: FaceAnchors = {
      eye: [[0.2 * h, eyeY, EYE_Z_PER_HEAD * h], [-0.2 * h, eyeY, EYE_Z_PER_HEAD * h]], eyeRadius: r,
      brow: [[0.2 * h, eyeY + BROW_RISE_PER_HEAD * h, 0.31 * h], [-0.2 * h, eyeY + BROW_RISE_PER_HEAD * h, 0.31 * h]],
      mouth: [0, eyeY - 0.5 * h, 0.33 * h], chin: [0, eyeY - 0.8 * h, 0.2 * h], crown: [0, eyeY + 0.5 * h, 0],
      skullCentre: [0, eyeY + 0.2 * h, -0.06 * h], skullRadii: [0.34 * h, 0.47 * h, 0.42 * h],
      ear: [[0.3 * h, eyeY, 0], [-0.3 * h, eyeY, 0]], noseTip: [0, eyeY - 0.27 * h, 0.44 * h],
    };
    const head = new THREE.Group();
    const a: Appearance = { body: ancestryOf(race, sub).skin.base, accent: "#6b4130", height: 1.7, weight: 72, hair: "#1a1a1a", eyes: "#2f6fb5", race, subrace: sub };
    const rig = buildFaceParts(head, face, [0, 0, 0], h, a);
    assert(rig.eyelid.length === 2, `${race}/${sub}: ${rig.eyelid.length} upper lids`);
    assert(rig.eyelidLower.length === 2, `${race}/${sub}: ${rig.eyelidLower.length} lower lids`);
    assert(rig.brow.length === 2, `${race}/${sub}: ${rig.brow.length} brows`);
    assert(Number.isFinite(rig.triangleCount) && rig.triangleCount > 0, `${race}/${sub}: triangles ${rig.triangleCount}`);
    // Both eyelids hang at the recessed eye anchor's z, not forward of it.
    for (const lid of [...rig.eyelid, ...rig.eyelidLower]) assert(Math.abs(lid.position.z - EYE_Z_PER_HEAD * h) < 1e-9, `${race}/${sub}: lid off the eye anchor`);
  }
});
