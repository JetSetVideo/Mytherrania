// Wave TEX lane QA (art verifier): pixel meters for the capture matrix of tools/capture-wave-tex.ts.
//
// QA tool, never game code. Reads capture PNGs + index.json, writes artifacts/wave-tex/verify-art/** and
// docs/wave-tex/VERIFY-ART.md (generated from verdicts.json, never typed by hand).
//
//   deno run -A tools/verify-wave-tex-art.ts measure <runDir> [--out <name>]   per-image + pairwise meters -> metrics JSON
//   deno run -A tools/verify-wave-tex-art.ts image <png> [x y w h]              meters of one image / crop (prints JSON)
//   deno run -A tools/verify-wave-tex-art.ts crop <png> x y w h <out.png> [scale]  crop (nearest upscale) for vision checks
//   deno run -A tools/verify-wave-tex-art.ts verdict '<json>'                   append a verdict {ready, board, verdict, sheet, region, measure, note}
//   deno run -A tools/verify-wave-tex-art.ts doc                                regenerate docs/wave-tex/VERIFY-ART.md
//
// Meters (all on decoded pixels at full resolution, sRGB -> Rec.709 luma / CIE Lab D65):
//   fg          subject mask = pixels whose RGB distance to the border-median background > 18 (HUD box excluded)
//   luma        p2 / p5 / p50 / p95 / p98 of the subject, spread = p95 - p5 (chiaroscuro range), 16-bin histogram
//   hiCav       edge-highlight vs cavity: mean luma of the brightest 5 % vs darkest 5 % of the subject (ratio, Weber)
//   lab         subject median Lab, chroma; region medians when boxes are given
//   pair meters dE76 between region medians; luma diff of the same view under two lights (roughness response);
//               decal diff mask (scarred vs reference): area, bbox, edge 10-90 % width, gradient-step count (banding)
//   hud         HUD box luma contrast (text vs plate, WCAG ratio), HUD pixel hash equality vs index text equality

type Img = { w: number; h: number; d: Uint8Array }; // RGBA8

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = `${ROOT}artifacts/wave-tex/verify-art`;

// ---------------------------------------------------------------- PNG decode (8-bit, non-interlaced)
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodePng(bytes: Uint8Array): Promise<Img> {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) return decodeViaSips(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, ct = 0, inter = 0;
  const idat: Uint8Array[] = [];
  let pal: Uint8Array | null = null, trns: Uint8Array | null = null;
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = body[8]; ct = body[9]; inter = body[12];
    } else if (type === "PLTE") pal = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || inter !== 0) throw new Error(`png depth ${depth} interlace ${inter} unsupported`);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
  const all = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const c of idat) { all.set(c, o); o += c.length; }
  const raw = await inflate(all);
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0, b = up ? up[x] : 0, c = up && x >= ch ? up[x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) d.set(px.subarray(i * 4, i * 4 + 4), i * 4);
    else if (ch === 3) { d[i * 4] = px[i * 3]; d[i * 4 + 1] = px[i * 3 + 1]; d[i * 4 + 2] = px[i * 3 + 2]; d[i * 4 + 3] = 255; }
    else if (ct === 3 && pal) {
      const k = px[i]; d[i * 4] = pal[k * 3]; d[i * 4 + 1] = pal[k * 3 + 1]; d[i * 4 + 2] = pal[k * 3 + 2];
      d[i * 4 + 3] = trns && k < trns.length ? trns[k] : 255;
    } else if (ch === 2) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i * 2]; d[i * 4 + 3] = px[i * 2 + 1]; }
    else { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i]; d[i * 4 + 3] = 255; }
  }
  return { w, h, d };
}

async function decodeViaSips(bytes: Uint8Array): Promise<Img> {
  const tmp = await Deno.makeTempFile({ suffix: ".img" });
  const outp = tmp + ".png";
  await Deno.writeFile(tmp, bytes);
  const r = await new Deno.Command("sips", { args: ["-s", "format", "png", tmp, "--out", outp], stdout: "null", stderr: "null" }).output();
  if (!r.success) throw new Error("sips failed");
  const img = await decodePng(await Deno.readFile(outp));
  await Deno.remove(tmp); await Deno.remove(outp);
  return img;
}

// ---------------------------------------------------------------- PNG encode (for crops / diff masks)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function encodePng(img: Img): Promise<Uint8Array> {
  const raw = new Uint8Array(img.h * (img.w * 4 + 1));
  for (let y = 0; y < img.h; y++) raw.set(img.d.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length); out.set(new TextEncoder().encode(type), 4); out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length))); return out;
  };
  const ih = new Uint8Array(13); const dv = new DataView(ih.buffer);
  dv.setUint32(0, img.w); dv.setUint32(4, img.h); ih[8] = 8; ih[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------- colour
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
export const luma = (r: number, g: number, b: number) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]; // relative luminance 0..1
const lumaByte = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b; // display value 0..255
export function lab(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export const dE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const contrast = (y1: number, y2: number) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

// ---------------------------------------------------------------- per-image meters
export type Box = [number, number, number, number]; // x y w h
const q = (s: Float64Array | number[], p: number) => s.length ? (s as number[])[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] : NaN;
const r2 = (x: number, k = 3) => Number.isFinite(x) ? Math.round(x * 10 ** k) / 10 ** k : null;

export function background(img: Img, box?: Box): [number, number, number] {
  const [x0, y0, w, h] = box ?? [0, 0, img.w, img.h];
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const take = (x: number, y: number) => { const i = (y * img.w + x) * 4; rs.push(img.d[i]); gs.push(img.d[i + 1]); bs.push(img.d[i + 2]); };
  for (let x = x0; x < x0 + w; x += 2) { take(x, y0); take(x, y0 + h - 1); }
  for (let y = y0; y < y0 + h; y += 2) { take(x0, y); take(x0 + w - 1, y); }
  const med = (a: number[]) => a.sort((p, q2) => p - q2)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

export function subjectMask(img: Img, box?: Box, exclude: Box[] = [], thr = 18): Uint8Array {
  const [x0, y0, w, h] = box ?? [0, 0, img.w, img.h];
  const bg = background(img, box);
  const m = new Uint8Array(img.w * img.h);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (exclude.some(([ex, ey, ew, eh]) => x >= ex && x < ex + ew && y >= ey && y < ey + eh)) continue;
    const i = (y * img.w + x) * 4;
    if (Math.hypot(img.d[i] - bg[0], img.d[i + 1] - bg[1], img.d[i + 2] - bg[2]) > thr) m[y * img.w + x] = 1;
  }
  return m;
}

/** The cel ink hull is one flat dark colour: the most common subject colour with luma < 60 holding > 1 % of the subject. */
export function inkColour(img: Img, mask: Uint8Array, box?: Box): [number, number, number] | null {
  const [x0, y0, w, h] = box ?? [0, 0, img.w, img.h];
  const cnt = new Map<number, number>(); let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (!mask[y * img.w + x]) continue; n++;
    const i = (y * img.w + x) * 4; if (lumaByte(img.d[i], img.d[i + 1], img.d[i + 2]) >= 60) continue;
    const k = (img.d[i] << 16) | (img.d[i + 1] << 8) | img.d[i + 2]; cnt.set(k, (cnt.get(k) ?? 0) + 1);
  }
  let best = -1, bc = 0; for (const [k, c] of cnt) if (c > bc) { best = k; bc = c; }
  return bc > n * 0.01 ? [best >> 16, (best >> 8) & 255, best & 255] : null;
}
/** Subject mask minus the ink hull (paint only): what a miniature judge looks at. */
export function paintMask(img: Img, mask: Uint8Array, ink: [number, number, number] | null): Uint8Array {
  if (!ink) return mask;
  const m = mask.slice();
  for (let k = 0; k < m.length; k++) if (m[k]) { const i = k * 4; if (Math.abs(img.d[i] - ink[0]) + Math.abs(img.d[i + 1] - ink[1]) + Math.abs(img.d[i + 2] - ink[2]) <= 6) m[k] = 0; }
  return m;
}

