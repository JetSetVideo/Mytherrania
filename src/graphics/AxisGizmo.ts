/**
 * Wave THEME lane V — the viewer's AXIS GIZMO (contract C-VIEW): a small 3D axes widget in the viewer's TOP-RIGHT
 * corner that turns with the camera — X red, Y yellow, Z green (the user's colours; X takes the conventional red),
 *   each positive end a labelled disc, each negative end a hollow ring of the same colour (named "−X" on hover). Clicking an end snaps the
 * camera to look along that axis (`ViewerControls.snapTo`).
 *
 * Why an overlay 2D canvas and not a second WebGL viewport: the gizmo is six discs and three lines, a 2D canvas draws
 * it in microseconds, costs no extra WebGL context (the page already runs the arena + the Creator viewer + the
 * PortraitStudio), and its hit test is the same pure layout the tests check (`gizmoLayout` / `pickAxis`).
 *
 * DOM (created with createElement, styled through CSSOM only — the page CSP is `style-src 'self'`):
 *   <canvas class="viewer-gizmo" aria-label="Axis gizmo: ..."> — sibling of the viewer canvas, absolutely placed at
 *   the canvas's top-right. Class `viewer-gizmo-hot` while the pointer is over an axis end (cursor: pointer).
 *   Lane T may style `.viewer-gizmo` (frame/shadow); the disc colours are drawn here.
 */
import { type AxisId, gizmoAxes, type ViewState } from "./ViewerControls.ts";

/** Axis colours: X red, Y yellow, Z green (BRIEF item 3). */
export const GIZMO_COLOURS: Record<"X" | "Y" | "Z", string> = { X: "#e0443a", Y: "#e8c62e", Z: "#3fae4f" };
/** Gizmo edge length (css px) = clamp(GIZMO_MIN_PX, GIZMO_SHARE · viewer width, GIZMO_MAX_PX). */
export const GIZMO_MIN_PX = 64;
export const GIZMO_MAX_PX = 96;
export const GIZMO_SHARE = 0.2;
/** Inset from the viewer's top-right corner, css px. */
export const GIZMO_INSET_PX = 8;
/** The gizmo never covers the plate's own controls: it shrinks (down to this) and then slides left past them. */
export const GIZMO_AVOID_MIN_PX = 52;
/** Elements of the plate the gizmo keeps clear of (the socket columns, the LV corner; lane T may add `.viewer-gizmo-avoid`). */
export const GIZMO_AVOID_SELECTOR = ".equip-col, .equip-slot, .hero-plate-corner, .th-plaque, .hero-tag, .viewer-gizmo-avoid";
/** Page chrome that can float OVER the viewer when it scrolls (the sticky screen nav): the gizmo moves down below it. */
export const GIZMO_COVER_SELECTOR = ".screen-nav, .viewer-gizmo-cover";
/** Clearance kept from every avoided element, css px (lane T's review: touching the Weapon socket read as cramped). */
export const GIZMO_CLEAR_PX = 6;

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * Where the gizmo goes inside a viewer `host` rect (client px). `covers` (page chrome floating over the viewer, e.g. the
 * sticky nav) push the top down to below them; then at that top: the top-right corner minus the inset, at `size`; if that
 * comes within GIZMO_CLEAR_PX of an obstacle, shrink in 2 px steps to GIZMO_AVOID_MIN_PX; if it still does, keep `size`
 * and slide left until clear. Pure.
 */
export function gizmoPlacement(host: Rect, size: number, obstacles: Rect[], covers: Rect[] = []): { left: number; top: number; size: number } {
  let top = host.top + GIZMO_INSET_PX;
  for (const c of covers) if (c.left < host.right && c.right > host.left && c.top <= top + size && c.bottom > top - GIZMO_INSET_PX) top = Math.max(top, c.bottom + GIZMO_INSET_PX);
  top = Math.min(top, Math.max(host.top + GIZMO_INSET_PX, host.bottom - size - GIZMO_INSET_PX));
  const pad = GIZMO_CLEAR_PX;
  const hits = (l: number, s: number) => obstacles.filter((o) => o.left - pad < l + s && o.right + pad > l && o.top - pad < top + s && o.bottom + pad > top);
  for (let s = size; s >= GIZMO_AVOID_MIN_PX; s -= 2) {
    const l = host.right - GIZMO_INSET_PX - s;
    if (hits(l, s).length === 0) return { left: l, top, size: s };
  }
  let l = host.right - GIZMO_INSET_PX - size;
  for (let i = 0; i < 8; i++) {
    const h = hits(l, size);
    if (h.length === 0) break;
    l = Math.min(...h.map((o) => o.left)) - pad - size;
  }
  return { left: Math.max(host.left + GIZMO_INSET_PX, l), top, size };
}

