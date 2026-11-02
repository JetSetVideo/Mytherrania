// Lane V-B body probe (headless, no browser): measures how "round / generated" the generated
// bodies look and renders cel-shaded multi-angle sheets with a tiny software rasteriser.
//
//   deno run -A tools/probe-body.ts --tag before      # metrics + sheets into artifacts/wave-v/lane-B/before
//   deno run -A tools/probe-body.ts --tag after       # same, after the change
//   deno run -A tools/probe-body.ts --compare         # before-over-after sheets per body (needs both raws)
//   deno run -A tools/probe-body.ts --browser         # in-game captures (real Chrome, needs deno task build)
//
// Metrics per race x sex (all from the REAL pipeline: anatomyFor -> field -> Surface Nets -> paint):
//   curvature   per-vertex signed mean curvature H (umbrella operator, 1/m, 2 rings of smoothing);
//               per region: concave share (H < -CONCAVE_H), IQR, Shannon entropy of the H histogram
//               (bits; more distinct curvature regimes -> more bits), dihedral p50/p95 (deg).
//   blends      every smoothUnion k in the plan, by junction, in cells and as a fraction of the
//               smaller limb radius; the k spread (distinct values, coefficient of variation).
//   joints      radial profile of the limb along its bone (anterior/posterior/lateral/medial rays
//               bisected on the body field): the WAIST at the elbow and knee = (smaller of the two
//               neighbouring belly peaks - narrowest width at the joint) / joint width, front and
//               side silhouettes; belly count = local maxima of width with >= 0.5 cell prominence.
//   silhouette  front-view neck->shoulder top-line concavity (area under the chord / chord length²).
//   texture     painted (game recipe) luminance per region: std, RMS gradient (1/m), and the "mush"
//               share = edges whose luminance jumps more than a cel band step (0.08).
//   physics     armAbduction/legAbduction (the solved joints), hitbox capsule share per bone (the
//               ragdoll's weld floor is 2 %), triangles.
// deno-lint-ignore-file no-explicit-any
import { generateBody, bodyField } from "../src/graphics/body/BodyMesh.ts";
import { REGIONS, type BodySpec, type MeshData, type SdfNode, type SdfSample, type Vec3 } from "../src/graphics/body/contracts.ts";
import { paintSkin } from "../src/graphics/body/SkinnedHumanoid.ts";
import { hitboxesFromPlan, positivePrimitives } from "../src/combat/Hitboxes.ts";
import { compileSdf, nodeBounds } from "../src/graphics/body/Sdf.ts";
import type { Appearance } from "../src/game/Characters.ts";

export const OUT = "artifacts/wave-v/lane-B";
/** Raw RGB sheets for --compare live OUTSIDE the repo (4.5 MB each). */
const RAW = `${Deno.env.get("TMPDIR") ?? "/tmp"}/probe-body-raw`;
const CONCAVE_H = 2; // 1/m: below -2 /m a vertex sits in a valley (a crease, a groove, a waist)

export interface ProbeBody { id: string; spec: BodySpec }
export const BODIES: ProbeBody[] = [];
const BASE: Record<string, { m: [number, number]; f: [number, number] }> = {
  human: { m: [1.76, 76], f: [1.66, 61] },
  elf: { m: [1.84, 66], f: [1.75, 56] },
  dwarf: { m: [1.38, 78], f: [1.32, 66] },
  ork: { m: [1.98, 118], f: [1.88, 96] },
};
for (const race of Object.keys(BASE)) {
  for (const sex of ["male", "female"] as const) {
    const [height, weight] = BASE[race][sex === "male" ? "m" : "f"];
    BODIES.push({ id: `${race}-${sex}`, spec: { race, subrace: null, className: "Warrior", height, weight, seed: 7, sex } });
  }
}

// ------------------------------------------------------------------------------------------
// mesh helpers
// ------------------------------------------------------------------------------------------
function adjacency(mesh: MeshData): number[][] {
  const n = mesh.positions.length / 3, nb: Set<number>[] = Array.from({ length: n }, () => new Set());
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  return nb.map((s) => [...s]);
}

