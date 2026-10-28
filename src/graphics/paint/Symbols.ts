// Symbols: the tattoo glyph set, as 2D polylines in a unit frame ([-1, 1]^2, +v up),
// and a distance query used by the `tattoo` pattern. Pure module; the glyphs are
// compiled once into one flat segment array at load, so a query allocates nothing.
//
// Each glyph means something in the game's vocabulary: the six birth signs
// (ring = Void, peaks = Mountain, flame = Flame, crescent = Moon, bolt = Storm,
// serpent = Serpent) and class marks (star = arcane, sun = devotion, eye = the dead
// watching, arrow, sword, fang, claw).

/** Glyph names; a glyph's index is what the `symbol` tattoo parameter selects. */
export const TATTOO_SYMBOLS = [
  "ring", "peaks", "flame", "crescent", "bolt", "serpent",
  "star", "sun", "eye", "arrow", "sword", "fang", "claw",
] as const;
export type TattooSymbol = typeof TATTOO_SYMBOLS[number];

/** Points sampled per full circle when an arc is flattened to a polyline. */
const ARC_STEPS_PER_TURN = 40;

type Polyline = number[]; // x0, y0, x1, y1, ...

/** A circular arc (centre cx, cy; radius r; from a0 to a1 radians) as a polyline. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): Polyline {
  const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (2 * Math.PI) * ARC_STEPS_PER_TURN));
  const out: Polyline = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * i / steps;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

/** A sampled curve (x(t), y(t)) for t in [0, 1]. */
function curve(steps: number, fn: (t: number) => [number, number]): Polyline {
  const out: Polyline = [];
  for (let i = 0; i <= steps; i++) out.push(...fn(i / steps));
  return out;
}

/** The glyph drawings, one list of polylines per TATTOO_SYMBOLS entry (same order). */
function glyphs(): Polyline[][] {
  const TAU = 2 * Math.PI;
  const star: Polyline = [];
  for (let k = 0; k <= 5; k++) { // pentagram: every second vertex of a regular pentagon
    const a = Math.PI / 2 + k * 2 * TAU / 5;
    star.push(0.95 * Math.cos(a), 0.95 * Math.sin(a));
  }
  const sunRays: Polyline[] = [];
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8;
    sunRays.push([0.62 * Math.cos(a), 0.62 * Math.sin(a), 0.95 * Math.cos(a), 0.95 * Math.sin(a)]);
  }
  return [
    /* ring    */ [arc(0, 0, 0.8, 0, TAU), arc(0, 0, 0.15, 0, TAU)],
    /* peaks   */ [[-0.9, -0.6, -0.35, 0.5, 0, -0.1, 0.4, 0.8, 0.9, -0.6, -0.9, -0.6]],
    /* flame   */ [[0, 1, 0.45, 0.2, 0.55, -0.35, 0.3, -0.75, 0, -0.85, -0.3, -0.75, -0.55, -0.35, -0.45, 0.2, -0.1, 0.45, 0, 1],
                   [0, 0.2, 0.2, -0.4, 0, -0.6, -0.2, -0.4, 0, 0.2]],
    /* crescent*/ [arc(0, 0, 0.85, 0.25 * Math.PI, 1.75 * Math.PI), arc(0.35, 0, 0.7, 0.32 * Math.PI, 1.68 * Math.PI)],
    /* bolt    */ [[0.25, 1, -0.35, 0.05, 0.15, 0.05, -0.25, -1]],
    /* serpent */ [curve(24, (t) => [0.55 * Math.sin(2 * Math.PI * t), 0.85 - 1.7 * t]), arc(0, 0.9, 0.12, 0, TAU)],
    /* star    */ [star],
    /* sun     */ [arc(0, 0, 0.45, 0, TAU), ...sunRays],
    /* eye     */ [curve(16, (t) => [2 * t - 1, 0.55 * (1 - (2 * t - 1) ** 2)]),
                   curve(16, (t) => [2 * t - 1, -0.55 * (1 - (2 * t - 1) ** 2)]), arc(0, 0, 0.25, 0, TAU)],
    /* arrow   */ [[-0.9, -0.9, 0.9, 0.9], [0.9, 0.9, 0.4, 0.85], [0.9, 0.9, 0.85, 0.4],
                   [-0.9, -0.9, -0.95, -0.55], [-0.9, -0.9, -0.55, -0.95]],
    /* sword   */ [[0, -1, 0, 1], [-0.5, -0.45, 0.5, -0.45]],
    /* fang    */ [[-0.5, 0.8, 0, -1, 0.5, 0.8, -0.5, 0.8]],
    /* claw    */ [[-0.6, 0.8, -0.2, -0.8], [-0.1, 0.9, 0.3, -0.7], [0.4, 0.8, 0.8, -0.6]],
  ];
}

/** Flattened segments: 4 floats (x0, y0, x1, y1) per segment, all glyphs back to back. */
const SEGMENTS: Float32Array = (() => {
  const flat: number[] = [];
  for (const g of glyphs()) {
    for (const line of g) {
      for (let i = 0; i + 3 < line.length; i += 2) flat.push(line[i], line[i + 1], line[i + 2], line[i + 3]);
    }
  }
  return Float32Array.from(flat);
})();

/** Segment index range [start, end) of each glyph in SEGMENTS. */
const RANGES: Uint32Array = (() => {
  const out = new Uint32Array(TATTOO_SYMBOLS.length * 2);
  let at = 0;
  glyphs().forEach((g, s) => {
    let n = 0;
    for (const line of g) n += Math.max(0, line.length / 2 - 1);
    out[s * 2] = at; out[s * 2 + 1] = at + n; at += n;
  });
  return out;
})();

/** Number of glyphs. */
export const SYMBOL_COUNT = TATTOO_SYMBOLS.length;

/** Index of a glyph by name (-1 when unknown). */
export function symbolIndex(name: string): number {
  return (TATTOO_SYMBOLS as readonly string[]).indexOf(name);
}

/**
 * Unsigned distance (glyph units, 1 = the glyph's radius) from (u, v) to the nearest
 * stroke of glyph `symbol` (index, wrapped into range). Equation per segment AB:
 *   h = clamp(dot(P - A, B - A) / |B - A|^2, 0, 1);  d = |P - A - h (B - A)|.
 */
export function symbolDistance(symbol: number, u: number, v: number): number {
  const s = ((Math.floor(symbol) % SYMBOL_COUNT) + SYMBOL_COUNT) % SYMBOL_COUNT;
  let best = Infinity;
  for (let k = RANGES[s * 2], end = RANGES[s * 2 + 1]; k < end; k++) {
    const o = k * 4;
    const ax = SEGMENTS[o], ay = SEGMENTS[o + 1], bx = SEGMENTS[o + 2], by = SEGMENTS[o + 3];
    const ex = bx - ax, ey = by - ay, px = u - ax, py = v - ay;
    const len2 = ex * ex + ey * ey;
    const h = len2 > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / len2)) : 0;
    const dx = px - h * ex, dy = py - h * ey;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