export interface GizmoEnd {
  id: AxisId;
  /** Centre of the end's disc in gizmo-local css px (0,0 = the gizmo's top-left). */
  x: number;
  y: number;
  /** Disc radius, css px. */
  r: number;
  depth: number;
  colour: string;
  positive: boolean;
}

/** Gizmo edge length for a viewer `widthPx` wide. Pure. */
export function gizmoSize(widthPx: number): number {
  return Math.round(Math.max(GIZMO_MIN_PX, Math.min(GIZMO_MAX_PX, (Number.isFinite(widthPx) ? widthPx : 0) * GIZMO_SHARE)));
}

/** The six ends laid out in a `size`-px square, sorted back-to-front (draw order; the last is on top). Pure. */
export function gizmoLayout(view: ViewState, size: number): GizmoEnd[] {
  const c = size / 2;
  const rPos = Math.max(8, size * 0.115), rNeg = Math.max(6, size * 0.085);
  const len = c - rPos - 2;
  return gizmoAxes(view)
    .map((a) => {
      const positive = a.id[0] === "+";
      return { id: a.id, x: c + a.x * len, y: c + a.y * len, r: positive ? rPos : rNeg, depth: a.depth, colour: GIZMO_COLOURS[a.id[1] as "X" | "Y" | "Z"], positive };
    })
    .sort((p, q) => p.depth - q.depth);
}

/**
 * The end under gizmo-local point (x, y): among the discs containing it (3 px grace), the one whose CENTRE is nearest
 * (ties -> the front-most). Nearest-centre, not front-most: on a 56 px gizmo a negative end half-hidden behind a
 * positive disc stays clickable on its visible part (measured: front-most picking made −X/−Z unreachable at 390 px).
 */
export function pickAxis(layout: GizmoEnd[], x: number, y: number): AxisId | null {
  let best: AxisId | null = null, bestD = Infinity;
  for (let i = layout.length - 1; i >= 0; i--) {
    const e = layout[i], d = Math.hypot(x - e.x, y - e.y);
    if (d <= e.r + 3 && d < bestD - 1e-9) { best = e.id; bestD = d; }
  }
  return best;
}

/** The overlay. DOM only in here; the layout and the pick are the pure functions above. */
export class AxisGizmo {
  readonly el: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D | null;
  #size = 0;
  #dpr = 1;
  #layout: GizmoEnd[] = [];
  #key = "";
  #hot: AxisId | null = null;
  #ac = new AbortController();

