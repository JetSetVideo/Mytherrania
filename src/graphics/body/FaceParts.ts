// Rigid face/hair parts of the skinned body (lane A, R03): eyes, brows, eyelids, lips, hair,
// beard and ork tusks, parented to the HEAD bone. Re-implements the parts of Humanoid.addFace
// (not exported there) against the SDF head's anchors, so the features sit in the carved eye
// sockets and on the generated skull rather than on a nominal sphere.

// @deno-types="@types/three"
import * as THREE from "three";
import { createCelSurface } from "../shaders/CelShader.ts";
import { HAIR_LENGTH_M, raceBuild, seededPick } from "../../game/RaceAppearance.ts";
import type { Appearance } from "../../game/Characters.ts";
import type { Vec3 } from "./contracts.ts";
import { type FaceAnchors, HAIR_CAP_POLAR, HAIR_CAP_SCALE, HAIR_CAP_TILT } from "./AnatomyParts.ts";

/** The parts the face morph drives each frame (brow, eyelid, mouth), like Humanoid's refs. */
export interface FaceRig {
  brow: THREE.Mesh[];
  eyelid: THREE.Mesh[];
  mouth: THREE.Mesh;
  /** Rest heights (head-bone space) the morph offsets from. */
  browRestY: number[];
  mouthRestY: number;
  /** The head unit the morph's displacements are scaled by (m). */
  unit: number;
  triangleCount: number;
}

/** Hex colour scaled by k (k < 1 darkens). */
export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

/** Iris colour contrasting with the white sclera and the skin (Humanoid.irisColour's rule). */
export function irisColour(a: Appearance): string {
  const eye = new THREE.Color(a.eyes), skin = new THREE.Color(a.body);
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const dist = Math.abs(eye.r - skin.r) + Math.abs(eye.g - skin.g) + Math.abs(eye.b - skin.b);
  if (lum(eye) > 0.55 || lum(eye) < 0.04 || dist < 0.5) return "#2f6fb5";
  return `#${eye.multiplyScalar(0.8).getHexString()}`;
}

function tris(g: THREE.BufferGeometry): number {
  return g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
}

/**
 * Build the rigid face parts under `head` (the head bone). `origin` is the head bone's bind
 * position in model space; anchors are model space, so each part sits at anchor − origin.
 * `unit` is the head height h (m).
 */
