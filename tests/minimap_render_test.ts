// Lane F (R06): the Minimap renderer, driven against a recording fake 2-D context
// (no browser). Proves the static layer is baked once, every pickup / item /
// fighter gets a marker, fog hides unseen drops, the ghost fades, and clicks cycle modes.
import { makeArena, placeObjects } from "../src/game/ArenaConfig.ts";
import { createFog, reveal } from "../src/game/FogOfWar.ts";
import { PICKUP_KINDS } from "../src/game/PowerUps.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { outline } from "../src/physics/ArenaPhysics.ts";
import { createMinimapView, Minimap, type MinimapPickupLike } from "../src/ui/Minimap.ts";
import type { MapCanvas, MapContext2D, MinimapHostCanvas } from "../src/ui/minimap/Canvas.ts";
import { MAP_COLOURS, PICKUP_STYLES } from "../src/ui/minimap/Glyphs.ts";

/** Plain (non-narrowing) assert: the same property is re-checked after it changes. */
function assert(ok: unknown, m = "assertion failed"): void {
  if (!ok) throw new Error(m);
}
function near(a: number, b: number, eps: number, m = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${m} expected ~${b}, got ${a}`);
}

/** One recorded call or property write. */
interface Rec { op: string; args: unknown[] }

/** Implements exactly MapContext2D and records every call and style write. */
class RecordingContext implements MapContext2D {
  readonly log: Rec[] = [];
  constructor(readonly owner: FakeCanvas) {}
  #fill: string | CanvasGradient | CanvasPattern = "#000";
  #stroke: string | CanvasGradient | CanvasPattern = "#000";
  #alpha = 1;
  get fillStyle() { return this.#fill; }
  set fillStyle(v) { this.#fill = v; this.log.push({ op: "fillStyle", args: [v] }); }
  get strokeStyle() { return this.#stroke; }
  set strokeStyle(v) { this.#stroke = v; this.log.push({ op: "strokeStyle", args: [v] }); }
  get globalAlpha() { return this.#alpha; }
  set globalAlpha(v) { this.#alpha = v; this.log.push({ op: "globalAlpha", args: [v] }); }
  lineWidth = 1;
  font = "10px serif";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";
  imageSmoothingEnabled = true;
  lineJoin: CanvasLineJoin = "miter";
  lineCap: CanvasLineCap = "butt";
  #rec(op: string, args: unknown[]): void { this.log.push({ op, args }); }
  save(): void { this.#rec("save", []); }
  restore(): void { this.#rec("restore", []); }
  setTransform(...a: unknown[]): void { this.#rec("setTransform", a); }
  translate(x: number, y: number): void { this.#rec("translate", [x, y]); }
  rotate(a: number): void { this.#rec("rotate", [a]); }
  scale(x: number, y: number): void { this.#rec("scale", [x, y]); }
  beginPath(): void { this.#rec("beginPath", []); }
  closePath(): void { this.#rec("closePath", []); }
  moveTo(x: number, y: number): void { this.#rec("moveTo", [x, y]); }
  lineTo(x: number, y: number): void { this.#rec("lineTo", [x, y]); }
  arc(...a: unknown[]): void { this.#rec("arc", a); }
  quadraticCurveTo(...a: unknown[]): void { this.#rec("quadraticCurveTo", a); }
  rect(...a: unknown[]): void { this.#rec("rect", a); }
  fill(...a: unknown[]): void { this.#rec("fill", a); }
  stroke(...a: unknown[]): void { this.#rec("stroke", a); }
  fillRect(...a: unknown[]): void { this.#rec("fillRect", a); }
  clearRect(...a: unknown[]): void { this.#rec("clearRect", a); }
  drawImage(...a: unknown[]): void { this.#rec("drawImage", a); }
  putImageData(...a: unknown[]): void { this.#rec("putImageData", a); }
  createImageData(...a: unknown[]): ImageData {
    this.#rec("createImageData", a);
    const w = a[0] as number, h = a[1] as number;
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" } as unknown as ImageData;
  }
  fillText(...a: unknown[]): void { this.#rec("fillText", a); }
  setLineDash(...a: unknown[]): void { this.#rec("setLineDash", a); }
  createRadialGradient(...a: unknown[]): CanvasGradient {
    this.#rec("createRadialGradient", a);
    return { addColorStop() {} } as CanvasGradient;
  }
  count(op: string): number { return this.log.filter((r) => r.op === op).length; }
}

class FakeCanvas implements MinimapHostCanvas {
  readonly ctx: RecordingContext;
  readonly listeners: ((ev: Event) => void)[] = [];
  readonly attrs = new Map<string, string>();
  clientWidth = 0;
  constructor(public width: number, public height: number, readonly label: string) { this.ctx = new RecordingContext(this); }
  getContext(_id: "2d"): MapContext2D { return this.ctx; }
  addEventListener(_t: "click", fn: (ev: Event) => void): void { this.listeners.push(fn); }
  removeEventListener(_t: "click", fn: (ev: Event) => void): void { this.listeners.splice(this.listeners.indexOf(fn), 1); }
  setAttribute(n: string, v: string): void { this.attrs.set(n, v); }
  click(): void { for (const fn of this.listeners) fn({ stopPropagation() {} } as unknown as Event); }
}

/** A Minimap over a real arena (shape, props, outline from the game modules) with a fake canvas factory. */
function rig(seed = 1) {
  const created: FakeCanvas[] = [];
  const host = new FakeCanvas(132, 132, "host");
  const mm = new Minimap(host, {
    cssSizePx: 200, devicePixelRatio: 2,
    createCanvas: (w, h): MapCanvas => { const c = new FakeCanvas(w, h, `layer${created.length}`); created.push(c); return c; },
  });
  const cfg = makeArena({ size: 40, objects: 14, shape: 3 });
  const props = placeObjects(cfg, rng32(seed));
  mm.setWorld({ outline: outline(cfg, 96), walled: true, props, size: cfg.size });
  return { mm, host, created, cfg, props };
}

/** Every PICKUP_KINDS row placed on a 6 m circle around the origin. */
function onePickupOfEachKind(): MinimapPickupLike[] {
  return PICKUP_KINDS.map((def, i) => {
    const a = (i / PICKUP_KINDS.length) * Math.PI * 2;
    return { def, x: Math.cos(a) * 6, z: Math.sin(a) * 6 };
  });
}

Deno.test("HiDPI: backing store = css size × devicePixelRatio", () => {
  const { mm, host } = rig();
  assert(host.width === 400 && host.height === 400, `200 css px × 2 → ${host.width}`);
  mm.resize(132, 3);
  assert(host.width === 396, `132 × 3 → ${host.width}`);
  // A pinned ratio survives a draw even when the live globalThis.devicePixelRatio differs (regression: it used to snap to the live one).
  const g = globalThis as { devicePixelRatio?: number };
  const before = g.devicePixelRatio;
  g.devicePixelRatio = 1;
  try {
    mm.draw(createMinimapView());
    assert(host.width === 396, `pinned dpr overridden by live dpr: ${host.width}`);
  } finally {
    if (before === undefined) delete g.devicePixelRatio;
    else g.devicePixelRatio = before;
  }
});

Deno.test("static layer is baked ONCE across 100 draw() calls", () => {
  const { mm, host, created, props } = rig();
  assert(props.length > 0, "the arena has props");
  assert(created.length === 2, `setWorld made ${created.length} layers (static + relief)`);
  const [staticLayer, reliefLayer] = created;
  const staticCallsAfterBake = staticLayer.ctx.log.length;
  assert(reliefLayer.ctx.count("putImageData") === 1, "relief written once");
  assert(staticLayer.ctx.count("rotate") === props.length, "one rotated glyph per prop");
  const fog = createFog(22, 0.5);
  const view = createMinimapView();
  view.fog = fog;
  view.pickups = onePickupOfEachKind();
  for (let k = 0; k < 100; k++) {
    view.time = k * 0.05;
    view.self.x = -3 + k * 0.05;
    view.self.z = Math.sin(k * 0.1);
    view.rival!.x = 4;
    view.rival!.z = 2;
    view.rivalVisible = k % 3 === 0;
    reveal(fog, view.self.x, view.self.z, 8);
    mm.draw(view);
  }
  assert(mm.bakeCount === 1, `bakeCount ${mm.bakeCount}`);
  assert(staticLayer.ctx.log.length === staticCallsAfterBake, "nothing drawn into the static layer after the bake");
  assert(reliefLayer.ctx.count("putImageData") === 1, "relief still written once");
  assert(created.length === 3, `only the fog layer was added (got ${created.length} layers)`);
  const staticBlits = host.ctx.log.filter((r) => r.op === "drawImage" && r.args[0] === staticLayer).length;
  assert(staticBlits === 100, `static layer composited ${staticBlits}× (expected 100)`);
  assert(created[2].ctx.count("createImageData") === 1, "fog image allocated once");
  assert(created[2].ctx.count("putImageData") === 100, "fog image refreshed per draw");
  assert(mm.stats.draws === 100, "100 draws counted");
});

Deno.test("a marker is drawn for each pickup, each item and both fighters", () => {
  const { mm, host } = rig();
  const view = createMinimapView();
  view.pickups = onePickupOfEachKind();
  view.items = [{ kind: "chest", x: -5, z: 5 }, { kind: "coin", x: 5, z: -5 }, { kind: "shrine", x: 0, z: 8 }];
  view.self.x = -2;
  view.rival!.x = 2;
  view.rivalVisible = true;
  host.ctx.log.length = 0;
  mm.draw(view);
  const st = mm.stats;
  assert(st.pickupsDrawn === PICKUP_KINDS.length, `pickups ${st.pickupsDrawn}/${PICKUP_KINDS.length}`);
  assert(st.itemsDrawn === 3, `items ${st.itemsDrawn}/3`);
  assert(st.selfDrawn && st.rival === "visible" && !st.rivalOffMap, "both fighters on the map");
  const fills = new Set(host.ctx.log.filter((r) => r.op === "fillStyle").map((r) => r.args[0]));
  for (const def of PICKUP_KINDS) assert(fills.has(PICKUP_STYLES[def.id].fill), `no ${def.id} colour drawn`);
  assert(fills.has(MAP_COLOURS.self) && fills.has(MAP_COLOURS.rival), "self and rival arrows drawn");
  // Same view under a fog where nothing has been seen: drops stay hidden, fighters do not.
  view.fog = createFog(22, 0.5);
  view.rivalVisible = false;
  mm.draw(view);
  assert(mm.stats.pickupsDrawn === 0 && mm.stats.itemsDrawn === 0, "unseen drops are hidden");
  assert(mm.stats.selfDrawn, "self always drawn");
});

Deno.test("player-up: the self arrow is drawn pointing straight up", () => {
  const { mm, host } = rig();
  mm.setMode("heading");
  const view = createMinimapView();
  view.self.facingX = 0.6;
  view.self.facingZ = 0.8; // heading south-east-ish
  host.ctx.log.length = 0;
  mm.draw(view);
  const log = host.ctx.log;
  const selfFill = log.findIndex((r) => r.op === "fillStyle" && r.args[0] === MAP_COLOURS.self);
  assert(selfFill > 0, "self arrow drawn");
  let rot = NaN;
  for (let i = selfFill; i >= 0; i--) if (log[i].op === "rotate") { rot = log[i].args[0] as number; break; }
  const wrapped = Math.atan2(Math.sin(rot), Math.cos(rot));
  near(wrapped, -Math.PI / 2, 1e-9, "arrow canvas angle");
});

Deno.test("rival: a ghost that fades when unseen; an edge arrow when off-map", () => {
  const { mm, host } = rig();
  const view = createMinimapView();
  view.rival!.x = 5;
  view.rivalVisible = true;
  view.time = 10;
  mm.draw(view);
  assert(mm.stats.rival === "visible", "visible first");
  view.rivalVisible = false;
  view.rival!.x = -9; // it moved while unseen: the ghost stays where it was last seen
  view.time = 16;
  host.ctx.log.length = 0;
  mm.draw(view);
  assert(mm.stats.rival === "ghost", "ghost when unseen");
  const alphas = host.ctx.log.filter((r) => r.op === "globalAlpha").map((r) => r.args[0] as number);
  assert(alphas.some((a) => Math.abs(a - 0.5) < 1e-9), `6 s into a 12 s fade → α 0.5 (saw ${alphas.join(",")})`);
  assert(host.ctx.log.some((r) => r.op === "fillText" && r.args[0] === "6s"), "ghost age label");
  // Follow mode, rival 18 m away with a 3 m sight range → beyond the zoomed map edge.
  mm.setMode("follow");
  view.sightRange = 3;
  view.rival!.x = 18;
  view.rivalVisible = true;
  view.time = 30;
  mm.draw(view);
  view.time = 31;
  mm.draw(view);
  assert(mm.stats.rival === "visible" && mm.stats.rivalOffMap, "off-map rival clamps to an edge arrow");
});

Deno.test("hit pings expand and expire; path and scale bar are drawn", () => {
  const { mm } = rig();
  const view = createMinimapView();
  view.path = [{ x: 2, z: 2 }, { x: 6, z: 3 }, { x: 8, z: 8 }];
  mm.ping(1, 1, "taken", 0);
  mm.ping(3, 1, "dealt", 0.2);
  view.time = 0.5;
  mm.draw(view);
  assert(mm.stats.pingsDrawn === 2, `pings ${mm.stats.pingsDrawn}`);
  assert(mm.stats.pathPoints === 3, "path drawn");
  assert(mm.stats.scaleBarMetres > 0, "scale bar drawn");
  view.time = 5;
  mm.draw(view);
  assert(mm.stats.pingsDrawn === 0, "pings expired");
});

Deno.test("a click cycles overview → follow → heading → overview and updates the accessible name", () => {
  const { mm, host } = rig();
  assert(mm.mode === "overview", "starts on the overview");
  assert(host.listeners.length === 1, "one click listener");
  host.click();
  assert(mm.mode === "follow", "follow");
  assert(host.attrs.get("aria-label")!.includes("follow"), host.attrs.get("aria-label"));
  host.click();
  assert(mm.mode === "heading", "heading");
  host.click();
  assert(mm.mode === "overview", "back to overview");
  mm.dispose();
  assert(host.listeners.length === 0, "dispose removes the listener");
});

Deno.test("steady state: every draw issues the same number of canvas calls (bounded work per tick)", () => {
  const { mm, host } = rig();
  const view = createMinimapView();
  view.fog = createFog(22, 0.5);
  view.pickups = onePickupOfEachKind();
  reveal(view.fog, 0, 0, 30);
  const counts: number[] = [];
  for (let k = 0; k < 20; k++) {
    view.time = k * 0.05;
    host.ctx.log.length = 0;
    mm.draw(view);
    counts.push(host.ctx.log.length);
  }
  assert(counts.slice(1).every((c) => c === counts[1]), `calls per draw vary: ${counts.join(",")}`);
});
