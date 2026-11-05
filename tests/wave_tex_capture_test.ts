// Wave TEX lane C: the capture HUD + capture helpers (src/graphics/CaptureHud.ts), pure. TX80-89.
import {
  CAPTURE_ANGLES, type CaptureInfo, clipText, diffImages, fitDistance, fmt, HUD_CHAR_W_PER_PX, HUD_FIELDS, hudMaxHeight, hudText,
  layoutHud, orbitDirection, orbitOf, sheetGrid, wrapList,
} from "../src/graphics/CaptureHud.ts";

function assert(ok: boolean, msg = "assertion failed"): void { if (!ok) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  actual:   ${x}\n  expected: ${y}`);
}
function assertAlmostEquals(a: number, b: number, eps: number): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${a} != ${b} (eps ${eps})`);
}

const INFO: CaptureInfo = {
  run: "r01", commit: "19f5c8c9cc0123+47a8e1", dirty: true, buildTime: "2026-11-04T21:00:00Z",
  race: "ork", subrace: "ironhide", sex: "female", className: "Warrior", variant: "marked",
  layers: [{ name: "skin", ops: "albedo:normal roughness:replace" }, { name: "wash", ops: "albedo:multiply", opacity: 0.4 }, { name: "varnish", ops: "roughness:min", enabled: false }],
  layerSource: "rig.material.stack",
  marks: [{ kind: "scar:claw", detail: "torsoL 130mm 30d" }, { kind: "tattoo:band", detail: "serpent foreArmL 55mm" }],
  marksDecals: 2,
  marksCovered: 1,
  channel: "roughness", light: "studio", lightDetail: "PreviewStage key",
  camera: { angle: "front-left-3q", yawDeg: 45.04, pitchDeg: -0.01, distanceM: 4.567, fovDeg: 24 },
  triangles: 10748.4, buildMs: 812.26, frameMs: 2.345,
};

Deno.test("TX80: the HUD prints every contract field, in HUD_FIELDS order", () => {
  const t = hudText(INFO, 200);
  const order = [...new Set(t.map((l) => l.field))];
  assertEquals(order, [...HUD_FIELDS]);
  const all = t.map((l) => l.text).join("\n");
  for (const s of ["commit 19f5c8c9cc+47a8e1 dirty", "2026-11-04T21:00:00Z", "ork/ironhide female Warrior", "variant marked", "layers(3 rig.material.stack) ", "skin albedo:normal roughness:replace",
    "wash albedo:multiply @0.40", "(off) varnish", "marks(2 req, 2 decals, 1 under garment) scar:claw torsoL 130mm 30d", "view roughness", "light studio PreviewStage key",
    "cam front-left-3q yaw 45.0 pitch 0.0 dist 4.57m fov 24.0", "tris 10748", "build 812.3ms frame 2.35ms"]) {
    assert(all.includes(s), `missing "${s}" in\n${all}`);
  }
});

Deno.test("TX81: no line is wider than the band, for any width (fuzz)", () => {
  const many: CaptureInfo = { ...INFO, layers: Array.from({ length: 40 }, (_, i) => ({ name: `layer-${i}-with-a-long-name`, ops: "albedo:softLight height:heightBlend" })), marks: Array.from({ length: 12 }, (_, i) => ({ kind: "tattoo:dotwork", detail: `x${i}` })) };
  for (let w = 60; w <= 900; w += 37) for (const f of [8, 10, 13]) {
    const lay = layoutHud(many, w, f, 3);
    for (const l of lay.lines) {
      assert(l.text.length <= lay.maxChars, `w=${w} f=${f}: ${l.text.length} > ${lay.maxChars}`);
      assert(l.x + l.text.length * f * HUD_CHAR_W_PER_PX <= w + 1e-9 || lay.maxChars === 8, `overflow at w=${w}`);
      assert(l.y <= lay.height, "line below the band");
    }
    assert(lay.height <= hudMaxHeight(f, 3), `band ${lay.height} > max ${hudMaxHeight(f, 3)}`);
  }
});

Deno.test("TX82: wrapList keeps whole items, caps lines and counts what it hid", () => {
  assertEquals(wrapList("marks(0) ", [], 40, 2), ["marks(0) none"]);
  assertEquals(wrapList("L ", ["a", "b"], 40, 2), ["L a; b"]);
  const items = Array.from({ length: 20 }, (_, i) => `item${i}`);
  const lines = wrapList("layers(20) ", items, 30, 2);
  assertEquals(lines.length, 2);
  const shown = lines.join(" ").match(/item\d+/g)!.length;
  const more = Number(/\+(\d+) more$/.exec(lines[1])![1]);
  assertEquals(shown + more, 20, lines.join(" / "));
  for (const l of lines) assert(l.length <= 30);
  // one item longer than the line: clipped, never lost from the count
  const long = wrapList("p ", ["x".repeat(100), "y"], 20, 3);
  assert(long[0].endsWith("…") && long[0].length === 20);
});

Deno.test("TX83: clipText and fmt are total", () => {
  assertEquals(clipText("abcdef", 4), "abc…");
  assertEquals(clipText("abc", 4), "abc");
  assertEquals(clipText("abc", 0), "");
  assertEquals(clipText("abc", 1), "…");
  assertEquals(fmt(-0.0001, 1), "0.0");
  assertEquals(fmt(-0.04, 1), "0.0");
  assertEquals(fmt(-0.06, 1), "-0.1");
  assertEquals(fmt(NaN), "-");
  assertEquals(fmt(Infinity), "-");
});

