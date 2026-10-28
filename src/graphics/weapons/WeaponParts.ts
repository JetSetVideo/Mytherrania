// Weapon part builders: one function per head/blade style, all emitting into a shared MeshKit
// in WEAPON LOCAL space (+y along the weapon from the main grip, +z = edge side, +x = flat).
// Every size a strike feature uses comes from the WeaponForm (Form.ts), the same source as
// Features.ts, so the mesh shows what lane X collides with. On top of that, the READABILITY
// pass (lane W2, docs/overhaul/lane-W2.md) shapes each archetype so it is recognisable at
// gameplay distance (7 m, 50 deg fov, 577 px tall view: 88 px per metre, so 6 px = 0.068 m):
//
//   * value contrast: blade flats one step darker than the metal (`flat`), a bright band on the
//     cutting edge (`edge`), dark sockets/langets/spines (`dark`), dark hafts (palette).
//   * tapered blades with per-archetype profiles (BLADE_LOOK): needle rapier, triangular dagger,
//     leaf short sword, long-pointed longsword/greatsword.
//   * hilts that name the sword: cup + knuckle bow + long quillons (rapier), knuckle bow
//     (sabre), parrying hooks + flared cross (greatsword), oval guard + ball pommel (short sword).
//   * VISUAL-ONLY exaggerations (no spec number changes, physics untouched) are named VISUAL_*
//     below; each keeps the strike features on or inside the drawn surface (tested).

// @deno-types="@types/three"
import * as THREE from "three";
import type { ArchetypeId, V3 } from "../../combat/contracts.ts";
import { clamp, clamp01, lerp } from "../../core/MathCore.ts";
import { hammerSpike, MAUL_BLOCK_RATIO } from "../../game/weapons/Features.ts";
import {
  bladeEdgeNormalAt, bladePointAt, bowLimbPoint, HAND_HALF_WIDTH, POINT_FRACTION, TIP_WIDTH_RATIO, type WeaponForm,
} from "../../game/weapons/Form.ts";
import { SPECULAR_METAL } from "../shaders/CelShader.ts";
import { MeshKit, type Ring } from "./MeshKit.ts";

/** Colours of one weapon (linear RGB, converted once from the hex names). */
export interface WeaponPalette {
  /** Metal body of heads (ball, finials, ferrules, maul cheeks): the metal's own tone. */
  blade: THREE.Color;
  /** Blade flats and head cheeks: a value step below `blade`, so the edge band reads. */
  flat: THREE.Color;
  /** Cutting-edge / striking-face highlight (the metal's highlight tone). */
  edge: THREE.Color;
  /** Spines, fullers, sockets, langets, chain (the metal's dark tone). */
  dark: THREE.Color;
  fitting: THREE.Color;
  /** Haft wood, darkened so a bright head separates from it. */
  wood: THREE.Color;
  /** Bow limb wood: lighter than a haft (the limbs ARE the weapon), darker than the string. */
  woodLight: THREE.Color;
  wrap: THREE.Color;
  string: THREE.Color;
}

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
/** Facets around round parts: 7 for hafts (reads round under cel bands), 6 for small parts. */
export const HAFT_SEGMENTS = 7;
export const SMALL_SEGMENTS = 6;
/** Edge bevel as a share of the half-width (the polished band you see on a blade). */
export const BEVEL_SHARE = 0.32;
/** Grip wrap: thicker than the haft by this factor, one palm long. */
export const WRAP_SCALE = 1.14;
/** Thinnest plate half-thickness, m (a zero-thickness edge would make zero-area facets). */
const MIN_HALF = 0.0008;

// --- VISUAL-ONLY exaggerations (mesh only; the spec, the physics and the features are unchanged) ---
/** Spear leaf drawn this much wider than headRadius, and never narrower than VISUAL_LEAF_MIN. */
export const VISUAL_LEAF_SCALE = 1.3;
export const VISUAL_LEAF_MIN = 0.034;
/** War hammer face drawn at this multiple of headRadius (the face feature sphere stays inside):
 * an 18-30 mm face is a 3-5 px dot at 7 m; the T of face + beak must be wider than it is tall. */
export const VISUAL_HAMMER_FACE = 2.0;
/** War hammer beak drawn this many times the Features.hammerSpike length (same direction): the
 * 7-10 cm spike is a 6 px stub at 7 m; drawn longer the T reads as hammer + pick. The point
 * feature then lies ~60% along the drawn beak (inside it): the drawn tip is not collidable. */
export const VISUAL_BEAK = 1.7;
/** Mace flange peaks reach this multiple of headRadius (feature sphere: 1.0). */
export const VISUAL_FLANGE_REACH = 1.12;
/** Flail ball drawn with a core of VISUAL_BALL_CORE x headRadius and spikes reaching
 * VISUAL_SPIKE_REACH x: a 3.5-6 cm iron ball (0.5-1 kg) is a 6-10 px dot at 7 m and reads as a
 * staff finial; drawn this big it reads as a flail. The feature sphere (1.0) sits in the core. */
