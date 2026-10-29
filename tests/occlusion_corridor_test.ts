// Lane O (V01): pure view-corridor math, fade easing and the dither pattern.
import {
  bayer4Threshold, boxBlocksCorridor, capsuleBlocksCorridor, closestSegmentSegment, Corridor, ditherCoverage,
  FADE_IN_HALF_LIFE, FADE_OUT_HALF_LIFE, FADE_SNAP, SEG, segmentHitsLocalBox, setCorridor, sphereBlocksCorridor,
  stepFade, stepOpacity,
} from "../src/graphics/occlusion/Corridor.ts";
import { injectOcclusionDither, OCCLUSION_DITHER_GLSL } from "../src/graphics/occlusion/FadeMaterials.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// Eye 7 m in front of a chest point at (0, 1.2, 0); corridor radius 0.05 -> 0.22, depth 0.25.
function corridor(): Corridor {
  return setCorridor(new Corridor(), 0, 2.5, 7, 0, 1.2, 0, 0.05, 0.22, 0.25);
}
const sphere = (wcx: number, wcy: number, wcz: number, wr: number, margin = 0) => ({ wcx, wcy, wcz, wr, margin });
const capsule = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cr: number, margin = 0) =>
  ({ ax, ay, az, bx, by, bz, cr, margin });
const slab = (...v: number[]) => segmentHitsLocalBox(Float64Array.from(v));
function seg(...v: number[]): Float64Array {
  const b = new Float64Array(SEG.LENGTH);
  b.set(v);
  closestSegmentSegment(b);
  return b;
}

Deno.test("a sphere on the corridor axis blocks; beside and behind it does not", () => {
  const c = corridor();
  assert(sphereBlocksCorridor(c, sphere(0, 1.85, 3.5, 0.3)), "midway sphere blocks");
  assert(!sphereBlocksCorridor(c, sphere(2.5, 1.85, 3.5, 0.3)), "sphere 2.5 m to the side does not");
  assert(!sphereBlocksCorridor(c, sphere(0, 1.2, -1.5, 0.5)), "sphere behind the target does not");
});

Deno.test("the corridor ends at the subject's front surface (tEnd)", () => {
  const c = corridor();
  assert(near(c.tEnd, 1 - 0.25 / c.length), "tEnd = 1 - depth / length");
  // A small sphere just past the front surface (between the front and the target point) is the subject itself.
  assert(!sphereBlocksCorridor(c, sphere(0, 1.2, -0.3, 0.05)), "inside/behind the subject is ignored");
});

Deno.test("the margin (hysteresis) widens the test", () => {
  const c = corridor();
  // Sphere grazing the cone: outside without margin, inside with 0.15 m.
  const t = 0.5, ax = 0, ay = 2.5 + (1.2 - 2.5) * t, az = 7 - 7 * t;
  const r = 0.2, gap = r + c.radiusAt(t) + 0.08;
  assert(!sphereBlocksCorridor(c, sphere(ax + gap, ay, az, r)), "grazing sphere is clear");
  assert(sphereBlocksCorridor(c, sphere(ax + gap, ay, az, r, 0.15)), "with the release margin it still holds");
});

Deno.test("segment-segment distance matches hand values", () => {
  // Two perpendicular segments 1 m apart in y.
  const b = seg(-1, 0, 0, 1, 0, 0, 0, 1, -1, 0, 1, 1);
  assert(near(b[SEG.DIST2], 1), `d2 ${b[SEG.DIST2]}`);
  assert(near(b[SEG.S], 0.5) && near(b[SEG.T], 0.5), "closest at both midpoints");
  // Parallel, offset: distance 2.
  assert(near(seg(0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 2, 0)[SEG.DIST2], 4), "parallel distance^2 = 4");
  // Degenerate (points).
  assert(near(seg(0, 0, 0, 0, 0, 0, 3, 4, 0, 3, 4, 0)[SEG.DIST2], 25), "point-point 5 m");
});

Deno.test("a vertical capsule (another fighter) between eye and subject blocks; behind does not", () => {
  const c = corridor();
  assert(capsuleBlocksCorridor(c, capsule(0, 0.35, 3, 0, 1.35, 3, 0.34)), "capsule in the way");
  assert(!capsuleBlocksCorridor(c, capsule(0, 0.35, -2, 0, 1.35, -2, 0.34)), "capsule behind the subject");
  assert(!capsuleBlocksCorridor(c, capsule(3, 0.35, 3, 3, 1.35, 3, 0.34)), "capsule to the side");
});

Deno.test("segment vs local box slab test (with pad)", () => {
  assert(slab(-2, 0, 0, 2, 0, 0, 0.5, 0.5, 0.5, 0, 0, 0), "through the box");
  assert(!slab(-2, 1, 0, 2, 1, 0, 0.5, 0.5, 0.5, 0, 0, 0), "above the box");
  assert(slab(-2, 0.6, 0, 2, 0.6, 0, 0.5, 0.5, 0.5, 0.2, 0.2, 0.2), "pad catches a near miss");
  assert(!slab(-3, 0, 0, -1, 0, 0, 0.5, 0.5, 0.5, 0, 0, 0), "segment stops short");
  assert(slab(0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0, 0, 0), "degenerate segment inside");
});

