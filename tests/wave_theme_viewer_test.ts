// Wave THEME lane V — the Creator viewer's camera math and axis gizmo (SPEC TH20-TH39). Pure modules: no DOM, no GL.
// @deno-types="@types/three"
import * as THREE from "three";
import {
  AXIS_IDS, type AxisId, cameraBasis, cameraPosition, clampState, cursorPointAtTargetDepth, orbit, ORBIT_RAD_PER_100PX, pinchFactor,
  PINCH_GAIN, projectNdc, reset, SNAP_POLE_EPS, snapTo, type Vec3, viewDirection, type ViewLimits, type ViewState, WHEEL_GAIN, wheelFactor,
  zoomAt, ZOOM_STEP_MAX,
} from "../src/graphics/ViewerControls.ts";
import { GIZMO_AVOID_MIN_PX, GIZMO_CLEAR_PX, GIZMO_COLOURS, GIZMO_INSET_PX, GIZMO_MAX_PX, GIZMO_MIN_PX, gizmoLayout, gizmoPlacement, gizmoSize, pickAxis } from "../src/graphics/AxisGizmo.ts";
import { seededRng } from "../src/game/Items.ts";

// The repo's tests carry local asserts (no std dependency).
function assert(c: unknown, msg = "assertion failed"): asserts c {
  if (!c) throw new Error(msg);
}
function assertAlmostEquals(a: number, b: number, eps: number, msg = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg} expected ${a} ~ ${b} (eps ${eps})`);
}
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${x} to equal ${y}`);
}

const W = 1280, H = 800; // a canvas, css px: NDC error -> px error
const LIM: ViewLimits = {
  pitchMin: -0.45, pitchMax: 1.15, distMin: 0.6, distMax: 8.4, floorY: 0.25,
  targetMin: [-0.9, 0, -0.9], targetMax: [0.9, 2.6, 0.9], fovDeg: 38, aspect: W / H,
};
const HOME: ViewState = { yaw: 0.55, pitch: 0.18, distance: 5.2, target: [0, 0.72, 0] };
const px = (a: [number, number], b: [number, number]) => Math.hypot(((a[0] - b[0]) / 2) * W, ((a[1] - b[1]) / 2) * H);
const AXIS: Record<AxisId, Vec3> = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1] };
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A seeded random state inside the limits and a model-ish point in front of the camera. */
function randomCase(rng: () => number): { s: ViewState; hit: Vec3; ndc: [number, number] } {
  const s = clampState({ yaw: (rng() * 2 - 1) * Math.PI, pitch: -0.3 + rng() * 1.3, distance: 1 + rng() * 6, target: [rng() * 0.6 - 0.3, 0.4 + rng() * 1.4, rng() * 0.6 - 0.3] }, LIM, HOME);
  const hit: Vec3 = [rng() * 0.6 - 0.3, 0.1 + rng() * 1.8, rng() * 0.6 - 0.3];
  return { s, hit, ndc: projectNdc(s, LIM, hit) };
}

Deno.test("SPEC TH20: orbit turns 0.6 rad per 100 px, yaw wraps into (-pi, pi]", () => {
  const s = orbit(HOME, 100, 0, LIM);
  assertAlmostEquals(s.yaw - HOME.yaw, ORBIT_RAD_PER_100PX, 1e-12);
  assertEquals(ORBIT_RAD_PER_100PX, 0.6);
  let w = HOME;
  for (let i = 0; i < 50; i++) { w = orbit(w, 333, 0, LIM); assert(w.yaw > -Math.PI - 1e-12 && w.yaw <= Math.PI + 1e-12, `yaw wrapped ${w.yaw}`); }
  assertAlmostEquals(orbit(HOME, 0, 20, LIM).pitch, HOME.pitch - 0.12, 1e-12); // dragging down lowers the camera
});

Deno.test("SPEC TH21: orbit pitch stays inside [pitchMin, pitchMax]", () => {
  assertAlmostEquals(orbit(HOME, 0, -10000, LIM).pitch, LIM.pitchMax, 1e-12);
  const low = orbit(HOME, 0, 10000, LIM);
  assert(low.pitch >= LIM.pitchMin - 1e-12, `low pitch ${low.pitch}`);
});

Deno.test("SPEC TH22: orbiting never takes the camera below floorY", () => {
  const rng = seededRng(2201);
  let s: ViewState = HOME;
  for (let i = 0; i < 2000; i++) {
    s = orbit(s, (rng() - 0.5) * 400, (rng() - 0.5) * 400, LIM);
    assert(cameraPosition(s)[1] >= LIM.floorY - 1e-9, `camera y ${cameraPosition(s)[1]} at step ${i}`);
  }
});

