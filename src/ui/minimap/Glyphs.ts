// Minimap glyphs: the small vector shapes the map is drawn with — one silhouette
// per prop kind, pickup markers, fighter arrows and edge arrows. Each function
// draws around the CURRENT origin/transform of `ctx` and allocates nothing.
import type { MapContext2D } from "./Canvas.ts";

/** Palette shared by every glyph (HUD palette: #172128 ink, #fff3cf parchment, #dfaa55 gold, #ef7455 coral). */
export const MAP_COLOURS = {
  background: "#0b1014",
  ink: "#0b1014",
  outline: "rgba(11,16,20,0.85)",
  wall: "#d9e3e1",
  wallShadow: "rgba(11,16,20,0.7)",
  edgeUnwalled: "#ef7455",
  outsideDim: "rgba(6,9,12,0.55)",
  self: "#fff3cf",
  rival: "#ef4a3a",
  path: "rgba(223,170,85,0.9)",
  text: "#fff3cf",
  textDim: "rgba(255,243,207,0.72)",
  rivalText: "#ef7455",
  north: "#dfaa55",
  pingTaken: "#ef4a3a",
  pingDealt: "#dfaa55",
} as const;

/** How a pickup or item is drawn. */
export type MarkerShape = "circle" | "diamond" | "coin" | "square" | "flag";

/** One marker style: shape and fill colour. */
export interface MarkerStyle {
  shape: MarkerShape;
  fill: string;
}

/** Pickups by PowerUps id (PICKUP_KINDS). Resources are round, buffs are diamonds, coins are gold discs. Health is pink, not red, so it never reads as the rival. */
export const PICKUP_STYLES: Readonly<Record<string, MarkerStyle>> = {
  health_orb: { shape: "circle", fill: "#ff8fb8" },
  mana_orb: { shape: "circle", fill: "#5b8cff" },
  stamina_draught: { shape: "circle", fill: "#a9ce7c" },
  rage: { shape: "diamond", fill: "#ef7455" },
  ward: { shape: "diamond", fill: "#7fd6e0" },
  swift: { shape: "diamond", fill: "#e8f5c8" },
  focus: { shape: "diamond", fill: "#b48cf0" },
  coin: { shape: "coin", fill: "#dfaa55" },
};

/** Items by Items.ItemKind. */
export const ITEM_STYLES: Readonly<Record<string, MarkerStyle>> = {
  coin: { shape: "coin", fill: "#dfaa55" },
  chest: { shape: "square", fill: "#b07a3a" },
  shrine: { shape: "diamond", fill: "#cfe3ff" },
  banner: { shape: "flag", fill: "#ef7455" },
};

/** Fallback by PowerUps.PickupKind when an id has no style of its own. */
export const KIND_STYLES: Readonly<Record<string, MarkerStyle>> = {
  resource: { shape: "circle", fill: "#cfe3ff" },
  buff: { shape: "diamond", fill: "#e8f5c8" },
  coin: { shape: "coin", fill: "#dfaa55" },
};

/** Last resort for an unknown pickup/item. */
export const UNKNOWN_STYLE: MarkerStyle = { shape: "circle", fill: "#b9c9c8" };

/** Fill + stroke colours of each prop silhouette. */
export const PROP_COLOURS: Readonly<Record<string, { fill: string; stroke: string }>> = {
  pillar: { fill: "#c9d4d2", stroke: "#2b363c" },
  rock: { fill: "#8a8270", stroke: "#2e2a22" },
  tree: { fill: "#5e8f4e", stroke: "#203a1c" },
  crate: { fill: "#b8874f", stroke: "#3e2a14" },
  ramp: { fill: "#d0ad72", stroke: "#4a3a1e" },
  platform: { fill: "#93a9ae", stroke: "#24343a" },
  arch: { fill: "#d6c6a4", stroke: "#3b3122" },
  gliderPad: { fill: "rgba(127,214,224,0.35)", stroke: "#7fd6e0" },
  unknown: { fill: "#9aa3a6", stroke: "#2b363c" },
};

/**
 * A deterministic pseudo-random value in [0, 1) from two coordinates and an index
 * (integer hash; no allocation, no global RNG). Used for rock-blob outlines, so a
 * rock looks the same every bake.
 */
