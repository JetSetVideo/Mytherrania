// Rigid face/hair parts of the skinned body (lane A, R03): eyes, brows, eyelids, lips, hair,
// beard and ork tusks, parented to the HEAD bone. Re-implements the parts of Humanoid.addFace
// (not exported there) against the SDF head's anchors, so the features sit in the carved eye
// sockets and on the generated skull rather than on a nominal sphere.
//
// Lane R-B (wave R) adds three things, each a stated number rather than an adjective:
//   * the hair's FALL is FITTED to the skull — a polyline whose near surface rides the cranium
//     ellipsoid at a stated shell gap, so the mass never sinks into the skull and never floats
//     off it (FaceParts.hairFallPath + skullClearance; the test measures the built vertices);
//   * the eye is ROUND (a higher-segment globe + iris edge count, measured by roundnessOf), the
//     globe carries a WET GLINT (a specular highlight plus a small secondary catch-light) and the
//     iris carries fine PAINTED flecks instead of a flat disc (EYE.fleck*: count/size in mm);
//   * the nails get their own painted pass in Recipes.ts (the eye/nail passes only there).

// @deno-types="@types/three"
import * as THREE from "three";
import { createCelSurface } from "../shaders/CelShader.ts";
import { raceBuild } from "../../game/RaceAppearance.ts";
import { greyFraction, lifeFraction } from "../../game/Age.ts";
import { ancestryOf } from "../../game/Ancestry.ts";
import { beardModeFor, hairColourFor, hairLengthM, isBald, lookSeed, tuskDims } from "./Proportions.ts";
import type { Appearance } from "../../game/Characters.ts";
import type { Vec3 } from "./contracts.ts";
import { browWedge, type FaceAnchors, lidBands } from "./AnatomyParts.ts";
import { headFrameOf } from "./HairFollicles.ts";
import { buildHairMeshes } from "./HairMesh.ts";
import { greyRgb } from "./HairShade.ts";
import { shadeHex, tintHex } from "../paint/Blend.ts";

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
   * The lignes that MOVE: the hanging hair locks (one per root sector), the ponytail, the braids
   * (wave X lane H; formerly the fall tubes, lobes and crest) and the beard mass. Wave H's
   * SecondaryMotion drives these (wind + the head's own velocity, damped spring), so they are
   * returned separately from the rigid face parts. The brows are NOT here on purpose: the facial
   * morph owns their transform every frame (DESIGN.md item 12), and two writers on one node is
   * exactly the bug the animation tensor work already hit once.
   */
  secondary: THREE.Object3D[];
  /**
   * The hair's SKULL-HUGGING parts only: since wave X (lane H) the underlayer, the scalp parts
   * of the grown strand cards, the bun and the root ties. Exposed so a test can measure their
   * clearance to the head's own surface; the hanging locks / tail / braids are in `secondary`.
   */
  hairParts: THREE.Object3D[];
  /** Wave X lane H: what the grown hair is (QA evidence; absent when bald). */
  hairStats?: {
    style: string; tier: string; follicles: number; clumps: number; triangles: number;
    minClearance: number; grey: number; recession: number; braids: number;
  };
}

/**
 * A hair colour greyed by grey fraction g (Age.greyFraction): the brows and the beard grey with
 * the scalp hair (the scalp itself greys per strand in HairMesh). sRGB hex in, sRGB hex out.
 */
export function greyedHex(hex: string, race: string, g: number): string {
  if (g <= 0) return hex;
  const gr = greyRgb(race, g);
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(gr[0], gr[1], gr[2]), Math.min(1, g * 0.9));
  return `#${c.getHexString()}`;
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

/**
 * The eye's look (lane R-B), on the eye's own scale (× the globe radius r) unless stated. The
 * segment counts set how ROUND the parts are: a disc of n edges inscribed in its circle has
 * roundnessOf(n), so the iris edge count is the one that matters for "not square".
 */