export function regionStats(img: Img, mask: Uint8Array | null, box?: Box) {
  const [x0, y0, w, h] = box ?? [0, 0, img.w, img.h];
  const ys: number[] = [], L: number[] = [], A: number[] = [], B: number[] = [], C: number[] = [];
  const hist = new Array(16).fill(0);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (mask && !mask[y * img.w + x]) continue;
    const i = (y * img.w + x) * 4, r = img.d[i], g = img.d[i + 1], b = img.d[i + 2];
    const v = lumaByte(r, g, b); ys.push(v); hist[Math.min(15, v >> 4)]++;
    const [l, a, bb] = lab(r, g, b); L.push(l); A.push(a); B.push(bb); C.push(Math.hypot(a, bb));
  }
  const n = ys.length;
  const s = Float64Array.from(ys).sort();
  const k = Math.max(1, Math.floor(n * 0.05));
  let lo = 0, hi = 0; for (let i = 0; i < k; i++) { lo += s[i]; hi += s[n - 1 - i]; } lo /= k; hi /= k;
  const sorted = (a: number[]) => Float64Array.from(a).sort();
  // distinct occupied value levels (posterisation meter): number of 1-unit luma bins with > 0.05 % of pixels
  const lv = new Array(256).fill(0); for (const v of ys) lv[Math.min(255, Math.round(v))]++;
  const levels = lv.filter((c) => c > n * 0.0005).length;
  return {
    n,
    luma: { p2: r2(q(s, 0.02), 1), p5: r2(q(s, 0.05), 1), p50: r2(q(s, 0.5), 1), p95: r2(q(s, 0.95), 1), p98: r2(q(s, 0.98), 1), spread: r2(q(s, 0.95) - q(s, 0.05), 1) },
    hiCav: { hi: r2(hi, 1), cav: r2(lo, 1), ratio: r2((hi + 12.75) / (lo + 12.75), 2) },
    hist: hist.map((c) => r2(c / Math.max(1, n), 3)),
    lab: [r2(q(sorted(L), 0.5), 1), r2(q(sorted(A), 0.5), 1), r2(q(sorted(B), 0.5), 1)] as number[],
    chroma: { p50: r2(q(sorted(C), 0.5), 1), p95: r2(q(sorted(C), 0.95), 1) },
    levels,
  };
}

/** HUD legibility: split the HUD box into plate (median) and ink (pixels far from the plate); WCAG ratio of medians. */
export function hudStats(img: Img, box: Box) {
  const [x0, y0, w, h] = box;
  const ys: number[] = [];
  let hash = 2166136261;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * img.w + x) * 4; ys.push(luma(img.d[i], img.d[i + 1], img.d[i + 2]));
    hash = Math.imul(hash ^ img.d[i] ^ (img.d[i + 1] << 8) ^ (img.d[i + 2] << 16), 16777619) >>> 0;
  }
  const s = Float64Array.from(ys).sort();
  const plate = q(s, 0.5);
  const ink = ys.filter((v) => Math.abs(v - plate) > 0.15);
  const inkS = Float64Array.from(ink).sort();
  const inkMed = ink.length ? q(inkS, 0.5) : plate;
  return { plate: r2(plate, 4), ink: r2(inkMed, 4), inkShare: r2(ink.length / Math.max(1, ys.length), 4), contrast: r2(contrast(plate, inkMed), 2), hash: hash.toString(16) };
}

/** Pixel diff between two same-size images inside an optional box: area share, bbox, mean |dRGB|. */
export function diffMask(a: Img, b: Img, thr = 10, box?: Box) {
  const [x0, y0, w, h] = box ?? [0, 0, a.w, a.h];
  const m = new Uint8Array(a.w * a.h);
  let n = 0, sum = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * a.w + x) * 4;
    const d = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2]));
    if (d > thr) { m[y * a.w + x] = 1; n++; sum += d; minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
  }
  return { mask: m, n, share: r2(n / (w * h), 5), meanD: r2(sum / Math.max(1, n), 1), bbox: n ? [minx, miny, maxx - minx + 1, maxy - miny + 1] as Box : null };
}

/**
 * Decal edge quality on a scarred-vs-reference pair. For every boundary pixel of the diff mask, walk the luma of
 * the MARKED image along the diff-gradient normal (±6 px): 10-90 % transition width (px, softness) and the number
 * of discrete plateaus in the walk (steps > 1.5 luma with flat runs between = banding). Also the share of boundary
 * pixels whose neighbourhood is a hard 0/1 step (aliasing: transition width <= 1 px).
 */