/** Signed mean curvature per vertex (1/m), umbrella operator, smoothed over `rings` 1-rings. */
export function meanCurvature(mesh: MeshData, adj = adjacency(mesh), rings = 2): Float64Array {
  const P = mesh.positions, N = mesh.normals, n = P.length / 3;
  let H = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    if (nb.length === 0) continue;
    let ux = 0, uy = 0, uz = 0, l2 = 0;
    for (const j of nb) {
      const dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2];
      ux += dx; uy += dy; uz += dz; l2 += dx * dx + dy * dy + dz * dz;
    }
    ux /= nb.length; uy /= nb.length; uz /= nb.length; l2 /= nb.length;
    // A sphere of radius r: neighbours sit l²/(2r) below the tangent plane -> H = -2·(u·n)/l² = 1/r.
    H[i] = (-2 * (ux * N[i * 3] + uy * N[i * 3 + 1] + uz * N[i * 3 + 2])) / Math.max(l2, 1e-12);
  }
  for (let r = 0; r < rings; r++) {
    const S = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = H[i]; for (const j of adj[i]) s += H[j]; S[i] = s / (adj[i].length + 1); }
    H = S;
  }
  return H;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}
function entropyBits(xs: number[], lo: number, hi: number, bins: number): number {
  const c = new Array(bins).fill(0);
  for (const x of xs) c[Math.max(0, Math.min(bins - 1, Math.floor((x - lo) / (hi - lo) * bins)))]++;
  let e = 0;
  for (const k of c) if (k > 0) { const p = k / xs.length; e -= p * Math.log2(p); }
  return e;
}

