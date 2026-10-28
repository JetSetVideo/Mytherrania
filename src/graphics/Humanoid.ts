// @deno-types="@types/three"
import * as THREE from "three";
import { createCelMesh, createCelSurface } from "./shaders/CelShader.ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Skeleton, type JointName } from "../game/Skeleton.ts";
import { buildWeaponMesh } from "./WeaponMesh.ts";
import { spineColumn, spineOffset, smoothSpine } from "../game/SpineCurve.ts";
import { raceBuild, HAIR_LENGTH_M, seededPick } from "../game/RaceAppearance.ts";
import { socketFor } from "../game/BodyGraph.ts";
import { BODY_PARTS, partShape, raceSilhouette, type BodyPartName } from "../game/BodyProfile.ts";
import { buildPart, partMaterial, PART_SAMPLES, stationsFor } from "./BodySurface.ts";
import { connectorGeometry } from "./Loft.ts";
import type { GeneratedWeapon } from "../game/WeaponGen.ts";
import type { Element } from "../game/Skills.ts";
import type { Appearance } from "../game/Characters.ts";

export interface HumanoidRig {
  group: THREE.Group;
  triangleCount: number;
  /** Flare the weapon's elemental effect (0 = off). */
  setEffect(strength: number, time: number): void;
  /**
   * Pose the weapon grip. `pitch` rotates the blade about the hand's local x
   * (negative = tip up), `roll` about its local z (guard/swing plane). Called by
   * the rig update each frame from the skeleton's grip state, so a thrust or a
   * high guard re-aims the blade without rebuilding the mesh.
   */
  setGrip(pitch: number, roll: number): void;
  update(skeleton: Skeleton, dt: number): void;
}

// Which body part each pivot draws, so a pivot can pick up that part's material
// (the head carries a little specular; flesh and cloth carry none).
const PIVOT_PART: Record<string, BodyPartName> = {
  spine: "chest", abdomen: "abdomen", neck: "neck", head: "head",
  shoulderL: "upperArm", shoulderR: "upperArm", elbowL: "foreArm", elbowR: "foreArm",
  hipL: "thigh", hipR: "thigh", kneeL: "shin", kneeR: "shin",
  ankleL: "foot", ankleR: "foot", toeL: "foot", toeR: "foot",
};

const DEFAULT_APPEARANCE: Appearance = { body: "#ef7455", accent: "#dfaa55", height: 1.7, weight: 70, hair: "#172128", beard: false, moustache: false, eyes: "#172128" };

