// Lane I-A: the persistent spectator camera. The first test is the user's actual complaint — a
// frame with no drag input must leave the angle exactly where it was (no ease-back, no dt).
import {
  CAMERA_PRESETS,
  cameraPose,
  cycleMode,
  decodeSpectateCam,
  encodeSpectateCam,
  focusSeat,
  orbitCamera,
  SPECTATE_CAM_BOUNDS,
  SPECTATE_CAM_DEFAULTS,
  type SpectateCamMode,
  type SpectateCamState,
  zoomCamera,
  ZOOM_STEP_RATIO,
} from "../src/game/SpectatorCamera.ts";
import { rng32, wrapAngle } from "../src/core/MathCore.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

/** Deep-equal for two states, matching the brief's "deep-equals". */
function stateEquals(a: SpectateCamState, b: SpectateCamState): boolean {
  const same = (x: number, y: number) => x === y || (Number.isNaN(x) && Number.isNaN(y));
  return a.mode === b.mode && same(a.yaw, b.yaw) && same(a.pitch, b.pitch) && same(a.dist, b.dist) && same(a.height, b.height);
}

/** A valid mode is one of the three the interface declares. */
function isMode(v: unknown): v is SpectateCamMode {
  return v === "free" || v === "follow-a" || v === "follow-b";
}

const B = SPECTATE_CAM_BOUNDS;
const SENS = { yaw: 0.003, pitch: 0.003 };

Deno.test("orbitCamera(s, 0, 0, …) is a deep-equal no-op (the user's complaint)", () => {
  assert(stateEquals(orbitCamera(SPECTATE_CAM_DEFAULTS, 0, 0, SENS), SPECTATE_CAM_DEFAULTS), "defaults changed");
  const s: SpectateCamState = { mode: "follow-b", yaw: 1.9, pitch: 0.7, dist: 14, height: 2 };
  assert(stateEquals(orbitCamera(s, 0, 0, SENS), s), "a set angle moved with no input");
});

Deno.test("500 no-input frames leave every field identical", () => {
  let s = SPECTATE_CAM_DEFAULTS;
  for (let i = 0; i < 500; i++) s = orbitCamera(s, 0, 0, SENS);
  assert(stateEquals(s, SPECTATE_CAM_DEFAULTS), "an idle frame drifted");
});

Deno.test("orbitCamera never mutates its input", () => {
  const s: SpectateCamState = { ...SPECTATE_CAM_DEFAULTS };
  const before = JSON.stringify(s);
  orbitCamera(s, 3, 3, { yaw: 1, pitch: 1 });
  zoomCamera(s, 5);
  cycleMode(s);
  focusSeat(s, 1);
  cameraPose(s, [0, 0, 0]);
  assert(JSON.stringify(s) === before, "a helper mutated the caller's state");
});

Deno.test("yaw wraps into [-π, π] and keeps going round (monotone wrap)", () => {
  const one = { yaw: 1, pitch: 1 };
  // A large dx comes back inside the range.
  for (const dx of [10, 25, 100, -7, -300]) {
    const y = orbitCamera(SPECTATE_CAM_DEFAULTS, dx, 0, one).yaw;
    assert(y >= -Math.PI && y <= Math.PI, `yaw out of range for dx=${dx}: ${y}`);
    assert(Number.isFinite(y), "yaw not finite");
  }
  // Increasing dx turns monotonically on the circle (each shortest-arc step is positive).
  let prev = orbitCamera(SPECTATE_CAM_DEFAULTS, 0, 0, one).yaw;
  let acc = 0;
  for (let k = 1; k <= 40; k++) {
    const y = orbitCamera(SPECTATE_CAM_DEFAULTS, k * 0.5, 0, one).yaw;
    const step = wrapAngle(y - prev); // shortest-arc delta, in (-π, π]
    assert(step >= 0, `yaw turned backwards at k=${k}`);
    acc += step;
    prev = y;
  }
  assert(Math.abs(acc - 40 * 0.5) < 1e-9, `total turn drifted: ${acc}`);
});

Deno.test("pitch clamps at both ends and never leaves the bounds over 1 000 random drags", () => {
  const one = { yaw: 0, pitch: 1 };
  let low = SPECTATE_CAM_DEFAULTS;
  for (let i = 0; i < 50; i++) low = orbitCamera(low, 0, -1, one);
  assert(low.pitch === B.pitch[0], `pitch floor: ${low.pitch}`);
  let high = SPECTATE_CAM_DEFAULTS;
  for (let i = 0; i < 50; i++) high = orbitCamera(high, 0, 1, one);
  assert(high.pitch === B.pitch[1], `pitch ceiling: ${high.pitch}`);

  const rng = rng32(0x5eed);
  let s = SPECTATE_CAM_DEFAULTS;
  for (let i = 0; i < 1000; i++) {
    const dx = (rng() * 2 - 1) * 40;
    const dy = (rng() * 2 - 1) * 40;
    s = orbitCamera(s, dx, dy, { yaw: 0.5, pitch: 0.5 });
    assert(s.pitch >= B.pitch[0] && s.pitch <= B.pitch[1], `pitch escaped: ${s.pitch}`);
    assert(s.yaw >= -Math.PI && s.yaw <= Math.PI, `yaw escaped: ${s.yaw}`);
    assert(Number.isFinite(s.pitch) && Number.isFinite(s.yaw), "non-finite angle");
  }
});