Deno.test("SPEC TH23: the pitch clamp is soft after a pole snap: no jump, only movement back toward the band", () => {
  const top = snapTo(HOME, "+Y");
  assert(top.pitch > LIM.pitchMax);
  assertEquals(orbit(top, 0, -100, LIM).pitch, top.pitch, "may not move further out");
  assertAlmostEquals(orbit(top, 0, 10, LIM).pitch, top.pitch - 0.06, 1e-12);
  const bottom = snapTo(HOME, "-Y");
  assertEquals(orbit(bottom, 0, 100, LIM).pitch, bottom.pitch);
  assert(orbit(bottom, 0, -10, LIM).pitch > bottom.pitch);
});

Deno.test("SPEC TH24: zoomAt keeps the hit point under the cursor (<= 2 px on a 1280x800 canvas; measured ~1e-10 px)", () => {
  const rng = seededRng(2402);
  let worst = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const { s, hit, ndc } = randomCase(rng);
    if (Math.abs(ndc[0]) > 1 || Math.abs(ndc[1]) > 1 || !Number.isFinite(ndc[0])) continue;
    for (const f of [0.5, 0.8, 0.95, 1.1, 1.4]) {
      const z = zoomAt(s, f, ndc[0], ndc[1], LIM, hit);
      const box = z.target.every((t, k) => t > LIM.targetMin[k] + 1e-9 && t < LIM.targetMax[k] - 1e-9);
      if (!box) continue; // TH28 measures the box-bound case
      worst = Math.max(worst, px(projectNdc(z, LIM, hit), ndc)); n++;
    }
  }
  assert(n > 500, `cases ${n}`);
  assert(worst <= 2, `worst drift ${worst} px`);
  assert(worst < 1e-6, `the homothety is exact (worst ${worst} px)`);
});

Deno.test("SPEC TH25: zoomAt without a hit uses the cursor ray at the target's depth, and that point stays put", () => {
  const rng = seededRng(2503);
  for (let i = 0; i < 200; i++) {
    const { s } = randomCase(rng);
    const nx = rng() * 1.6 - 0.8, ny = rng() * 1.6 - 0.8;
    const p = cursorPointAtTargetDepth(s, LIM, nx, ny);
    const q = projectNdc(s, LIM, p);
    assert(px(q, [nx, ny]) < 1e-6, "the ray point projects to the cursor");
    const z = zoomAt(s, 0.7, nx, ny, LIM, null);
    if (z.target.some((t, k) => t <= LIM.targetMin[k] + 1e-9 || t >= LIM.targetMax[k] - 1e-9)) continue;
    assert(px(projectNdc(z, LIM, p), [nx, ny]) < 1e-6);
  }
  // At the centre with no hit, the zoom is a pure dolly: the target does not move.
  const c = zoomAt(HOME, 0.5, 0, 0, LIM, null);
  c.target.forEach((t, k) => assertAlmostEquals(t, HOME.target[k], 1e-9));
});

Deno.test("SPEC TH26: zoom distance clamps to [distMin, distMax], and a clamped zoom still keeps the point", () => {
  let s = HOME;
  const hit: Vec3 = [0.05, 1.1, 0.1], ndc = projectNdc(HOME, LIM, hit);
  for (let i = 0; i < 40; i++) s = zoomAt(s, 0.7, ndc[0], ndc[1], LIM, hit);
  assertAlmostEquals(s.distance, LIM.distMin, 1e-12);
  assert(px(projectNdc(s, LIM, hit), ndc) < 1e-6, "the clamped step is still a homothety");
  for (let i = 0; i < 40; i++) s = zoomAt(s, 1.4, 0, 0, LIM, null);
  assertAlmostEquals(s.distance, LIM.distMax, 1e-12);
  assertEquals(zoomAt(s, 1.4, 0, 0, LIM, null).distance, LIM.distMax, "a zoom past the clamp is a no-op");
});

Deno.test("SPEC TH27: one wheel step zooms at most ZOOM_STEP_MAX either way", () => {
  assertAlmostEquals(zoomAt(HOME, 1e-6, 0, 0, LIM).distance, HOME.distance / ZOOM_STEP_MAX, 1e-9);
  assertAlmostEquals(zoomAt(HOME, 1e6, 0, 0, LIM).distance, Math.min(LIM.distMax, HOME.distance * ZOOM_STEP_MAX), 1e-9);
  assertEquals(zoomAt(HOME, NaN, 0, 0, LIM).distance, HOME.distance, "NaN factor = no zoom");
});