Deno.test("TX84: the dirty flag paints the commit line in the warn colour; layout is deterministic", () => {
  const a = layoutHud(INFO, 420), b = layoutHud(INFO, 420);
  assertEquals(a, b);
  const commit = a.lines.find((l) => l.field === "commit")!;
  const clean = layoutHud({ ...INFO, dirty: false }, 420).lines.find((l) => l.field === "commit")!;
  assert(commit.colour !== clean.colour);
  assert(!clean.text.includes("dirty"));
  // baselines strictly increase
  for (let i = 1; i < a.lines.length; i++) assert(a.lines[i].y > a.lines[i - 1].y);
});

Deno.test("TX85: orbitDirection and orbitOf are inverses; yaw +90 is the body's left (+X)", () => {
  for (let yaw = -180; yaw < 180; yaw += 15) for (const pitch of [-60, -5, 0, 8, 45, 85]) {
    const d = orbitDirection(yaw, pitch);
    assertAlmostEquals(Math.hypot(...d), 1, 1e-12);
    const o = orbitOf([d[0] * 3 + 1, d[1] * 3 + 2, d[2] * 3 - 1], [1, 2, -1]);
    assertAlmostEquals(o.distanceM, 3, 1e-9);
    assertAlmostEquals(o.pitchDeg, pitch, 1e-9);
    assertAlmostEquals(((o.yawDeg - yaw) % 360 + 540) % 360 - 180, 0, 1e-9);
  }
  const left = orbitDirection(90, 0);
  assertAlmostEquals(left[0], 1, 1e-12);
  assertEquals(orbitOf([0, 0, 0], [0, 0, 0]).distanceM, 0);
});

Deno.test("TX86: the angle set covers the brief (7 views + face/forearm/back close-ups), ids unique", () => {
  const ids = CAPTURE_ANGLES.map((a) => a.id);
  assertEquals(new Set(ids).size, ids.length);
  for (const id of ["front", "back", "left", "right", "front-left-3q", "back-right-3q", "top"]) assert(ids.includes(id), id);
  assertEquals(CAPTURE_ANGLES.filter((a) => a.closeUp).map((a) => a.closeUp).sort(), ["back", "face", "forearm"]);
  // fitDistance: the sphere subtends the fov (with margin 1)
  const d = fitDistance(1, 24, 1);
  assertAlmostEquals(Math.asin(1 / d) * 2 * 180 / Math.PI, 24, 1e-9);
});

Deno.test("TX87: diffImages — identical images read 0, a changed block reads its exact share and box", () => {
  const W = 64, H = 48;
  const a = new Uint8ClampedArray(W * H * 4).fill(100);
  assertEquals(diffImages(a, a.slice(), W, H), { changed: 0, total: W * H, changedPct: 0, meanAbs: 0, boxes: [] });
  const b = a.slice();
  for (let y = 10; y < 20; y++) for (let x = 30; x < 45; x++) { const i = (y * W + x) * 4; b[i] = 200; }
  const d = diffImages(a, b, W, H, { threshold: 16, cell: 8, minPixels: 1 });
  assertEquals(d.changed, 150);
  assertAlmostEquals(d.changedPct, 100 * 150 / (W * H), 1e-3);
  assertEquals(d.boxes.length, 1);
  assertEquals([d.boxes[0].x0, d.boxes[0].y0, d.boxes[0].x1, d.boxes[0].y1, d.boxes[0].pixels], [30, 10, 44, 19, 150]);
  // below threshold: not a change (mean of 3 channels: 40/3 < 16)
  const c = a.slice(); c[0] = 140;
  assertEquals(diffImages(a, c, W, H).changed, 0);
});

Deno.test("TX88: diffImages separates distant regions, drops specks below minPixels, is symmetric", () => {
  const W = 96, H = 96;
  const a = new Uint8ClampedArray(W * H * 4);
  const b = a.slice();
  const paint = (x0: number, y0: number, n: number) => { for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) b[(y * W + x) * 4 + 1] = 255; };
  paint(2, 2, 6); paint(70, 70, 10); b[(50 * W + 50) * 4 + 2] = 255; // a 1-px speck
  const d = diffImages(a, b, W, H, { cell: 16, minPixels: 4 });
  assertEquals(d.changed, 36 + 100 + 1);
  assertEquals(d.boxes.map((x) => x.pixels), [100, 36]);
  const r = diffImages(b, a, W, H, { cell: 16, minPixels: 4 });
  assertEquals(r.boxes, d.boxes);
  let threw = false;
  try { diffImages(a, b, W + 1, H); } catch { threw = true; }
  assert(threw, "size mismatch must throw");
});

Deno.test("TX89: sheetGrid lays cells row-major without overlap inside the sheet", () => {
  const g = sheetGrid(10, 4, 100, 150, 28, 4);
  assertEquals(g.cells.length, 10);
  assertEquals(g.width, 4 + 4 * 104);
  assertEquals(g.height, 28 + 4 + 3 * 154);
  for (const c of g.cells) assert(c.x + c.w <= g.width && c.y + c.h <= g.height && c.y >= 28);
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    const p = g.cells[i], q = g.cells[j];
    assert(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `cells ${i} ${j} overlap`);
  }
  assertEquals(sheetGrid(0, 5, 10, 10).cells.length, 0);
  assertEquals(sheetGrid(3, 7, 10, 10).width, 4 + 3 * 14); // fewer tiles than cols: the sheet shrinks
});