export const VISUAL_BALL_CORE = 1.0;
export const VISUAL_SPIKE_REACH = 1.5;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A round tube along y between y0 and y1 (radii r0, r1), optionally capped. */
export function rod(kit: MeshKit, y0: number, y1: number, r0: number, r1: number, color: THREE.Color, opts: {
  segs?: number; start?: boolean | V3; end?: boolean | V3; specular?: number;
} = {}): void {
  const n = opts.segs ?? HAFT_SEGMENTS;
  kit.setSpecular(opts.specular ?? 0);
  kit.tube([
    { pts: MeshKit.circle([0, y0, 0], X, Z, r0, r0, n), centre: [0, y0, 0], colors: color },
    { pts: MeshKit.circle([0, y1, 0], X, Z, r1, r1, n), centre: [0, y1, 0], colors: color },
  ], { start: opts.start, end: opts.end, smooth: true });
}

/** A small round knob (lathe: two rings + two apexes) centred at `c` (or at y on the axis). */
export function knob(kit: MeshKit, c: number | V3, r: number, color: THREE.Color, specular = SPECULAR_METAL): void {
  const o: V3 = typeof c === "number" ? [0, c, 0] : c;
  kit.setSpecular(specular);
  const ring = (dy: number, rr: number): Ring => ({
    pts: MeshKit.circle([o[0], o[1] + dy, o[2]], X, Z, rr, rr, SMALL_SEGMENTS), centre: [o[0], o[1] + dy, o[2]], colors: color,
  });
  kit.tube([ring(-0.5 * r, 0.87 * r), ring(0.5 * r, 0.87 * r)], { start: [o[0], o[1] - r, o[2]], end: [o[0], o[1] + r, o[2]], smooth: true });
}

/** Wrapped grip band centred at y (one palm long). */
export function wrap(kit: MeshKit, y: number, r: number, pal: WeaponPalette): void {
  rod(kit, y - HAND_HALF_WIDTH, y + HAND_HALF_WIDTH, r * WRAP_SCALE, r * WRAP_SCALE, pal.wrap, { segs: SMALL_SEGMENTS });
}

/** Haft from the butt to `top`, with an iron butt cap and a wrap at every grip. */
export function haft(kit: MeshKit, form: WeaponForm, top: number, gripYs: number[], pal: WeaponPalette): void {
  const r = form.details.shaftRadius;
  rod(kit, -form.tail + 0.05, top, r, r * 0.92, pal.wood);
  rod(kit, -form.tail, -form.tail + 0.05, r * 1.12, r * 1.12, pal.dark, { start: true, segs: SMALL_SEGMENTS, specular: SPECULAR_METAL });
  for (const y of gripYs) if (y - HAND_HALF_WIDTH > -form.tail + 0.05 && y + HAND_HALF_WIDTH < top) wrap(kit, y, r, pal);
}

/** Metal langets / socket: a dark sleeve on the haft from y0 up to y1 (under a head). */
export function langets(kit: MeshKit, y0: number, y1: number, sr: number, pal: WeaponPalette): void {
  rod(kit, y0, y1, sr * 1.16, sr * 1.2, pal.dark, { segs: 5, start: true, specular: SPECULAR_METAL });
}

/** A round tube along a polyline in any direction (rings perpendicular to the path). */
export function pathTube(kit: MeshKit, pts: V3[], radius: number, color: THREE.Color, sides = 4, opts: {
  start?: boolean | V3; end?: boolean | V3;
} = {}): void {
  const rings: Ring[] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = unit(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const u = unit(cross(t, Math.abs(t[0]) < 0.9 ? X : Y)), v = cross(t, u);
    rings.push({ pts: MeshKit.circle(pts[i], u, v, radius, radius, sides), centre: pts[i], colors: color });
  }
  kit.setSpecular(SPECULAR_METAL);
  kit.tube(rings, { start: opts.start, end: opts.end, smooth: sides > 4 });
}

/**
 * A flat plate: a CONVEX polygon (in the plane with unit normal `n`) extruded by +-half along n,
 * one colour and one half-thickness per outline point (edges thin out toward the rim).
 */
export function plate(kit: MeshKit, outline: V3[], n: V3, half: number[], colors: THREE.Color[]): void {
  const k = outline.length;
  const c: V3 = [0, 0, 0];
  for (const p of outline) { c[0] += p[0] / k; c[1] += p[1] / k; c[2] += p[2] / k; }
  const off = (p: V3, h: number): V3 => [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h];
  const hm = half.reduce((s, h) => s + Math.max(MIN_HALF, h), 0) / k;
  const front = outline.map((p, i) => off(p, Math.max(MIN_HALF, half[i])));
  const back = outline.map((p, i) => off(p, -Math.max(MIN_HALF, half[i])));
  const cf = off(c, hm), cb = off(c, -hm);
  const cc = colors[0].clone().lerp(colors[Math.floor(k / 2)], 0.5);
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    kit.tri(cf, front[i], front[j], cc, colors[i], colors[j], c);
    kit.tri(cb, back[i], back[j], cc, colors[i], colors[j], c);
    kit.tri(front[i], back[i], back[j], colors[i], colors[i], colors[j], c);
    kit.tri(front[i], back[j], front[j], colors[i], colors[j], colors[j], c);
  }
}

// --- blades -----------------------------------------------------------------------------------

