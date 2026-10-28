import { findTransition, keyAngle, StanceAnimator, stanceTransitions, transitionPose } from "../src/game/StanceAnim.ts";
import type { JointKey } from "../src/game/StanceAnim.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
function near(a: number, b: number, eps = 1e-3, m = ""): void { if (Math.abs(a - b) > eps) throw new Error(`${m} expected ~${b}, got ${a}`); }

const key: JointKey = { joint: "spine", from: 0, peak: 1, to: 0.5 };

Deno.test("a key hits its start, peak and end exactly", () => {
  near(keyAngle(key, 0), 0, 1e-9, "start = from");
  near(keyAngle(key, 0.5), 1, 1e-9, "mid = peak");
  near(keyAngle(key, 1), 0.5, 1e-9, "end = to");
});

Deno.test("the motion is monotonic on each half and continuous at the peak", () => {
  // First half rises from -> peak, second half falls peak -> end, no jump at 0.5.
  let prev = keyAngle(key, 0);
  for (let t = 0.02; t <= 0.5; t += 0.02) {
    const a = keyAngle(key, t);
    assert(a >= prev - 1e-9, `first half must rise at t=${t}`);
    prev = a;
  }
  near(keyAngle(key, 0.5 - 1e-4), keyAngle(key, 0.5 + 1e-4), 1e-2, "continuous at the peak");
  prev = keyAngle(key, 0.5);
  for (let t = 0.52; t <= 1; t += 0.02) {
    const a = keyAngle(key, t);
    assert(a <= prev + 1e-9, `second half must fall at t=${t}`);
    prev = a;
  }
});

Deno.test("the angle follows sin/cos easing (slow at both ends)", () => {
  // At t=0.25 the easing is sin(pi/4) ≈ 0.707 of the way from->peak.
  near(keyAngle(key, 0.25), Math.SQRT1_2, 1e-3, "quarter-point follows sin easing");
});

Deno.test("transitionPose covers every keyed joint and respects clamps", () => {
  const tr = findTransition("standing", "kneeling")!;
  assert(tr !== null, "a kneel transition exists");
  const pose = transitionPose(tr, 0.5);
  assert(pose.has("kneeL") && pose.has("kneeR") && pose.has("spine"), "keyed joints present");
  // Out-of-range progress is clamped, not extrapolated.
  near(keyAngle(key, -0.5), key.from, 1e-9, "below 0 clamps to from");
  near(keyAngle(key, 1.5), key.to, 1e-9, "above 1 clamps to to");
});

Deno.test("the canonical set covers the stance changes the balance plates produce", () => {
  const pairs = stanceTransitions().map((t) => `${t.from}->${t.to}`);
  for (const need of ["standing->kneeling", "kneeling->fallen", "standing->staggered", "kneeling->standing"]) {
    assert(pairs.includes(need), `missing transition ${need}`);
  }
  // A fall is slower than a stagger.
  const fall = findTransition("kneeling", "fallen")!;
  const stagger = findTransition("standing", "staggered")!;
  assert(fall.duration > stagger.duration, "a fall takes longer than a stagger");
});

Deno.test("the animator plays a transition over its duration and finishes", () => {
  const anim = new StanceAnimator();
  const tr = findTransition("standing", "kneeling")!;
  anim.play(tr);
  assert(anim.playing(), "playing after play()");
  const pose = anim.update(0.1);
  assert(pose !== null && pose.has("kneeL"), "produces a pose");
  // Run until the move completes, keeping the last non-null (settled) pose.
  let settled = pose;
  for (let i = 0; i < 20 && anim.playing(); i++) {
    const p = anim.update(0.1);
    if (p) settled = p;
  }
  assert(!anim.playing(), "finishes after the duration");
  // The final pose holds the kneel's `to` angles.
  const kneeTo = tr.keys.find((k) => k.joint === "kneeL")!.to;
  near(settled!.get("kneeL")!, kneeTo, 1e-2, "settles on the end pose");
  assert(anim.update(0.1) === null, "idle once finished");
});

Deno.test("a stance chain is coherent: the end of one is the start of the next", () => {
  // standing->kneeling then kneeling->fallen: the knee/spine continuity holds.
  const kneel = findTransition("standing", "kneeling")!;
  const fall = findTransition("kneeling", "fallen")!;
  const kneelSpineEnd = kneel.keys.find((k) => k.joint === "spine")!.to;
  const fallSpineStart = fall.keys.find((k) => k.joint === "spine")!.from;
  near(fallSpineStart, kneelSpineEnd, 1e-6, "spine is continuous across the chain");
});