Deno.test("SPEC TH28: the target never leaves its box (and zooming at the edge of the frame stays bounded)", () => {
  const rng = seededRng(2804);
  let s = HOME;
  for (let i = 0; i < 300; i++) {
    s = zoomAt(s, 0.6 + rng() * 0.9, rng() * 2 - 1, rng() * 2 - 1, LIM, rng() < 0.5 ? null : [rng() * 4 - 2, rng() * 4 - 1, rng() * 4 - 2]);
    s.target.forEach((t, k) => assert(t >= LIM.targetMin[k] - 1e-12 && t <= LIM.targetMax[k] + 1e-12, `target ${s.target}`));
    assert(s.distance >= LIM.distMin && s.distance <= LIM.distMax);
  }
});

Deno.test("SPEC TH29: zoom in then out by the inverse factor at the same cursor returns to the start", () => {
  const hit: Vec3 = [0.06, 1.0, 0.1], ndc = projectNdc(HOME, LIM, hit);
  const a = zoomAt(HOME, 0.8, ndc[0], ndc[1], LIM, hit);
  const b = zoomAt(a, 1 / 0.8, ndc[0], ndc[1], LIM, hit);
  assertAlmostEquals(b.distance, HOME.distance, 1e-9);
  b.target.forEach((t, k) => assertAlmostEquals(t, HOME.target[k], 1e-9));
});

Deno.test("SPEC TH30: wheelFactor — up zooms in, Mac pinch (ctrl) has the larger gain, lines/pages scale, clamped, total", () => {
  assert(wheelFactor(-100, 0, false) < 1 && wheelFactor(100, 0, false) > 1);
  assertAlmostEquals(wheelFactor(100, 0, false), Math.exp(100 * WHEEL_GAIN), 1e-12);
  assertAlmostEquals(wheelFactor(10, 0, true), Math.exp(10 * PINCH_GAIN), 1e-12);
  assert(PINCH_GAIN > WHEEL_GAIN * 4, "pinch deltas are small: a larger gain");
  assertAlmostEquals(wheelFactor(3, 1, false), wheelFactor(48, 0, false), 1e-12);
  assertEquals(wheelFactor(1e6, 0, true), ZOOM_STEP_MAX);
  assertEquals(wheelFactor(-1e6, 2, false), 1 / ZOOM_STEP_MAX);
  assertEquals(wheelFactor(NaN, 0, false), 1);
});

Deno.test("SPEC TH31: pinchFactor — fingers apart zooms in by the spread ratio; degenerate spreads are no-ops", () => {
  assertAlmostEquals(pinchFactor(100, 125), 0.8, 1e-12);
  assertAlmostEquals(pinchFactor(125, 100), 1.25, 1e-12);
  assertEquals(pinchFactor(0, 50), 1);
  assertEquals(pinchFactor(50, 0), 1);
  assertEquals(pinchFactor(10, 1000), 1 / ZOOM_STEP_MAX);
});

Deno.test("SPEC TH32: snapTo each of the 6 axes looks along it (camera on that side), distance and target kept", () => {
  for (const id of AXIS_IDS) {
    const s = snapTo(HOME, id);
    const d = viewDirection(s), a = AXIS[id];
    assert(dot(d, a) < -Math.cos(SNAP_POLE_EPS) + 1e-9, `${id}: view dir ${d}`);
    const cam = cameraPosition(s), off: Vec3 = [cam[0] - s.target[0], cam[1] - s.target[1], cam[2] - s.target[2]];
    assert(dot(off, a) > s.distance * 0.999, `${id}: the camera stands on the ${id} side`);
    assertEquals(s.distance, HOME.distance);
    assertEquals(s.target, HOME.target);
  }
});

Deno.test("SPEC TH33: a pole snap has a finite, orthonormal camera basis", () => {
  for (const id of ["+Y", "-Y"] as AxisId[]) {
    const { fwd, right, up } = cameraBasis(snapTo(HOME, id));
    for (const v of [fwd, right, up]) { assert(v.every(Number.isFinite)); assertAlmostEquals(Math.hypot(...v), 1, 1e-9); }
    assertAlmostEquals(dot(fwd, right), 0, 1e-9); assertAlmostEquals(dot(fwd, up), 0, 1e-9); assertAlmostEquals(dot(right, up), 0, 1e-9);
  }
});

