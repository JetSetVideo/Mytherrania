// Weapon part builders: one function per head/blade style, all emitting into a shared MeshKit
// in WEAPON LOCAL space (+y along the weapon from the main grip, +z = edge side, +x = flat).
// Every size comes from the WeaponForm (Form.ts), the same source as the strike features,
// so the mesh shows exactly what lane X collides with.

// @deno-types="@types/three"
import * as THREE from "three";
import type { V3 } from "../../combat/contracts.ts";
import { clamp } from "../../core/MathCore.ts";
import { hammerSpike, MAUL_BLOCK_RATIO } from "../../game/weapons/Features.ts";
import {
  bladeEdgeNormalAt, bladeHalfWidthAt, bladePointAt, bowLimbPoint, HAND_HALF_WIDTH, POINT_FRACTION, type WeaponForm,
} from "../../game/weapons/Form.ts";
import { SPECULAR_METAL } from "../shaders/CelShader.ts";
import { MeshKit, type Ring } from "./MeshKit.ts";

/** Colours of one weapon (linear RGB, converted once from the hex names). */
export interface WeaponPalette {
  blade: THREE.Color;
  edge: THREE.Color;
  dark: THREE.Color;
  fitting: THREE.Color;
  wood: THREE.Color;
  wrap: THREE.Color;
  string: THREE.Color;
}

const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];
/** Facets around round parts: 7 for hafts (reads round under cel bands), 6 for small parts. */
export const HAFT_SEGMENTS = 7;
export const SMALL_SEGMENTS = 6;
/** Edge bevel as a share of the half-width (the polished band you see on a blade). */
export const BEVEL_SHARE = 0.3;
/** Grip wrap: thicker than the haft by this factor, one palm long. */
export const WRAP_SCALE = 1.14;

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

