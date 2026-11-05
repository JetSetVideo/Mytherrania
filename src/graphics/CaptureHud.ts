// Wave TEX lane C: the capture HUD — the burned-in "software information" block of every capture image, plus the
// pure helpers of the capture tool (camera orbit maths, run-to-run pixel diff regions, contact-sheet grid).
//
// PURE: no THREE.js, no DOM. The capture page (tools/capture-wave-tex.ts generates and bundles it) draws the layout
// returned here into a 2D canvas BELOW the rendered tile, so the subject is never covered and a pixel meter on the
// render region reads the render only. Nothing here is game UI: the game never imports this module.
//
// Layout model: a fixed-width monospace block. Text width is estimated as `chars x charW` with
// charW = HUD_CHAR_W_PER_PX x fontPx (the canvas uses a monospace font, so the estimate is the font's advance).
// Every line is clipped to the band width (ellipsis), long lists wrap to at most `maxListLines` lines and end with
// "+N more", so a stack of 40 layers can never push the block past the image.

/** Order of the HUD's fields (pinned: verifiers parse the burned-in block and index.json by these keys). */
export const HUD_FIELDS = [
  "run", "commit", "build", "subject", "variant", "layers", "marks", "channel", "light", "camera", "triangles", "timing",
] as const;
export type HudField = typeof HUD_FIELDS[number];

/** Monospace advance per font pixel (Menlo/Courier-like fonts: ~0.6). */
export const HUD_CHAR_W_PER_PX = 0.6;
/** Line height per font pixel. */
export const HUD_LINE_H_PER_PX = 1.3;
export const HUD_DEFAULT_FONT_PX = 11;
export const HUD_PAD_PX = 6;

export interface HudLayer {
  name: string;
  /** Operators, e.g. "albedo:multiply roughness:replace" or a v1 blend mode. */
  ops: string;
  opacity?: number;
  enabled?: boolean;
}
export interface HudMark { kind: string; detail?: string }
export interface HudCamera {
  angle: string;
  yawDeg: number;
  pitchDeg: number;
  distanceM: number;
  fovDeg: number;
}
/** Everything the HUD shows for one image. Optional values print as "-". */
export interface CaptureInfo {
  run: string;
  commit: string;
  dirty?: boolean;
  /** ISO time of the bundle build. */
  buildTime: string;
  race: string;
  subrace?: string | null;
  sex: string;
  className: string;
  variant: string;
  layers: readonly HudLayer[];
  /** Where the layer list came from (e.g. "rig.material.stack", "v1 recipe"): printed in the layers prefix. */
  layerSource?: string;
  marks: readonly HudMark[];
  /** Decals the renderer packed for this rig (R's rig.material.packed.count); printed beside the requested count. */
  marksDecals?: number;
  /** Requested marks under the outfit (hidden by the renderer's skin mask, M's validateMarks `covered`). */
  marksCovered?: number;
  channel: string;
  light: string;
  lightDetail?: string;
  camera: HudCamera;
  triangles: number;
  buildMs: number;
  frameMs: number;
}

export interface HudLine { field: HudField; text: string; x: number; y: number; colour: string }
export interface HudLayout {
  /** Band size in pixels (drawn below the render tile). */
  width: number;
  height: number;
  fontPx: number;
  lineH: number;
  maxChars: number;
  background: string;
  lines: HudLine[];
}

export const HUD_COLOURS = { background: "#101216", text: "#e8e2d2", key: "#ffd27a", dim: "#9aa3ad", warn: "#ff8a6a" } as const;

