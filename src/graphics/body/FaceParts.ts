// Rigid face/hair parts of the skinned body (lane A, R03): eyes, brows, eyelids, lips, hair,
// beard and ork tusks, parented to the HEAD bone. Re-implements the parts of Humanoid.addFace
// (not exported there) against the SDF head's anchors, so the features sit in the carved eye
// sockets and on the generated skull rather than on a nominal sphere.

// @deno-types="@types/three"
import * as THREE from "three";
import { createCelSurface } from "../shaders/CelShader.ts";
import { raceBuild, seededPick } from "../../game/RaceAppearance.ts";
import { ancestryOf } from "../../game/Ancestry.ts";
import { beardModeFor, hairColourFor, hairFall, hairLengthM, isBald, lookSeed, tuskDims } from "./Proportions.ts";
import type { Appearance } from "../../game/Characters.ts";
import type { Vec3 } from "./contracts.ts";
import { browWedge, type FaceAnchors, HAIR_CAP_POLAR, HAIR_CAP_SCALE, HAIR_CAP_TILT, lidBands } from "./AnatomyParts.ts";

/** The parts the face morph drives each frame (brow, eyelid, mouth), like Humanoid's refs. */
export interface FaceRig {
  brow: THREE.Mesh[];
  eyelid: THREE.Mesh[];
  /** The lower lid bands (lane Q-A): every model has an upper AND a lower lid. */
  eyelidLower: THREE.Mesh[];
  mouth: THREE.Mesh;
  /** Rest heights (head-bone space) the morph offsets from. */
  browRestY: number[];
  mouthRestY: number;
  /** The head unit the morph's displacements are scaled by (m). */
  unit: number;
  triangleCount: number;
  /**
   * The lignes that MOVE: the hair fall, its lobes, the crest and the beard mass. Wave H's
   * SecondaryMotion drives these (wind + the head's own velocity, damped spring), so they are
   * returned separately from the rigid face parts. The brows are NOT here on purpose: the facial
   * morph owns their transform every frame (DESIGN.md item 12), and two writers on one node is
   * exactly the bug the animation tensor work already hit once.
   */
  secondary: THREE.Object3D[];
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
  // The ancestry node drives the look (BRIEF 1.1); the seed makes one member of a race differ
  // from the next while staying reproducible.
  const node = ancestryOf(a.race ?? "human", a.subrace ?? null);
  const seed = lookSeed(a);
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
  const refs: FaceRig = { brow: [], eyelid: [], eyelidLower: [], mouth: null as unknown as THREE.Mesh, browRestY: [], mouthRestY: 0, unit, triangleCount: 0, secondary: [] };
  // Eyelid bands (lane Q-A): the ancestry's lid block (head heights) × h, per eye. The upper band
  // spans from the eyeball's top down to the opening; the lower from the bottom up to the opening,
  // so the visible aperture is node.lid.aperture and both bands overlap the recessed globe.
  const lb = lidBands(node, h);
  const halfAperture = lb.aperture / 2;
  const shell = r * 1.04;
  const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
  // Eyes: sclera ball in the socket, iris and pupil discs on its front, a catch-light.
  for (let i = 0; i < 2; i++) {
    const e = at(face.eye[i]);
    add(new THREE.SphereGeometry(r, 14, 10), flat("#f6f1e6"), e);
    const iris = add(new THREE.CircleGeometry(r * 0.55, 16), flat(irisColour(a)), [e[0], e[1], e[2] + r * 0.985]);
    iris.renderOrder = 1;
    add(new THREE.CircleGeometry(r * 0.25, 12), flat("#050505"), [e[0], e[1], e[2] + r * 0.99]);
    add(new THREE.CircleGeometry(r * 0.1, 8), flat("#ffffff"), [e[0] + r * 0.2, e[1] + r * 0.2, e[2] + r * 0.995]);
    // Upper lid: a spherical zone from the eyeball's top down to y = +aperture/2 (its rim), of
    // height min(R, aperture/2 + upperThickness); scale.y = 1 − eyeOpen lowers it to close the eye.
    const yUpTop = Math.min(shell, halfAperture + lb.upperThickness);
    const thUpStart = Math.acos(clampUnit(yUpTop / shell));
    const thUpEnd = Math.acos(clampUnit(halfAperture / shell));
    const upperGeo = new THREE.SphereGeometry(shell, 10, 3, 0, Math.PI * 2, thUpStart, Math.max(1e-3, thUpEnd - thUpStart));
    refs.eyelid.push(add(upperGeo, flat(shade(a.body, 0.7)), [e[0], e[1], e[2]]));
    // Lower lid: the mirror band, from the bottom up to y = −aperture/2.
    const yLoBot = -Math.min(shell, halfAperture + lb.lowerThickness);
    const thLoStart = Math.acos(clampUnit(-halfAperture / shell));
    const thLoEnd = Math.acos(clampUnit(yLoBot / shell));
    const lowerGeo = new THREE.SphereGeometry(shell, 10, 3, 0, Math.PI * 2, thLoStart, Math.max(1e-3, thLoEnd - thLoStart));
    refs.eyelidLower.push(add(lowerGeo, flat(shade(a.body, 0.7)), [e[0], e[1], e[2]]));
    const b = at(face.brow[i]);
    // Brow from the ancestry: a POINTED wedge (lane Q-A), no longer a box. browWedge gives the
    // inner root radius and the outer tip (tipR ≪ rootR, brow.point sharpens it); the tip's x is
    // stated in head heights. A 6-sided cone flattened along the face depth reads as a ridge that
    // runs to a point at its outer end. The mesh stays in refs.brow, so the morph keeps driving it.
    const w = browWedge(node, h, face.eye[i][1]);
    const browColour = hairColourFor(node, seed);
    const sgn = b[0] < 0 ? -1 : 1;
    const len = w.tipX - w.innerX;
    const brow = add(new THREE.ConeGeometry(w.rootR, len, 6), flat(browColour),
      at([sgn * (w.innerX + w.tipX) * 0.5, w.y, w.z]));
    brow.scale.set(1, 1, 0.5);                 // flatten the cone into a ridge in the face depth
    brow.rotation.z = sgn > 0 ? -Math.PI / 2 : Math.PI / 2; // apex (point) points outward
    refs.brow.push(brow);
    refs.browRestY.push(b[1]);
  }
  // Lips: upper lip, maw line and the lower lip the morph opens.
  const m = at(face.mouth);
  add(new THREE.BoxGeometry(0.2 * h, 0.045 * h, 0.03 * h), flat("#9e3d3a"), [m[0], m[1] + 0.03 * h, m[2]]);
  add(new THREE.BoxGeometry(0.16 * h, 0.012 * h, 0.02 * h), flat("#3a1210"), [m[0], m[1], m[2] + 0.004 * h]);
  refs.mouth = add(new THREE.BoxGeometry(0.18 * h, 0.05 * h, 0.03 * h), flat("#b8504a"), [m[0], m[1] - 0.035 * h, m[2]]);
  refs.mouthRestY = m[1] - 0.035 * h;
  // Tusks: the count and protrusion come from the ancestry (ork = 2 lower tusks rising past the
  // upper lip, tips up and out; every other ancestry = none). The ork's underbite jaw jut is kept.
  const tk = tuskDims(node, h);
  if (tk.count > 0) {
    for (let i = 0; i < tk.count; i++) {
      const s = i % 2 === 0 ? -1 : 1;
      const tusk = add(new THREE.ConeGeometry(0.03 * h, tk.length, 6), flat("#efe6d0"), [m[0] + s * 0.11 * h, m[1] + 0.02 * h, m[2] + 0.03 * h + tk.protrusion * 0.4]);
      tusk.rotation.x = -0.35 - node.tusk.protrusion * 0.3; // tips up and out, sized by protrusion
    }
  }
  // Hair: colours/curl/density/length from the ancestry. A bald draw is deterministic from the
  // character seed, and a baldChance of 0 (the elf) is NEVER bald. The cap sits over the skull
  // ellipsoid; the fall down the back is WIDENED and SHORTENED by curl, with lobes when it coils.
  const bald = isBald(node, seed);
  const hairColor = hairColourFor(node, seed);
  const style = seededPick(node.hair.styles, (a.race ?? "human").length * 31 + (a.subrace ?? "").length);
  const sc = at(face.skullCentre), sr = face.skullRadii;
  const hairLen = hairLengthM(node, h);
  if (!bald && node.hair.length !== "bald") {
    // The shell's size, extent and tilt are shared with AnatomyParts so pointed ears clear it.
    const capGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, HAIR_CAP_POLAR);
    const cap = createCelSurface(capGeo, hairColor);
    cap.scale.set(sr[0] * HAIR_CAP_SCALE, sr[1] * HAIR_CAP_SCALE, sr[2] * HAIR_CAP_SCALE);
    cap.position.set(...sc);
    cap.rotation.x = HAIR_CAP_TILT;
    head.add(cap);
    triangleCount += tris(capGeo);
  }
  if (!bald && hairLen > 0.02) {
    const fall = hairFall(node.hair.curl, node.hair.density, hairLen, h);
    const top: Vec3 = [0, sc[1] + 0.1 * h, sc[2] - sr[2] * 0.95];
    const bot: Vec3 = [0, top[1] - fall.drop, top[2] - 0.35 * h];
    const span = Math.hypot(top[1] - bot[1], top[2] - bot[2]);
    const fallGeo = new THREE.CylinderGeometry(fall.topRadius, fall.botRadius, span, 12);
    const fallMesh = createCelSurface(fallGeo, hairColor);
    fallMesh.position.set(0, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2);
    fallMesh.rotation.x = -Math.atan2(bot[2] - top[2], top[1] - bot[1]);
    head.add(fallMesh);
    refs.secondary.push(fallMesh);
    triangleCount += tris(fallGeo);
    // Lobes: a coiled fall reads as a lumpier mass, a straight one stays a smooth tube.
    for (let i = 0; i < Math.min(fall.lobes, 4); i++) {
      const a2 = (i / fall.lobes) * Math.PI * 2;
      const lobeGeo = new THREE.SphereGeometry(fall.botRadius * 0.5, 8, 6);
      const lobe = createCelSurface(lobeGeo, hairColor);
      lobe.position.set(Math.cos(a2) * fall.topRadius * 0.55, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2 + Math.sin(a2) * fall.topRadius * 0.55);
      head.add(lobe);
      refs.secondary.push(lobe);
      triangleCount += tris(lobeGeo);
    }
    if (style === "mohawk") {
      const crestGeo = new THREE.BoxGeometry(0.1 * h, 0.25 * h, sr[2] * 2);
      const crest = createCelSurface(crestGeo, hairColor);
      crest.position.set(0, sc[1] + sr[1] * 0.95, sc[2]);
      head.add(crest);
      refs.secondary.push(crest);
      triangleCount += tris(crestGeo);
    }
  }
  // Beard from the ancestry: mode none|chin|moustache-thin|moustache|full, gated by required/
  // allowed. A "full" mass hangs from the chin into the neck gap but the TOP stays below the
  // mouth line, so a coverage < 1 always shows as the mouth still readable.
  const mode = beardModeFor(node, a.beard ?? build.beard);
  const beardColour = hairColor;
  const c = at(face.chin);
  if (mode === "moustache-thin" || mode === "moustache" || mode === "full") {
    const barT = mode === "moustache-thin" ? 0.028 : 0.05; // thin = a thin bar only
    add(new THREE.BoxGeometry(0.2 * h, barT * h, 0.03 * h), flat(beardColour), [m[0], m[1] + 0.06 * h, m[2] + 0.01 * h]);
  }
  if (mode === "full" || mode === "chin" || mode === "moustache") {
    const bd = node.beard;
    const chinOnly = mode === "chin"; // a chin-only growth, never a jaw-wrapping mass
    const beardLen = (mode === "full" ? 0.5 : 0.3) * h * bd.lengthMul;
    const beardGeo = new THREE.CylinderGeometry((chinOnly ? 0.16 : 0.2) * h, 0.1 * h, beardLen, 10);
    const beard = createCelSurface(beardGeo, beardColour);
    const topY = c[1] + 0.02 * h; // below the mouth line -> the mouth stays visible
    beard.position.set(c[0], topY - beardLen / 2, c[2] - 0.02 * h);
    beard.rotation.x = -0.15;
    head.add(beard);
    refs.secondary.push(beard);
    triangleCount += tris(beardGeo);
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
  for (const e of refs.eyelidLower) e.scale.y = Math.max(0.05, 1 - f.eyeOpen);
  refs.mouth.scale.y = 0.4 + f.mouthOpen * 1.2;
  refs.mouth.position.y = refs.mouthRestY - f.mouthOpen * r * 0.08;
  refs.mouth.rotation.z = f.mouthCurve * 0.2;
}