/**
 * Drawn blade profile per archetype: half-width = w0 (lerp(1, tipRatio, u) + leaf sin(pi u)) up
 * to the shoulder (u = s / shoulder), then a straight taper to the point over `point` of the
 * blade. Form.ts keeps its own (TIP_WIDTH_RATIO, POINT_FRACTION) profile for the mass model and
 * the edge features; the drawn edge stays within ~0.35 w0 (< 1 cm) of the feature line.
 */
export interface BladeLook {
  tipRatio: number;
  point: number;
  leaf: number;
  /** VISUAL width multiplier on headRadius (the edge features stay inside the drawn blade). */
  scale: number;
  /** Leather-wrapped ricasso: share of the blade length and its width (x w0); 0 = none. */
  ricasso: number;
  ricassoWidth: number;
}
const look = (tipRatio: number, point: number, o: Partial<BladeLook> = {}): BladeLook =>
  ({ tipRatio, point, leaf: 0, scale: 1, ricasso: 0, ricassoWidth: 1, ...o });
export const BLADE_LOOK: Partial<Record<ArchetypeId, BladeLook>> = {
  dagger: look(0.62, 0.4), // triangular, a long needle point
  shortsword: look(0.92, 0.24, { leaf: 0.12, scale: 1.2 }), // broad leaf / xiphos blade, long point
  sabre: look(0.82, 0.2), // keeps its width for the draw cut, then a long tapered point
  rapier: look(0.42, 0.22), // needle taper
  longsword: look(0.56, 0.2),
  greatsword: look(0.62, 0.17, { scale: 1.15, ricasso: 0.13, ricassoWidth: 0.55 }), // Zweihander: broad, ricasso + hooks
  scythe: look(0.5, 0.3),
};
const FORM_LOOK: BladeLook = look(TIP_WIDTH_RATIO, POINT_FRACTION);
export const bladeLook = (id: ArchetypeId): BladeLook => BLADE_LOOK[id] ?? FORM_LOOK;

/** Drawn half-width at arc length s (see BladeLook). */
export function lookHalfWidth(form: WeaponForm, s: number): number {
  const lk = bladeLook(form.archetype);
  const t = clamp01(s / Math.max(1e-6, form.bladeLength));
  const w0 = form.bladeHalfWidth * lk.scale;
  if (t <= lk.ricasso) return w0 * lk.ricassoWidth;
  const shoulder = 1 - lk.point;
  if (t <= shoulder) {
    const u = t / shoulder;
    return w0 * (lerp(1, lk.tipRatio, u) + lk.leaf * Math.sin(Math.PI * u));
  }
  return w0 * lk.tipRatio * (1 - (t - shoulder) / lk.point);
}

/** Arc positions of the blade sections: the ricasso step (if any), then even to the shoulder. */
function bladeStations(form: WeaponForm, curved: boolean): number[] {
  const lk = bladeLook(form.archetype), Lb = form.bladeLength;
  const shoulder = (1 - lk.point) * Lb;
  const n = curved ? 7 : 5;
  if (lk.ricasso <= 0) return Array.from({ length: n }, (_, k) => (shoulder * k) / (n - 1));
  const r = lk.ricasso * Lb, step = 0.006;
  const out = [0, r, r + step];
  for (let k = 1; k < n - 1; k++) out.push(r + step + ((shoulder - r - step) * k) / (n - 2));
  return out;
}

/**
 * Blade along the form's centreline: a bevelled lens (double edge, optional fuller) or a
 * single-edged section, edge along +N (= +z on a straight blade), closing to the point. The
 * apex of every section carries the bright `edge` tone and the bevel line the darker `flat`, so
 * the cutting edge reads as a light band against the flat; a single edge's spine is `dark`.
 */
export function blade(kit: MeshKit, form: WeaponForm, pal: WeaponPalette): void {
  const Lb = form.bladeLength;
  const lk = bladeLook(form.archetype);
  const curved = Math.abs(form.bladeTurn) > 1e-4;
  const rings: Ring[] = [];
  const c: V3 = [0, 0, 0], n: V3 = [0, 0, 0];
  for (const s of bladeStations(form, curved)) {
    bladePointAt(form, s, c);
    bladeEdgeNormalAt(form, s, n);
    const w = lookHalfWidth(form, s);
    const t = Math.max(MIN_HALF, form.bladeThickness * (1 - 0.45 * (s / Lb)) / 2); // distal taper, half thickness
    const bev = BEVEL_SHARE * w;
    let ab: [number, number][];
    let cols: THREE.Color[];
    if (form.singleEdged) {
      ab = [[0, w], [t, w - bev], [t, -w], [-t, -w], [-t, w - bev]];
      cols = [pal.edge, pal.flat, pal.dark, pal.dark, pal.flat];
    } else if (form.fullered) {
      ab = [[0, w], [t, w - bev], [0.45 * t, 0], [t, -(w - bev)], [0, -w], [-t, -(w - bev)], [-0.45 * t, 0], [-t, w - bev]];
      cols = [pal.edge, pal.flat, pal.dark, pal.flat, pal.edge, pal.flat, pal.dark, pal.flat];
    } else {
      ab = [[0, w], [t, w - bev], [t, -(w - bev)], [0, -w], [-t, -(w - bev)], [-t, w - bev]];
      cols = [pal.edge, pal.flat, pal.flat, pal.edge, pal.flat, pal.flat];
    }
    if (s <= lk.ricasso * Lb + 1e-9) cols = cols.map(() => pal.wrap); // leather-wrapped ricasso
    rings.push({ pts: MeshKit.section([c[0], c[1], c[2]], X, [n[0], n[1], n[2]], ab), centre: [c[0], c[1], c[2]], colors: cols });
  }
  kit.setSpecular(SPECULAR_METAL);
  kit.tube(rings, { start: true, end: bladePointAt(form, Lb, [0, 0, 0]), apexColor: pal.edge });
}

