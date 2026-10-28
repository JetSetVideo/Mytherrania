// Minimap overlays: the screen-space furniture drawn on top of the map — the north
// marker, the scale bar, the explored share, the mode name and the rival distance.
// Strings are cached and rebuilt only when the number they show changes, so a
// steady draw allocates nothing.
import type { FogGrid } from "../../game/FogOfWar.ts";
import { exploredFraction } from "../../game/FogOfWar.ts";
import type { MapContext2D } from "./Canvas.ts";
import { drawEdgeArrow, MAP_COLOURS } from "./Glyphs.ts";
import { canvasAngleOf, clampToEdge, createEdgeMarker, type MapFrame, scaleBarMetres } from "./MapMath.ts";

/** Overlay layout, CSS px (× dpr at draw time). Each is a legibility choice for a 132–220 px map. */
export const OVERLAY_LAYOUT = {
  /** Gap between the map edge and corner text / scale bar. */
  padding: 6,
  /** Distance from the map edge to the north marker's centre. */
  northInset: 13,
  /** Radius of the dark disc behind the "N". */
  northDisc: 7.5,
  /** The scale bar may use at most this fraction of the map width. */
  scaleBarMaxFraction: 0.3,
  /** Height of the scale bar's end ticks. */
  scaleTick: 3,
} as const;

/** What the overlays need from the current tick. */
export interface OverlayInput {
  fog: FogGrid | null;
  modeLabel: string;
  selfX: number;
  selfZ: number;
  /** Rival position, or NaN when there is no rival. */
  rivalX: number;
  rivalZ: number;
}

/** Draws the overlays and owns their cached strings. One instance per Minimap. */
export class MapOverlays {
  readonly #edge = createEdgeMarker();
  #exploredShown = -1;
  #exploredText = "";
  #distShown = -1;
  #distText = "";
  #scaleShown = -1;
  #scaleText = "";
  /** The scale-bar length chosen by the last draw, metres. */
  scaleBarMetres = 0;

  /**
   * Draw in screen space (resets the transform). `font` and `boldFont` are CSS font
   * strings already scaled by dpr; `u` = devicePixelRatio (px per CSS px).
   */
  draw(ctx: MapContext2D, f: MapFrame, input: OverlayInput, font: string, boldFont: string, u: number): void {
    const W = f.widthPx, H = f.heightPx, L = OVERLAY_LAYOUT, pad = L.padding * u, e = this.#edge;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // North: where bearing 0 meets the rim — top-centre when north-up, orbiting in heading-up.
    const nA = canvasAngleOf(f, 0);
    clampToEdge(f, W / 2 + Math.cos(nA) * W * 4, H / 2 + Math.sin(nA) * H * 4, L.northInset * u, e);
    ctx.beginPath();
    ctx.arc(e.x, e.y, L.northDisc * u, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(11,16,20,0.78)";
    ctx.fill();
    ctx.strokeStyle = MAP_COLOURS.north;
    ctx.lineWidth = u;
    ctx.stroke();
    drawEdgeArrow(ctx, e.x + Math.cos(e.angle) * (L.northDisc + 2.5) * u, e.y + Math.sin(e.angle) * (L.northDisc + 2.5) * u, e.angle, 3 * u, MAP_COLOURS.north, 0.8 * u);
    ctx.font = boldFont;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = MAP_COLOURS.north;
    ctx.fillText("N", e.x, e.y + 0.5 * u);
    // Scale bar (bottom-left): the largest nice length ≤ 30 % of the map width.
    ctx.font = font;
    const metres = scaleBarMetres(f.pixelsPerMetre, W * L.scaleBarMaxFraction);
    this.scaleBarMetres = metres;
    const bar = metres * f.pixelsPerMetre, y = H - pad, tick = L.scaleTick * u;
    for (let pass = 0; pass < 2; pass++) {
      // Pass 0: dark under-stroke for contrast on any terrain; pass 1: the bar.
      ctx.strokeStyle = pass === 0 ? MAP_COLOURS.ink : MAP_COLOURS.text;
      ctx.lineWidth = (pass === 0 ? 3.2 : 1.4) * u;
      ctx.beginPath();
      ctx.moveTo(pad, y - tick);
      ctx.lineTo(pad, y);
      ctx.lineTo(pad + bar, y);
      ctx.lineTo(pad + bar, y - tick);
      ctx.stroke();
    }
    if (metres !== this.#scaleShown) {
      this.#scaleShown = metres;
      this.#scaleText = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    shadowText(ctx, this.#scaleText, pad, y - tick - u, MAP_COLOURS.text, u);
    // Explored share (top-left) and mode (top-right).
    ctx.textBaseline = "top";
    if (input.fog) {
      const pct = Math.round(exploredFraction(input.fog) * 100);
      if (pct !== this.#exploredShown) {
        this.#exploredShown = pct;
        this.#exploredText = `${pct}% seen`;
      }
      shadowText(ctx, this.#exploredText, pad, pad, MAP_COLOURS.textDim, u);
    }
    ctx.textAlign = "right";
    shadowText(ctx, input.modeLabel, W - pad, pad, MAP_COLOURS.textDim, u);
    // Distance to the rival (bottom-right): always known (the magnetism sense gives bearing and range).
    if (Number.isFinite(input.rivalX)) {
      const d = Math.round(Math.hypot(input.rivalX - input.selfX, input.rivalZ - input.selfZ));
      if (d !== this.#distShown) {
        this.#distShown = d;
        this.#distText = `rival ${d} m`;
      }
      ctx.textBaseline = "bottom";
      shadowText(ctx, this.#distText, W - pad, H - pad, MAP_COLOURS.rivalText, u);
    }
  }
}

/** Text with a 1-px dark drop shadow, legible over any terrain. */
export function shadowText(ctx: MapContext2D, s: string, x: number, y: number, colour: string, u: number): void {
  ctx.fillStyle = MAP_COLOURS.ink;
  ctx.fillText(s, x + u, y + u);
  ctx.fillStyle = colour;
  ctx.fillText(s, x, y);
}