Deno.test("zoomCamera is monotone in steps and clamped at both ends", () => {
  let prev = -Infinity;
  for (let k = -12; k <= 12; k++) {
    const d = zoomCamera(SPECTATE_CAM_DEFAULTS, k).dist;
    assert(Number.isFinite(d), `non-finite dist at step ${k}`);
    assert(d >= prev, `dist not monotone at step ${k}`);
    assert(d >= B.dist[0] && d <= B.dist[1], `dist escaped at step ${k}`);
    prev = d;
  }
  assert(zoomCamera(SPECTATE_CAM_DEFAULTS, 1000).dist === B.dist[1], "no far clamp");
  assert(zoomCamera(SPECTATE_CAM_DEFAULTS, -1000).dist === B.dist[0], "no near clamp");
  // Multiplicative: one +1 step is exactly the ratio away.
  assert(Math.abs(zoomCamera(SPECTATE_CAM_DEFAULTS, 1).dist - 9 * ZOOM_STEP_RATIO) < 1e-12, "not multiplicative");
});

Deno.test("cameraPose keeps the camera at `dist` from the target and never below it for pitch >= 0", () => {
  const target: [number, number, number] = [3, 1.2, -4];
  const span = (s: SpectateCamState) => {
    const p = cameraPose(s, target).position;
    return Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
  };
  // Every preset (height 0) sits exactly `dist` metres away and its `look` is the target.
  for (const preset of CAMERA_PRESETS) {
    const pose = cameraPose(preset.state, target);
    assert(Math.abs(span(preset.state) - preset.state.dist) < 1e-9, `preset ${preset.id} span != dist`);
    assert(pose.look[0] === target[0] && pose.look[1] === target[1] && pose.look[2] === target[2], "look != target");
  }
  // Any pitch >= 0, height >= 0: the camera is never below the target's height.
  const rng = rng32(0xabcd);
  for (let i = 0; i < 500; i++) {
    const s: SpectateCamState = {
      mode: "free",
      yaw: wrapAngle((rng() * 2 - 1) * 10),
      pitch: rng() * B.pitch[1],
      dist: B.dist[0] + rng() * (B.dist[1] - B.dist[0]),
      height: rng() * 5,
    };
    assert(cameraPose(s, target).position[1] >= target[1] - 1e-12, "camera dipped below the target");
  }
  // The `height` lift shows up on y and only on y.
  const flat = cameraPose({ ...SPECTATE_CAM_DEFAULTS, height: 0 }, target).position;
  const lifted = cameraPose({ ...SPECTATE_CAM_DEFAULTS, height: 3 }, target).position;
  assert(Math.abs(lifted[1] - (flat[1] + 3)) < 1e-12, "height did not lift y by exactly height");
  assert(lifted[0] === flat[0] && lifted[2] === flat[2], "height leaked onto x/z");
});

Deno.test("every preset is inside the bounds, has a unique id and a label", () => {
  assert(CAMERA_PRESETS.length === 4, `expected 4 presets, got ${CAMERA_PRESETS.length}`);
  const ids = new Set(CAMERA_PRESETS.map((p) => p.id));
  assert(ids.size === CAMERA_PRESETS.length, "preset ids are not unique");
  for (const p of CAMERA_PRESETS) {
    assert(p.id.length > 0 && p.label.length > 0, "empty id or label");
    assert(p.state.pitch >= B.pitch[0] && p.state.pitch <= B.pitch[1], `preset ${p.id} pitch out of bounds`);
    assert(p.state.dist >= B.dist[0] && p.state.dist <= B.dist[1], `preset ${p.id} dist out of bounds`);
    assert(p.state.yaw >= -Math.PI && p.state.yaw <= Math.PI, `preset ${p.id} yaw out of range`);
    assert(isMode(p.state.mode), `preset ${p.id} bad mode`);
  }
  // The set must offer a broadcast/wide view and a top-down view.
  assert(CAMERA_PRESETS.some((p) => p.state.dist >= 20), "no wide/broadcast preset");
  assert(CAMERA_PRESETS.some((p) => p.state.pitch >= 1.4), "no top-down preset");
  assert(CAMERA_PRESETS.some((p) => p.state.dist <= 8), "no close/duel preset");
  assert(CAMERA_PRESETS.some((p) => p.state.pitch <= 0.15), "no low-angle preset");
});