/** Dihedral angle (deg) per interior edge, tagged with the region of its first vertex. */
function dihedrals(mesh: MeshData): { deg: number; region: number }[] {
  const P = mesh.positions, I = mesh.indices;
  const fn = (t: number): Vec3 => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  const edge = new Map<string, number>();
  const out: { deg: number; region: number }[] = [];
  for (let t = 0; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e], b = I[t + (e + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const o = edge.get(key);
      if (o === undefined) { edge.set(key, t); continue; }
      const n1 = fn(o), n2 = fn(t);
      const d = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
      out.push({ deg: Math.acos(d) * 180 / Math.PI, region: mesh.region[a] });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// blends
// ------------------------------------------------------------------------------------------
function firstPrimId(n: SdfNode): string {
  return n.type === "primitive" ? n.primitive.id : firstPrimId(n.children[0]);
}
export function blendList(root: SdfNode): { k: number; children: string[] }[] {
  const out: { k: number; children: string[] }[] = [];
  const walk = (n: SdfNode) => {
    if (n.type !== "op") return;
    if (n.op === "smoothUnion") out.push({ k: n.k, children: n.children.map(firstPrimId) });
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

// ------------------------------------------------------------------------------------------
// limb profiles
// ------------------------------------------------------------------------------------------
type Field = ReturnType<typeof bodyField>;
function rayExit(F: Field, p: Vec3, e: Vec3, maxR: number, step: number): number {
  const s: SdfSample = { d: 0, region: 0, bone: 0 };
  const at = (r: number) => F.sample(p[0] + e[0] * r, p[1] + e[1] * r, p[2] + e[2] * r, s).d;
  if (at(0) > 0) return 0;
  let lo = 0, hi = -1;
  for (let r = step; r <= maxR; r += step) { if (at(r) > 0) { hi = r; break; } lo = r; }
  if (hi < 0) return maxR;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (at(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
export interface Profile { s: number[]; front: number[]; side: number[] }
/** Widths along a limb: `front` = lateral + medial (the front-view silhouette), `side` = anterior + posterior. */
export function limbProfile(F: Field, root: Vec3, d: Vec3, o: Vec3, f: Vec3, length: number, maxR: number, cell: number): Profile {
  const out: Profile = { s: [], front: [], side: [] };
  const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
  for (let s = 0.04 * length; s <= length; s += cell / 2) {
    const p: Vec3 = [root[0] + d[0] * s, root[1] + d[1] * s, root[2] + d[2] * s];
    out.s.push(s);
    out.front.push(rayExit(F, p, o, maxR, cell / 3) + rayExit(F, p, neg(o), maxR, cell / 3));
    out.side.push(rayExit(F, p, f, maxR, cell / 3) + rayExit(F, p, neg(f), maxR, cell / 3));
  }
  return out;
}
function maxIn(p: Profile, w: number[], a: number, b: number): number {
  let m = -Infinity;
  p.s.forEach((s, i) => { if (s >= a && s <= b) m = Math.max(m, w[i]); });
  return m;
}
function minIn(p: Profile, w: number[], a: number, b: number): number {
  let m = Infinity;
  p.s.forEach((s, i) => { if (s >= a && s <= b) m = Math.min(m, w[i]); });
  return m;
}
/** Waist at joint sj between segments of length L1 (above) and L2 (below): (min(peakA, peakB) − narrowest)/narrowest. */
export function waistAt(p: Profile, w: number[], sj: number, L1: number, L2: number): number {
  const neck = minIn(p, w, sj - 0.15 * L1, sj + 0.15 * L2);
  const a = maxIn(p, w, sj - 0.75 * L1, sj - 0.1 * L1), b = maxIn(p, w, sj + 0.1 * L2, sj + 0.6 * L2);
  return (Math.min(a, b) - neck) / Math.max(neck, 1e-9);
}
export function bellies(w: number[], prominence: number): number {
  let count = 0;
  for (let i = 1; i < w.length - 1; i++) {
    if (!(w[i] >= w[i - 1] && w[i] > w[i + 1])) continue;
    let l = Infinity, r = Infinity;
    for (let j = i - 1; j >= 0 && w[j] <= w[i]; j--) l = Math.min(l, w[j]);
    for (let j = i + 1; j < w.length && w[j] <= w[i]; j++) r = Math.min(r, w[j]);
    if (w[i] - Math.max(l === Infinity ? -Infinity : l, r === Infinity ? -Infinity : r) >= prominence) count++;
  }
  return count;
}

// ------------------------------------------------------------------------------------------
// software rasteriser (orthographic, z-buffer, cel bands, depth-edge ink)
// ------------------------------------------------------------------------------------------
export interface View { centre: Vec3; dir: Vec3; half: number; w: number; h: number; grey?: boolean }
export interface Image { w: number; h: number; rgb: Uint8Array }
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lin2s = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function render(mesh: MeshData, colours: Float32Array | null, v: View): Image {
  const { w, h } = v;
  const fwd = norm(v.dir), up0: Vec3 = Math.abs(fwd[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0];
  const right = norm(cross(up0, fwd)), up = cross(fwd, right);
  const light = norm([-0.45 * right[0] + 0.6 * up[0] + 0.66 * fwd[0], -0.45 * right[1] + 0.6 * up[1] + 0.66 * fwd[1], -0.45 * right[2] + 0.6 * up[2] + 0.66 * fwd[2]]);
  const P = mesh.positions, N = mesh.normals, I = mesh.indices, nv = P.length / 3;
  const sx = new Float64Array(nv), sy = new Float64Array(nv), sz = new Float64Array(nv);
  const scale = (h / 2) / v.half;
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3] - v.centre[0], y = P[i * 3 + 1] - v.centre[1], z = P[i * 3 + 2] - v.centre[2];
    sx[i] = w / 2 + (x * right[0] + y * right[1] + z * right[2]) * scale;
    sy[i] = h / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale;
    sz[i] = x * fwd[0] + y * fwd[1] + z * fwd[2];
  }
  const depth = new Float64Array(w * h).fill(-Infinity);
  const shade = new Float32Array(w * h * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
    if (area >= 0) continue; // back-facing (CCW outward, y flipped on screen)
    const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c]))), x1 = Math.min(w - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c]))), y1 = Math.min(h - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const w0 = ((sx[b] - qx) * (sy[c] - qy) - (sx[c] - qx) * (sy[b] - qy)) / area;
        const w1 = ((sx[c] - qx) * (sy[a] - qy) - (sx[a] - qx) * (sy[c] - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
        const k = py * w + px;
        if (z <= depth[k]) continue;
        depth[k] = z;
        let nx = w0 * N[a * 3] + w1 * N[b * 3] + w2 * N[c * 3];
        let ny = w0 * N[a * 3 + 1] + w1 * N[b * 3 + 1] + w2 * N[c * 3 + 1];
        let nz = w0 * N[a * 3 + 2] + w1 * N[b * 3 + 2] + w2 * N[c * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const ndl = nx * light[0] + ny * light[1] + nz * light[2];
        const tone = ndl < 0.05 ? 0.46 : ndl < 0.5 ? 0.72 : 1.0; // three cel bands, as the game's CelShader
        for (let ch = 0; ch < 3; ch++) {
          const alb = v.grey || !colours ? 0.62 : lin2s(w0 * colours[a * 3 + ch] + w1 * colours[b * 3 + ch] + w2 * colours[c * 3 + ch]);
          shade[k * 3 + ch] = alb * tone;
        }
      }
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  const ink = 0.018 * scale; // a 1.8 cm depth step is an ink edge (screen units: metres -> px not needed for depth)
  void ink;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const k = py * w + px;
      const bg = [0.93, 0.91, 0.86];
      if (depth[k] === -Infinity) { for (let ch = 0; ch < 3; ch++) rgb[k * 3 + ch] = Math.round(bg[ch] * 255); continue; }
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = px + dx, qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const dq = depth[qy * w + qx];
        if (dq === -Infinity || depth[k] - dq > 0.04) { edge = true; break; }
      }
      for (let ch = 0; ch < 3; ch++) rgb[k * 3 + ch] = edge ? 22 : Math.round(Math.max(0, Math.min(1, shade[k * 3 + ch])) * 255);
    }
  }
  return { w, h, rgb };
}

export function compose(rows: Image[][], pad = 4): Image {
  const W = Math.max(...rows.map((r) => r.reduce((s, im) => s + im.w + pad, pad)));
  const H = rows.reduce((s, r) => s + Math.max(...r.map((im) => im.h)) + pad, pad);
  const rgb = new Uint8Array(W * H * 3).fill(255);
  let y = pad;
  for (const r of rows) {
    let x = pad;
    for (const im of r) {
      for (let j = 0; j < im.h; j++) rgb.set(im.rgb.subarray(j * im.w * 3, (j + 1) * im.w * 3), ((y + j) * W + x) * 3);
      x += im.w + pad;
    }
    y += Math.max(...r.map((im) => im.h)) + pad;
  }
  return { w: W, h: H, rgb };
}

// PNG (zlib via CompressionStream("deflate"), filter 0 per row).
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export async function png(im: Image): Promise<Uint8Array> {
  const raw = new Uint8Array((im.w * 3 + 1) * im.h);
  for (let y = 0; y < im.h; y++) raw.set(im.rgb.subarray(y * im.w * 3, (y + 1) * im.w * 3), y * (im.w * 3 + 1) + 1);
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, im.w); dv.setUint32(4, im.h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------------------------------
// one body
// ------------------------------------------------------------------------------------------
const appearanceOf = (s: BodySpec): Appearance => ({
  body: "#4f6f8a", accent: "#dfaa55", height: s.height, weight: s.weight, hair: "#3a2a1e", eyes: "#2f6fb5",
  race: s.race, subrace: s.subrace, sex: (s.sex ?? undefined) as any,
});

export function measure(spec: BodySpec) {
  const body = generateBody(spec);
  const { plan, mesh } = body;
  const c = plan.cell, h = plan.proportions.head;
  const adj = adjacency(mesh);
  const H = meanCurvature(mesh, adj);
  const colours = paintSkin(mesh, spec, appearanceOf(spec), c);
  // curvature + dihedral per region group
  const groups: Record<string, string[]> = {
    arm: ["upperArm", "foreArm"], leg: ["thigh", "shin"], trunk: ["torso", "pelvis", "neck"], all: [...REGIONS],
  };
  const dih = dihedrals(mesh);
  const curvature: Record<string, any> = {};
  for (const [g, regs] of Object.entries(groups)) {
    const ids = new Set(regs.map((r) => REGIONS.indexOf(r as any)));
    const hs: number[] = [];
    for (let i = 0; i < H.length; i++) if (ids.has(mesh.region[i])) hs.push(H[i]);
    const ds = dih.filter((e) => ids.has(e.region)).map((e) => e.deg);
    curvature[g] = {
      n: hs.length,
      concaveShare: hs.filter((x) => x < -CONCAVE_H).length / Math.max(1, hs.length),
      p10: quantile(hs, 0.1), p50: quantile(hs, 0.5), p90: quantile(hs, 0.9),
      iqr: quantile(hs, 0.75) - quantile(hs, 0.25),
      entropyBits: entropyBits(hs, -40, 80, 24),
      dihedralP50: quantile(ds, 0.5), dihedralP95: quantile(ds, 0.95),
    };
  }
  // blends
  const blends = blendList(plan.root);
  const ks = blends.map((b) => b.k);
  const meanK = ks.reduce((s, k) => s + k, 0) / ks.length;
  const sdK = Math.sqrt(ks.reduce((s, k) => s + (k - meanK) ** 2, 0) / ks.length);
  const named = (pred: (b: { children: string[] }) => boolean) => blends.find(pred)?.k ?? NaN;
  const has = (b: { children: string[] }, ...ids: string[]) => ids.every((i) => b.children.includes(i));
  const junction = {
    shoulder: named((b) => has(b, "ribcage", "upperArmL")),
    elbow: named((b) => has(b, "upperArmL", "elbowL")),
    wrist: named((b) => has(b, "upperArmL", "palmL")),
    knee: named((b) => has(b, "thighL", "kneeL")),
    hip: named((b) => has(b, "ribcage", "thighL")),
    neck: named((b) => has(b, "ribcage", "neck")),
  };
  // joints
  const F = bodyField(plan);
  const P = plan.proportions;
  const arm = plan.arms[0], leg = plan.legs[0];
  const aProf = limbProfile(F, arm.shoulder, arm.frame.d, arm.frame.o, arm.frame.f, P.upperArm + P.foreArm, 3 * P.radius.deltoid, c);
  const legLen = Math.hypot(leg.ankle[0] - leg.hip[0], leg.ankle[1] - leg.hip[1]);
  const thighLen = Math.hypot(leg.knee[0] - leg.hip[0], leg.knee[1] - leg.hip[1]);
  const lProf = limbProfile(F, leg.hip, leg.frame.d, leg.frame.o, leg.frame.f, legLen, 3 * P.radius.thighTop, c);
  const joints = {
    elbowWaistFront: waistAt(aProf, aProf.front, P.upperArm, P.upperArm, P.foreArm),
    elbowWaistSide: waistAt(aProf, aProf.side, P.upperArm, P.upperArm, P.foreArm),
    kneeWaistFront: waistAt(lProf, lProf.front, thighLen, thighLen, legLen - thighLen),
    kneeWaistSide: waistAt(lProf, lProf.side, thighLen, thighLen, legLen - thighLen),
    armBelliesFront: bellies(aProf.front, 0.5 * c), armBelliesSide: bellies(aProf.side, 0.5 * c),
    legBelliesFront: bellies(lProf.front, 0.5 * c), legBelliesSide: bellies(lProf.side, 0.5 * c),
  };
  // neck -> shoulder top line (front view): topmost body point per column between the neck and the shoulder joint
  const sAt = (x: number): number => {
    const s: SdfSample = { d: 0, region: 0, bone: 0 };
    let best = -Infinity;
    for (let z = -0.6 * h; z <= 0.6 * h; z += c / 2) {
      // March down from the chin to the first inside point, then bisect the top surface.
      let hi = P.y.chin, lo = NaN;
      for (let y = P.y.chin; y >= P.y.shoulder - 0.8 * h; y -= c / 4) { if (F.sample(x, y, z, s).d < 0) { lo = y; break; } hi = y; }
      if (Number.isNaN(lo)) continue;
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (F.sample(x, m, z, s).d < 0) lo = m; else hi = m; }
      best = Math.max(best, lo);
    }
    return best;
  };
  const xn = P.halfWidth.neck * 1.05, xs = arm.shoulder[0];
  const ya = sAt(xn), yb = sAt(xs);
  let under = 0;
  const steps = 24;
  for (let i = 1; i < steps; i++) { const x = xn + (xs - xn) * i / steps; const chord = ya + (yb - ya) * i / steps; under += (chord - sAt(x)) * (xs - xn) / steps; }
  const chordLen = Math.hypot(xs - xn, yb - ya);
  const silhouette = { neckShoulderConcavity: under / (chordLen * chordLen) };
  // texture
  const lum = new Float64Array(H.length);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.2126 * lin2s(colours[i * 3]) + 0.7152 * lin2s(colours[i * 3 + 1]) + 0.0722 * lin2s(colours[i * 3 + 2]);
  const texture: Record<string, any> = {};
  const texGroups: Record<string, string[]> = { arm: ["upperArm", "foreArm"], leg: ["thigh", "shin"], trunk: ["torso", "pelvis"], neckFace: ["neck", "face"], all: [...REGIONS] };
  const Pp = mesh.positions;
  // Interior vertices: every neighbour in the same region. A paint jump there is texture (or noise);
  // at a region seam it is a designed contour (the garment hem, the sole edge) and is not "mush".
  const interior = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) interior[i] = adj[i].every((j) => mesh.region[j] === mesh.region[i]) ? 1 : 0;
  for (const [g, regs] of Object.entries(texGroups)) {
    const ids = new Set(regs.map((r) => REGIONS.indexOf(r as any)));
    const ys: number[] = [];
    let g2 = 0, ne = 0, jumps = 0, gi2 = 0, ni = 0, jumpsI = 0;
    for (let i = 0; i < lum.length; i++) {
      if (!ids.has(mesh.region[i])) continue;
      ys.push(lum[i]);
      for (const j of adj[i]) {
        if (j < i || !ids.has(mesh.region[j])) continue;
        const L = Math.hypot(Pp[i * 3] - Pp[j * 3], Pp[i * 3 + 1] - Pp[j * 3 + 1], Pp[i * 3 + 2] - Pp[j * 3 + 2]) || 1e-6;
        const dy = lum[i] - lum[j];
        g2 += (dy / L) ** 2; ne++;
        if (Math.abs(dy) > 0.08) jumps++;
        if (interior[i] && interior[j]) { gi2 += (dy / L) ** 2; ni++; if (Math.abs(dy) > 0.08) jumpsI++; }
      }
    }
    const mean = ys.reduce((s, y) => s + y, 0) / Math.max(1, ys.length);
    texture[g] = {
      std: Math.sqrt(ys.reduce((s, y) => s + (y - mean) ** 2, 0) / Math.max(1, ys.length)),
      rmsGradient: Math.sqrt(g2 / Math.max(1, ne)), mushShare: jumps / Math.max(1, ne),
      interiorRmsGradient: Math.sqrt(gi2 / Math.max(1, ni)), interiorMushShare: jumpsI / Math.max(1, ni),
    };
  }
  // physics
  const boxes = hitboxesFromPlan(plan, { mass: 70 });
  const vol: Record<string, number> = {};
  let tot = 0;
  for (const b of boxes.boxes) {
    const L = Math.hypot(b.a[0] - b.b[0], b.a[1] - b.b[1], b.a[2] - b.b[2]);
    const v = Math.PI * b.radius * b.radius * L + 4 / 3 * Math.PI * b.radius ** 3;
    vol[b.bone] = (vol[b.bone] ?? 0) + v; tot += v;
  }
  const share: Record<string, number> = {};
  for (const k of Object.keys(vol)) share[k] = vol[k] / tot;
  // Field volume per bone (litres): the RENDERED field voxelised at 0.75 cell, owned by the sample's bone.
  const vstep = 0.75 * c, sv: SdfSample = { d: 0, region: 0, bone: 0 }, boneVol: Record<string, number> = {};
  const BONES = plan.bones.map((b) => b.id);
  for (let z = plan.bounds.min[2]; z <= plan.bounds.max[2]; z += vstep) {
    for (let y = Math.max(0, plan.bounds.min[1]); y <= plan.bounds.max[1]; y += vstep) {
      for (let x = plan.bounds.min[0]; x <= plan.bounds.max[0]; x += vstep) {
        if (F.sample(x, y, z, sv).d > 0) continue;
        const id = BONES[sv.bone] ?? String(sv.bone);
        boneVol[id] = (boneVol[id] ?? 0) + vstep * vstep * vstep * 1000;
      }
    }
  }
  // The PHYSICS measure of mass per bone: the hard union of the positive primitives, voxel-owned by the
  // deepest primitive (Hitboxes.fitPlan's rule) — what the ragdoll's segment masses are fitted to.
  const solid = solidBoneVolumes(plan.root, 0.75 * c, plan.bones.length);
  const solidVolumeL: Record<string, number> = {};
  plan.bones.forEach((b, i) => { if (solid[i] > 0) solidVolumeL[b.id] = solid[i] * 1000; });
  const physics = {
    boneVolumeL: boneVol, solidVolumeL,
    armAbduction: plan.armAbduction, legAbduction: plan.legAbduction, armDisplayAbduction: plan.armDisplayAbduction,
    elbowShare: share.elbowL, shares: share, hitboxMassKgAt1010: boxes.mass,
    triangles: body.stats.triangles, components: body.stats.components, cell: c,
  };
  return { body, colours, metrics: { curvature, blends: { count: ks.length, distinct: new Set(ks.map((k) => k.toFixed(4))).size, cvK: sdK / meanK, meanKCells: meanK / c, junction }, joints, silhouette, texture, physics }, profiles: { arm: aProf, leg: lProf } };
}

