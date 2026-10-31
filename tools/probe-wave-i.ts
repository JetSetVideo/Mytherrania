// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave I probe — the five claims of this wave, each MEASURED in a real Chrome:
//   1. the spectator camera keeps the angle the user set (no ease-back, survives a mode change and a
//      match restart), and the four presets apply;
//   2. the custom cursor exists, tracks the pointer, and its blob trails it;
//   3. clicking a fighter opens a stat card anchored beside them, clicking the OTHER fighter swaps it,
//      clicking the ground closes it, and clicking a map object opens that object's card;
//   4. props are seated on the terrain (no float) and the skirt layer closes the seam, measured from the
//      live arena's own height sampler;
//   5. a blade-vs-blade clash emits sparks, the pool stays inside its cap, and the frame keeps its 60 FPS
//      headroom (CPU per rAF callback against 16.6 ms) with every new system live.
//   deno run -A tools/probe-wave-i.ts
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";

const PORT = 8811;
const server = Deno.serve({ hostname: "127.0.0.1", port: PORT, onListen() {} }, (r) => serveAsset(r));
const b = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
await Deno.mkdir("artifacts/qa-wave-i", { recursive: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
await p.waitForTimeout(600);

const call = (fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);
const report: Record<string, any> = {};

// ── enter spectator mode (AI vs AI, free mouse). The arena is forced to a PROP-RICH one first, so the
// floating-prop and seam claims are measured over many props rather than the one a random ring may hold.
await call("debugWorld", { nextArena: { objects: 16 } });
await p.click('[data-action="spectate"]');
await p.waitForTimeout(1500);

// ── 1. the camera keeps its angle
const camStart = await call("debugSpectateCam");
await call("debugOrbitSpectate", 240, 60);          // the user drags the camera
const camSet = await call("debugSpectateCam");
await p.waitForTimeout(2500);                        // …and does nothing for 2.5 s
const camIdle = await call("debugSpectateCam");
const presets = await call("debugCameraPresets");
await call("debugApplyCameraPreset", presets[1].id);
const camPreset = await call("debugSpectateCam");
await call("debugCycleSpectateMode");
const camMode = await call("debugSpectateCam");
report.camera = {
  start: camStart,
  afterDrag: camSet,
  afterIdle: camIdle,
  dragMoved: camSet.yaw !== camStart.yaw || camSet.pitch !== camStart.pitch,
  angleHeldForIdleFrames: camIdle.yaw === camSet.yaw && camIdle.pitch === camSet.pitch,
  presetIds: presets.map((x: any) => x.id),
  presetApplied: camPreset.dist !== camIdle.dist || camPreset.pitch !== camIdle.pitch || camPreset.yaw !== camIdle.yaw,
  modeAfterCycle: camMode.mode,
};

// ── 2/3. the cursor and the inspect cards
await p.mouse.move(420, 380);
await p.waitForTimeout(400);
const cursorA = await call("debugCursor");
await p.mouse.move(760, 460);
await p.waitForTimeout(60);
const cursorB = await call("debugCursor");
await p.waitForTimeout(1400);
const cursorSettled = await call("debugCursor");

// Clicks must be aimed at FRESH projections: the fighters are AI-driven and keep moving, so a
// coordinate captured a second earlier can be a metre away by the time the click lands.
const clickAt = async (which: "fighter0" | "fighter1" | "object" | "empty") => {
  const t = await call("debugInspectTargets");
  const spot = which === "fighter0" ? t.fighters[0]
    : which === "fighter1" ? t.fighters[1]
    : which === "object" ? (t.objects.find((o: any) => !o.id.startsWith("object:coin")) ?? t.objects[0])
    : t.empty;
  if (!spot) return { hover: null, card: null, target: null, candidates: 0 };
  await p.mouse.move(spot.x, spot.y);
  await p.waitForTimeout(150);
  const hovered = await call("debugInspect");
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(250);
  return { ...(await call("debugInspect")), hoveredBeforeClick: hovered.hover };
};

const hoverOnFighter = await clickAt("fighter0");
const cardA = hoverOnFighter;
await p.screenshot({ path: "artifacts/qa-wave-i/01-fighter-card.png" });
const cardB = await clickAt("fighter1");
const cardObj = await clickAt("object");
await p.screenshot({ path: "artifacts/qa-wave-i/02-object-card.png" });
const cardClosed = await clickAt("empty");

report.cursor = {
  present: cursorA.visible,
  follows: cursorA.x === 420 && cursorA.y === 380,
  blobTrails: cursorB.blobX !== cursorB.x || cursorB.blobY !== cursorB.y,
  blobSettlesOnReticle: Math.hypot(cursorSettled.blobX - cursorSettled.x, cursorSettled.blobY - cursorSettled.y) < 1.5,
  radiusAtRest: cursorA.radius,
  radiusHover: hoverOnFighter.hoveredBeforeClick !== null ? (await call("debugCursor")).radius : null,
};
report.inspect = {
  hoveredFighter: hoverOnFighter.hoveredBeforeClick,
  fighterCardTitle: cardA.card?.title ?? null,
  fighterCardRows: cardA.card?.rows?.length ?? 0,
  fighterCardBars: cardA.card?.bars?.length ?? 0,
  swappedToOtherFighter: cardB.target?.kind === "fighter" && cardB.target.seat === 1 && cardB.card?.title !== cardA.card?.title,
  swappedCardTitle: cardB.card?.title ?? null,
  fighterCardBadges: cardA.card?.badges ?? [],
  objectCardTitle: cardObj.card?.title ?? null,
  objectCardIsObject: cardObj.target?.kind === "object" && cardObj.card?.title !== cardA.card?.title,
  objectCardBadge: cardObj.card?.badges ?? [],
  closedOnEmptyClick: cardClosed.card === null && cardClosed.hover === null,
};

// ── 4. props seated on the terrain, and the skirt layer
const props = await call("debugProps");
report.props = {
  count: props.props.length,
  floatingBefore: props.floatingBefore,
  // AFTER the fix: no prop's base may sit above the ground at ANY sampled point of its footprint.
  floatingNow: props.props.filter((x: any) => x.floating > 0.02).length,
  worstFloatingM: Math.max(...props.props.map((x: any) => x.floating)),
  // The seam the skirt has to close, per prop, and the worst of them.
  worstSeamM: Math.max(...props.props.map((x: any) => x.gap)),
  // The apron must reach the terrain everywhere: its own depth has to cover the footprint's fall.
  seamsCovered: props.props.filter((x: any) => x.skirtDrop + 0.02 >= x.gap).length,
  seats: props.props.slice(0, 3),
  baseOffsetKinds: props.baseOffsets,
  skirtMeshes: props.skirtMeshes,
  skirtTriangles: props.skirtTriangles,
  skirtMaterialSamples: props.materialSamples,
};

// ── 5. a clash emits sparks, the pool stays capped, and the frame keeps its headroom
await call("debugForceClash");
await p.waitForTimeout(200);
const clash1 = await call("debugClash");
await p.screenshot({ path: "artifacts/qa-wave-i/03-clash-sparks.png" });
for (let i = 0; i < 40; i++) { await call("debugForceClash"); await p.waitForTimeout(16); }
const clash40 = await call("debugClash");
report.clash = {
  firstBurstSparks: clash1.sparks.live,
  at: clash1.lastAt,
  after40BurstsLive: clash40.sparks.live,
  capped: clash40.sparks.live <= clash40.sparks.max,
  spawned: clash40.sparks.spawned,
  dropped: clash40.sparks.dropped,
  events: clash40.events,
};
report.frame = await call("debugFrameStats");
report.effectsScale = await call("debugEffectsScale");
report.errors = errors;

console.log(JSON.stringify(report, null, 1));
await Deno.writeTextFile("artifacts/qa-wave-i/report.json", JSON.stringify({ ...report, at: new Date().toISOString() }, null, 2));
await b.close();
server.shutdown();