/** Quillon bar along z (the blade WIDTH axis) at height y: a centre block, `tip` x at the ends. */
function crossGuard(kit: MeshKit, y: number, span: number, hx: number, hy: number, color: THREE.Color, tip = 0.75): void {
  const sq = (a: number, b: number): [number, number][] => [[a, b], [a, -b], [-a, -b], [-a, b]];
  const ring = (z: number, k: number): Ring => ({ pts: MeshKit.section([0, y, z], X, Y, sq(hx * k, hy * k)), centre: [0, y, z], colors: color });
  const inner = Math.min(0.02, 0.4 * span);
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(-span, tip), ring(-inner, 1.12), ring(inner, 1.12), ring(span, tip)], { start: true, end: true });
}

/** An elliptic plate (radii rx along x, rz along z) of half-height hy at y: a gladius guard. */
function ovalGuard(kit: MeshKit, y: number, rx: number, rz: number, hy: number, color: THREE.Color): void {
  const ring = (yy: number): Ring => ({ pts: MeshKit.circle([0, yy, 0], X, Z, rx, rz, 8), centre: [0, yy, 0], colors: color });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(y - hy), ring(y + hy)], { start: true, end: true });
}

/** A wheel along x (wheel pommel), radius r, half-thickness h, centred at y. */
function wheel(kit: MeshKit, y: number, r: number, h: number, color: THREE.Color): void {
  const ring = (x: number): Ring => ({ pts: MeshKit.circle([x, y, 0], Y, Z, r, r, 8), centre: [x, y, 0], colors: color });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(-h), ring(h)], { start: true, end: true });
}

/**
 * Knuckle bow: a bar from the guard at (yTop, zTop) bowing out in front of the fingers (edge
 * side, +z, out to `bulge`) down to the pommel (yBot, zBot), in the blade plane (x = 0).
 */
function knuckleBow(kit: MeshKit, yTop: number, zTop: number, yBot: number, zBot: number, bulge: number, r: number, color: THREE.Color): void {
  const h = yTop - yBot;
  const pts: V3[] = [
    [0, yTop, zTop], [0, yTop - 0.16 * h, bulge], [0, yTop - 0.5 * h, bulge + 0.004],
    [0, yTop - 0.84 * h, bulge - 0.01], [0, yBot, zBot],
  ];
  pathTube(kit, pts, r, color, 4, { start: true, end: true });
}

/** Cup (bell) guard of a rapier: a lathe dome around the blade root, convex side to the tip. */
function cupGuard(kit: MeshKit, y: number, rc: number, depth: number, pal: WeaponPalette): void {
  const ring = (yy: number, r: number, col: THREE.Color): Ring => ({ pts: MeshKit.circle([0, yy, 0], X, Z, r, r, 10), centre: [0, yy, 0], colors: col });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(y, rc, pal.edge), ring(y + 0.3 * depth, 0.93 * rc, pal.fitting), ring(y + 0.72 * depth, 0.58 * rc, pal.fitting)], {
    start: true, end: [0, y + depth, 0], smooth: true,
  });
}

/** Greatsword cross drawn this much wider than guardHalfSpan (a look-only detail, like the span). */
export const GREATSWORD_GUARD_SCALE = 1.2;
/** Greatsword quillons rise toward the blade by this angle, rad (~25 deg: a V guard). */
export const GREATSWORD_QUILLON_RISE = 0.45;
/** Greatsword parrying-hook reach beyond the ricasso, m (visual: the guard mass is a share). */
export const GREATSWORD_HOOK = 0.07;
/** Rapier cup radius and depth, m (a taza cup is 9-12 cm across). Visual: mass is the guard share. */
export const RAPIER_CUP_RADIUS = 0.05;
export const RAPIER_CUP_DEPTH = 0.042;

/**
 * Sword hilt, per archetype: wrapped handle, guard and pommel. The quillons run along z, the
 * blade's WIDTH (edge to edge), so an opposing blade sliding down either edge is caught.
 *   dagger      small cross, small pommel
 *   shortsword  oval guard plate + big ball pommel (gladius)
 *   longsword   long straight cross + wheel pommel
 *   greatsword  wide cross with flared tips + parrying hooks on the ricasso + big pommel
 *   sabre       short cross + KNUCKLE BOW on the edge side
 *   rapier      long quillons with ball finials + CUP + KNUCKLE BOW (swept hilt)
 * Guard and pommel shapes are visual: their masses are the guard share / solved pommel mass.
 */