/** Volume (m³) per bone index of the hard union of the positive primitives (voxel centres at `step`). */
export function solidBoneVolumes(root: SdfNode, step: number, nb: number): number[] {
  const node: SdfNode = { type: "op", op: "union", k: 0, children: positivePrimitives(root).map((primitive) => ({ type: "primitive" as const, primitive })) };
  const F = compileSdf(node), b = nodeBounds(node), s: SdfSample = { d: 0, region: 0, bone: 0 }, out = new Array(nb).fill(0);
  for (let z = b.min[2] + step / 2; z < b.max[2]; z += step) for (let y = Math.max(0, b.min[1]) + step / 2; y < b.max[1]; y += step) for (let x = b.min[0] + step / 2; x < b.max[0]; x += step) {
    if (F.sample(x, y, z, s).d <= 0) out[s.bone] += step * step * step;
  }
  return out;
}

export function sheet(r: ReturnType<typeof measure>, size = 260): Image {
  const { plan, mesh } = r.body, P = plan.proportions, h = P.head;
  const mid: Vec3 = [0, P.y.crown / 2, 0];
  const half = P.y.crown * 0.56;
  const full = (dir: Vec3, grey = false) => render(mesh, r.colours, { centre: mid, dir, half, w: size, h: Math.round(size * 1.7), grey });
  const arm = plan.arms[0], leg = plan.legs[0];
  const close = (centre: Vec3, dir: Vec3, s: number) => render(mesh, r.colours, { centre, dir, half: s, w: size, h: size, grey: true });
  const q: Vec3 = [0.7, 0, 0.7];
  const o = arm.frame.o;
  return compose([
    [full([0, 0, 1]), full([1, 0, 0]), full([0, 0, -1]), full(q)],
    [full([0, 0, 1], true), full([1, 0, 0], true), full([0, 0, -1], true), full([-0.6, 0.15, -0.8], true)],
    [close(arm.shoulder, [0.55, 0.15, 0.8], 1.0 * h), close(arm.elbow, [o[0], o[1], o[2]], 0.75 * h), close(arm.elbow, [0.2, 0.1, 1], 0.75 * h), close(arm.elbow, [0.2, 0.1, -1], 0.75 * h)],
    [close(leg.knee, [0.55, 0.1, 0.85], 0.9 * h), close(leg.knee, [1, 0.05, 0], 1.1 * h), close(leg.knee, [0.1, 0.05, -1], 0.9 * h), close([0, P.y.shoulder - 0.3 * h, 0], [0.3, 0.35, -1], 1.3 * h)],
  ]);
}