Deno.test("encode/decode round-trips exactly", () => {
  const samples: SpectateCamState[] = [
    SPECTATE_CAM_DEFAULTS,
    { mode: "free", yaw: 0, pitch: 0.6, dist: 12, height: 0 },
    { mode: "follow-a", yaw: -2.9, pitch: 1.2, dist: 37, height: 1.5 },
    ...CAMERA_PRESETS.map((p) => p.state),
  ];
  for (const s of samples) {
    assert(stateEquals(decodeSpectateCam(encodeSpectateCam(s)), s), `round trip failed for ${JSON.stringify(s)}`);
  }
});

Deno.test("decode is total for hostile and absent input (never NaN)", () => {
  const hostile: (string | null)[] = [
    null,
    "",
    "null",
    "{]",
    "{}",
    JSON.stringify({ mode: "free", yaw: 0, pitch: 0.5, dist: 1e9, height: 0 }), // huge dist
    JSON.stringify({ mode: "free", yaw: 0, pitch: null, dist: 9, height: 0 }), // NaN/absent pitch
    JSON.stringify({ mode: "free", yaw: 0, pitch: -1, dist: 9, height: 0 }), // negative pitch
    JSON.stringify({ mode: "wat", yaw: 0, pitch: 0.5, dist: 9, height: 0 }), // unknown mode
  ];
  for (const raw of hostile) {
    const out = decodeSpectateCam(raw);
    assert(isMode(out.mode), `bad mode from ${String(raw)}`);
    assert(Number.isFinite(out.yaw) && Number.isFinite(out.pitch) && Number.isFinite(out.dist) && Number.isFinite(out.height), `non-finite field from ${String(raw)}`);
    assert(out.pitch >= B.pitch[0] && out.pitch <= B.pitch[1], `pitch out of bounds from ${String(raw)}`);
    assert(out.dist >= B.dist[0] && out.dist <= B.dist[1], `dist out of bounds from ${String(raw)}`);
    assert(out.yaw >= -Math.PI && out.yaw <= Math.PI, `yaw out of range from ${String(raw)}`);
  }
  // Specific fallbacks the brief calls out.
  assert(stateEquals(decodeSpectateCam(null), SPECTATE_CAM_DEFAULTS), "null != defaults");
  assert(stateEquals(decodeSpectateCam(""), SPECTATE_CAM_DEFAULTS), "empty != defaults");
  assert(stateEquals(decodeSpectateCam("{}"), SPECTATE_CAM_DEFAULTS), "{} != defaults");
  assert(decodeSpectateCam(JSON.stringify({ dist: 1e9 })).dist === B.dist[1], "huge dist not clamped to the far bound");
  assert(decodeSpectateCam(JSON.stringify({ pitch: -1 })).pitch === B.pitch[0], "negative pitch not clamped to the low bound");
  assert(decodeSpectateCam(JSON.stringify({ mode: "wat" })).mode === SPECTATE_CAM_DEFAULTS.mode, "unknown mode not defaulted");
});

Deno.test("cycleMode runs free -> follow-a -> follow-b -> free over four calls", () => {
  let s: SpectateCamState = SPECTATE_CAM_DEFAULTS;
  const seen: SpectateCamMode[] = [];
  for (let i = 0; i < 4; i++) {
    s = cycleMode(s);
    seen.push(s.mode);
  }
  assert(seen.join(",") === "follow-a,follow-b,free,follow-a", `cycle: ${seen.join(",")}`);
  // Cycling never disturbs the user's angle.
  const tilted: SpectateCamState = { mode: "free", yaw: 1.1, pitch: 0.9, dist: 11, height: 0 };
  const c = cycleMode(tilted);
  assert(c.yaw === tilted.yaw && c.pitch === tilted.pitch && c.dist === tilted.dist && c.height === tilted.height, "cycle changed the angle");
});

Deno.test("focusSeat changes only the mode", () => {
  const s: SpectateCamState = { mode: "free", yaw: 2.4, pitch: 0.3, dist: 6.5, height: 1 };
  const a = focusSeat(s, 0);
  assert(a.mode === "follow-a" && a.yaw === s.yaw && a.pitch === s.pitch && a.dist === s.dist && a.height === s.height, "seat 0 focus changed the angle");
  const b = focusSeat(s, 1);
  assert(b.mode === "follow-b" && b.yaw === s.yaw && b.pitch === s.pitch && b.dist === s.dist && b.height === s.height, "seat 1 focus changed the angle");
});
