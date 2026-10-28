// The 2-D canvas surface the minimap draws on, as a minimal structural contract.
// The browser's CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D
// both satisfy it; the Deno tests satisfy it with a call recorder. Keeping the
// contract this small is what lets the renderer be tested without a browser.

/** Exactly the CanvasRenderingContext2D members the minimap uses — nothing more. */
export type MapContext2D = Pick<
  CanvasRenderingContext2D,
  | "save" | "restore" | "setTransform" | "translate" | "rotate" | "scale"
  | "beginPath" | "closePath" | "moveTo" | "lineTo" | "arc" | "quadraticCurveTo" | "rect"
  | "fill" | "stroke" | "fillRect" | "clearRect" | "drawImage" | "putImageData" | "createImageData"
  | "fillText" | "setLineDash" | "createRadialGradient"
  | "fillStyle" | "strokeStyle" | "lineWidth" | "globalAlpha" | "font" | "textAlign" | "textBaseline"
  | "imageSmoothingEnabled" | "lineJoin" | "lineCap"
>;

/** A drawable surface: the visible minimap canvas, or an offscreen layer. */
export interface MapCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): MapContext2D | null;
}

/** The on-page canvas: a MapCanvas plus the DOM bits the minimap uses when present. */
export interface MinimapHostCanvas extends MapCanvas {
  /** CSS width in px (layout size); read only on resize, never per tick. */
  clientWidth?: number;
  addEventListener?(type: "click", listener: (ev: Event) => void): void;
  removeEventListener?(type: "click", listener: (ev: Event) => void): void;
  setAttribute?(name: string, value: string): void;
}

/** Creates an offscreen layer of `width × height` backing-store pixels. */
export type CanvasFactory = (width: number, height: number) => MapCanvas;

/**
 * The browser default: OffscreenCanvas where available (no DOM node), otherwise a
 * detached <canvas>. Throws in an environment with neither — tests inject a factory.
 */
export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  const g = globalThis as unknown as {
    OffscreenCanvas?: new (w: number, h: number) => unknown;
    document?: { createElement(tag: "canvas"): { width: number; height: number } };
  };
  if (g.OffscreenCanvas) return new g.OffscreenCanvas(width, height) as MapCanvas;
  if (g.document) {
    const c = g.document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c as unknown as MapCanvas;
  }
  throw new Error("Minimap: no OffscreenCanvas or document; pass opts.createCanvas");
};

/** View any MapCanvas as a CanvasImageSource for drawImage (true for real canvases; the test recorder ignores it). */
export function asImageSource(layer: MapCanvas): CanvasImageSource {
  return layer as unknown as CanvasImageSource;
}