export function hilt(kit: MeshKit, form: WeaponForm, pal: WeaponPalette): void {
  const id = form.archetype;
  const span = form.details.guardHalfSpan, gy = form.guardY + form.guardThickness / 2;
  const hy = form.guardThickness / 2;
  const gripR = id === "greatsword" ? 0.0165 : id === "dagger" ? 0.0135 : 0.0155;
  kit.setPart("haft");
  rod(kit, form.shaftBottomY, form.guardY, gripR, gripR + 0.001, pal.wrap, { segs: SMALL_SEGMENTS });
  const pr = Math.max(form.pommelRadius, 0.014);
  kit.setPart("guard");
  switch (id) {
    case "shortsword":
      ovalGuard(kit, gy, 0.028, span, hy, pal.fitting);
      knob(kit, form.pommelY, Math.max(pr, 0.024), pal.fitting);
      break;
    case "longsword":
      crossGuard(kit, gy, span, 0.009, hy * 0.6, pal.fitting, 0.85);
      wheel(kit, form.pommelY, Math.max(pr, 0.026), 0.011, pal.fitting);
      break;
    case "greatsword": {
      // A V guard (quillons swept up toward the blade, ball finials: the claymore read), a
      // block at the centre, parrying hooks at the end of the leather ricasso, a big pommel.
      const q = GREATSWORD_GUARD_SCALE * span, rise = Math.tan(GREATSWORD_QUILLON_RISE) * q;
      blockZ(kit, gy, -0.026, 0.026, 0.013, 0.016, pal.fitting);
      for (const side of [1, -1]) {
        pathTube(kit, [[0, gy, side * 0.02], [0, gy + 0.35 * rise, side * 0.55 * q], [0, gy + rise, side * q]], 0.009, pal.fitting, 4, { start: true, end: true });
        knob(kit, [0, gy + rise, side * q], 0.017, pal.fitting);
      }
      const s = bladeLook(id).ricasso * form.bladeLength, c = bladePointAt(form, s, [0, 0, 0]), w = lookHalfWidth(form, s);
      for (const side of [1, -1]) spike(kit, [0, c[1], side * 0.5 * w], X, Y, 0.01, [0, c[1] - 0.04, side * (w + GREATSWORD_HOOK)], pal.fitting);
      knob(kit, form.pommelY, Math.max(pr, 0.028), pal.fitting);
      break;
    }
    case "sabre":
      crossGuard(kit, gy, span, 0.008, hy * 0.7, pal.fitting, 0.8);
      knuckleBow(kit, gy, span, form.pommelY + 0.5 * pr, 0.6 * pr, 0.052, 0.005, pal.fitting);
      knob(kit, form.pommelY, pr, pal.fitting);
      break;
    case "rapier":
      crossGuard(kit, gy, span, 0.0065, 0.0065, pal.fitting, 0.8);
      for (const side of [1, -1]) knob(kit, [0, gy, side * span], 0.011, pal.fitting);
      cupGuard(kit, form.guardY - 0.004, RAPIER_CUP_RADIUS, RAPIER_CUP_DEPTH, pal);
      knuckleBow(kit, form.guardY - 0.004, 0.92 * RAPIER_CUP_RADIUS, form.pommelY + 0.5 * pr, 0.6 * pr, 0.058, 0.0045, pal.fitting);
      knob(kit, form.pommelY, Math.max(pr, 0.019), pal.fitting);
      break;
    default: // dagger
      crossGuard(kit, gy, span, 0.009, hy, pal.fitting);
      knob(kit, form.pommelY, Math.max(pr, 0.016), pal.fitting);
  }
}

// --- pole heads ---------------------------------------------------------------------------------

/**
 * Leaf-shaped spear head on a socket. Section: a diamond (midrib + two edges), bright edges
 * fading to a darker midrib. Drawn VISUAL_LEAF_SCALE wider than headRadius (at least
 * VISUAL_LEAF_MIN): the edge features (at headRadius) lie inside the drawn leaf.
 */
export function leafHead(kit: MeshKit, form: WeaponForm, H: number, R: number, pal: WeaponPalette): void {
  const base = form.forward - H, sr = form.details.shaftRadius;
  const Rv = Math.max(VISUAL_LEAF_SCALE * R, VISUAL_LEAF_MIN);
  langets(kit, base - 0.1, base + 0.02, sr, pal);
  const rib = Math.max(0.006, 0.16 * Rv);
  const ring = (y: number, w: number): Ring => ({
    pts: MeshKit.section([0, y, 0], X, Z, [[0, w], [rib, 0], [0, -w], [-rib, 0]]), centre: [0, y, 0],
    colors: [pal.edge, pal.flat, pal.edge, pal.flat],
  });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(base, 0.3 * Rv), ring(base + 0.18 * H, 0.8 * Rv), ring(base + 0.4 * H, Rv), ring(base + 0.72 * H, 0.52 * Rv)], {
    start: true, end: [0, form.forward, 0], apexColor: pal.edge,
  });
}

/**
 * Axe bit lofted along y from the beard horn to the top horn. Each station is a wedge from the
 * inner outline zIn (on the haft from the top horn down to the neck, then sweeping out along the
 * BEARD; `neck = false` keeps the whole bit on the socket, as a halberd blade is) to the edge
 * zEdge (keen), with a crisp bright band on the last centimetres. The edge line and
 * the horn tips are exactly Features.bitEdge (same t = 0, 1/4, 1/2, 3/4, 1, same crescent term).
 */