  constructor(host: HTMLCanvasElement, onSnap: (axis: AxisId) => void) {
    const doc = host.ownerDocument;
    const el = doc.createElement("canvas");
    el.className = "viewer-gizmo";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Axis gizmo: X red, Y yellow, Z green. Click an axis end to look along it.");
    el.dataset.gizmo = "1";
    Object.assign(el.style, { position: "absolute", zIndex: "3", touchAction: "none", cursor: "default", borderRadius: "50%" });
    this.el = el;
    this.#ctx = el.getContext("2d");
    host.insertAdjacentElement("afterend", el);
    const parent = host.parentElement;
    if (parent && doc.defaultView && doc.defaultView.getComputedStyle(parent).position === "static") parent.style.position = "relative";
    const sig = { signal: this.#ac.signal };
    const local = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return pickAxis(this.#layout, e.clientX - r.left, e.clientY - r.top);
    };
    // The gizmo swallows its own pointer events so a click on it never starts a model drag underneath.
    el.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); }, sig);
    el.addEventListener("pointermove", (e) => {
      const hot = local(e);
      if (hot !== this.#hot) { this.#hot = hot; el.classList.toggle("viewer-gizmo-hot", hot !== null); el.style.cursor = hot ? "pointer" : "default"; this.#key = ""; }
    }, sig);
    el.addEventListener("pointerleave", () => { if (this.#hot) { this.#hot = null; el.classList.remove("viewer-gizmo-hot"); el.style.cursor = "default"; this.#key = ""; } }, sig);
    el.addEventListener("click", (e) => { e.stopPropagation(); const a = local(e); if (a) onSnap(a); }, sig);
    el.addEventListener("dblclick", (e) => e.stopPropagation(), sig);
    el.addEventListener("wheel", (e) => e.stopPropagation(), { signal: this.#ac.signal, passive: true });
  }

  /** Place at the host canvas's top-right and redraw if the view, size or hover changed. Cheap when nothing did. */
  update(host: HTMLCanvasElement, view: ViewState, dpr: number): void {
    const hr = host.getBoundingClientRect();
    const scope = host.closest(".stage-plate") ?? host.parentElement;
    const obstacles: Rect[] = [];
    for (const o of scope?.querySelectorAll(GIZMO_AVOID_SELECTOR) ?? []) {
      const r = o.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > hr.left && r.left < hr.right && r.bottom > hr.top && r.top < hr.bottom) obstacles.push(r);
    }
    const covers: Rect[] = [];
    for (const o of host.ownerDocument.querySelectorAll(GIZMO_COVER_SELECTOR)) {
      const r = o.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) covers.push(r);
    }
    const place = gizmoPlacement(hr, gizmoSize(hr.width), obstacles, covers);
    const size = Math.round(place.size);
    // Client -> the gizmo's containing block (the host's offsetParent, same as the gizmo's): offsets of the host.
    // Rounded DOWN: a sub-pixel round-up must not eat into the clearance from the sockets (right / below).
    const left = Math.floor(host.offsetLeft + (place.left - hr.left)), top = Math.floor(host.offsetTop + (place.top - hr.top));
    const pos = `${left},${top},${size}`;
    if (this.el.dataset.pos !== pos) {
      this.el.dataset.pos = pos;
      Object.assign(this.el.style, { left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px` });
    }
    const d = Math.max(1, Math.min(3, dpr || 1));
    if (size !== this.#size || d !== this.#dpr) {
      this.#size = size; this.#dpr = d;
      this.el.width = Math.round(size * d); this.el.height = Math.round(size * d);
      this.#key = "";
    }
    this.#layout = gizmoLayout(view, size);
    const key = `${view.yaw.toFixed(4)},${view.pitch.toFixed(4)},${this.#hot}`;
    if (key === this.#key) return;
    this.#key = key;
    this.#draw();
  }

  #draw(): void {
    const g = this.#ctx;
    if (!g) return;
    const s = this.#size, c = s / 2;
    g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    g.clearRect(0, 0, s, s);
    // A dark disc behind the axes: the colours read on any floor tone.
    g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2);
    g.fillStyle = "rgba(12,9,6,0.62)"; g.fill();
    g.lineWidth = 1; g.strokeStyle = "rgba(230,214,176,0.35)"; g.stroke();
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const e of this.#layout) {
      const hot = e.id === this.#hot;
      if (e.positive) {
        g.beginPath(); g.moveTo(c, c); g.lineTo(e.x, e.y);
        g.lineWidth = 2.5; g.strokeStyle = e.colour; g.globalAlpha = e.depth < -0.2 ? 0.6 : 1; g.stroke(); g.globalAlpha = 1;
      }
      g.beginPath(); g.arc(e.x, e.y, e.r + (hot ? 1.5 : 0), 0, Math.PI * 2);
      if (e.positive) {
        g.fillStyle = e.colour; g.fill();
        g.lineWidth = hot ? 2 : 1; g.strokeStyle = hot ? "#fff7e0" : "rgba(0,0,0,0.55)"; g.stroke();
        g.fillStyle = "#14100a"; g.font = `700 ${Math.round(e.r * 1.25)}px system-ui, sans-serif`;
        g.fillText(e.id[1], e.x, e.y + 0.5);
      } else {
        g.fillStyle = "rgba(20,16,10,0.85)"; g.fill();
        g.lineWidth = hot ? 2.5 : 1.75; g.strokeStyle = e.colour; g.stroke();
        // Negative ends are hollow rings (Blender's convention); the hovered one names itself ("−X").
        if (hot) { g.fillStyle = e.colour; g.font = `700 ${Math.round(e.r * 1.1)}px system-ui, sans-serif`; g.fillText(`−${e.id[1]}`, e.x, e.y + 0.5); }
      }
    }
  }

  /** QA: the gizmo's client rect and every end's centre in CLIENT px (what a probe clicks). */
  debug(): { rect: { left: number; top: number; width: number; height: number; x: number; y: number; w: number; h: number }; ends: (GizmoEnd & { clientX: number; clientY: number })[]; endsById: Record<string, { x: number; y: number; colour: string; depth: number }>; labels: Record<string, string>; hot: AxisId | null; className: string } {
    const r = this.el.getBoundingClientRect();
    const ends = this.#layout.map((e) => ({ ...e, clientX: r.left + e.x, clientY: r.top + e.y }));
    const endsById: Record<string, { x: number; y: number; colour: string; depth: number }> = {};
    for (const e of ends) endsById[e.id] = { x: e.clientX, y: e.clientY, colour: e.colour, depth: e.depth };
    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height, x: r.left, y: r.top, w: r.width, h: r.height },
      ends, endsById,
      labels: { "+X": "X", "+Y": "Y", "+Z": "Z", "-X": "−X (on hover)", "-Y": "−Y (on hover)", "-Z": "−Z (on hover)" },
      hot: this.#hot, className: this.el.className,
    };
  }

  dispose(): void {
    this.#ac.abort();
    this.el.remove();
  }
}