async function writeRaw(path: string, im: Image) {
  const head = new Uint8Array(8); new DataView(head.buffer).setUint32(0, im.w); new DataView(head.buffer).setUint32(4, im.h);
  const out = new Uint8Array(8 + im.rgb.length); out.set(head); out.set(im.rgb, 8);
  await Deno.writeFile(path, out);
}
async function readRaw(path: string): Promise<Image> {
  const b = await Deno.readFile(path), dv = new DataView(b.buffer);
  return { w: dv.getUint32(0), h: dv.getUint32(4), rgb: b.subarray(8) };
}

/**
 * In-game check (needs a fresh `deno task build`): the real Chrome renders the real CelSkinned shader
 * and ink hull. Swaps the player model per race (Engine.debugSetModel) and orbits the camera
 * (debugView), front / side / back / a close 3-4 at the elbow height. Writes artifacts/wave-v/lane-B/browser.
 */
async function browserCaptures(): Promise<void> {
  const { chromium } = await import("playwright");
  const { serveAsset } = await import("./serve.ts");
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r));
  const port = (server.addr as Deno.NetAddr).port;
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
  const page = await b.newPage({ viewport: { width: 640, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
  const dir = `${OUT}/browser${Deno.env.get("PROBE_TAG") ? "-" + Deno.env.get("PROBE_TAG") : ""}`;
  await Deno.mkdir(dir, { recursive: true });
  await page.click('[data-action="start"]').catch(() => {});
  await page.waitForTimeout(1500);
  const races = [["human", "imperial", "Warrior"], ["elf", "high", "Mage"], ["dwarf", "mountain", "Warrior"], ["ork", "ironhide", "Barbarian"]];
  for (const [race, sub, cls] of races) {
    await page.evaluate((r) => (globalThis as any).__MYTHERRANIA__.engine.debugSetModel({ race: r[0], subrace: r[1], className: r[2] }), [race, sub, cls]);
    await page.waitForTimeout(1200);
    await page.evaluate(() => (globalThis as any).__MYTHERRANIA__.engine.debugView({ freeze: true, hour: 12 }));
    // The player faces +X: "front" is yaw π/2 (as tools/probe-models.ts).
    const shots: [string, number, number, number, string | undefined][] = [
      ["front", Math.PI / 2, 4.2, 0.1, undefined], ["side", Math.PI, 4.2, 0.1, undefined], ["back", -Math.PI / 2, 4.2, 0.1, undefined],
      ["close34", Math.PI / 2 + 0.7, 2.0, 0.05, undefined], ["arm", Math.PI / 2 + 0.9, 1.0, 0.1, "hand"], ["armBack", -Math.PI / 2 - 0.6, 1.0, 0.1, "hand"],
    ];
    for (const [name, yaw, dist, pitch, target] of shots) {
      await page.evaluate((v) => (globalThis as any).__MYTHERRANIA__.engine.debugView({ clean: true, pose: "idle", orbit: { yaw: v[0], pitch: v[2], dist: v[1], ...(v[3] ? { target: v[3] } : {}) } }), [yaw, dist, pitch, target ?? ""] as [number, number, number, string]);
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${dir}/${race}-${name}.png` });
    }
    console.log(`${race}: ${shots.map((x) => x[0]).join("/")}`);
  }
  console.log(`page errors: ${errors.length}${errors.length ? " " + errors.slice(0, 3).join(" | ") : ""}`);
  await b.close();
  await server.shutdown();
}

if (import.meta.main) {
  const args = Deno.args;
  if (args.includes("--browser")) { await browserCaptures(); Deno.exit(0); }
  if (args.includes("--compare")) {
    await Deno.mkdir(`${OUT}/compare`, { recursive: true });
    for (const b of BODIES) {
      const before = await readRaw(`${RAW}/before/${b.id}.rgb`), after = await readRaw(`${RAW}/after/${b.id}.rgb`);
      await Deno.writeFile(`${OUT}/compare/${b.id}.png`, await png(compose([[before, after]], 6)));
      console.log(`${OUT}/compare/${b.id}.png`);
    }
    Deno.exit(0);
  }
  const tag = args[args.indexOf("--tag") + 1] ?? "now";
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const noImages = args.includes("--no-images");
  await Deno.mkdir(`${OUT}/${tag}`, { recursive: true });
  const all: Record<string, unknown> = {};
  for (const b of BODIES) {
    if (only && !only.includes(b.id)) continue;
    const t0 = performance.now();
    const r = measure(b.spec);
    all[b.id] = r.metrics;
    const m = r.metrics;
    console.log(`${b.id.padEnd(13)} tris ${m.physics.triangles} | arm H concave ${(100 * m.curvature.arm.concaveShare).toFixed(1)}% ent ${m.curvature.arm.entropyBits.toFixed(2)} | leg concave ${(100 * m.curvature.leg.concaveShare).toFixed(1)}% ent ${m.curvature.leg.entropyBits.toFixed(2)} | trunk concave ${(100 * m.curvature.trunk.concaveShare).toFixed(1)}% | k distinct ${m.blends.distinct}/${m.blends.count} cv ${m.blends.cvK.toFixed(2)} | elbow waist F/S ${m.joints.elbowWaistFront.toFixed(3)}/${m.joints.elbowWaistSide.toFixed(3)} knee ${m.joints.kneeWaistFront.toFixed(3)}/${m.joints.kneeWaistSide.toFixed(3)} | bellies arm ${m.joints.armBelliesFront}/${m.joints.armBelliesSide} leg ${m.joints.legBelliesFront}/${m.joints.legBelliesSide} | neck-sh conc ${m.silhouette.neckShoulderConcavity.toFixed(4)} | tex arm grad ${m.texture.arm.rmsGradient.toFixed(2)} std ${m.texture.arm.std.toFixed(3)} mush ${(100 * m.texture.arm.mushShare).toFixed(1)}% leg grad ${m.texture.leg.rmsGradient.toFixed(2)} | abd ${m.physics.armAbduction.toFixed(4)}/${m.physics.legAbduction.toFixed(4)} elbow ${(100 * m.physics.elbowShare).toFixed(2)}% (${Math.round(performance.now() - t0)} ms)`);
    if (!noImages) {
      const im = sheet(r);
      await Deno.writeFile(`${OUT}/${tag}/${b.id}.png`, await png(im));
      await Deno.mkdir(`${RAW}/${tag}`, { recursive: true });
      await writeRaw(`${RAW}/${tag}/${b.id}.rgb`, im);
    }
  }
  await Deno.writeTextFile(`${OUT}/${tag}/metrics.json`, JSON.stringify(all, null, 1));
  console.log(`wrote ${OUT}/${tag}/metrics.json`);
}