// Cel-shaded humanoid: upper torso -> abdomen -> pelvis, arms with elbows, legs
// with knees, ankles and toes, plus head/face. Each segment pivots at a skeleton
// joint; total height/weight scale the whole rig. Weapon mounts on the right hand.
export function buildHumanoid(weapon: GeneratedWeapon, appearance: Appearance = DEFAULT_APPEARANCE, element: Element = "fire"): HumanoidRig {
  const group = new THREE.Group();
  const pivots = new Map<JointName, THREE.Group>();

  // The race's body proportions come from the silhouette; the appearance traits (hair,
  // beard, tusks, ears) from the race build.
  const sil = appearance.silhouette ?? raceSilhouette(appearance.race ?? "human", appearance.subrace ?? null);

  // Build every part FIRST: the parts' heights set the rig's scale and its ground
  // offset. The engine puts the rig's origin at the body's centre (0.6 above the
  // ground), so the sole must land at -BODY_RADIUS or the legs sink into the floor.
  const BODY_RADIUS = 0.6;
  const parts = new Map<BodyPartName, ReturnType<typeof buildPart>>();
  for (const name of BODY_PARTS) parts.set(name, buildPart(name, sil));
  const P = (n: BodyPartName) => parts.get(n)!;
  const footShape = partShape("foot", sil);
  const footDrop = P("foot").rootRadius * footShape.depth + 0.04;
  const legDrop = 0.14 + 0.22 + P("thigh").height + P("shin").height + footDrop;
  const crownRise = 0.36 + 0.24 + P("head").height / 2;
  // Scale so the fighter is exactly the requested height, then place the spine so the
  // sole sits on the ground:
  //   scale = target / (legDrop + crownRise);  spineY = legDrop - BODY_RADIUS / scale
  const heightScale = appearance.height / (legDrop + crownRise);
  const spineY = legDrop - BODY_RADIUS / heightScale;
  const weightScale = appearance.weight / 70;

  // Higher-poly geometry: every part is a lofted surface (graphics/BodySurface.ts).
  let triCount = 0;

  // Body geometry is accumulated per pivot and MERGED, so each pivot draws one ink
  // outline. An outline per primitive is what made the body read as a stack of tubes:
  // wherever two parts met you saw two overlapping contours instead of one surface.
  type Piece = { geo: THREE.BufferGeometry; pos: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };
  const buckets = new Map<THREE.Object3D, Piece[]>();
  const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number], scale?: [number, number, number]): void => {
    const list = buckets.get(parent);
    if (list) list.push({ geo, pos, rot, scale });
    else buckets.set(parent, [{ geo, pos, rot, scale }]);
  };
  const flushParts = (): void => {
    for (const [parent, pieces] of buckets) {
      const geos = pieces.map((p) => {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(...p.pos),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
          new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
        );
        return p.geo.clone().applyMatrix4(m);
      });
      const merged = mergeGeometries(geos, false) ?? geos[0];
      triCount += countTris(merged);
      parent.add(createCelMesh(merged, appearance.body, partMaterial(PIVOT_PART[parent.name] ?? "chest").specular));
    }
  };

  const makePivot = (name: JointName, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group => {
    const p = new THREE.Group();
    p.name = name;
    p.position.set(x, y, z);
    parent.add(p);
    pivots.set(name, p);
    return p;
  };

  // Body: every part is a LOFTED surface built from the race's silhouette — no boxes,
  // no spheres, no cylinders. Each part's cross-section is a superellipse modulated by
  // muscle lobes, domed at both ends, so neighbouring parts overlap along a curve
  // instead of butting flat caps together.
  const spine = makePivot("spine", group, 0, spineY, 0);
  const chestBow = spineOffset(0.62) * heightScale;
  const chest = P("chest");
  part(spine, chest.geometry, [0, 0.05 - chest.height / 2, chestBow * 0.5]);
  // Pectorals and scapulae: the chest plates the connectivity graph declares as children of
  // the ribcage. +Z is forward (the face is built at +z), so the pectoral mass sits proud of
  // the chest's front face and the scapulae ride its back. Both are flattened along z so
  // they read as plates laid over the ribcage rather than as extra limbs.
  const pect = P("pectorals");
  part(spine, pect.geometry, [0, -0.05, chestBow * 0.5 + chest.rootRadius * 0.68 * weightScale], [0, 0, 0], [1, 1, 0.6]);
  const scap = P("scapulae");
  part(spine, scap.geometry, [0, -0.02, chestBow * 0.5 - chest.rootRadius * 0.66 * weightScale], [0, 0, 0], [1, 1, 0.55]);
  // Spine ridge: the back's S-curve as outline-free contour strips.
  {
    const ridgeMat = appearance.accent;
    const column = smoothSpine(spineColumn(), 2);
    for (let i = 0; i < column.length; i += 5) {
      const v = column[i];
      const geo = new THREE.BoxGeometry(0.06 * weightScale, 0.07, 0.03);
      triCount += countTris(geo);
      const ridge = createCelSurface(geo, ridgeMat);
      ridge.position.set(0, -0.2 + v.y * heightScale * 1.5, -0.19 - v.z * heightScale * 0.9);
      spine.add(ridge);
    }
  }

  // Abdomen and pelvis stack under the chest on the same axis, each a loft whose dome
  // overlaps its neighbour.
  const abdomen = makePivot("abdomen", spine, 0, -0.14, 0);
  const abs = P("abdomen");
  part(abdomen, abs.geometry, [0, -0.29, 0]);
  const pelvis = P("pelvis");
  part(abdomen, pelvis.geometry, [0, -0.3, 0]);

  // Neck + head + face. The neck is long enough to leave a visible gap between the
  // torso top and the chin, so a beard hangs in the open instead of inside the torso.
  const neck = makePivot("neck", spine, 0, 0.36, 0);
  const neckPart = P("neck");
  part(neck, neckPart.geometry, [0, -0.03, 0]);
  const head = makePivot("head", neck, 0, 0.24, 0);
  const headPart = P("head");
  part(head, headPart.geometry, [0, -0.18, 0]);
  // The face projects onto the head's actual root radius, so the features sit on the
  // lofted skull rather than a nominal sphere.
  const faceRefs = addFace(head, appearance, headPart.rootRadius * 0.95);

  // Shoulders/arms
  for (const side of ["L", "R"] as const) {
    // The shoulder sits on the silhouette's shoulder offset, so a wide race's arm rides
    // on its own body rather than being swallowed by it.
    const sx = side === "L" ? sil.shoulder : -sil.shoulder;
    // Seat the arm INTO the torso using the shoulder link's `seat` from the connectivity
    // graph. The pivot is pulled inboard by that amount, so the deltoid mass overlaps the
    // ribcage and the limb emerges from the body instead of butting against it with a step.
    const armSeat = socketFor("upperArm")?.seat ?? 0;
    const shoulder = makePivot(`shoulder${side}` as JointName, spine, (sx - Math.sign(sx) * armSeat) * weightScale, 0.16, 0);
    const upper = P("upperArm");
    // Rotated a half turn so the loft hangs DOWN from the pivot (its root at the
    // shoulder, its tip at the elbow) without mirroring the section.
    part(shoulder, upper.geometry, [0, 0, 0], [Math.PI, 0, 0]);
    // SOCKET (sculpt spec §5). The SPINE pivot owns a sphere centred exactly on the shoulder
    // pivot. A sphere is the only shape invariant under rotation about its own centre, so the
    // limb's root stays buried inside it in EVERY pose and no rotation can open a gap. A
    // connector loft cannot do this: its two ends would have to live in two independently
    // animated frames at once, which is exactly why the earlier collar attempt tore into a
    // blade. R = k * limb root radius, k = 1.35.
    part(spine, new THREE.SphereGeometry(1.35 * stationsFor("upperArm", sil)[0].radius, 22, 16), [(sx - Math.sign(sx) * armSeat) * weightScale, 0.16, 0]);
    const elbow = makePivot(`elbow${side}` as JointName, shoulder, 0, -upper.height, 0);
    // Connection form: the upper arm's tip section carried into the forearm's root
    // section, so the elbow is one surface rather than two domes crossing.
    part(elbow, connectorGeometry(stationsFor("upperArm", sil)[PART_SAMPLES - 1], stationsFor("foreArm", sil)[0], 0.14), [0, 0.07, 0], [Math.PI, 0, 0]);
    const fore = P("foreArm");
    part(elbow, fore.geometry, [0, 0, 0], [Math.PI, 0, 0]);
    // Hand: a loft (the palm's own organic section), with fingers and an opposed thumb
    // built from the same surface scaled down — not boxes and cylinders.
    const handRoot = new THREE.Group();
    handRoot.position.y = -fore.height;
    elbow.add(handRoot);
    const hand = P("hand");
    part(handRoot, hand.geometry, [0, -0.02, 0], [Math.PI, 0, 0]);
    for (let fi = 0; fi < 4; fi++) {
      const fx = (fi - 1.5) * 0.027 * weightScale;
      const len = fi === 0 || fi === 3 ? 0.045 : 0.055;
      part(handRoot, hand.geometry, [fx, -0.13 - len / 2 + 0.01, 0.008], [Math.PI - 0.5, 0, 0], [0.24, 0.34, 0.22]);
      part(handRoot, hand.geometry, [fx, -0.13 - len - 0.004, 0.035], [Math.PI - 1.3, 0, 0], [0.2, 0.28, 0.19]);
    }
    const inward = side === "L" ? -1 : 1; // thumb sits on the body side of each hand
    part(handRoot, hand.geometry, [inward * 0.065 * weightScale, -0.07, 0.035], [Math.PI - 0.6, 0, -inward * 0.9], [0.26, 0.4, 0.24]);
  }

  // Hips -> thighs -> knees -> shins -> ankles -> feet -> toes
  for (const side of ["L", "R"] as const) {
    const sx = side === "L" ? -sil.hip : sil.hip;
    // Same seating rule at the hip: the thigh's root is driven into the pelvis so the
    // gluteal mass fuses into the torso instead of showing a step at the waist.
    const hipSeat = socketFor("thigh")?.seat ?? 0;
    const hip = makePivot(`hip${side}` as JointName, abdomen, (sx - Math.sign(sx) * hipSeat) * weightScale, -0.22, 0);
    const thigh = P("thigh");
    part(hip, thigh.geometry, [0, 0, 0], [Math.PI, 0, 0]);
    // Hip socket, same construction: the ABDOMEN pivot owns a sphere centred on the hip
    // pivot, so the thigh's root stays buried in every pose. The hip uses a larger k than
    // the shoulder: the pelvis is wide and the thigh root small, so at k=1.35 the sphere
    // sat inside the torso silhouette and a slight step still read at the top of the leg.
    // k stays inside the sculpt spec's [1.15, 1.80] band.
    part(abdomen, new THREE.SphereGeometry(1.6 * stationsFor("thigh", sil)[0].radius, 22, 16), [(sx - Math.sign(sx) * hipSeat) * weightScale, -0.22, 0]);
    const knee = makePivot(`knee${side}` as JointName, hip, 0, -thigh.height, 0);
    part(knee, connectorGeometry(stationsFor("thigh", sil)[PART_SAMPLES - 1], stationsFor("shin", sil)[0], 0.14), [0, 0.07, 0], [Math.PI, 0, 0]);
    const shin = P("shin");
    part(knee, shin.geometry, [0, 0, 0], [Math.PI, 0, 0]);
    const ankle = makePivot(`ankle${side}` as JointName, knee, 0, -shin.height, 0);
    const foot = P("foot");
    // The foot loft runs along +z (forward) rather than down, so the sole is a surface.
    part(ankle, foot.geometry, [0, -0.04, 0.02], [Math.PI / 2, 0, 0]);
    const toe = makePivot(`toe${side}` as JointName, ankle, 0, -0.05, 0.22);
    part(toe, foot.geometry, [0, 0, 0.05], [Math.PI / 2, 0, 0], [0.9, 0.5, 0.4]);
  }

  // Weapon: the procedural generator's parts, gripped in the right fist. The rest
  // pose points the blade UP the local +z axis (tilted away from the ground): the
  // mesh is built along its own +y, so a pitch of -0.35 lays it mostly upright with
  // a slight forward cant. Combat stances re-aim it through setGrip — a thrust
  // levels it onto the forward vector, a high guard lifts it near-vertical, a swing
  // rolls it onto the arc plane. The elemental effect shell rides the striking parts.
  const grip = new THREE.Group();
  grip.position.set(0, -0.53, 0.03);
  grip.rotation.x = -0.35;
  pivots.get("elbowR")!.add(grip);
  const weaponMesh = buildWeaponMesh(weapon, element);
  grip.add(weaponMesh.group);
  triCount += weaponMesh.triangleCount;

  group.scale.setScalar(heightScale);
  // Emit the merged body: one surface + one ink outline per pivot.
  flushParts();

  return {
    group,
    triangleCount: triCount,
    setEffect(strength: number, time: number): void { weaponMesh.setEffect(strength, time); },
    setGrip(pitch: number, roll: number): void { grip.rotation.x = pitch; grip.rotation.z = roll; },
    update(sk: Skeleton, dt: number): void {
      sk.update(dt);
      for (const [name, pivot] of pivots) {
        const joint = sk.joint(name);
        pivot.rotation.set(joint.angle, 0, 0);
      }
      // Facial morph: eyebrows, eyelids and mouth follow the combat state. The brow
      // raises/furrows, the eyelid opens/closes over the eye, the mouth opens.
      {
        const f = sk.face.face();
        const r = 0.18 * weightScale;
        for (const b of faceRefs.brow) {
          b.position.y = r * 0.22 + r * 0.1 * (f.browRaise - f.browFurrow * 0.5);
          b.rotation.z = (f.browFurrow - 0.5) * 0.3 * (b.position.x < 0 ? -1 : 1);
        }
        for (const e of faceRefs.eyelid) e.scale.y = Math.max(0.05, 1 - f.eyeOpen);
        if (faceRefs.mouth) {
          faceRefs.mouth.scale.y = 0.4 + f.mouthOpen * 1.2;
          faceRefs.mouth.position.y = -r * 0.5 - f.mouthOpen * r * 0.08;
          faceRefs.mouth.rotation.z = f.mouthCurve * 0.2;
        }
      }
    },
  };
}