export function buildFaceParts(head: THREE.Object3D, face: FaceAnchors, origin: Vec3, unit: number, a: Appearance): FaceRig {
  const build = raceBuild(a.race ?? "human", a.subrace ?? null);
  const at = (p: Vec3): [number, number, number] => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  let triangleCount = 0;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number]): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    head.add(m);
    triangleCount += tris(geo);
    return m;
  };
  const flat = (color: string) => new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.45) });
  const h = unit, r = face.eyeRadius;
  const refs: FaceRig = { brow: [], eyelid: [], mouth: null as unknown as THREE.Mesh, browRestY: [], mouthRestY: 0, unit, triangleCount: 0 };
  // Eyes: sclera ball in the socket, iris and pupil discs on its front, a catch-light.
  for (let i = 0; i < 2; i++) {
    const e = at(face.eye[i]);
    add(new THREE.SphereGeometry(r, 14, 10), flat("#f6f1e6"), e);
    const iris = add(new THREE.CircleGeometry(r * 0.55, 16), flat(irisColour(a)), [e[0], e[1], e[2] + r * 0.985]);
    iris.renderOrder = 1;
    add(new THREE.CircleGeometry(r * 0.25, 12), flat("#050505"), [e[0], e[1], e[2] + r * 0.99]);
    add(new THREE.CircleGeometry(r * 0.1, 8), flat("#ffffff"), [e[0] + r * 0.2, e[1] + r * 0.2, e[2] + r * 0.995]);
    // Eyelid: the upper half-shell of the eyeball, hung from its TOP (geometry shifted so
    // the pole is the origin): scale.y = 1 − eyeOpen lowers its rim from the top of the eye
    // (open) to the eye's equator (half closed), as the morph expects.
    const lidGeo = new THREE.SphereGeometry(r * 1.06, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, -r * 1.06, 0);
    const lid = add(lidGeo, flat(shade(a.body, 0.7)), [e[0], e[1] + r * 1.06, e[2]]);
    refs.eyelid.push(lid);
    const b = at(face.brow[i]);
    const brow = add(new THREE.BoxGeometry(0.2 * h, 0.04 * h, 0.05 * h), flat(a.hair ?? "#2a1d14"), b);
    refs.brow.push(brow);
    refs.browRestY.push(b[1]);
  }
  // Lips: upper lip, maw line and the lower lip the morph opens.
  const m = at(face.mouth);
  add(new THREE.BoxGeometry(0.2 * h, 0.045 * h, 0.03 * h), flat("#9e3d3a"), [m[0], m[1] + 0.03 * h, m[2]]);
  add(new THREE.BoxGeometry(0.16 * h, 0.012 * h, 0.02 * h), flat("#3a1210"), [m[0], m[1], m[2] + 0.004 * h]);
  refs.mouth = add(new THREE.BoxGeometry(0.18 * h, 0.05 * h, 0.03 * h), flat("#b8504a"), [m[0], m[1] - 0.035 * h, m[2]]);
  refs.mouthRestY = m[1] - 0.035 * h;
  // Ork tusks: up-curved cones from the jutting lower jaw, tips past the upper lip.
  if (build.underbite > 0.01) {
    for (const s of [-1, 1]) {
      const tusk = add(new THREE.ConeGeometry(0.03 * h, 0.12 * h + build.underbite * 0.1 * h, 6), flat("#efe6d0"), [m[0] + s * 0.11 * h, m[1] + 0.02 * h, m[2] + 0.03 * h]);
      tusk.rotation.x = -0.35;
    }
  }
  // Hair: a cap over the skull ellipsoid (cel-lit, no outline) and a fall down the back.
  const hairColor = a.hair ?? a.body;
  const hairLen = HAIR_LENGTH_M[build.hairLength] * (h / 0.227); // scaled to the head unit (h of a 1.70 m human)
  const style = seededPick(build.hairStyles, (a.race ?? "human").length * 31 + (a.subrace ?? "").length);
  const sc = at(face.skullCentre), sr = face.skullRadii;
  if (build.hairLength !== "bald") {
    // The shell's size, extent and tilt are shared with AnatomyParts so pointed ears clear it.
    const capGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, HAIR_CAP_POLAR);
    const cap = createCelSurface(capGeo, hairColor);
    cap.scale.set(sr[0] * HAIR_CAP_SCALE, sr[1] * HAIR_CAP_SCALE, sr[2] * HAIR_CAP_SCALE);
    cap.position.set(...sc);
    cap.rotation.x = HAIR_CAP_TILT;
    head.add(cap);
    triangleCount += tris(capGeo);
  }
  if (hairLen > 0.02) {
    const drop = Math.min(hairLen, 2.7 * h);
    const top: Vec3 = [0, sc[1] + 0.1 * h, sc[2] - sr[2] * 0.95];
    const bot: Vec3 = [0, top[1] - drop, top[2] - 0.35 * h];
    const span = Math.hypot(top[1] - bot[1], top[2] - bot[2]);
    const fallGeo = new THREE.CylinderGeometry(sr[0] * 0.8, sr[0] * 0.45, span, 12);
    const fall = createCelSurface(fallGeo, hairColor);
    fall.position.set(0, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2);
    fall.rotation.x = -Math.atan2(bot[2] - top[2], top[1] - bot[1]);
    head.add(fall);
    triangleCount += tris(fallGeo);
    if (style === "mohawk") {
      const crestGeo = new THREE.BoxGeometry(0.1 * h, 0.25 * h, sr[2] * 2);
      const crest = createCelSurface(crestGeo, hairColor);
      crest.position.set(0, sc[1] + sr[1] * 0.95, sc[2]);
      head.add(crest);
      triangleCount += tris(crestGeo);
    }
  }
  // Beard: the race decides (dwarves always); hangs from the jaw past the chin.
  if (a.beard ?? build.beard) {
    const beardLen = (build.beard ? 0.55 : 0.35) * h;
    const c = at(face.chin);
    const beardGeo = new THREE.CylinderGeometry(0.2 * h, 0.1 * h, beardLen, 10);
    const beard = createCelSurface(beardGeo, a.hair ?? a.body);
    beard.position.set(c[0], c[1] - beardLen * 0.35, c[2] - 0.02 * h);
    beard.rotation.x = -0.15;
    head.add(beard);
    triangleCount += tris(beardGeo);
    add(new THREE.BoxGeometry(0.22 * h, 0.04 * h, 0.03 * h), flat(a.hair ?? a.body), [m[0], m[1] + 0.06 * h, m[2] + 0.01 * h]);
  }
  refs.triangleCount = triangleCount;
  return refs;
}

/** Drive the face parts from the skeleton's facial morph (same mapping as Humanoid.update). */
export function applyFaceMorph(refs: FaceRig, f: { browRaise: number; browFurrow: number; eyeOpen: number; mouthOpen: number; mouthCurve: number }): void {
  const r = refs.unit * 0.5; // Humanoid's morph unit is the skull radius ≈ h / 2
  for (let i = 0; i < refs.brow.length; i++) {
    const b = refs.brow[i];
    b.position.y = refs.browRestY[i] + r * 0.1 * (f.browRaise - f.browFurrow * 0.5);
    b.rotation.z = (f.browFurrow - 0.5) * 0.3 * (b.position.x < 0 ? -1 : 1);
  }
  for (const e of refs.eyelid) e.scale.y = Math.max(0.05, 1 - f.eyeOpen);
  refs.mouth.scale.y = 0.4 + f.mouthOpen * 1.2;
  refs.mouth.position.y = refs.mouthRestY - f.mouthOpen * r * 0.08;
  refs.mouth.rotation.z = f.mouthCurve * 0.2;
}