export function edgeQuality(marked: Img, ref: Img, mask: Uint8Array) {
  const W = marked.w, H = marked.h;
  const L = (img: Img, x: number, y: number) => { const i = (y * W + x) * 4; return lumaByte(img.d[i], img.d[i + 1], img.d[i + 2]); };
  const widths: number[] = [], plateaus: number[] = [];
  let hard = 0, total = 0;
  for (let y = 7; y < H - 7; y += 2) for (let x = 7; x < W - 7; x += 2) {
    const k = y * W + x;
    if (!mask[k]) continue;
    const nb = mask[k - 1] + mask[k + 1] + mask[k - W] + mask[k + W];
    if (nb === 4) continue; // interior
    // normal = gradient of the per-pixel difference magnitude (3x3 sobel)
    const dd = (xx: number, yy: number) => Math.abs(L(marked, xx, yy) - L(ref, xx, yy));
    const gx = dd(x + 1, y - 1) + 2 * dd(x + 1, y) + dd(x + 1, y + 1) - dd(x - 1, y - 1) - 2 * dd(x - 1, y) - dd(x - 1, y + 1);
    const gy = dd(x - 1, y + 1) + 2 * dd(x, y + 1) + dd(x + 1, y + 1) - dd(x - 1, y - 1) - 2 * dd(x, y - 1) - dd(x + 1, y - 1);
    const g = Math.hypot(gx, gy); if (g < 1e-6) continue;
    const nx = gx / g, ny = gy / g;
    const prof: number[] = [];
    for (let t = -6; t <= 6; t++) prof.push(dd(Math.round(x + nx * t), Math.round(y + ny * t)));
    const lo = Math.min(...prof), hi = Math.max(...prof), span = hi - lo;
    if (span < 6) continue;
    total++;
    // monotone-ish rise from outside (low diff) to inside (high diff)
    let i10 = -1, i90 = -1;
    for (let t = 0; t < prof.length; t++) { if (i10 < 0 && prof[t] >= lo + 0.1 * span) i10 = t; if (i90 < 0 && prof[t] >= lo + 0.9 * span) i90 = t; }
    const wpx = Math.max(0, i90 - i10);
    widths.push(wpx);
    if (wpx <= 1) hard++;
    // plateaus: count runs of near-constant values (|step| < 0.5) separated by jumps > 1.5 inside the transition
    let steps = 0;
    for (let t = Math.max(1, i10); t <= Math.max(i10, i90); t++) if (Math.abs(prof[t] - prof[t - 1]) > 1.5 && t >= 2 && Math.abs(prof[t - 1] - prof[t - 2]) < 0.5) steps++;
    plateaus.push(steps);
  }
  const s = Float64Array.from(widths).sort();
  return {
    boundarySamples: total,
    width10_90: { p25: r2(q(s, 0.25), 1), p50: r2(q(s, 0.5), 1), p75: r2(q(s, 0.75), 1) },
    hardShare: r2(hard / Math.max(1, total), 3),
    bandingShare: r2(plateaus.filter((p) => p >= 2).length / Math.max(1, total), 3),
  };
}

// ---------------------------------------------------------------- decal meters from the 'marks' channel view
/**
 * Mark mask from the `marks` debug view: neutral skin prints flat grey (209), marks print as other GREY levels;
 * hands/hair keep colour, the ink hull is (23,33,40), background (112,114,118). Components (8-connected) are the
 * individual decals. For each: inside vs a 4-px ring of the albedo / final / roughness / height tiles (medians),
 * dE76, dL*, chroma inside vs ring (ink saturation vs skin), and the edge profile on the albedo tile.
 */
export function markComponents(tiles: Record<string, Img>, minArea = 12) {
  const mk = tiles.marks, W = mk.w, H = mk.h;
  const M = new Uint8Array(W * H), okRing = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const r = mk.d[k * 4], g = mk.d[k * 4 + 1], b = mk.d[k * 4 + 2];
    const grey = Math.max(r, g, b) - Math.min(r, g, b) < 12;
    const ink = Math.abs(r - 23) + Math.abs(g - 33) + Math.abs(b - 40) < 8, bg = Math.abs(r - 112) + Math.abs(g - 114) + Math.abs(b - 118) < 8;
    // a mark tints the neutral grey (scars print in their stage colour, ink in grey levels); non-skin materials
    // (hands, hair, tusks) pass their albedo through, so a pixel equal to the albedo tile is not a mark
    const al = tiles.albedo?.d, dAl = al ? Math.abs(r - al[k * 4]) + Math.abs(g - al[k * 4 + 1]) + Math.abs(b - al[k * 4 + 2]) : 999;
    if (!ink && !bg && Math.abs(r - 209) + Math.abs(g - 209) + Math.abs(b - 209) > 18 && dAl > 24) M[k] = 1;
    if (grey && Math.abs(r - 209) <= 2) okRing[k] = 1;
  }
  const cid = new Int32Array(W * H).fill(-1); const comps: number[][] = [];
  for (let k = 0; k < W * H; k++) if (M[k] && cid[k] < 0) {
    const stack = [k], pts: number[] = []; cid[k] = comps.length;
    while (stack.length) { const c = stack.pop()!; pts.push(c); const x = c % W, y = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const n = yy * W + xx; if (M[n] && cid[n] < 0) { cid[n] = comps.length; stack.push(n); } } }
    comps.push(pts);
  }
  const med = (a: number[]) => { const s2 = Float64Array.from(a).sort(); return s2.length ? s2[s2.length >> 1] : NaN; };
  const labOf = (img: Img, pts: number[]) => { const L: number[] = [], A: number[] = [], B: number[] = [], C: number[] = []; for (const k of pts) { const [l, a, b] = lab(img.d[k * 4], img.d[k * 4 + 1], img.d[k * 4 + 2]); L.push(l); A.push(a); B.push(b); C.push(Math.hypot(a, b)); } return { lab: [med(L), med(A), med(B)], chroma: med(C) }; };
  const lumOf = (img: Img, pts: number[]) => med(pts.map((k) => lumaByte(img.d[k * 4], img.d[k * 4 + 1], img.d[k * 4 + 2])));
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  comps.forEach((pts, ci) => {
    if (pts.length < minArea) return;
    // ring: within 4 px, outside every mark, neutral in the marks view
    const ring: number[] = []; const seen = new Set<number>();
    let minx = 1e9, miny = 1e9, maxx = 0, maxy = 0;
    for (const k of pts) { const x = k % W, y = (k / W) | 0; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const n = yy * W + xx; if (!M[n] && okRing[n] && !seen.has(n)) { seen.add(n); ring.push(n); } } }
    if (ring.length < 8) return;
    const mkLab = labOf(mk, pts);
    // closing round: scars print TINTED in the marks view (stage colour), ink prints grey levels -> kind by marks-view chroma
    const row: Record<string, unknown> = { comp: ci, area: pts.length, bbox: [minx, miny, maxx - minx + 1, maxy - miny + 1], ring: ring.length, marksView: r2(lumOf(mk, pts), 1), marksLab: mkLab.lab.map((v) => r2(v, 1)), marksChroma: r2(mkLab.chroma, 1), kind: mkLab.chroma > 6 ? "scar" : "ink" };
    if (tiles.albedo) {
      const i = labOf(tiles.albedo, pts), o = labOf(tiles.albedo, ring);
      Object.assign(row, { albedoIn: i.lab.map((v) => r2(v, 1)), albedoRing: o.lab.map((v) => r2(v, 1)), dE: r2(dE(i.lab, o.lab), 1), dL: r2(i.lab[0] - o.lab[0], 1), chromaIn: r2(i.chroma, 1), chromaRing: r2(o.chroma, 1) });
      // edge: |L* - L*ring| profile across the boundary (constant ring image as reference)
      const ref: Img = { w: W, h: H, d: tiles.albedo.d.slice() };
      const rc = (() => { const k = ring[ring.length >> 1]; return [tiles.albedo.d[k * 4], tiles.albedo.d[k * 4 + 1], tiles.albedo.d[k * 4 + 2]]; })();
      const mm = new Uint8Array(W * H); for (const k of pts) mm[k] = 1;
      for (let y = Math.max(0, miny - 8); y <= Math.min(H - 1, maxy + 8); y++) for (let x = Math.max(0, minx - 8); x <= Math.min(W - 1, maxx + 8); x++) { const k = y * W + x; ref.d[k * 4] = rc[0]; ref.d[k * 4 + 1] = rc[1]; ref.d[k * 4 + 2] = rc[2]; }
      row.edge = edgeQuality(tiles.albedo, ref, mm);
    }
    if (tiles.final) { row.finalDL = r2(lumOf(tiles.final, pts) - lumOf(tiles.final, ring), 1); }
    if (tiles.roughness) { row.roughIn = r2(lumOf(tiles.roughness, pts), 1); row.roughRing = r2(lumOf(tiles.roughness, ring), 1); }
    if (tiles.height) { row.heightIn = r2(lumOf(tiles.height, pts), 1); row.heightRing = r2(lumOf(tiles.height, ring), 1); }
    if (tiles.normal) { const i = labOf(tiles.normal, pts), o = labOf(tiles.normal, ring); row.normalDE = r2(dE(i.lab, o.lab), 1); }
    // closing round: marks-view chroma alone misfiles pale mature scars as ink (ork laceration chroma 4.8). Ink is flat (packDecals
    // zeroes ink height) and keeps the skin's roughness, a scar moves height or roughness -> classify on those when present.
    // 1-2 px wide slivers are silhouette/ink-hull seams between views (marks view 50.5 grey, height sentinel 80.2), not marks.
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    const dH = row.heightIn !== undefined ? Math.abs((row.heightIn as number) - (row.heightRing as number)) : 0;
    const sDH = row.heightIn !== undefined ? (row.heightIn as number) - (row.heightRing as number) : 0;
    const neutralGrey = Math.abs(mkLab.lab[1]) < 1.5 && Math.abs(mkLab.lab[2]) < 3.5;
    if (Math.min(bw, bh) <= 2 || (dH >= 25 && ((row.normalDE as number) ?? 0) >= 25) || (sDH <= -20 && neutralGrey)) row.kind = "seam";
    else if (row.heightIn !== undefined && row.roughIn !== undefined) {
      // >= 5 height levels: ork/dwarf skin carries P's fine height detail (+-3 levels under a flat ink band)
      const relief = dH >= 5 || Math.abs((row.roughIn as number) - (row.roughRing as number)) >= 8;
      row.kind = relief ? "scar" : "ink";
    }
    out.push(row);
  });
  return { maskPx: M.reduce((a, b) => a + b, 0), components: out.sort((a, b) => b.area - a.area) };
}