export const EYE = {
  /** Sclera sphere segments (lon, lat): the globe's own silhouette resolution (already a sphere). */
  globeLon: 14,
  globeLat: 10,
  /** Iris disc edges. 32 edges -> roundnessOf = 0.990 (was 16 -> 0.950): the iris reads round. */
  irisSegments: 32,
  pupilSegments: 16,
  /** Iris / pupil disc radius as fractions of the globe radius r. */
  irisRadius: 0.55,
  pupilRadius: 0.22,
  /** Fine painted flecks on the iris: count, and radius as a fraction of the iris disc radius. */
  fleckCount: 8,
  fleckRadius: 0.16,
  /** The wet glint: radius (× r), its y-squash (a specular on a wet curve) and its centre offset. */
  glintRadius: 0.30,
  glintSquash: 0.7,
  glintX: 0.30,
  glintY: 0.34,
  /** A small secondary catch-light on the far side (two highlights read as a moist surface). */
  glint2Radius: 0.10,
  glint2X: -0.24,
  glint2Y: -0.28,
} as const;

/**
 * Roundness of a regular n-gon inscribed in its circumcircle: area(ngon) / area(circle) =
 * (n / 2π)·sin(2π/n). 1 = a perfect circle; 14 edges -> 0.950, 18 -> 0.970, 32 -> 0.990.
 */
export function roundnessOf(n: number): number {
  return (n / (2 * Math.PI)) * Math.sin((2 * Math.PI) / n);
}

/** The hair's fit to the skull (lane R-B), head heights unless stated. */
export const HAIR_FIT = {
  /**
   * Radial gap between the skull's surface and the hair fall's NEAR surface, head heights
   * (0.04 h ≈ 0.9 cm on a 22.7 cm head): the fall rides the cranium just clear of it.
   */
  shellGapPerHead: 0.04,
  /** Vertical tube segments the fall is built from (each rides the skull's back). */
  fallSegments: 8,
  /** Radial segments of each fall tube (a smooth tube, not a prism). */
  fallRadialSegments: 6,
  /** Fall radius clamps (× h): the mass's own thickness behind the skull (not a float). */
  fallRadiusTopPerHead: 0.10,
  fallRadiusBotPerHead: 0.07,
  /** The band is measured where the skull has real depth (|y − centre| / y-radius ≤ this). */
  bandWindowPerRadius: 0.6,
  /** The stated clearance band the fall's NEAR surface sits in, head heights. */
  minClearancePerHead: 0.008,
  maxClearancePerHead: 0.10,
} as const;

/** Deterministic [0,1) hash of a seed (no Math.random anywhere in this pure module). */
function unitHash(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x27d4eb2d, 0x165667b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0; // >>> 0: a JS XOR yields a SIGNED 32-bit int, which would go negative
  return h / 0x100000000;
}

/**
 * The cranium's BACK surface z at height y (the skull ellipsoid FaceAnchors state), model
 * space, or null outside the ellipsoid's vertical span. The head's own surface, no screenshot.
 */
export function skullBackZ(sc: Vec3, sr: Vec3, y: number): number | null {
  const t = (y - sc[1]) / sr[1];
  if (t < -1 || t > 1) return null;
  return sc[2] - sr[2] * Math.sqrt(1 - t * t);
}

/**
 * SIGNED clearance (m) of a model point from the skull ellipsoid surface: the point's radial
 * excess over the surface along the ray from the skull centre (> 0 outside, < 0 inside).
 * q < 1 means the point is inside the cranium, so a hair vertex with clearance <= 0 has sunk in.
 */
export function skullClearance(p: Vec3, sc: Vec3, sr: Vec3): number {
  const dx = p[0] - sc[0], dy = p[1] - sc[1], dz = p[2] - sc[2];
  const qx = dx / sr[0], qy = dy / sr[1], qz = dz / sr[2];
  const q = Math.hypot(qx, qy, qz);
  const dist = Math.hypot(dx, dy, dz);
  return q < 1e-9 ? -dist : dist * (q - 1) / q;
}