/** A small round knob (lathe: two rings + two apexes) centred at y. */
export function knob(kit: MeshKit, y: number, r: number, color: THREE.Color, specular = SPECULAR_METAL): void {
  kit.setSpecular(specular);
  const ring = (dy: number, rr: number): Ring => ({ pts: MeshKit.circle([0, y + dy, 0], X, Z, rr, rr, SMALL_SEGMENTS), centre: [0, y + dy, 0], colors: color });
  kit.tube([ring(-0.5 * r, 0.87 * r), ring(0.5 * r, 0.87 * r)], { start: [0, y - r, 0], end: [0, y + r, 0], smooth: true });
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

/**
 * Blade along the form's centreline: a bevelled lens (double edge, optional fuller) or a
 * single-edged section, edge along +N (= +z on a straight blade), closing to the point.
 */
export function blade(kit: MeshKit, form: WeaponForm, pal: WeaponPalette): void {
  const Lb = form.bladeLength;
  const curved = Math.abs(form.bladeTurn) > 1e-4;
  const stations = curved ? 6 : 3;
  const shoulder = (1 - POINT_FRACTION) * Lb;
  const rings: Ring[] = [];
  const c: V3 = [0, 0, 0], n: V3 = [0, 0, 0];
  for (let k = 0; k < stations; k++) {
    const s = (shoulder * k) / (stations - 1);
    bladePointAt(form, s, c);
    bladeEdgeNormalAt(form, s, n);
    const w = bladeHalfWidthAt(form, s);
    const t = form.bladeThickness * (1 - 0.45 * (s / Lb)) / 2; // distal taper, half thickness
    const bev = BEVEL_SHARE * w;
    let ab: [number, number][];
    let cols: THREE.Color[];
    if (form.singleEdged) {
      ab = [[0, w], [t, w - bev], [t, -w], [-t, -w], [-t, w - bev]];
      cols = [pal.edge, pal.blade, pal.dark, pal.dark, pal.blade];
    } else if (form.fullered) {
      ab = [[0, w], [t, w - bev], [0.45 * t, 0], [t, -(w - bev)], [0, -w], [-t, -(w - bev)], [-0.45 * t, 0], [-t, w - bev]];
      cols = [pal.edge, pal.blade, pal.dark, pal.blade, pal.edge, pal.blade, pal.dark, pal.blade];
    } else {
      ab = [[0, w], [t, w - bev], [t, -(w - bev)], [0, -w], [-t, -(w - bev)], [-t, w - bev]];
      cols = [pal.edge, pal.blade, pal.blade, pal.edge, pal.blade, pal.blade];
    }
    rings.push({ pts: MeshKit.section([c[0], c[1], c[2]], X, [n[0], n[1], n[2]], ab), centre: [c[0], c[1], c[2]], colors: cols });
  }
  kit.setSpecular(SPECULAR_METAL);
  kit.tube(rings, { start: true, end: bladePointAt(form, Lb, [0, 0, 0]), apexColor: pal.edge });
}

/**
 * Sword hilt: wrapped handle, cross guard, round pommel. The quillons run along z, the blade's
 * WIDTH (edge to edge), so an opposing blade sliding down either edge is caught.
 */
export function hilt(kit: MeshKit, form: WeaponForm, pal: WeaponPalette): void {
  rod(kit, form.shaftBottomY, form.guardY, 0.0155, 0.0165, pal.wrap, { segs: SMALL_SEGMENTS });
  const span = form.details.guardHalfSpan, gy = form.guardY + form.guardThickness / 2;
  const hy = form.guardThickness / 2, hx = 0.012;
  const sq: [number, number][] = [[hx, hy], [hx, -hy], [-hx, -hy], [-hx, hy]];
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([
    { pts: MeshKit.section([0, gy, -span], X, Y, sq), centre: [0, gy, -span], colors: pal.fitting },
    { pts: MeshKit.section([0, gy, span], X, Y, sq), centre: [0, gy, span], colors: pal.fitting },
  ], { start: true, end: true });
  knob(kit, form.pommelY, Math.max(form.pommelRadius, 0.014), pal.fitting);
}

/** Leaf-shaped spear head on a socket. Section: a diamond (midrib + two edges). */
export function leafHead(kit: MeshKit, form: WeaponForm, H: number, R: number, pal: WeaponPalette): void {
  const base = form.forward - H, sr = form.details.shaftRadius;
  rod(kit, base - 0.06, base + 0.02, sr * 1.15, sr * 0.9, pal.dark, { segs: SMALL_SEGMENTS, specular: SPECULAR_METAL });
  const rib = 0.006;
  const ring = (y: number, w: number): Ring => ({
    pts: MeshKit.section([0, y, 0], X, Z, [[0, w], [rib, 0], [0, -w], [-rib, 0]]), centre: [0, y, 0],
    colors: [pal.edge, pal.blade, pal.edge, pal.blade],
  });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(base, 0.4 * R), ring(base + 0.38 * H, R), ring(base + 0.75 * H, 0.55 * R)], {
    start: true, end: [0, form.forward, 0], apexColor: pal.edge,
  });
}

/**
 * Axe bit lofted along y: each station is a wedge from the cheek (z0, thick) to the edge
 * (zEdge, keen). The crescent sweeps the horns back; the beard hangs below the eye.
 * Matches Features.bitEdge exactly (same stations, same crescent term).
 */
export function axeBit(kit: MeshKit, centreY: number, height: number, depth: number, crescent: number, z0Base: number, pal: WeaponPalette): void {
  const rings: Ring[] = [];
  const eyeLow = centreY - 0.3 * height, eyeHigh = centreY + 0.3 * height;
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const y = centreY - 0.6 * height + t * height;
    const zEdge = depth - crescent * 0.3 * height * (2 * t - 1) * (2 * t - 1);
    const off = Math.max(0, eyeLow - y, y - eyeHigh) * 0.9; // beard / horn leave the haft
    const z0 = Math.min(z0Base + off, zEdge - 0.03);
    const ab: [number, number][] = [[0.01, z0], [0.0025, zEdge - 0.015], [0, zEdge], [-0.0025, zEdge - 0.015], [-0.01, z0]];
    rings.push({ pts: MeshKit.section([0, y, 0], X, Z, ab), centre: [0, y, (z0 + zEdge) / 2], colors: [pal.blade, pal.blade, pal.edge, pal.blade, pal.blade] });
  }
  kit.setSpecular(SPECULAR_METAL);
  kit.tube(rings, { start: true, end: true });
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