export function axeBit(
  kit: MeshKit, centreY: number, height: number, depth: number, crescent: number, z0Base: number, pal: WeaponPalette, neck = true,
): void {
  const N = 9; // stations t = k / 8; the two horn stations are cone apexes
  const yAt = (t: number) => centreY - 0.6 * height + t * height;
  const zEdge = (t: number) => depth - crescent * 0.3 * height * (2 * t - 1) * (2 * t - 1);
  // Bearded profile: the top edge runs straight from the eye to the top horn; only the beard
  // leaves the haft (a neck flaring both ways reads as a pennon or a hammer at 7 m).
  const neckLo = centreY - 0.2 * height;
  const rings: Ring[] = [];
  for (let k = 1; k < N - 1; k++) {
    const t = k / (N - 1), y = yAt(t), zE = zEdge(t);
    const u = !neck || y >= neckLo ? 0 : (neckLo - y) / (neckLo - yAt(0));
    const zIn = Math.min(z0Base + (zE - z0Base) * 0.85 * Math.pow(clamp01(u), 1.3), zE - 0.02);
    const band = Math.min(0.022, 0.45 * (zE - zIn));
    const tc = 0.0095, tb = 0.0042, te = 0.0035;
    const ab: [number, number][] = [
      [tc, zIn], [tb, zE - band], [te, zE - band + 0.0025], [0, zE], [-te, zE - band + 0.0025], [-tb, zE - band], [-tc, zIn],
    ];
    rings.push({
      pts: MeshKit.section([0, y, 0], X, Z, ab), centre: [0, y, (zIn + zE) / 2],
      colors: [pal.flat, pal.flat, pal.edge, pal.edge, pal.edge, pal.flat, pal.flat],
    });
  }
  kit.setSpecular(SPECULAR_METAL);
  kit.tube(rings, { start: [0, yAt(0), zEdge(0)], end: [0, yAt(1), zEdge(1)], apexColor: pal.edge });
}

/** A flat diamond-section point from y0 to the apex at y1 (halberd top spike), half-width w. */
export function spearPoint(kit: MeshKit, y0: number, y1: number, w: number, pal: WeaponPalette): void {
  const L = y1 - y0, rib = Math.max(0.006, 0.28 * w);
  const ring = (y: number, ww: number): Ring => ({
    pts: MeshKit.section([0, y, 0], X, Z, [[0, ww], [rib, 0], [0, -ww], [-rib, 0]]), centre: [0, y, 0],
    colors: [pal.edge, pal.flat, pal.edge, pal.flat],
  });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(y0, 0.55 * w), ring(y0 + 0.28 * L, w)], { start: true, end: [0, y1, 0], apexColor: pal.edge });
}

/** Halberd back fluke: a slim hooked spike from the socket (`base`) to the point `tip`. */
export function fluke(kit: MeshKit, base: V3, tip: V3, height: number, pal: WeaponPalette): void {
  const d = unit(sub(tip, base));
  const up: V3 = [0, -d[2], d[1]]; // in the yz plane, perpendicular to the fluke, toward +y
  const mid: V3 = [0, (base[1] + tip[1]) / 2 + up[1] * 0.25 * height, (base[2] + tip[2]) / 2 + up[2] * 0.25 * height];
  const ring = (c: V3, h: number, w: number): Ring => ({
    pts: MeshKit.section(c, X, up, [[0, h], [w, 0], [0, -h], [-w, 0]]), centre: c, colors: [pal.flat, pal.flat, pal.edge, pal.flat],
  });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(base, 0.5 * height, 0.008), ring(mid, 0.3 * height, 0.005)], { start: true, end: tip, apexColor: pal.edge });
}

/** A box-like block along z (from z0 to z1) with a rectangular (x, y) section. */
export function blockZ(kit: MeshKit, y: number, z0: number, z1: number, hx: number, hy: number, color: THREE.Color, specular = SPECULAR_METAL): void {
  const sq: [number, number][] = [[hx, hy], [hx, -hy], [-hx, -hy], [-hx, hy]];
  kit.setSpecular(specular);
  kit.tube([
    { pts: MeshKit.section([0, y, z0], X, Y, sq), centre: [0, y, z0], colors: color },
    { pts: MeshKit.section([0, y, z1], X, Y, sq), centre: [0, y, z1], colors: color },
  ], { start: true, end: true });
}

/** A spike: a ring at `base` (in plane u, v) closing to `tip`. */
export function spike(kit: MeshKit, base: V3, u: V3, v: V3, r: number, tip: V3, color: THREE.Color, sides = 4): void {
  kit.setSpecular(SPECULAR_METAL);
  const pts = MeshKit.circle(base, u, v, r, r, sides);
  kit.tube([{ pts, centre: base, colors: color }], { start: true, end: tip });
}

// --- blunt heads ----------------------------------------------------------------------------------

/**
 * Flanged mace head: a dark core, `count` Gothic flanges (pentagonal plates whose peak reaches
 * VISUAL_FLANGE_REACH x R, bright rims) and a finial knob on top.
 */