/** One vertical fall tube: its y-range, its axis z and its radius (model space, metres). */
export interface HairSeg { y0: number; y1: number; z: number; r: number }

/**
 * The hair fall as vertical tube segments that ride the skull's back at the shell gap (lane R-B).
 * Each segment's axis z is placed behind the DEEPEST skull point over its own y-range, by the gap
 * plus the segment radius, so the tube's near surface can never reach the skull: an un-tilted tube
 * cannot poke a leaning rim into the head the way a path-aligned one can (measured and fixed here).
 * The polyline starts below the crown (the cap shell covers the crown) and, below the skull, keeps
 * the last z so the fall hangs straight.
 */
export function hairSegments(h: number, sc: Vec3, sr: Vec3, topR: number, botR: number, drop: number): HairSeg[] {
  const gap = HAIR_FIT.shellGapPerHead * h;
  const yTop = sc[1] + 0.15 * sr[1];
  const yBot = yTop - Math.max(1e-4, drop);
  const K = HAIR_FIT.fallSegments;
  const segs: HairSeg[] = [];
  let lastZ = sc[2] - sr[2] - gap - topR; // fallback for segments entirely below the skull
  for (let i = 0; i < K; i++) {
    const y0 = yTop - (yTop - yBot) * (i / K);
    const y1 = yTop - (yTop - yBot) * ((i + 1) / K);
    const mid = (y0 + y1) / 2;
    const f = Math.min(1, Math.max(0, (yTop - mid) / drop));
    const r = topR + (botR - topR) * f;
    let minBack = Infinity;
    for (let s = 0; s <= 6; s++) {
      const sb = skullBackZ(sc, sr, y1 + (y0 - y1) * (s / 6));
      if (sb !== null) minBack = Math.min(minBack, sb);
    }
    const z = minBack === Infinity ? lastZ : minBack - gap - r;
    lastZ = z;
    segs.push({ y0, y1, z, r });
  }
  return segs;
}