/** A spike: a 4-point ring at `base` (in plane u, v) closing to `tip`. */
export function spike(kit: MeshKit, base: V3, u: V3, v: V3, r: number, tip: V3, color: THREE.Color, sides = 4): void {
  kit.setSpecular(SPECULAR_METAL);
  const pts = MeshKit.circle(base, u, v, r, r, sides);
  kit.tube([{ pts, centre: base, colors: color }], { start: true, end: tip });
}

/** Flanged mace head: a core with `count` bevelled flanges (radial slabs). */
export function flangedHead(kit: MeshKit, y: number, H: number, R: number, count: number, pal: WeaponPalette): void {
  const y0 = y - H / 2, y1 = y + H / 2;
  rod(kit, y0, y1, 0.42 * R, 0.42 * R, pal.blade, { segs: 8, start: true, end: [0, y1 + 0.3 * R, 0], specular: SPECULAR_METAL });
  kit.setSpecular(SPECULAR_METAL);
  const tf = clamp(0.12 * R, 0.004, 0.008);
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const d: V3 = [Math.cos(a), 0, Math.sin(a)], q: V3 = [-Math.sin(a), 0, Math.cos(a)];
    const at = (r: number, yy: number, side: number): V3 => [d[0] * r + q[0] * side, yy, d[2] * r + q[2] * side];
    const inner = [at(0.35 * R, y0, -tf), at(0.35 * R, y1, -tf), at(0.35 * R, y1, tf), at(0.35 * R, y0, tf)];
    const outer = [at(R, y0 + 0.2 * H, -tf / 3), at(R, y1 - 0.12 * H, -tf / 3), at(R, y1 - 0.12 * H, tf / 3), at(R, y0 + 0.2 * H, tf / 3)];
    kit.tube([
      { pts: inner, centre: [d[0] * 0.35 * R, y, d[2] * 0.35 * R], colors: pal.blade },
      { pts: outer, centre: [d[0] * R, y, d[2] * R], colors: pal.edge },
    ], { end: true });
  }
}

/** Flail chain: alternating links (closed 4-station loops) from y0 up to y1. */
export function chain(kit: MeshKit, y0: number, y1: number, pal: WeaponPalette): number {
  const pitch = 0.045;
  const links = clamp(Math.round((y1 - y0) / pitch), 2, 7);
  const step = (y1 - y0) / links;
  kit.setSpecular(SPECULAR_METAL);
  for (let k = 0; k < links; k++) {
    const cy = y0 + (k + 0.5) * step;
    const side: V3 = k % 2 === 0 ? X : Z;
    const normal: V3 = k % 2 === 0 ? Z : X;
    const lh = step * 0.62, sw = 0.013;
    const path: V3[] = [[0, cy - lh, 0], [side[0] * sw, cy, side[2] * sw], [0, cy + lh, 0], [-side[0] * sw, cy, -side[2] * sw]];
    const rings: Ring[] = [];
    for (const p of [...path, path[0]]) {
      const radial: V3 = [p[0], p[1] - cy, p[2]];
      const l = Math.hypot(radial[0], radial[1], radial[2]) || 1;
      rings.push({ pts: MeshKit.circle(p, normal, [radial[0] / l, radial[1] / l, radial[2] / l], 0.004, 0.004, 3), centre: p, colors: pal.dark });
    }
    kit.tube(rings);
  }
  return links;
}

/** Spiked ball: a lathe sphere plus spikes (equatorial ring + bottom). */
export function spikedBall(kit: MeshKit, y: number, R: number, spikes: number, pal: WeaponPalette): void {
  const core = 0.72 * R;
  kit.setSpecular(SPECULAR_METAL);
  const ring = (phi: number): Ring => ({
    pts: MeshKit.circle([0, y + core * Math.cos(phi), 0], X, Z, core * Math.sin(phi), core * Math.sin(phi), 8),
    centre: [0, y + core * Math.cos(phi), 0], colors: pal.blade,
  });
  kit.tube([ring(Math.PI / 4), ring(Math.PI / 2), ring((3 * Math.PI) / 4)], { start: [0, y + core, 0], end: [0, y - core, 0], smooth: true });
  for (let k = 0; k < spikes; k++) {
    const a = (k / Math.max(1, spikes - 1)) * Math.PI * 2;
    const dir: V3 = k === spikes - 1 ? [0, -1, 0] : [Math.cos(a), 0, Math.sin(a)];
    const u: V3 = k === spikes - 1 ? X : [-Math.sin(a), 0, Math.cos(a)];
    const v: V3 = k === spikes - 1 ? Z : Y;
    spike(kit, [dir[0] * core * 0.9, y + dir[1] * core * 0.9, dir[2] * core * 0.9], u, v, 0.28 * core,
      [dir[0] * R, y + dir[1] * R, dir[2] * R], pal.edge, 3);
  }
}