Deno.test("oriented box (rotated 90 deg about y, scaled) against the corridor", () => {
  const c = corridor();
  // A 4 m x 3 m x 0.35 m wall turned 90 deg: in world it is 0.35 wide in x and 4 long in z.
  // inv = world -> local for rotation y +90 deg (local x = -world z, local z = world x), scale 1.
  const inv = { elements: [0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1] };
  const wall = (x: number, z: number) => ({
    wcx: x, wcy: 1.5, wcz: z, wr: 2.5, margin: 0, lcx: 0, lcy: 0, lcz: 0, lhx: 2, lhy: 1.5, lhz: 0.175, sx: 1, sy: 1, sz: 1,
    // world -> local = R^T (p - centre): translation column = -R^T centre = (z, -1.5, -x).
    inv: { elements: inv.elements.map((v, i) => (i === 12 ? z : i === 13 ? -1.5 : i === 14 ? -x : v)) },
  });
  assert(boxBlocksCorridor(c, wall(0, 3.5)), "wall along the view line, on it, blocks");
  assert(!boxBlocksCorridor(c, wall(1.5, 3.5)), "same wall 1.5 m to the side does not");
});

Deno.test("stepOpacity is frame-rate independent at 30/60/144 Hz", () => {
  const run = (hz: number, blockFor: number, total: number) => {
    let a = 1;
    const frames = Math.round(total * hz), blockFrames = Math.round(blockFor * hz);
    for (let i = 0; i < frames; i++) a = stepOpacity(a, i < blockFrames ? 0.15 : 1, 1 / hz);
    return a;
  };
  // 0.5 s blocked, and 1/6 s blocked then 1/3 s released (mid-release, no snap).
  for (const [blockFor, total] of [[0.5, 0.5], [1 / 6, 0.5]]) {
    const [a30, a60, a144] = [run(30, blockFor, total), run(60, blockFor, total), run(144, blockFor, total)];
    assert(near(a30, a60, 1e-9) && near(a60, a144, 1e-9), `same opacity: ${a30} ${a60} ${a144}`);
  }
});

Deno.test("stepFade (in place, allocation-free form) equals stepOpacity", () => {
  const timing = { fadeInHalfLife: FADE_IN_HALF_LIFE, fadeOutHalfLife: FADE_OUT_HALF_LIFE, snap: FADE_SNAP, dt: 1 / 60 };
  const state = { opacity: 1, targetOpacity: 0.15 };
  let ref = 1;
  for (let i = 0; i < 90; i++) {
    if (i === 30) state.targetOpacity = 1;
    stepFade(state, timing);
    ref = stepOpacity(ref, state.targetOpacity, timing.dt);
    assert(Math.abs(state.opacity - ref) < 1e-12, `frame ${i}: ${state.opacity} vs ${ref}`);
  }
});

Deno.test("fade-in reaches 95% of the way within 0.3 s; release is slower", () => {
  let a = 1;
  for (let i = 0; i < 18; i++) a = stepOpacity(a, 0.15, 1 / 60); // 0.3 s
  assert(a <= 0.15 + 0.05 * 0.85 + 1e-9, `0.3 s: ${a}`);
  assert(FADE_OUT_HALF_LIFE > FADE_IN_HALF_LIFE, "release slower than fade-in");
  // Snap: a released occluder returns to exactly 1 in finite time.
  for (let i = 0; i < 600; i++) a = stepOpacity(a, 1, 1 / 60);
  assert(a === 1, "snapped back to exactly 1");
});

Deno.test("Bayer 4x4 is a permutation; opacity k/16 keeps exactly k pixels", () => {
  const seen = new Set<number>();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(Math.round(bayer4Threshold(x, y) * 16 - 0.5));
  assert(seen.size === 16, "16 distinct thresholds");
  // Standard Bayer matrix row 0: 0 8 2 10.
  assert([0, 1, 2, 3].map((x) => bayer4Threshold(x, 0) * 16 - 0.5).join() === "0,8,2,10", "row 0 = 0,8,2,10");
  for (let k = 0; k <= 16; k++) assert(near(ditherCoverage(k / 16), k / 16), `coverage ${k}/16`);
  assert(near(ditherCoverage(0.35), 6 / 16), "fighter minimum keeps 6/16 pixels");
  assert(bayer4Threshold(5, 6) === bayer4Threshold(1, 2), "the pattern tiles every 4 px");
});

Deno.test("dither injection: declarations before main, discard first in main, idempotent", () => {
  const src = "uniform vec3 c;\nvoid main() {\n  gl_FragColor = vec4(c, 1.0);\n}\n";
  const out = injectOcclusionDither(src)!;
  assert(out.indexOf(OCCLUSION_DITHER_GLSL) < out.indexOf("void main"), "declarations first");
  assert(out.indexOf("discard") > out.indexOf("void main") && out.indexOf("discard") < out.indexOf("gl_FragColor"), "discard before the colour");
  assert(injectOcclusionDither(out) === out, "idempotent");
  assert(injectOcclusionDither("no entry point") === null, "no main -> null");
});