/** An iris fleck's colours: lighter and darker than the iris, alternating, so marks read as paint. */
export function irisFleckColours(iris: string): [string, string] {
  return [tintHex(iris, 0.45), shadeHex(iris, 0.55)];
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
  const refs: FaceRig = { brow: [], eyelid: [], eyelidLower: [], mouth: null as unknown as THREE.Mesh, browRestY: [], mouthRestY: 0, unit, triangleCount: 0, secondary: [], hairParts: [] };
  // Eyelid bands (lane Q-A): the ancestry's lid block (head heights) × h, per eye. The upper band
  // spans from the eyeball's top down to the opening; the lower from the bottom up to the opening,
  // so the visible aperture is node.lid.aperture and both bands overlap the recessed globe.
  const lb = lidBands(node, h);
  const halfAperture = lb.aperture / 2;
  const shell = r * 1.04;
  const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
  // Eyes: a ROUND globe in the socket, a round PAINTED iris with fine flecks, a pupil and a WET GLINT.
  const irisHex = irisColour(a);
  const [fleckLight, fleckDark] = irisFleckColours(irisHex);
  for (let i = 0; i < 2; i++) {
    const e = at(face.eye[i]);
    add(new THREE.SphereGeometry(r, EYE.globeLon, EYE.globeLat), flat("#f6f1e6"), e);
    const irisR = r * EYE.irisRadius;
    const irisZ = r * 0.985;
    const iris = add(new THREE.CircleGeometry(irisR, EYE.irisSegments), flat(irisHex), [e[0], e[1], e[2] + irisZ]);
    iris.renderOrder = 1;
    add(new THREE.CircleGeometry(r * EYE.pupilRadius, EYE.pupilSegments), flat("#050505"), [e[0], e[1], e[2] + r * 0.99]);
    // Fine painted iris flecks (lane R-B): EYE.fleckCount marks spread over the iris disc, placed
    // deterministically from the character seed. Each is a small disc, alternating lighter/darker,
    // so the iris reads as painted rather than a flat coloured circle.
    const fleckR = irisR * EYE.fleckRadius;
    for (let f = 0; f < EYE.fleckCount; f++) {
      const ang = (f / EYE.fleckCount) * Math.PI * 2 + (unitHash(seed ^ (f * 2654435761)) - 0.5) * 0.9;
      const rad = irisR * (0.22 + 0.58 * unitHash(seed ^ (f * 40503 + 17)));
      const fl = add(new THREE.CircleGeometry(fleckR, 6), flat(f % 2 === 0 ? fleckLight : fleckDark),
        [e[0] + Math.cos(ang) * rad, e[1] + Math.sin(ang) * rad, e[2] + irisZ + r * 0.004]);
      fl.renderOrder = 2;
    }
    // Wet glint: a specular highlight (moisture) up and to one side of the globe, plus a small
    // secondary catch-light on the other. Sizes/offsets are fractions of r (EYE.glint*).
    const glint = add(new THREE.CircleGeometry(r * EYE.glintRadius, 12), flat("#ffffff"),
      [e[0] + r * EYE.glintX, e[1] + r * EYE.glintY, e[2] + r * 0.99]);
    glint.renderOrder = 3;
    glint.scale.set(1, EYE.glintSquash, 1);
    const glint2 = add(new THREE.CircleGeometry(r * EYE.glint2Radius, 8), flat("#eef4ff"),
      [e[0] + r * EYE.glint2X, e[1] + r * EYE.glint2Y, e[2] + r * 0.985]);
    glint2.renderOrder = 3;
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
    const browColour = greyedHex(hairColourFor(node, seed), a.race ?? "human", greyFraction(a.race ?? "human", a.age));
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
  // Hair (wave X lane H): GROWN, not a cap shell. Follicles are placed on the skull ellipsoid
  // inside the hairline (HairFollicles), clumped into guide strands that hug the skull, fall under
  // gravity, curl, and are cut / gathered / braided by the style (HairGrowth); the strands become
  // cel-shaded cards with root->tip shade, per-clump tone and grey for elders (HairMesh +
  // HairShade). The bald draw is unchanged: deterministic from the seed, never for baldChance 0.
  const bald = isBald(node, seed);
  const hairBase = hairColourFor(node, seed);
  const race = a.race ?? "human";
  const grey = greyFraction(race, a.age);
  const hairColor = greyedHex(hairBase, race, grey);
  const hairLen = hairLengthM(node, h);
  if (!bald && node.hair.length !== "bald") {
    const frame = headFrameOf(face, origin, h, node.ears.lengthMul);
    const hair = buildHairMeshes(head, {
      frame, spec: node.hair, lengthM: hairLen, seed, race, ancestryIds: [race, a.subrace ?? ""], sex: a.sex,
      lifeFraction: lifeFraction(race, a.age), grey, baseHex: hairBase, skinHex: node.skin.base,
    });
    refs.hairParts.push(...hair.statics);
    refs.secondary.push(...hair.hanging);
    triangleCount += hair.triangles;
    const st = hair.data.stats;
    refs.hairStats = {
      style: hair.data.plan.style, tier: hair.data.plan.tier, follicles: st.follicles, clumps: st.clumps, triangles: st.triangles,
      minClearance: st.minClearance, grey: st.grey, recession: st.recession, braids: hair.data.growth.braids.length,
    };
  }
  // Beard from the ancestry: mode none|chin|moustache-thin|moustache|full, gated by required/
  // allowed. A "full" mass hangs from the chin into the neck gap but the TOP stays below the
  // mouth line, so a coverage < 1 always shows as the mouth still readable.
  // Wave X lane H: a woman's default is beardless (the race build's flag is the men's default);
  // an explicit a.beard or an ancestry that REQUIRES one (dwarves) still grows it.
  const mode = beardModeFor(node, a.beard ?? (a.sex === "female" ? false : build.beard));
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