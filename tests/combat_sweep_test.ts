// Lane X (W05): swept collision of weapon features against capsules.
import { sweepStrike } from "../src/combat/Sweep.ts";
import type { HitboxSet, V3 } from "../src/combat/contracts.ts";
import { capsule, dagger, longsword, pose, warhammer } from "./combat_fixtures.ts";
// @deno-types="@types/three"
import * as THREE from "three";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }
const DT = 1 / 60;
const X: V3 = [1, 0, 0], Z: V3 = [0, 0, 1];
const len = (v: V3) => Math.hypot(...v);

/** Blade swung about world x (edge +z leads): θ from θm − Δ/2 to θm + Δ/2 in one frame. */
function swingAboutX(thetaMid: number, delta: number) {
  return { prev: { matrix: pose(X, thetaMid - delta / 2, [0, 0, 0]), time: 0 }, curr: { matrix: pose(X, thetaMid + delta / 2, [0, 0, 0]), time: DT } };
}
/** World point of local (0, y, 0) under rotation θ about x. */
const onBlade = (theta: number, y: number): V3 => [0, y * Math.cos(theta), y * Math.sin(theta)];

Deno.test("sweep: a 30 m/s tip swing crosses a forearm inside ONE 1/60 s frame and still hits (no tunnelling)", () => {
  const sword = longsword(), thetaMid = 0.4, delta = 0.53; // ω = 31.8 rad/s → tip (0.95 m) 30.2 m/s
  const c = onBlade(thetaMid, 0.8);
  const target: HitboxSet = { mass: 70, boxes: [capsule([c[0] - 0.15, c[1], c[2]], [c[0] + 0.15, c[1], c[2]], 0.04)] };
  // The discrete check at the two instants misses: the blade is ~0.21 m from the arm at both.
  for (const th of [thetaMid - delta / 2, thetaMid + delta / 2]) {
    const p = onBlade(th, 0.8);
    assert(Math.hypot(p[1] - c[1], p[2] - c[2]) > 0.15, "fixture: discrete instants should be clear");
  }
  const { prev, curr } = swingAboutX(thetaMid, delta);
  const hit = sweepStrike(prev, curr, target, sword);
  assert(hit, "swept blade tunnelled through the forearm");
  assert(hit.feature === "edge", `feature ${hit.feature}`);
  assert(hit.t > 0.3 && hit.t < 0.6, `t ${hit.t}`);
  const speed = len(hit.velocity), r = Math.hypot(hit.point[1], hit.point[2]);
  assert(Math.abs(speed - 31.8 * r) < 0.12 * 31.8 * r, `speed ${speed.toFixed(2)} vs ω·r ${(31.8 * r).toFixed(2)}`);
  assert(hit.edgeAlignment > 0.95, `edge alignment ${hit.edgeAlignment}`);
  assert(hit.thrustAlignment < 0.2, `thrust alignment ${hit.thrustAlignment}`);
  // Normal points out of the target toward the blade's approach side; the point is on the surface.
  const toBlade: V3 = [0, -Math.sin(thetaMid), Math.cos(thetaMid)]; // the side the edge comes from is −velocity
  assert(hit.normal[1] * -toBlade[1] + hit.normal[2] * -toBlade[2] > 0.5, `normal ${hit.normal}`);
  assert(Math.abs(Math.hypot(hit.point[1] - c[1], hit.point[2] - c[2]) - 0.04) < 1e-6, "contact point on the capsule surface");
});

Deno.test("sweep: a blade moving parallel to a limb, 10 cm off, returns null", () => {
  const sword = longsword();
  const target: HitboxSet = { mass: 70, boxes: [capsule([-0.6, 0.5, 0.12], [0.6, 0.5, 0.12], 0.04)] };
  const prev = { matrix: pose(X, 0, [-0.5, 0, 0]), time: 0 }, curr = { matrix: pose(X, 0, [0.5, 0, 0]), time: DT };
  assert(sweepStrike(prev, curr, target, sword) === null, "phantom hit on a parallel pass");
});