function countTris(geo: THREE.BufferGeometry): number {
  if (geo.index) return geo.index.count / 3;
  const pos = geo.getAttribute("position");
  return pos ? pos.count / 3 : 0;
}

// Face features are projected onto the skull sphere (radius r): each feature is
// placed at the surface point for its (x, y) and pushed out by half its depth, so
// nothing is buried inside the head. Unlit MeshBasic + cel colours keep the face
// readable regardless of the time of day.
function addFace(head: THREE.Group, a: Appearance, r: number): { brow: THREE.Mesh[]; eyelid: THREE.Mesh[]; mouth: THREE.Mesh } {
  const build = raceBuild(a.race ?? "human", a.subrace ?? null);
  const onSkull = (x: number, y: number) => Math.sqrt(Math.max(0, r * r - x * x - y * y));
  const refs = { brow: [] as THREE.Mesh[], eyelid: [] as THREE.Mesh[], mouth: null as unknown as THREE.Mesh };
  const mk = (w: number, h: number, d: number, x: number, y: number, color: string, out = 0) => {
    const c = new THREE.Color(color);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(0.45) }));
    m.position.set(x, y, onSkull(x, y) + d / 2 - 0.004 + out);
    head.add(m);
    return m;
  };
  const ex = r * 0.38, ey = r * 0.22;
  // Eyes: sclera, iris, pupil, brow ridge
  for (const sx of [-1, 1]) {
    // Stylised large eyes so they read at third-person distance: sclera, dark limbal
    // ring, saturated iris, pupil, catch-light.
    mk(r * 0.5, r * 0.34, 0.012, sx * ex, ey, "#f6f1e6");
    mk(r * 0.32, r * 0.32, 0.012, sx * ex, ey, "#1d140c", 0.004);
    mk(r * 0.26, r * 0.26, 0.012, sx * ex, ey, irisColour(a), 0.008);
    mk(r * 0.11, r * 0.12, 0.008, sx * ex, ey, "#050505", 0.014);
    mk(r * 0.06, r * 0.06, 0.006, sx * ex + r * 0.06, ey + r * 0.07, "#ffffff", 0.018); // catch-light
    // The brow ridge and the eyelid: deformable (the morph moves these).
    refs.brow.push(mk(r * 0.46, r * 0.08, 0.03, sx * ex, ey + r * 0.22, a.hair ?? "#2a1d14"));
    refs.eyelid.push(mk(r * 0.5, r * 0.1, 0.014, sx * ex, ey + r * 0.16, shade(a.body, 0.7), 0.006));
    // Cheekbones and ears (ear length scales with the race: elves long, orks short)
    mk(r * 0.28, r * 0.14, 0.03, sx * r * 0.55, -r * 0.08, shade(a.body, 0.92));
    const earLen = r * 0.2 * build.earMul;
    const ear = new THREE.Mesh(new THREE.SphereGeometry(earLen, 10, 8), new THREE.MeshLambertMaterial({ color: shade(a.body, 0.85), emissive: new THREE.Color(shade(a.body, 0.3)) }));
    ear.scale.set(0.45, 1 + (build.earMul - 1) * 1.2, 0.7);
    ear.position.set(sx * r * 1.04, r * 0.02 + (build.earMul - 1) * r * 0.1, r * 0.02);
    head.add(ear);
  }
  // Nose bridge + tip + nostrils
  mk(r * 0.16, r * 0.34, 0.035, 0, 0, shade(a.body, 0.8));
  mk(r * 0.28, r * 0.16, 0.06, 0, -r * 0.18, shade(a.body, 0.68));
  for (const sx of [-1, 1]) mk(r * 0.06, r * 0.05, 0.01, sx * r * 0.06, -r * 0.24, "#3a1f18", 0.03);
  // Lips (upper/lower) and maw line — the lower lip is the deformable mouth.
  mk(r * 0.46, r * 0.11, 0.022, 0, -r * 0.37, "#9e3d3a");             // upper lip
  mk(r * 0.36, r * 0.022, 0.012, 0, -r * 0.43, "#3a1210", 0.004);      // maw line
  refs.mouth = mk(r * 0.4, r * 0.12, 0.022, 0, -r * 0.5, "#b8504a");   // lower lip (the mouth)
  // Ork underbite: the lower jaw and tusks protrude past the upper teeth. The
  // underbite value pushes the lower jaw forward and adds two up-curved tusks
  // that rise ABOVE the lower lip, further out than the top teeth.
  if (build.underbite > 0.01) {
    const jut = build.underbite * r;
    // Lower jaw pushed forward.
    mk(r * 0.5, r * 0.16, 0.05, 0, -r * 0.6, shade(a.body, 0.82), jut * 0.6);
    // Two tusks curving up from the lower jaw, tips past the upper teeth line.
    for (const sx of [-1, 1]) {
      const tusk = new THREE.Mesh(
        new THREE.ConeGeometry(r * 0.06, r * 0.3 + jut * 0.5, 6),
        new THREE.MeshLambertMaterial({ color: "#efe6d0", emissive: new THREE.Color("#5a5240") }),
      );
      tusk.position.set(sx * r * 0.28, -r * 0.42 + (r * 0.15 + jut * 0.25), onSkull(sx * r * 0.28, -r * 0.42) + jut * 0.9);
      tusk.rotation.x = -0.35; // tilt forward, tips up and out
      head.add(tusk);
    }
  }
  // Jaw / chin
  mk(r * 0.5, r * 0.16, 0.03, 0, -r * 0.68, shade(a.body, 0.93));
  // Hair cap + length: the race's hair length grows a back fall (long for elves,
  // short for orks), shaped by the race's haircut style.
  const hairLen = HAIR_LENGTH_M[build.hairLength] * (r / 0.18); // scale to head size
  const hairColor = a.hair ?? a.body;
  const style = seededPick(build.hairStyles, (a.race ?? "human").length * 31 + (a.subrace ?? "").length);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36), new THREE.MeshBasicMaterial({ color: hairColor }));
  cap.rotation.x = -0.35;
  head.add(cap);
  if (hairLen > 0.02) {
    // The back fall drapes from the nape down the BACK, so it must sit outside the
    // torso silhouette (local -Z beyond the torso radius) or the torso occludes it.
    // A slanted mass from the head's back down to mid-back reads as long hair.
    const drop = Math.min(hairLen, 0.62);
    const topY = r * 0.3, topZ = -r * 1.05;
    // The torso radius is ~r*2.11, so the fall's lower end must sit beyond it
    // (z < -r*2.11) or the torso occludes the drape from every side view.
    const botY = topY - drop, botZ = -r * 2.35;
    const midY = (topY + botY) / 2, midZ = (topZ + botZ) / 2;
    const span = Math.hypot(topY - botY, topZ - botZ);
    const fall = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.72, r * 0.4, span, 10),
      new THREE.MeshBasicMaterial({ color: hairColor }),
    );
    fall.position.set(0, midY, midZ);
    // Tilt the drape about X so it sweeps backward as it descends.
    fall.rotation.x = -Math.atan2(botZ - topZ, topY - botY);
    head.add(fall);
    // A rounded tip so the end of the fall reads as a mass, not an open tube.
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 10, 8), new THREE.MeshBasicMaterial({ color: hairColor }));
    tip.position.set(0, botY, botZ);
    head.add(tip);
    // Side locks framing the face (medium+ hair), hanging beside the jaw.
    if (hairLen > 0.12) {
      for (const sx of [-1, 1]) {
        const lock = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.05, drop * 0.85, 6), new THREE.MeshBasicMaterial({ color: hairColor }));
        lock.position.set(sx * r * 0.85, topY - drop * 0.45, -r * 0.1);
        head.add(lock);
      }
    }
    // A mohawk crest for the ork/mohawk style.
    if (style === "mohawk") {
      const crest = new THREE.Mesh(new THREE.BoxGeometry(r * 0.14, r * 0.55, r * 1.15), new THREE.MeshBasicMaterial({ color: hairColor }));
      crest.position.set(0, r * 0.6, -r * 0.1);
      head.add(crest);
    }
    // A braid tail for braided styles.
    if (style === "braided") {
      const braid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.05, hairLen, 6), new THREE.MeshBasicMaterial({ color: hairColor }));
      braid.position.set(r * 0.5, r * 0.1 - hairLen / 2, -r * 0.3);
      head.add(braid);
    }
  }
  // Beard: the race decides whether facial hair grows (dwarves always, most humans
  // optionally); a per-character flag can force it on. The mass hangs from the jaw
  // past the chin so it reads from the front and the side.
  const hasBeard = a.beard ?? build.beard;
  if (hasBeard) {
    const beardColor = a.hair ?? a.body;
    const beardLen = r * (build.beard ? 0.75 : 0.5);
    const jawY = -r * 0.45;
    const beard = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.44, r * 0.24, beardLen, 10),
      new THREE.MeshLambertMaterial({ color: beardColor, emissive: new THREE.Color(shade(beardColor, 0.3)) }),
    );
    // Hang from the jaw down and slightly forward, so the mass sits on the chin
    // without covering the mouth and eyes above it.
    beard.position.set(0, jawY - beardLen * 0.5, onSkull(0, jawY) * 0.5);
    beard.rotation.x = -0.1;
    head.add(beard);
    // A rounded tip so the beard ends in a mass, not an open tube.
    const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 8, 6), new THREE.MeshBasicMaterial({ color: beardColor }));
    tip.position.set(0, jawY - beardLen, onSkull(0, jawY) * 0.5 + beardLen * 0.08);
    head.add(tip);
    // Moustache bar across the upper lip.
    mk(r * 0.5, r * 0.09, 0.03, 0, -r * 0.33, beardColor, 0.02);
  }
  if (a.moustache) mk(r * 0.5, r * 0.08, 0.025, 0, -r * 0.33, a.hair ?? a.body, 0.02);
  return refs;
}

/** Iris colour that contrasts with both the white sclera and the skin. */
function irisColour(a: Appearance): string {
  const eye = new THREE.Color(a.eyes), skin = new THREE.Color(a.body);
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const dist = Math.abs(eye.r - skin.r) + Math.abs(eye.g - skin.g) + Math.abs(eye.b - skin.b);
  if (lum(eye) > 0.55 || lum(eye) < 0.04 || dist < 0.5) return "#2f6fb5"; // too pale/dark/skin-like → blue
  return `#${eye.multiplyScalar(0.8).getHexString()}`;
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}