Deno.test("SPEC TH34: reset returns a fresh copy of home", () => {
  const r = reset(HOME);
  assertEquals(r, HOME);
  r.target[0] = 99; r.yaw = 3;
  assertEquals(HOME.target[0], 0, "home is not aliased");
});

Deno.test("SPEC TH35: clampState is total (garbage in -> a valid state)", () => {
  const bad = [{ yaw: NaN, pitch: Infinity, distance: -5, target: [NaN, 1e9, -1e9] }, { yaw: 1e9, pitch: -9, distance: 1e9, target: [0, 0, 0] }] as unknown as ViewState[];
  for (const b of bad) {
    const s = clampState(b, LIM, HOME);
    assert([s.yaw, s.pitch, s.distance, ...s.target].every(Number.isFinite), JSON.stringify(s));
    assert(s.distance >= LIM.distMin && s.distance <= LIM.distMax);
    assert(s.pitch >= LIM.pitchMin - 1e-12 && s.pitch <= LIM.pitchMax + 1e-12);
    assert(cameraPosition(s)[1] >= LIM.floorY - 1e-9);
  }
});

Deno.test("SPEC TH36: deterministic and pure — the same input sequence gives identical states; inputs are not mutated", () => {
  const run = () => {
    const rng = seededRng(3606);
    let s = reset(HOME);
    const trace: ViewState[] = [];
    for (let i = 0; i < 200; i++) {
      const k = rng();
      s = k < 0.4 ? orbit(s, rng() * 80 - 40, rng() * 80 - 40, LIM) : k < 0.8 ? zoomAt(s, wheelFactor(rng() * 200 - 100, 0, rng() < 0.5), rng() * 2 - 1, rng() * 2 - 1, LIM) : k < 0.9 ? snapTo(s, AXIS_IDS[Math.floor(rng() * 6)]) : reset(HOME);
      trace.push(s);
    }
    return trace;
  };
  assertEquals(run(), run());
  const frozen = JSON.stringify(HOME);
  orbit(HOME, 10, 10, LIM); zoomAt(HOME, 0.5, 0.3, 0.2, LIM, [0, 1, 0]); snapTo(HOME, "+X"); clampState(HOME, LIM);
  assertEquals(JSON.stringify(HOME), frozen);
});

Deno.test("SPEC TH37: the pure projection matches THREE's PerspectiveCamera with lookAt", () => {
  const rng = seededRng(3707);
  for (let i = 0; i < 100; i++) {
    const { s, hit } = randomCase(rng);
    const cam = new THREE.PerspectiveCamera(LIM.fovDeg, LIM.aspect, 0.1, 50);
    const p = cameraPosition(s);
    cam.position.set(p[0], p[1], p[2]); cam.lookAt(s.target[0], s.target[1], s.target[2]); cam.updateMatrixWorld(true);
    const v = new THREE.Vector3(...hit).project(cam);
    const q = projectNdc(s, LIM, hit);
    assert(px([v.x, v.y], q) < 1e-6, `case ${i}: three ${v.x},${v.y} vs pure ${q}`);
  }
});

Deno.test("SPEC TH38: gizmo — X red, Y yellow, Z green; turns with the camera; each end is clickable at its centre", () => {
  assertEquals(GIZMO_COLOURS.X, "#e0443a");
  assertEquals(GIZMO_COLOURS.Y.toLowerCase(), "#e8c62e");
  assertEquals(GIZMO_COLOURS.Z.toLowerCase(), "#3fae4f");
  assertEquals(gizmoSize(100), GIZMO_MIN_PX); assertEquals(gizmoSize(5000), GIZMO_MAX_PX); assertEquals(gizmoSize(400), 80);
  const L = gizmoLayout(HOME, 80);
  assertEquals(L.length, 6);
  const by = Object.fromEntries(L.map((e) => [e.id, e]));
  assert(by["+Y"].y < 40 && by["-Y"].y > 40, "+Y points up on screen");
  assertAlmostEquals(by["+X"].x - 40, -(by["-X"].x - 40), 1e-9);
  for (const e of L) assertEquals(e.colour, GIZMO_COLOURS[e.id[1] as "X" | "Y" | "Z"]);
  for (let i = 1; i < L.length; i++) assert(L[i].depth >= L[i - 1].depth, "drawn back to front");
  for (const id of AXIS_IDS) {
    const lay = gizmoLayout(HOME, 64), e = lay.find((x) => x.id === id)!;
    assertEquals(pickAxis(lay, e.x, e.y), id, `${id} clickable at its centre on a 64 px gizmo`);
  }
  assertEquals(pickAxis(L, 2, 2), null, "the corner is not an axis");
  // After a +X snap, +X points at the viewer (centre, front-most).
  const S = gizmoLayout(snapTo(HOME, "+X"), 80), px0 = S.find((e) => e.id === "+X")!;
  assertAlmostEquals(px0.x, 40, 1e-9); assertAlmostEquals(px0.y, 40, 1e-9); assertAlmostEquals(px0.depth, 1, 1e-12);
  assertEquals(S[S.length - 1].id, "+X");
});