/** Round to `d` decimals and print without a trailing "-0". */
export function fmt(n: number, d = 1): string {
  if (!Number.isFinite(n)) return "-";
  const s = n.toFixed(d);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** Clip a line to `max` characters with a trailing ellipsis character. */
export function clipText(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return max === 1 ? "…" : text.slice(0, max - 1) + "…";
}

/**
 * Wrap a list of items after a prefix: items joined by "; ", never split inside an item unless one item alone is
 * longer than a line (then clipped). At most `maxLines` lines; when items are left over, whole items are dropped from
 * the last line until " +N more" fits (N = every item not printed in full, so shown + N = items.length).
 * Empty list -> `${prefix}none`. Every line is at most `maxChars` long.
 */
export function wrapList(prefix: string, items: readonly string[], maxChars: number, maxLines: number): string[] {
  if (items.length === 0) return [clipText(prefix + "none", maxChars)];
  const lead = (k: number) => k === 0 ? prefix : "  "; // continuation lines: a 2-space hanging indent
  const text = (k: number, its: string[]) => lead(k) + its.join("; ");
  const rows: string[][] = [];
  let row: string[] = [];
  for (const it of items) {
    if (row.length && text(rows.length, [...row, it]).length > maxChars) { rows.push(row); row = []; }
    row.push(it);
  }
  if (row.length) rows.push(row);
  const kept = rows.slice(0, Math.max(1, maxLines));
  // An item alone wider than its line is clipped: it no longer counts as shown.
  const whole = (k: number, its: string[]) => its.length - (text(k, its).length > maxChars ? 1 : 0);
  let shown = kept.reduce((a, r, k) => a + whole(k, r), 0);
  if (shown < items.length) {
    const k = kept.length - 1;
    const last = kept[k];
    const fits = () => text(k, last).length + ` +${items.length - shown} more`.length <= maxChars;
    while (last.length && !fits()) { const n = whole(k, last); last.pop(); shown -= n - whole(k, last); }
    const tag = ` +${items.length - shown} more`;
    return kept.map((r, j) => j === k ? clipText(text(j, r) + tag, maxChars) : clipText(text(j, r), maxChars));
  }
  return kept.map((r, j) => clipText(text(j, r), maxChars));
}

/** The HUD's text, one or more lines per field, in HUD_FIELDS order (no geometry). */
export function hudText(info: CaptureInfo, maxChars = 80, maxListLines = 3): { field: HudField; text: string }[] {
  const out: { field: HudField; text: string }[] = [];
  const push = (field: HudField, text: string) => out.push({ field, text: clipText(text, maxChars) });
  const c = info.camera;
  push("run", `run ${info.run}`);
  // "<sha>+<src hash>": the sha is cut to 10 chars, the uncommitted-tree hash is kept whole (two dirty trees differ).
  const [sha, ...extra] = info.commit.split("+");
  push("commit", `commit ${sha.slice(0, 10)}${extra.length ? "+" + extra.join("+") : ""}${info.dirty ? " dirty" : ""}`);
  push("build", `build ${info.buildTime}`);
  push("subject", `${info.race}${info.subrace ? "/" + info.subrace : ""} ${info.sex} ${info.className}`);
  push("variant", `variant ${info.variant}`);
  const layers = info.layers.map((l) => `${l.enabled === false ? "(off) " : ""}${l.name} ${l.ops}${l.opacity !== undefined && l.opacity !== 1 ? " @" + fmt(l.opacity, 2) : ""}`);
  for (const t of wrapList(`layers(${info.layers.length}${info.layerSource ? " " + info.layerSource : ""}) `, layers, maxChars, maxListLines)) out.push({ field: "layers", text: t });
  const marks = info.marks.map((m) => m.detail ? `${m.kind} ${m.detail}` : m.kind);
  for (const t of wrapList(`marks(${info.marks.length}${info.marksDecals !== undefined ? ` req, ${info.marksDecals} decals` : ""}${info.marksCovered ? `, ${info.marksCovered} under garment` : ""}) `, marks, maxChars, maxListLines)) out.push({ field: "marks", text: t });
  push("channel", `view ${info.channel}`);
  push("light", `light ${info.light}${info.lightDetail ? " " + info.lightDetail : ""}`);
  push("camera", `cam ${c.angle} yaw ${fmt(c.yawDeg)} pitch ${fmt(c.pitchDeg)} dist ${fmt(c.distanceM, 2)}m fov ${fmt(c.fovDeg)}`);
  push("triangles", `tris ${Math.round(info.triangles)}`);
  push("timing", `build ${fmt(info.buildMs)}ms frame ${fmt(info.frameMs, 2)}ms`);
  return out;
}

/**
 * Lay the HUD out as a band of width `width` (the tile width). Lines are left-aligned at HUD_PAD_PX; `y` is the
 * text BASELINE of each line (canvas fillText). Field "run"/"commit"/"build" print dim, "subject" in the key
 * colour, the rest in text colour; a "+dirty" commit prints in the warn colour.
 */
export function layoutHud(info: CaptureInfo, width: number, fontPx = HUD_DEFAULT_FONT_PX, maxListLines = 3): HudLayout {
  const f = Math.max(6, fontPx);
  const lineH = Math.ceil(f * HUD_LINE_H_PER_PX);
  const maxChars = Math.max(8, Math.floor((width - 2 * HUD_PAD_PX) / (f * HUD_CHAR_W_PER_PX)));
  const text = hudText(info, maxChars, maxListLines);
  const lines: HudLine[] = text.map((t, i) => ({
    field: t.field,
    text: t.text,
    x: HUD_PAD_PX,
    y: HUD_PAD_PX + (i + 1) * lineH - Math.round((lineH - f) / 2) - 1,
    colour: t.field === "commit" && info.dirty ? HUD_COLOURS.warn
      : t.field === "run" || t.field === "commit" || t.field === "build" ? HUD_COLOURS.dim
      : t.field === "subject" ? HUD_COLOURS.key : HUD_COLOURS.text,
  }));
  return { width, height: 2 * HUD_PAD_PX + text.length * lineH, fontPx: f, lineH, maxChars, background: HUD_COLOURS.background, lines };
}

/** Upper bound of the band height for any info (so every tile of a sheet can share one height). */
export function hudMaxHeight(fontPx = HUD_DEFAULT_FONT_PX, maxListLines = 3): number {
  const f = Math.max(6, fontPx);
  const fixed = HUD_FIELDS.length - 2; // every field but layers + marks is one line
  return 2 * HUD_PAD_PX + (fixed + 2 * maxListLines) * Math.ceil(f * HUD_LINE_H_PER_PX);
}

// ─── camera orbit ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * A named view as yaw/pitch about the subject. Yaw 0 = camera on +Z looking at the subject's front (the rig faces
 * +Z); yaw +90 = camera on +X (the body's LEFT side). Pitch +90 = straight down.
 */
export interface OrbitView { id: string; yawDeg: number; pitchDeg: number; closeUp?: "face" | "forearm" | "back" }

export const CAPTURE_ANGLES: readonly OrbitView[] = [
  { id: "front", yawDeg: 0, pitchDeg: 4 },
  { id: "back", yawDeg: 180, pitchDeg: 4 },
  { id: "left", yawDeg: 90, pitchDeg: 4 },
  { id: "right", yawDeg: -90, pitchDeg: 4 },
  { id: "front-left-3q", yawDeg: 45, pitchDeg: 8 },
  { id: "back-right-3q", yawDeg: -135, pitchDeg: 8 },
  { id: "top", yawDeg: 0, pitchDeg: 88 },
  { id: "face", yawDeg: 20, pitchDeg: 4, closeUp: "face" },
  { id: "forearm", yawDeg: 70, pitchDeg: 10, closeUp: "forearm" },
  { id: "back-closeup", yawDeg: 180, pitchDeg: 10, closeUp: "back" },
];

/** Unit vector from the target to the camera for a yaw/pitch (degrees). */
export function orbitDirection(yawDeg: number, pitchDeg: number): [number, number, number] {
  const y = yawDeg * Math.PI / 180, p = pitchDeg * Math.PI / 180;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
}

/** Yaw/pitch (degrees) and distance of a camera position relative to a target (inverse of orbitDirection). */
export function orbitOf(cam: readonly number[], target: readonly number[]): { yawDeg: number; pitchDeg: number; distanceM: number } {
  const dx = cam[0] - target[0], dy = cam[1] - target[1], dz = cam[2] - target[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-12) return { yawDeg: 0, pitchDeg: 0, distanceM: 0 };
  return { yawDeg: Math.atan2(dx, dz) * 180 / Math.PI, pitchDeg: Math.asin(Math.max(-1, Math.min(1, dy / d))) * 180 / Math.PI, distanceM: d };
}

/** Distance at which a sphere of radius r fills a vertical fov (degrees) with a margin factor. */
export function fitDistance(radius: number, fovDeg: number, margin = 1.08): number {
  const h = Math.max(1e-3, fovDeg) * Math.PI / 360;
  return radius * margin / Math.sin(Math.min(h, Math.PI / 2 - 1e-6));
}

// ─── run-to-run diff ────────────────────────────────────────────────────────────────────────────────────────

export interface DiffBox { x0: number; y0: number; x1: number; y1: number; pixels: number }
export interface DiffResult { changed: number; total: number; changedPct: number; meanAbs: number; boxes: DiffBox[] }

/**
 * Pixel diff of two RGBA images of equal size: a pixel CHANGED when its mean absolute channel difference exceeds
 * `threshold` (0..255). Changed pixels are grouped into regions on a `cell`-pixel grid: grid cells holding at least
 * `minPixels` changed pixels are joined 8-connected, and each group's box spans its changed pixels exactly.
 * Boxes are sorted by changed pixel count (largest first) and capped at `maxBoxes`.
 */
export function diffImages(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number, o: { threshold?: number; cell?: number; minPixels?: number; maxBoxes?: number } = {}): DiffResult {
  const thr = o.threshold ?? 16, cell = Math.max(1, Math.floor(o.cell ?? 16)), minPx = Math.max(1, o.minPixels ?? 4), maxBoxes = o.maxBoxes ?? 24;
  const n = width * height;
  if (a.length < n * 4 || b.length < n * 4) throw new Error("diffImages: buffers smaller than width x height x 4");
  const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
  const count = new Int32Array(gw * gh);
  const bx0 = new Int32Array(gw * gh).fill(width), by0 = new Int32Array(gw * gh).fill(height), bx1 = new Int32Array(gw * gh).fill(-1), by1 = new Int32Array(gw * gh).fill(-1);
  let changed = 0, sum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      sum += d;
      if (d > thr) {
        changed++;
        const g = Math.floor(y / cell) * gw + Math.floor(x / cell);
        count[g]++;
        if (x < bx0[g]) bx0[g] = x; if (y < by0[g]) by0[g] = y; if (x > bx1[g]) bx1[g] = x; if (y > by1[g]) by1[g] = y;
      }
    }
  }
  const seen = new Uint8Array(gw * gh);
  const boxes: DiffBox[] = [];
  const stack: number[] = [];
  for (let g = 0; g < gw * gh; g++) {
    if (seen[g] || count[g] < minPx) continue;
    const box: DiffBox = { x0: width, y0: height, x1: -1, y1: -1, pixels: 0 };
    seen[g] = 1; stack.push(g);
    while (stack.length) {
      const k = stack.pop()!;
      box.pixels += count[k];
      box.x0 = Math.min(box.x0, bx0[k]); box.y0 = Math.min(box.y0, by0[k]); box.x1 = Math.max(box.x1, bx1[k]); box.y1 = Math.max(box.y1, by1[k]);
      const gx = k % gw, gy = (k - gx) / gw;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = gx + dx, yy = gy + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const j = yy * gw + xx;
        if (!seen[j] && count[j] >= minPx) { seen[j] = 1; stack.push(j); }
      }
    }
    boxes.push(box);
  }
  boxes.sort((p, q) => q.pixels - p.pixels || p.y0 - q.y0 || p.x0 - q.x0);
  return { changed, total: n, changedPct: n ? +(100 * changed / n).toFixed(4) : 0, meanAbs: n ? +(sum / n).toFixed(4) : 0, boxes: boxes.slice(0, maxBoxes) };
}

// ─── contact sheet grid ─────────────────────────────────────────────────────────────────────────────────────

export interface SheetCell { index: number; x: number; y: number; w: number; h: number; col: number; row: number }
/** Row-major grid of `count` cells of tileW x tileH with `gap` px gutters below a title band of `titleH` px. */
export function sheetGrid(count: number, cols: number, tileW: number, tileH: number, titleH = 0, gap = 4): { width: number; height: number; cells: SheetCell[] } {
  const c = Math.max(1, Math.min(cols, Math.max(1, count)));
  const rows = Math.max(1, Math.ceil(count / c));
  const cells: SheetCell[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % c, row = Math.floor(i / c);
    cells.push({ index: i, col, row, x: gap + col * (tileW + gap), y: titleH + gap + row * (tileH + gap), w: tileW, h: tileH });
  }
  return { width: gap + c * (tileW + gap), height: titleH + gap + rows * (tileH + gap), cells };
}