/** War hammer: waisted head along z (face at +z), back spike drooping by the curvature, top spike. */
export function hammerHead(kit: MeshKit, y: number, H: number, R: number, sr: number, curvature: number, pal: WeaponPalette): void {
  const faceZ = sr + 0.035;
  const oct = (hx: number, hy: number): [number, number][] => {
    const c = 0.3 * Math.min(hx, hy);
    return [[hx, hy - c], [hx, -(hy - c)], [hx - c, -hy], [-(hx - c), -hy], [-hx, -(hy - c)], [-hx, hy - c], [-(hx - c), hy], [hx - c, hy]];
  };
  const ring = (z: number, hx: number, hy: number): Ring => ({ pts: MeshKit.section([0, y, z], X, Y, oct(hx, hy)), centre: [0, y, z], colors: pal.blade });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(-(sr + 0.012), 0.45 * R + 0.008, H / 2), ring(sr + 0.01, 0.5 * R, 0.42 * H), ring(faceZ + 0.6 * R, R, R)], { start: true, end: true });
  const s = hammerSpike(R, curvature);
  const dir: V3 = [0, -Math.sin(s.droop), -Math.cos(s.droop)];
  spike(kit, [0, y, -(sr + 0.012)], X, Y, 0.38 * Math.min(R, H / 2), [0, y + dir[1] * s.length, sr + dir[2] * s.length], pal.edge);
  spike(kit, [0, y + H / 2, 0], X, Z, 0.5 * sr, [0, y + H / 2 + 0.035, 0], pal.edge);
}

/** Maul block along z, chamfered, with bevelled faces at both ends. */
export function maulBlock(kit: MeshKit, y: number, H: number, R: number, pal: WeaponPalette): void {
  const half = MAUL_BLOCK_RATIO * R, hx = R, hy = H / 2;
  const oct = (k: number): [number, number][] => {
    const ax = hx * k, ay = hy * k, c = 0.25 * Math.min(ax, ay);
    return [[ax, ay - c], [ax, -(ay - c)], [ax - c, -ay], [-(ax - c), -ay], [-ax, -(ay - c)], [-ax, ay - c], [-(ax - c), ay], [ax - c, ay]];
  };
  const ring = (z: number, k: number, col: THREE.Color): Ring => ({ pts: MeshKit.section([0, y, z], X, Y, oct(k)), centre: [0, y, z], colors: col });
  kit.setSpecular(SPECULAR_METAL);
  kit.tube([ring(-half, 0.86, pal.edge), ring(-half + 0.014, 1, pal.blade), ring(half - 0.014, 1, pal.blade), ring(half, 0.86, pal.edge)], { start: true, end: true });
}

/** Bow limb from the riser to one tip (sign +1 up, -1 down); returns the tip point. */
export function bowLimb(kit: MeshKit, half: number, brace: number, recurve: number, sign: 1 | -1, pal: WeaponPalette): V3 {
  const rings: Ring[] = [];
  const n = 5;
  const at = (t: number): V3 => bowLimbPoint(half, brace, recurve, sign, t);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = at(t), q = at(Math.min(1, t + 0.05)), o = at(Math.max(0, t - 0.05));
    const tan: V3 = [0, q[1] - o[1], q[2] - o[2]];
    const l = Math.hypot(tan[1], tan[2]) || 1;
    const nrm: V3 = [0, -tan[2] / l, tan[1] / l]; // in the yz plane, perpendicular to the limb
    const w = 0.017 * (1 - 0.5 * t), th = 0.0095 * (1 - 0.45 * t);
    rings.push({ pts: MeshKit.section(p, X, nrm, [[w, th], [w, -th], [-w, -th], [-w, th]]), centre: p, colors: pal.wood });
  }
  kit.setSpecular(0);
  kit.tube(rings, { start: false, end: true });
  return at(1);
}