// ---------------------------------------------------------------- crop helper
export function crop(img: Img, [x0, y0, w, h]: Box, scale = 1): Img {
  const W = w * scale, H = h * scale, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = Math.min(img.w - 1, x0 + Math.floor(x / scale)), sy = Math.min(img.h - 1, y0 + Math.floor(y / scale));
    d.set(img.d.subarray((sy * img.w + sx) * 4, (sy * img.w + sx) * 4 + 4), (y * W + x) * 4);
  }
  return { w: W, h: H, d };
}

// ---------------------------------------------------------------- index reading (shape-tolerant)
// deno-lint-ignore no-explicit-any
type Entry = Record<string, any>;
// deno-lint-ignore no-explicit-any
function entriesOf(index: any): Entry[] {
  const out: Entry[] = [];
  // deno-lint-ignore no-explicit-any
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const p = v.path ?? v.file ?? v.png ?? v.image;
      if (typeof p === "string" && /\.(png|jpe?g)$/i.test(p) && (v.light ?? v.lighting ?? v.view ?? v.angle) !== undefined) out.push(v);
      else Object.values(v).forEach(walk);
    }
  };
  walk(index);
  return out;
}
// deno-lint-ignore no-explicit-any
const get = (e: Entry, ...ks: string[]): any => { for (const k of ks) { const v = k.split(".").reduce((o: Entry | undefined, kk) => o?.[kk], e); if (v !== undefined) return v; } return undefined; };
// capture-wave-tex index: images[] share a sheet `path`; `render` / `hudRect` are sheet px, `regions` are render px.
const regionsOf = (e: Entry): Record<string, Box> => {
  const r = get(e, "render") as Box | undefined, raw = (get(e, "regions") ?? {}) as Record<string, number[]>;
  // capture regions are [x0, y0, x1, y1] in render px -> sheet [x, y, w, h], clamped to the render rect
  return Object.fromEntries(Object.entries(raw).map(([k, b]) => {
    if (!r) return [k, b as Box];
    const x0 = Math.max(0, b[0]), y0 = Math.max(0, b[1]), x1 = Math.min(r[2], b[2]), y1 = Math.min(r[3], b[3]);
    return [k, [r[0] + x0, r[1] + y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)] as Box];
  }));
};
const key = (e: Entry) => ({
  id: String(get(e, "id") ?? ""),
  path: get(e, "path", "file", "png", "image") as string,
  race: String(get(e, "race", "subject.race", "hud.race") ?? "?"),
  sub: String(get(e, "subrace", "subRace", "subject.subrace", "hud.subrace") ?? ""),
  sex: String(get(e, "sex", "subject.sex", "hud.sex") ?? "?"),
  variant: String(get(e, "variant", "subject.variant", "marks.variant") ?? "?"),
  light: String(get(e, "light", "lighting", "hud.light") ?? "?"),
  angle: String(get(e, "angle", "camera.angle", "view.angle") ?? "?"),
  view: String(get(e, "channel", "channelView", "view") ?? "final"),
  hud: get(e, "hudRect", "hudBox", "boxes.hud") as Box | undefined,
  subject: get(e, "render", "subjectBox", "boxes.subject") as Box | undefined,
  regions: regionsOf(e),
  hudText: get(e, "hudText", "hud.text", "hud.lines", "hud") as unknown,
});