export function flangedHead(kit: MeshKit, y: number, H: number, R: number, count: number, pal: WeaponPalette): void {
  const y0 = y - H / 2, y1 = y + H / 2;
  rod(kit, y0, y1, 0.4 * R, 0.4 * R, pal.dark, { segs: 8, start: true, end: true, specular: SPECULAR_METAL });
  const tf = clamp(0.11 * R, 0.005, 0.0075);
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + Math.PI / count;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)], q: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const at = (r: number, yy: number): V3 => [d[0] * r, yy, d[2] * r];
    const outline = [
      at(0.36 * R, y0 + 0.02 * H), at(0.95 * R, y0 + 0.16 * H), at(VISUAL_FLANGE_REACH * R, y0 + 0.55 * H), at(0.92 * R, y1 - 0.06 * H),
      at(0.36 * R, y1),
    ];
    kit.setSpecular(SPECULAR_METAL);
    plate(kit, outline, q, [tf, 0.55 * tf, 0.35 * tf, 0.55 * tf, tf], [pal.flat, pal.edge, pal.edge, pal.edge, pal.flat]);
  }
  knob(kit, y1 + 0.16 * R, 0.3 * R, pal.blade);
}

/**
 * Flail chain: big alternating BRIGHT links from y0 up to y1 (a dark chain merges with the dark
 * haft into one long stick at 7 m; bright beads read as a chain). An S-laid chain was tried: at
 * 7 m it reads as a curled staff head. CHAIN_SWAY > 0 lays it on an S; the features treat the
 * chain as taut either way.
 */
export function chain(kit: MeshKit, y0: number, y1: number, pal: WeaponPalette): number {
  const links = clamp(Math.round((y1 - y0) / CHAIN_PITCH), 2, 8);
  const at = (u: number): V3 => [0, y0 + (y1 - y0) * u, CHAIN_SWAY * Math.sin(2 * Math.PI * u)];
  kit.setSpecular(SPECULAR_METAL);
  for (let k = 0; k < links; k++) {
    const u = (k + 0.5) / links, c = at(u);
    const tg = unit(sub(at(u + 0.01), at(u - 0.01)));
    const inPlane: V3 = [0, -tg[2], tg[1]];
    const side: V3 = k % 2 === 0 ? X : inPlane;
    const normal = unit(cross(tg, side));
    const lh = (0.62 * (y1 - y0)) / links, sw = 0.022;
    const path: V3[] = [
      [c[0] - tg[0] * lh, c[1] - tg[1] * lh, c[2] - tg[2] * lh], [c[0] + side[0] * sw, c[1] + side[1] * sw, c[2] + side[2] * sw],
      [c[0] + tg[0] * lh, c[1] + tg[1] * lh, c[2] + tg[2] * lh], [c[0] - side[0] * sw, c[1] - side[1] * sw, c[2] - side[2] * sw],
    ];
    const rings: Ring[] = [];
    for (const p of [...path, path[0]]) {
      const radial = unit(sub(p, c));
      rings.push({ pts: MeshKit.circle(p, normal, radial, 0.0065, 0.0065, 3), centre: p, colors: pal.blade });
    }
    kit.tube(rings);
  }
  return links;
}
/** Chain link pitch and the S sway of the drawn chain, m. */
export const CHAIN_PITCH = 0.06;
export const CHAIN_SWAY = 0;

/** Spiked ball: a lathe sphere plus 9 spikes (6 equatorial, 2 lower diagonals, 1 bottom). */
export function spikedBall(kit: MeshKit, y: number, R: number, pal: WeaponPalette): void {
  const core = VISUAL_BALL_CORE * R;
  kit.setSpecular(SPECULAR_METAL);
  const ring = (phi: number): Ring => ({
    pts: MeshKit.circle([0, y + core * Math.cos(phi), 0], X, Z, core * Math.sin(phi), core * Math.sin(phi), 8),
    centre: [0, y + core * Math.cos(phi), 0], colors: pal.blade,
  });
  kit.tube([ring(Math.PI / 4), ring(Math.PI / 2), ring((3 * Math.PI) / 4)], { start: [0, y + core, 0], end: [0, y - core, 0], smooth: true });
  const dirs: V3[] = [];
  for (let k = 0; k < 6; k++) dirs.push([Math.cos((k / 6) * Math.PI * 2), 0, Math.sin((k / 6) * Math.PI * 2)]);
  for (const a of [Math.PI / 6, Math.PI + Math.PI / 6]) dirs.push(unit([Math.cos(a), -1, Math.sin(a)]));
  dirs.push([0, -1, 0]);
  const reach = VISUAL_SPIKE_REACH * R;
  for (const dir of dirs) {
    const u = unit(cross(dir, Math.abs(dir[1]) > 0.9 ? X : Y)), v = cross(dir, u);
    spike(kit, [dir[0] * core * 0.9, y + dir[1] * core * 0.9, dir[2] * core * 0.9], u, v, 0.24 * core,
      [dir[0] * reach, y + dir[1] * reach, dir[2] * reach], pal.edge);
  }
}

/**
 * War hammer head: a waisted block to a crowned face at +z (drawn VISUAL_HAMMER_FACE x the face
 * radius) and a curved BEAK at -z, arched, VISUAL_BEAK x the Features.hammerSpike length: the
 * hammer-and-pick T. No top spike: at 7 m a top spike turns the T into a mace or a trident.
 */
