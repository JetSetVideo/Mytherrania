// Portrait backdrop (wave W, lane H): the hero card's figure used to sit on the portrait renderer's
// clear colour #172128 — a cold blue-grey (R 23, G 33, B 40) that clashed with the medieval UI
// (walnut panels, gold frames: styles.css --u-walnut #2a1c12, --u-gold #f0cf73). The portrait and the
// creator preview now stand on a DARK WARM VIGNETTE: leather brown behind the figure, walnut toward
// the frame, the deepest walnut in the corners, with a faint gold glow low behind the figure (the
// "rim" the UI's gilded frames pick up). Pure module (no THREE, no DOM): the pixels are a function of
// the position, so a test can pin the corner colour without a GL context.

/** UI tokens this backdrop matches (styles.css :root). */
export const UI_WALNUT = "#2a1c12";
export const UI_WALNUT_DEEP = "#170f09";
export const UI_LEATHER = "#3a2416";
export const UI_GOLD = "#f0cf73";
/** Centre glow (a warm leather lit from the front). */
export const BACKDROP_CENTRE = "#4a2f1b";
/** How much of the gold the glow behind the figure takes (0..1) at its centre. */
export const BACKDROP_GOLD_GLOW = 0.14;

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * sRGB colour (0..255) of the backdrop at normalised position (u, v) ∈ [0, 1]² (v = 0 at the top).
 * Radial: centre → walnut at r = 0.75 → deep walnut at the corners (r ≈ 1.41 from the centre in
 * half-extents); plus a soft gold glow centred low (behind the shoulders).
 */
export function backdropColour(u: number, v: number): [number, number, number] {
  const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
  const r = Math.hypot(dx, dy);
  let c = mix(hex(BACKDROP_CENTRE), hex(UI_WALNUT), smooth(0.05, 0.85, r));
  c = mix(c, hex(UI_WALNUT_DEEP), smooth(0.85, 1.42, r));
  const g = Math.hypot(dx, (v - 0.62) * 2.2);
  c = mix(c, hex(UI_GOLD), BACKDROP_GOLD_GLOW * (1 - smooth(0, 0.9, g)));
  return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
}

/** RGBA pixels (row 0 = TOP) of a `w × h` backdrop. */
export function backdropPixels(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = backdropColour((x + 0.5) / w, (y + 0.5) / h);
      const k = (y * w + x) * 4;
      out[k] = r; out[k + 1] = g; out[k + 2] = b; out[k + 3] = 255;
    }
  }
  return out;
}

/** True when a colour reads BLUE (its blue channel leads red by more than `margin`). */
export function readsBlue(rgb: readonly number[], margin = 4): boolean {
  return rgb[2] > rgb[0] + margin;
}