async function measureRun(runDir: string, name: string) {
  const idxPath = `${runDir}/index.json`;
  const index = JSON.parse(await Deno.readTextFile(idxPath));
  const es = entriesOf(index).map(key);
  console.error(`${es.length} images in ${idxPath}`);
  const imgs = new Map<string, Img>();
  const load = async (p: string) => {
    if (!imgs.has(p)) {
      const abs = p.startsWith("/") ? p : (await exists(`${runDir}/${p}`)) ? `${runDir}/${p}` : `${ROOT}${p}`;
      imgs.set(p, await decodePng(await Deno.readFile(abs)));
    }
    return imgs.get(p)!;
  };
  // deno-lint-ignore no-explicit-any
  const per: any[] = [];
  for (const e of es) {
    const img = await load(e.path);
    const excl = e.hud ? [e.hud] : [];
    const m0 = subjectMask(img, e.subject, excl);
    const ink = inkColour(img, m0, e.subject);
    const m = paintMask(img, m0, ink);
    const st = regionStats(img, m, e.subject);
    const regions: Record<string, unknown> = {};
    for (const [rn, b] of Object.entries(e.regions)) regions[rn] = regionStats(img, m, b);
    per.push({ ...e, hudText: undefined, w: img.w, h: img.h, ink, inkShare: r2(1 - st.n / Math.max(1, m0.reduce((a, b) => a + b, 0)), 4), stats: st, regions, hudStats: e.hud ? hudStats(img, e.hud) : null, hudTextKey: JSON.stringify(e.hudText ?? null) });
    if (imgs.size > 24) imgs.clear();
  }
  const hudIssues: string[] = [];
  // HUD text vs index fields (OCR-free: the index records what CaptureHud drew; check it says the truth)
  for (const raw of entriesOf(index)) {
    const h = raw.hud as Record<string, string> | undefined; if (!h || typeof h !== "object") continue;
    const id = raw.id ?? raw.path, all = Object.values(h).join(" | ");
    const want: [string, unknown][] = [["race", raw.race], ["sex", raw.sex], ["light", raw.light], ["view", raw.view], ["angle", raw.camera?.angle ?? raw.angle], ["tris", raw.triangles], ["commit", String(index.commit ?? "").slice(0, 14)]];
    for (const [k, v] of want) if (v !== undefined && v !== null && !all.includes(String(v))) hudIssues.push(`${id}: HUD lacks ${k}=${v}`);
    if (raw.camera?.yawDeg !== undefined && !all.includes(`yaw ${Number(raw.camera.yawDeg).toFixed(1)}`)) hudIssues.push(`${id}: HUD yaw != ${raw.camera.yawDeg}`);
    const nMarks = Array.isArray(raw.marks) ? raw.marks.length : undefined;
    const subj = (index.subjects ?? []).find((s: Entry) => s.id === raw.subject);
    const mk = subj?.marks?.length ?? nMarks;
    const rq = /marks\((\d+) req, (\d+) (?:drawn|decals)/.exec(h.marks ?? "");
    if (rq && subj && (Number(rq[1]) !== (subj.marksRequested ?? mk) || Number(rq[2]) !== (subj.decalsPacked ?? subj.decalsDrawn ?? -1))) hudIssues.push(`${id}: HUD '${rq[0]}' vs index req ${subj.marksRequested} drawn ${subj.decalsDrawn}`);
    else if (!rq && mk !== undefined && h.marks && !h.marks.includes(`marks(${mk})`)) hudIssues.push(`${id}: HUD marks '${h.marks.slice(0, 40)}' vs index ${mk}`);
    if (subj?.layers && h.layers && Number(/layers\((\d+)/.exec(h.layers)?.[1]) !== subj.layers.length) hudIssues.push(`${id}: HUD layers count vs index ${subj.layers.length}`);
  }
  // HUD consistency: identical HUD pixels must mean identical HUD text and vice versa
  const byHash = new Map<string, Set<string>>();
  for (const p of per) if (p.hudStats) { const s = byHash.get(p.hudStats.hash) ?? new Set(); s.add(p.hudTextKey); byHash.set(p.hudStats.hash, s); }
  for (const [h, s] of byHash) if (s.size > 1) hudIssues.push(`hud pixels ${h} shared by ${s.size} different HUD texts`);
  // pairs: light response per (race,sex,variant,angle,view)
  const group = (f: (p: Entry) => string) => { const g = new Map<string, Entry[]>(); for (const p of per) { const k = f(p); g.set(k, [...(g.get(k) ?? []), p]); } return g; };
  const lights = [...group((p) => `${p.race}|${p.sub}|${p.sex}|${p.variant}|${p.angle}|${p.view}`).entries()].map(([k, ps]) => ({
    k, byLight: Object.fromEntries(ps.map((p) => [p.light, { p50: p.stats.luma.p50, spread: p.stats.luma.spread, hiCav: p.stats.hiCav.ratio, levels: p.stats.levels }])),
  }));
  // marks: scarred vs reference, same everything else
  const marks = [];
  const g2 = group((p) => `${p.race}|${p.sub}|${p.sex}|${p.light}|${p.angle}|${p.view}`);
  for (const [k, ps] of g2) {
    const ref = ps.find((p) => /ref/i.test(p.variant)), mk = ps.find((p) => !/ref/i.test(p.variant));
    if (!ref || !mk) continue;
    const A = await load(mk.path), B = await load(ref.path);
    if (A.w !== B.w || A.h !== B.h) continue;
    const box = mk.subject as Box | undefined;
    const dm = diffMask(A, B, 10, box);
    const eq = dm.n > 20 ? edgeQuality(A, B, dm.mask) : null;
    // ink saturation vs skin: chroma inside the diff vs the ring just outside it
    let inkC = null;
    if (dm.n > 20) { const s1 = regionStats(A, dm.mask); inkC = { inside: s1.chroma.p50, insideL: s1.lab[0] }; }
    marks.push({ k, marked: mk.path, ref: ref.path, diff: { share: dm.share, meanD: dm.meanD, bbox: dm.bbox }, edge: eq, ink: inkC });
  }
  // race separation: subject median Lab, reference/final/flat-or-studio front
  const races = per.filter((p) => /ref/i.test(p.variant) && p.view === "final" && p.angle === "front" && /angles/.test(p.id));
  const raceDE = [];
  for (let i = 0; i < races.length; i++) for (let j = i + 1; j < races.length; j++) {
    const a = races[i], b = races[j];
    if (a.light !== b.light || a.sex !== b.sex || a.race === b.race) continue;
    raceDE.push({ light: a.light, sex: a.sex, a: a.race + (a.sub ? "/" + a.sub : ""), b: b.race + (b.sub ? "/" + b.sub : ""), dE: r2(dE(a.stats.lab, b.stats.lab), 1) });
  }
  const out = { run: runDir, measuredAt: new Date().toISOString(), images: per.length, hudIssues, per, lights, marks, raceDE };
  await Deno.mkdir(`${OUT}/${name}`, { recursive: true });
  await Deno.writeTextFile(`${OUT}/${name}/metrics.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ images: per.length, hudIssues: hudIssues.length, lightGroups: lights.length, markPairs: marks.length, raceDE: raceDE.length, out: `${OUT}/${name}/metrics.json` }));
}

async function exists(p: string) { try { await Deno.stat(p); return true; } catch { return false; } }

// ---------------------------------------------------------------- verdicts + doc
const VERDICTS = `${OUT}/verdicts.json`;
async function readVerdicts(): Promise<Entry[]> { try { return JSON.parse(await Deno.readTextFile(VERDICTS)); } catch { return []; } }
async function writeDoc() {
  const vs = await readVerdicts();
  const L: string[] = [
    "# Wave TEX — art verification (lane QA)", "",
    "Generated by `deno run -A tools/verify-wave-tex-art.ts doc` from `artifacts/wave-tex/verify-art/verdicts.json`. Do not edit by hand.", "",
    "Method: every verdict pairs a vision judgement (marked *judgement*) with a pixel measurement from `tools/verify-wave-tex-art.ts` on the",
    "decoded PNG at full resolution (luma = Rec.709 on sRGB bytes 0..255 unless noted; Lab D65; dE76), and where the image model is asked a",
    "question the same question is asked of a control (reference / HEAD baseline) sheet. Only findings backed by a number count.", "",
    "| # | READY | board | verdict | sheet | region | measurement | note |", "|---|---|---|---|---|---|---|---|",
  ];
  vs.forEach((v, i) => L.push(`| ${i + 1} | ${v.ready ?? ""} | ${v.board ?? ""} | **${v.verdict}** | \`${v.sheet ?? ""}\` | ${v.region ?? ""} | ${String(v.measure ?? "").replace(/\|/g, "/")} | ${String(v.note ?? "").replace(/\|/g, "/")} |`));
  // `closes`: a board id or a list of them; a later entry naming a FAIL/WARN's board closes it.
  const closed = (v: Entry) => vs.some((w) => w !== v && [w.closes ?? []].flat().includes(v.board));
  const open = vs.filter((v) => v.verdict === "FAIL" && !closed(v));
  L.push("", `## Open FAILs (${open.length})`, "");
  for (const v of open) L.push(`- ${v.board ?? "?"} ${v.ready ?? ""}: ${v.sheet} — ${v.note}`);
  const warns = vs.filter((v) => v.verdict === "WARN" && !closed(v));
  L.push("", `## Open WARNs (${warns.length})`, "");
  for (const v of warns) L.push(`- ${v.board ?? "?"} ${v.ready ?? ""}: ${v.region} — ${v.measure} (${v.note})`);
  L.push("", "## Tool commands", "", "- `measure <runDir>` per-tile meters + HUD truth vs index.json -> `artifacts/wave-tex/verify-art/<run>/metrics.json`; `summary <run>` prints them",
    "- `cmp <runA> <runB> [--variant a:b]` render-rect diffs matched by image id; `marks <runDir> [variant]` decal components from the marks view",
    "- `warns <run> [<run2> ...]` closing round: WARN-1..4 re-measure (albedo hi-5 %/ridge, grey AO share, scar height vs normal dE, laceration height) + skin/garment dE + stud std per subject -> `warns-<runs>.json`",
    "- `image|crop|diff` single-image helpers; `verdict '<json>'` appends + regenerates this file",
    "", "## Pending", "");
  // the latest entry carrying a `pending` list owns this section (older text kept as the fallback)
  const pend = [...vs].reverse().find((v) => Array.isArray(v.pending));
  if (pend) for (const p of pend.pending) L.push(`- ${p}`);
  else L.push("- F's READY (closing fixer) not posted when QA stopped (2026-11-05 05:44 UTC, board Z-129). Re-measure: `deno run -A tools/verify-wave-tex-art.ts warns artifacts/wave-tex/captures/r07q-before-F artifacts/wave-tex/captures/r07q-closing`; baseline in board Z-127.");
  await Deno.writeTextFile(`${ROOT}docs/wave-tex/VERIFY-ART.md`, L.join("\n") + "\n");
  console.log(`VERIFY-ART.md: ${vs.length} verdicts, ${open.length} open FAIL`);
}

// ---------------------------------------------------------------- CLI
if (import.meta.main) {
  const [cmd, ...a] = Deno.args;
  if (cmd === "measure") {
    const name = a.includes("--out") ? a[a.indexOf("--out") + 1] : a[0].split("/").filter(Boolean).pop()!;
    await measureRun(a[0], name);
  } else if (cmd === "image") {
    const img = await decodePng(await Deno.readFile(a[0]));
    const box = a.length >= 5 ? a.slice(1, 5).map(Number) as Box : undefined;
    const m = subjectMask(img, box);
    console.log(JSON.stringify({ w: img.w, h: img.h, bg: background(img, box), subject: regionStats(img, m, box), all: regionStats(img, null, box) }));
  } else if (cmd === "crop") {
    const img = await decodePng(await Deno.readFile(a[0]));
    const c = crop(img, a.slice(1, 5).map(Number) as Box, Number(a[6] ?? 1));
    await Deno.writeFile(a[5], await encodePng(c));
    console.log(a[5]);
  } else if (cmd === "diff") {
    const A = await decodePng(await Deno.readFile(a[0])), B = await decodePng(await Deno.readFile(a[1]));
    const box = a.length >= 6 ? a.slice(2, 6).map(Number) as Box : undefined;
    const dm = diffMask(A, B, 10, box);
    console.log(JSON.stringify({ share: dm.share, n: dm.n, meanD: dm.meanD, bbox: dm.bbox, edge: dm.n > 20 ? edgeQuality(A, B, dm.mask) : null }));
  } else if (cmd === "cmp") {
    // cmp <runA> <runB> [--variant marked:reference] : tile-wise RENDER-rect diff matched by image id
    const [ra, rb] = a; const vi = a.indexOf("--variant"); const [va, vb] = vi >= 0 ? a[vi + 1].split(":") : ["", ""];
    const ia = JSON.parse(await Deno.readTextFile(`${ra}/index.json`)), ib = JSON.parse(await Deno.readTextFile(`${rb}/index.json`));
    const mapB = new Map<string, Entry>(entriesOf(ib).map((e) => [String(e.id), e]));
    const cache = new Map<string, Img>();
    const ld = async (p: string) => { if (!cache.has(p)) cache.set(p, await decodePng(await Deno.readFile(p.startsWith("/") ? p : `${ROOT}${p}`))); return cache.get(p)!; };
    // deno-lint-ignore no-explicit-any
    const rows: any[] = [];
    for (const e of entriesOf(ia)) {
      if (va && !String(e.id).includes(`-${va}/`)) continue;
      const idB = va ? String(e.id).replace(`-${va}/`, `-${vb}/`) : String(e.id);
      const f = mapB.get(idB); if (!f) continue;
      const A = await ld(e.path), B = await ld(f.path);
      const [ax, ay, w, h] = e.render as Box, [bx, by] = f.render as Box;
      const ca = crop(A, [ax, ay, w, h]), cb = crop(B, [bx, by, w, h]);
      const dm = diffMask(ca, cb, 10);
      rows.push({ id: e.id, share: dm.share, meanD: dm.meanD, bbox: dm.bbox, edge: dm.n > 20 ? edgeQuality(ca, cb, dm.mask) : null });
    }
    const name = `cmp-${ra.split("/").filter(Boolean).pop()}-vs-${rb.split("/").filter(Boolean).pop()}${va ? `-${va}` : ""}`;
    await Deno.mkdir(OUT, { recursive: true }); await Deno.writeTextFile(`${OUT}/${name}.json`, JSON.stringify(rows, null, 1));
    const changed = rows.filter((r) => r.share > 0);
    console.log(`${name}: ${rows.length} tiles, changed ${changed.length}, max share ${Math.max(0, ...rows.map((r) => r.share))}`);
    for (const r of changed.slice(0, Number(Deno.env.get("N") ?? 40))) console.log(`  ${r.id} share ${r.share} meanD ${r.meanD} bbox ${r.bbox} ${r.edge ? `edge w50 ${r.edge.width10_90.p50} hard ${r.edge.hardShare} band ${r.edge.bandingShare}` : ""}`);
  } else if (cmd === "marks") {
    // marks <runDir> [variantFilter] : per channels-sheet angle row, decal components measured from the marks view
    const idx = JSON.parse(await Deno.readTextFile(`${a[0]}/index.json`)); const vf = a[1] ?? "";
    const rows = new Map<string, Record<string, Entry>>();
    for (const e of entriesOf(idx)) { if (!/\/channels\//.test(e.id) || (vf && !String(e.id).includes(vf))) continue; const k = String(e.id).replace(/\/[^/]+$/, ""); const r = rows.get(k) ?? {}; r[e.view] = e; rows.set(k, r); }
    const cache = new Map<string, Img>(); const ld = async (p: string) => { if (!cache.has(p)) cache.set(p, await decodePng(await Deno.readFile(p.startsWith("/") ? p : `${ROOT}${p}`))); return cache.get(p)!; };
    const res: Record<string, unknown> = {};
    for (const [k, r] of rows) {
      if (!r.marks) continue;
      const tiles: Record<string, Img> = {};
      for (const v of ["marks", "albedo", "final", "roughness", "height", "normal"]) if (r[v]) tiles[v] = crop(await ld(r[v].path), r[v].render as Box);
      const mc = markComponents(tiles);
      res[k] = mc;
      console.log(`${k}: mask ${mc.maskPx} px, ${mc.components.length} comps`);
      // deno-lint-ignore no-explicit-any
      for (const c of mc.components.slice(0, 6) as any[]) console.log(`   area ${c.area} bbox ${c.bbox} marksV ${c.marksView} albedo in ${c.albedoIn} ring ${c.albedoRing} dE ${c.dE} dL ${c.dL} C ${c.chromaIn}/${c.chromaRing} finalDL ${c.finalDL} rough ${c.roughIn}/${c.roughRing} height ${c.heightIn}/${c.heightRing} nDE ${c.normalDE} edge w50 ${c.edge?.width10_90.p50} hard ${c.edge?.hardShare} band ${c.edge?.bandingShare} n ${c.edge?.boundarySamples}`);
    }
    const name = `marks-${a[0].split("/").filter(Boolean).pop()}${vf ? "-" + vf.replace(/[^a-z-]/gi, "") : ""}`;
    await Deno.mkdir(OUT, { recursive: true }); await Deno.writeTextFile(`${OUT}/${name}.json`, JSON.stringify(res, null, 1));
  } else if (cmd === "warns") {
    // warns <runDir> [<runDir2> ...] : closing-round re-measure of QA WARN-1..4 + P's preset reads, one row per subject x run.
    //   W1 edge highlight: albedo view 3q, paint px in C's face box (skin) + whole subject: mean of brightest 5 %, p50, ratio hi5/p50;
    //      final view p95. W2 ao: ao view on 3q/forearm/back-closeup: p5, p50, share of paint px < 250 and < 230.
    //   W3/W4 scar relief + mature height: marked-bare channel rows, components kind=scar (tinted in the marks view):
    //      height in-ring (levels; view = 128 + h/8mm*255 per CAPTURE.md), normal dE inside vs ring, albedo dE/dL.
    //   P: skin vs garment dE76 (albedo 3q face box vs back box, reference), studs = back-closeup centre box luma std (final, albedo, height).
    const runs = a.filter((x) => !x.startsWith("--"));
    const out: Record<string, unknown> = {};
    const sd = (img: Img, m: Uint8Array | null, [x0, y0, w, h]: Box) => { let s = 0, s2 = 0, n = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (m && !m[y * img.w + x]) continue; const i = (y * img.w + x) * 4; const v = lumaByte(img.d[i], img.d[i + 1], img.d[i + 2]); s += v; s2 += v * v; n++; } return n ? r2(Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), 2) : null; };
    for (const run of runs) {
      const idx = JSON.parse(await Deno.readTextFile(`${run}/index.json`));
      const es = entriesOf(idx);
      const by = new Map<string, Entry>(es.map((e) => [String(e.id), e]));
      const cache = new Map<string, Img>(); const ld = async (p: string) => { if (!cache.has(p)) { if (cache.size > 6) cache.clear(); cache.set(p, await decodePng(await Deno.readFile(p.startsWith("/") ? p : `${ROOT}${p}`))); } return cache.get(p)!; };
      const tile = async (id: string) => { const e = by.get(id); if (!e) return null; const im = crop(await ld(e.path), e.render as Box); return { e, im, regions: Object.fromEntries(Object.entries((e.regions ?? {}) as Record<string, number[]>).map(([k, b]) => [k, [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(im.w, b[2]) - Math.max(0, b[0]), Math.min(im.h, b[3]) - Math.max(0, b[1])] as Box])) }; };
      const paint = (im: Img) => { const m0 = subjectMask(im); return paintMask(im, m0, inkColour(im, m0)); };
      const subjects = (idx.subjects ?? []).map((s: Entry) => s.id as string);
      const rows: Record<string, unknown> = {};
      for (const sid of subjects.filter((s: string) => s.endsWith("-reference"))) {
        const base = sid.replace(/-reference$/, "");
        const r: Record<string, unknown> = {};
        const alb = await tile(`${sid}/channels/front-left-3q/studio/albedo`), fin = await tile(`${sid}/channels/front-left-3q/studio/final`);
        if (alb) {
          const m = paint(alb.im), all = regionStats(alb.im, m), face = alb.regions.face ? regionStats(alb.im, m, alb.regions.face) : null, back = alb.regions.back ? regionStats(alb.im, m, alb.regions.back) : null;
          r.W1 = { albedoHi5: all.hiCav.hi, albedoP50: all.luma.p50, ridge: r2((all.hiCav.hi ?? 0) / Math.max(1, all.luma.p50 ?? 1), 3), faceHi5: face?.hiCav.hi, faceP50: face?.luma.p50, faceRidge: face ? r2((face.hiCav.hi ?? 0) / Math.max(1, face.luma.p50 ?? 1), 3) : null, finalP95: fin ? regionStats(fin.im, paint(fin.im)).luma.p95 : null };
          if (face && back) r.P = { skinGarmentDE: r2(dE(face.lab, back.lab), 1), skinMinusGarmentL: r2(face.lab[0] - back.lab[0], 1) };
        }
        const ao: Record<string, unknown> = {};
        for (const ang of ["front-left-3q", "forearm", "back-closeup", "face"]) {
          const t = await tile(`${sid}/channels/${ang}/studio/ao`); if (!t) continue;
          const m = paint(t.im); let n = 0, lt250 = 0, lt230 = 0; const vs: number[] = [];
          for (let k = 0; k < m.length; k++) if (m[k]) { const d0 = t.im.d; if (Math.max(d0[k * 4], d0[k * 4 + 1], d0[k * 4 + 2]) - Math.min(d0[k * 4], d0[k * 4 + 1], d0[k * 4 + 2]) > 6) continue; // ao is grey: skip hands/hair/face parts (not channel materials, they pass colour through)
            const v = lumaByte(t.im.d[k * 4], t.im.d[k * 4 + 1], t.im.d[k * 4 + 2]); vs.push(v); n++; if (v < 250) lt250++; if (v < 230) lt230++; }
          const s = Float64Array.from(vs).sort();
          ao[ang] = { p5: r2(q(s, 0.05), 1), p50: r2(q(s, 0.5), 1), lt250: r2(lt250 / Math.max(1, n), 4), lt230: r2(lt230 / Math.max(1, n), 4) };
        }
        r.W2 = ao;
        const studs: Record<string, unknown> = {};
        for (const v of ["final", "albedo", "height"]) { const t = await tile(`${sid}/channels/back-closeup/studio/${v}`); if (!t) continue; const cb: Box = [150, 200, 120, 160]; studs[v] = sd(t.im, paint(t.im), cb); }
        r.studsStd = studs;
        // marks on the bare subject
        const scars: unknown[] = [];
        for (const ang of ["forearm", "back-closeup", "face"]) {
          const tiles: Record<string, Img> = {};
          for (const v of ["marks", "albedo", "final", "roughness", "height", "normal"]) { const t = await tile(`${base}-marked-bare/channels/${ang}/studio/${v}`); if (t) tiles[v] = t.im; }
          if (!tiles.marks) continue;
          // deno-lint-ignore no-explicit-any
          const mc = markComponents(tiles, 20).components as any[];
          for (const c of mc.filter((c) => c.kind === "scar").slice(0, 4)) scars.push({ row: ang, area: c.area, bbox: c.bbox, marksLab: c.marksLab, dE: c.dE, dL: c.dL, dHeight: r2(c.heightIn - c.heightRing, 1), heightIn: c.heightIn, normalDE: c.normalDE, rough: [c.roughIn, c.roughRing] });
          r[`ink-${ang}`] = mc.filter((c) => c.kind === "ink").slice(0, 2).map((c) => ({ area: c.area, dE: c.dE, dL: c.dL, edgeW50: c.edge?.width10_90.p50, banding: c.edge?.bandingShare, normalDE: c.normalDE }));
        }
        r.scars = scars;
        rows[base] = r;
      }
      out[run.split("/").filter(Boolean).pop()!] = rows;
    }
    const name = `warns-${runs.map((r) => r.split("/").filter(Boolean).pop()).join("-vs-")}`;
    await Deno.mkdir(OUT, { recursive: true }); await Deno.writeTextFile(`${OUT}/${name}.json`, JSON.stringify(out, null, 1));
    console.log(`${OUT}/${name}.json`);
    // deno-lint-ignore no-explicit-any
    for (const [run, rows] of Object.entries(out) as [string, Record<string, any>][]) for (const [s, r] of Object.entries(rows)) {
      console.log(`${run} ${s}: W1 hi5 ${r.W1?.albedoHi5} p50 ${r.W1?.albedoP50} ridge ${r.W1?.ridge} face hi5 ${r.W1?.faceHi5} ridge ${r.W1?.faceRidge} finalP95 ${r.W1?.finalP95} | P skin-garment dE ${r.P?.skinGarmentDE} dL ${r.P?.skinMinusGarmentL} | studs std ${JSON.stringify(r.studsStd)}`);
      // deno-lint-ignore no-explicit-any
      console.log(`   W2 ao ${Object.entries(r.W2).map(([k, v]: [string, any]) => `${k} p5 ${v.p5} p50 ${v.p50} <250 ${v.lt250} <230 ${v.lt230}`).join(" ; ")}`);
      // deno-lint-ignore no-explicit-any
      for (const c of r.scars as any[]) console.log(`   scar ${c.row} area ${c.area} bbox ${c.bbox} marksLab ${c.marksLab} dE ${c.dE} dL ${c.dL} dHeight ${c.dHeight} (in ${c.heightIn}) nDE ${c.normalDE} rough ${c.rough}`);
      for (const k of ["ink-forearm", "ink-back-closeup", "ink-face"]) if (r[k]?.length) console.log(`   ${k} ${JSON.stringify(r[k])}`);
    }
  } else if (cmd === "verdict") {
    const vs = await readVerdicts(); vs.push({ at: new Date().toISOString(), ...JSON.parse(a[0]) });
    await Deno.mkdir(OUT, { recursive: true }); await Deno.writeTextFile(VERDICTS, JSON.stringify(vs, null, 1));
    await writeDoc();
  } else if (cmd === "doc") await writeDoc();
  else if (cmd === "summary") {
    const m = JSON.parse(await Deno.readTextFile(`${OUT}/${a[0]}/metrics.json`));
    const f = (x: number | null) => x === null ? "-" : String(x);
    console.log(`run ${m.run}: ${m.images} images, HUD issues ${m.hudIssues.length}`); for (const h of [...new Set(m.hudIssues.map((x: string) => x.replace(/^[^:]*: /, "")))].slice(0, 8)) console.log("  hud:", h);
    // deno-lint-ignore no-explicit-any
    const hc = m.per.filter((p: any) => p.hudStats).map((p: any) => p.hudStats.contrast); if (hc.length) console.log(`  HUD contrast min ${Math.min(...hc)} max ${Math.max(...hc)}`);
    console.log("tile | paint p5/p50/p95 spread | hi/cav ratio | chroma p50 | levels | face L,a,b | forearm p50 spread");
    // deno-lint-ignore no-explicit-any
    for (const p of m.per.filter((p: any) => a.includes("--all") || p.angle === "front" || p.light !== "studio" || /face|forearm/.test(p.angle))) {
      const s = p.stats, fa = p.regions.face?.lab, fo = p.regions.forearm?.luma;
      console.log(`${p.id} | ${f(s.luma.p5)}/${f(s.luma.p50)}/${f(s.luma.p95)} ${f(s.luma.spread)} | ${f(s.hiCav.ratio)} | ${f(s.chroma.p50)} | ${s.levels} | ${fa ? fa.join(",") : "-"} | ${fo ? fo.p50 + " " + fo.spread : "-"}`);
    }
    for (const r of m.raceDE) console.log(`dE ${r.sex} ${r.a} vs ${r.b}: ${r.dE}`);
    for (const k of m.marks) console.log(`marks ${k.k}: diff ${k.diff.share} meanD ${k.diff.meanD} bbox ${k.diff.bbox} edge ${JSON.stringify(k.edge)} ink ${JSON.stringify(k.ink)}`);
  } else console.log("usage: measure <runDir> | image <png> [x y w h] | crop <png> x y w h out [scale] | diff a b [x y w h] | verdict '<json>' | doc");
}