Deno.test("SPEC TH39: gizmo placement — top-right when free, shrinks then slides left to avoid controls; never overlaps", () => {
  const host = { left: 100, top: 50, right: 500, bottom: 600 };
  const free = gizmoPlacement(host, 80, []);
  assertEquals(free, { left: 500 - GIZMO_INSET_PX - 80, top: 50 + GIZMO_INSET_PX, size: 80 });
  const col = { left: 450, top: 125, right: 494, bottom: 400 }; // a socket column starting 75 px below the top
  const shrunk = gizmoPlacement(host, 80, [col]);
  assert(shrunk.size < 80 && shrunk.size >= GIZMO_AVOID_MIN_PX && shrunk.top + shrunk.size + GIZMO_CLEAR_PX <= col.top, `>= 6 px clear ${JSON.stringify(shrunk)}`);
  const tall = { left: 450, top: 40, right: 494, bottom: 400 };
  const slid = gizmoPlacement(host, 80, [tall]);
  assertEquals(slid.size, 80);
  assert(slid.left + slid.size + GIZMO_CLEAR_PX <= tall.left, JSON.stringify(slid));
  // A sticky nav floating over the viewer's top: the gizmo moves below it, still at the right.
  const nav = { left: 0, top: 0, right: 2000, bottom: 90 };
  const below = gizmoPlacement(host, 80, [], [nav]);
  assertEquals(below, { left: 500 - GIZMO_INSET_PX - 80, top: 90 + GIZMO_INSET_PX, size: 80 });
  assertEquals(gizmoPlacement(host, 80, [], [{ left: 0, top: 700, right: 2000, bottom: 760 }]).top, 50 + GIZMO_INSET_PX, "a cover elsewhere changes nothing");
  const rng = seededRng(3909);
  for (let i = 0; i < 300; i++) {
    const obs = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => { const l = 100 + rng() * 380, t = 50 + rng() * 200; return { left: l, top: t, right: l + 20 + rng() * 60, bottom: t + 20 + rng() * 200 }; });
    const p = gizmoPlacement(host, 80, obs);
    if (p.left <= host.left + GIZMO_INSET_PX + 1e-9) continue; // pinned at the left edge: no room (reported, not asserted)
    const d = GIZMO_CLEAR_PX - 1e-9;
    for (const o of obs) assert(!(o.left - d < p.left + p.size && o.right + d > p.left && o.top - d < p.top + p.size && o.bottom + d > p.top), `case ${i} within ${GIZMO_CLEAR_PX} px`);
  }
});

Deno.test("SPEC TH39b: PreviewScene wires the viewer CSP-safely (non-passive wheel, zoom-only preventDefault, removable listeners)", async () => {
  const src = await Deno.readTextFile(new URL("../src/graphics/PreviewScene.ts", import.meta.url));
  const giz = await Deno.readTextFile(new URL("../src/graphics/AxisGizmo.ts", import.meta.url));
  assert(/addEventListener\("wheel"[\s\S]*?passive: false/.test(src), "the wheel listener is non-passive");
  const wheel = src.slice(src.indexOf('addEventListener("wheel"'), src.indexOf('addEventListener("dblclick"'));
  assert(wheel.indexOf('if (role === "page")') < wheel.indexOf("e.preventDefault()"), "preventDefault only after the page role returned");
  assert(src.includes("this.#input.abort()") && giz.includes("this.#ac.abort()"), "dispose removes every listener");
  assert(src.includes("e.stopImmediatePropagation()"), "the engine's wave-P drag listener is suppressed (one orbit per drag)");
  for (const s of [src, giz]) { assert(!/innerHTML/.test(s) && !/style="/.test(s), "no markup strings (CSP)"); assert(!/Math\.random/.test(s)); }
});