export function hammerHead(kit: MeshKit, y: number, H: number, R: number, sr: number, curvature: number, pal: WeaponPalette): void {
  const faceZ = sr + 0.035, Rv = VISUAL_HAMMER_FACE * R;
  const oct = (hx: number, hy: number): [number, number][] => {
    const c = 0.3 * Math.min(hx, hy);
    return [[hx, hy - c], [hx, -(hy - c)], [hx - c, -hy], [-(hx - c), -hy], [-hx, -(hy - c)], [-hx, hy - c], [-(hx - c), hy], [hx - c, hy]];
  };
  const ring = (z: number, hx: number, hy: number, col: THREE.Color): Ring => ({ pts: MeshKit.section([0, y, z], X, Y, oct(hx, hy)), centre: [0, y, z], colors: col });
  const back = -(sr + 0.012);
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([
    ring(back, 0.5 * Rv, Math.max(H / 2, 0.8 * Rv), pal.flat),
    ring(faceZ - 0.2 * Rv, 0.8 * Rv, 0.8 * Rv, pal.flat),
    ring(faceZ + 0.25 * Rv, Rv, Rv, pal.edge),
    ring(faceZ + 0.45 * Rv, 0.86 * Rv, 0.86 * Rv, pal.edge),
  ], { start: true, end: true });
  // Beak: a quadratic arc from the back of the eye, arched up, down to the feature point.
  const s = hammerSpike(R, curvature), len = VISUAL_BEAK * s.length;
  const tip: V3 = [0, y - Math.sin(s.droop) * len, sr - Math.cos(s.droop) * len];
  const b0: V3 = [0, y, back];
  const ctl: V3 = [0, (b0[1] + tip[1]) / 2 + 0.22 * Math.abs(tip[2] - back), (b0[2] + tip[2]) / 2];
  const bez = (u: number): V3 => [
    0, (1 - u) * (1 - u) * b0[1] + 2 * u * (1 - u) * ctl[1] + u * u * tip[1], (1 - u) * (1 - u) * b0[2] + 2 * u * (1 - u) * ctl[2] + u * u * tip[2],
  ];
  const rings: Ring[] = [];
  for (const u of [0, 0.4, 0.72]) {
    const p = bez(u), tg = unit(sub(bez(u + 0.02), p));
    const nr: V3 = [0, -tg[2], tg[1]];
    const hh = lerp(0.5 * H, 0.12 * H, u), hx = lerp(0.5 * Rv, 0.2 * Rv, u);
    rings.push({ pts: MeshKit.section(p, X, nr, [[0, hh], [hx, 0], [0, -hh], [-hx, 0]]), centre: p, colors: [pal.edge, pal.flat, pal.edge, pal.flat] });
  }
  kit.tube(rings, { start: true, end: tip, apexColor: pal.edge });
}

/** Maul block along z: bright bevelled striking faces, dark iron bands behind them. */
export function maulBlock(kit: MeshKit, y: number, H: number, R: number, pal: WeaponPalette): void {
  const half = MAUL_BLOCK_RATIO * R, hx = R, hy = H / 2;
  const oct = (k: number): [number, number][] => {
    const ax = hx * k, ay = hy * k, c = 0.25 * Math.min(ax, ay);
    return [[ax, ay - c], [ax, -(ay - c)], [ax - c, -ay], [-(ax - c), -ay], [-ax, -(ay - c)], [-ax, ay - c], [-(ax - c), ay], [ax - c, ay]];
  };
  const ring = (z: number, k: number, col: THREE.Color): Ring => ({ pts: MeshKit.section([0, y, z], X, Y, oct(k)), centre: [0, y, z], colors: col });
  const prof: [number, number, THREE.Color][] = [[0, 0.84, pal.edge], [0.014, 1, pal.edge], [0.022, 1.05, pal.dark], [0.042, 1.05, pal.dark], [0.05, 0.98, pal.blade]];
  const rings: Ring[] = [];
  for (const [dz, k, col] of prof) rings.push(ring(-half + dz, k, col));
  for (const [dz, k, col] of [...prof].reverse()) rings.push(ring(half - dz, k, col));
  kit.setSpecular(SPECULAR_METAL);
  kit.tube(rings, { start: true, end: true });
}

/** Bow limb from the riser to one tip (sign +1 up, -1 down); returns the tip point. */
export function bowLimb(kit: MeshKit, half: number, brace: number, recurve: number, sign: 1 | -1, pal: WeaponPalette): V3 {
  const rings: Ring[] = [];
  const n = 6;
  const at = (t: number): V3 => bowLimbPoint(half, brace, recurve, sign, t);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = at(t), q = at(Math.min(1, t + 0.05)), o = at(Math.max(0, t - 0.05));
    const tan: V3 = [0, q[1] - o[1], q[2] - o[2]];
    const l = Math.hypot(tan[1], tan[2]) || 1;
    const nrm: V3 = [0, -tan[2] / l, tan[1] / l]; // in the yz plane, perpendicular to the limb
    const w = 0.021 * (1 - 0.45 * t), th = 0.011 * (1 - 0.4 * t);
    rings.push({ pts: MeshKit.section(p, X, nrm, [[w, th], [w, -th], [-w, -th], [-w, th]]), centre: p, colors: pal.woodLight });
  }
  kit.setSpecular(0);
  kit.tube(rings, { start: false, end: true });
  return at(1);
}