Deno.test("sweep: edge-leading swing aligns ~1, flat-leading swing ~0 (same blade, same speed)", () => {
  const sword = longsword();
  const c = onBlade(0.4, 0.7);
  const edgeTarget: HitboxSet = { mass: 70, boxes: [capsule([-0.2, c[1], c[2]], [0.2, c[1], c[2]], 0.05)] };
  const e = swingAboutX(0.4, 0.3);
  const edgeHit = sweepStrike(e.prev, e.curr, edgeTarget, sword)!;
  // Flat-leading: rotate about z, so the blade moves along ±x while its edges face ±z.
  const p = [0.7 * -Math.sin(0.4), 0.7 * Math.cos(0.4), 0];
  const flatTarget: HitboxSet = { mass: 70, boxes: [capsule([p[0], p[1], -0.2], [p[0], p[1], 0.2], 0.05)] };
  const flatHit = sweepStrike({ matrix: pose(Z, 0.25, [0, 0, 0]), time: 0 }, { matrix: pose(Z, 0.55, [0, 0, 0]), time: DT }, flatTarget, sword)!;
  assert(edgeHit && flatHit, "both swings must connect");
  assert(edgeHit.edgeAlignment > 0.95, `edge-leading ${edgeHit.edgeAlignment}`);
  assert(flatHit.edgeAlignment < 0.15, `flat-leading ${flatHit.edgeAlignment}`);
  console.log(`  edge-leading alignment ${edgeHit.edgeAlignment.toFixed(3)}, flat-leading ${flatHit.edgeAlignment.toFixed(3)}`);
});

Deno.test("sweep: reverse-grip dagger stabbing down along its blade → point contact, thrustAlignment ~1", () => {
  const knife = dagger();
  const reverse = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI); // blade points down
  const prev = { matrix: pose(X, 0, [0, 1.5, 0], reverse), time: 0 }, curr = { matrix: pose(X, 0, [0, 1.5 - 8 * DT, 0], reverse), time: DT };
  const shoulder: HitboxSet = { mass: 70, boxes: [capsule([-0.15, 1.05, 0], [0.15, 1.05, 0], 0.05, "chest")] };
  const hit = sweepStrike(prev, curr, shoulder, knife);
  assert(hit, "stab missed");
  assert(hit.feature === "point", `feature ${hit.feature}`);
  assert(hit.thrustAlignment > 0.99, `thrust alignment ${hit.thrustAlignment}`);
  assert(Math.abs(len(hit.velocity) - 8) < 0.2, `speed ${len(hit.velocity)}`);
  assert(hit.normal[1] > 0.99, `normal ${hit.normal}`);
});

Deno.test("sweep: the EARLIEST of two limbs on the arc is returned; a hammer head registers as `head`", () => {
  const sword = longsword();
  const a = onBlade(0.3, 0.8), b = onBlade(0.5, 0.8);
  const first = capsule([-0.1, a[1], a[2]], [0.1, a[1], a[2]], 0.04, "foreArm"), second = capsule([-0.1, b[1], b[2]], [0.1, b[1], b[2]], 0.04, "chest");
  const { prev, curr } = swingAboutX(0.4, 0.5);
  const hit = sweepStrike(prev, curr, { mass: 70, boxes: [second, first] }, sword);
  assert(hit && hit.hitbox === first, `hit ${hit?.hitbox.zone}`);
  const hammer = warhammer(), h = onBlade(0.4, 0.81);
  const head = sweepStrike(prev, curr, { mass: 70, boxes: [capsule([-0.1, h[1], h[2]], [0.1, h[1], h[2]], 0.06, "head")] }, hammer);
  assert(head && head.feature === "head", `hammer feature ${head?.feature}`);
});

Deno.test("sweep: degenerate inputs stay finite (no motion, NaN pose, no features, zero dt)", () => {
  const sword = longsword();
  const target: HitboxSet = { mass: 70, boxes: [capsule([-0.1, 0.5, 0], [0.1, 0.5, 0], 0.05)] };
  const still = { matrix: pose(X, 0, [0, 0, 0]), time: 0 };
  const rest = sweepStrike(still, { ...still, time: 0 }, target, sword);
  assert(rest && rest.t === 0 && len(rest.velocity) === 0 && rest.edgeAlignment === 0 && rest.thrustAlignment === 0, "resting overlap");
  assert([...rest.point, ...rest.normal].every(Number.isFinite), "finite");
  const bad = { matrix: new Array(16).fill(NaN), time: DT };
  assert(sweepStrike(still, bad, target, sword) === null, "NaN pose");
  assert(sweepStrike(still, still, target, { ...sword, features: [] }) === null, "no features");
  assert(sweepStrike(still, still, { mass: 70, boxes: [] }, sword) === null, "no boxes");
});