export function hash01(x: number, z: number, i: number): number {
  let h = Math.imul(Math.floor(x * 73.13) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(z * 91.7) + i * 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Vertices of a rock blob (radius jitter between 0.72 and 1.04 of the footprint). */
const ROCK_VERTICES = 7;

/**
 * Draw one prop's top-down silhouette centred on the current origin, its local +x
 * along the prop's facing. `r` is the footprint radius in pixels
 * (objectSize(kind).r · scale · px/m); `seedX/seedZ` make the rock outline stable.
 *   pillar   — circle with a cap highlight
 *   rock     — irregular 7-gon blob
 *   tree     — scalloped crown (6 lobes) around a trunk dot
 *   crate    — square with a cross brace
 *   ramp     — triangle pointing up-slope (+x) with a ridge line
 *   platform — rectangle with an inset rim
 *   arch     — two posts joined by a semicircular span
 *   gliderPad — ring with a launch chevron
 */
export function drawPropGlyph(ctx: MapContext2D, kind: string, r: number, lineWidth: number, seedX: number, seedZ: number): void {
  const c = PROP_COLOURS[kind] ?? PROP_COLOURS.unknown;
  ctx.fillStyle = c.fill;
  ctx.strokeStyle = c.stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  switch (kind) {
    case "pillar":
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "rock":
      for (let i = 0; i < ROCK_VERTICES; i++) {
        const a = (i / ROCK_VERTICES) * Math.PI * 2;
        const k = r * (0.72 + 0.32 * hash01(seedX, seedZ, i));
        if (i === 0) ctx.moveTo(Math.cos(a) * k, Math.sin(a) * k);
        else ctx.lineTo(Math.cos(a) * k, Math.sin(a) * k);
      }
      ctx.closePath();
      break;
    case "tree": {
      const lobes = 6, lobeR = r * 0.42, ringR = r * 0.58;
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2;
        ctx.moveTo(Math.cos(a) * ringR + lobeR, Math.sin(a) * ringR);
        ctx.arc(Math.cos(a) * ringR, Math.sin(a) * ringR, lobeR, 0, Math.PI * 2);
      }
      ctx.moveTo(r * 0.6, 0);
      ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "#3e2a14";
      ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "crate": {
      const s = r * 0.9;
      ctx.rect(-s, -s, 2 * s, 2 * s);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s, -s);
      ctx.lineTo(s, s);
      ctx.moveTo(s, -s);
      ctx.lineTo(-s, s);
      ctx.stroke();
      return;
    }
    case "ramp":
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.8, r * 0.75);
      ctx.lineTo(-r * 0.8, -r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, 0);
      ctx.lineTo(r * 0.55, 0);
      ctx.stroke();
      return;
    case "platform":
      ctx.rect(-r, -r * 0.7, 2 * r, 1.4 * r);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-r * 0.72, -r * 0.44, 1.44 * r, 0.88 * r);
      ctx.stroke();
      return;
    case "arch": {
      const post = r * 0.22;
      ctx.rect(-post, -r - post, 2 * post, 2 * post);
      ctx.rect(-post, r - post, 2 * post, 2 * post);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.lineWidth = lineWidth * 2.2;
      ctx.strokeStyle = c.fill;
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.stroke();
      return;
    }
    case "gliderPad":
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, r * 0.25);
      ctx.lineTo(r * 0.35, 0);
      ctx.lineTo(-r * 0.35, -r * 0.25);
      ctx.stroke();
      return;
    default:
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      break;
  }
  ctx.fill();
  ctx.stroke();
}

/** Draw a pickup/item marker of radius `r` px centred at (x, y) in the current transform. */
export function drawMarker(ctx: MapContext2D, style: MarkerStyle, x: number, y: number, r: number, lineWidth: number): void {
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = MAP_COLOURS.outline;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  switch (style.shape) {
    case "diamond":
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case "square":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case "flag":
      ctx.moveTo(x - r * 0.8, y + r);
      ctx.lineTo(x - r * 0.8, y - r);
      ctx.lineTo(x + r, y - r * 0.5);
      ctx.lineTo(x - r * 0.8, y);
      ctx.closePath();
      break;
    case "coin":
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      break;
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
}

/**
 * A fighter TOKEN: a filled disc of radius 0.62·size with a triangular nose reaching
 * `size` px along canvas angle `angle`. Reads as "a body facing that way" at a glance,
 * where a notched kite arrow is easily mistaken for the mouse cursor.
 */
export function drawToken(ctx: MapContext2D, x: number, y: number, angle: number, size: number, fill: string, lineWidth: number): void {
  const r = 0.62 * size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  // Nose: tangent points of the disc at ±50° to the tip, so the outline is one smooth shape.
  const a = (50 * Math.PI) / 180;
  ctx.moveTo(size * 1.15, 0);
  ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  ctx.arc(0, 0, r, a, -a);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = MAP_COLOURS.outline;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  // A dark pip at the centre marks the body's exact position.
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(lineWidth, 0.18 * size), 0, Math.PI * 2);
  ctx.fillStyle = MAP_COLOURS.ink;
  ctx.fill();
  ctx.restore();
}

/** A small triangle on the map rim at (x, y) pointing outward along `angle`: "it is that way, off the map". */
export function drawEdgeArrow(ctx: MapContext2D, x: number, y: number, angle: number, size: number, fill: string, lineWidth: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.75);
  ctx.lineTo(-size * 0.6, -size * 0.75);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = MAP_COLOURS.outline;
  ctx.lineWidth = lineWidth;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
