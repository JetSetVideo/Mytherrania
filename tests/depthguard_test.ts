// The skin-penetration invariant: a limb's skin can never end up inside the torso, and the
// system must be able to REJECT that state before it is rendered. These pin the whole
// guarantee — the signed surface gap is exact and sign-correct, the sweep finds the deepest
// intrusion, the margin flips `safe` exactly on the boundary, the angle budget tightens as
// the surfaces fatten and loosens as the limb lengthens, the budget never loosens a joint
// past its own limits, the pre-flight gate flags a penetrating pose and passes a clean one,
// and no entry point can ever emit NaN.
import {
  angleBudget,
  guardVertices,
  surfaceGap,
  validatePose,
  type Capsule,
  type Vec3,
} from "../src/game/DepthGuard.ts";
import { type JointId } from "../src/game/BodyGraph.ts";
import { effectiveLimits } from "../src/game/PartHierarchy.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

const AXIS: Capsule = { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 10 }, radius: 2 };

// ------------------------------------------------------- surfaceGap: sign + exactness

Deno.test("surfaceGap is exact and sign-correct inside, outside and on the surface", () => {
  // On the surface: a point 2 out, level with the axis.
  assert(near(surfaceGap({ x: 2, y: 0, z: 5 }, AXIS), 0), "on-surface gap must be 0");
  // Outside by exactly 1.
  assert(near(surfaceGap({ x: 3, y: 0, z: 5 }, AXIS), 1), "outside gap must be +1");
  // Inside by exactly 1.
  assert(near(surfaceGap({ x: 1, y: 0, z: 5 }, AXIS), -1), "inside gap must be -1");
  // Sign is strictly correct.
  assert(surfaceGap({ x: 3, y: 0, z: 5 }, AXIS) > 0, "outside must be positive");
  assert(surfaceGap({ x: 1, y: 0, z: 5 }, AXIS) < 0, "inside must be negative");
  // Past the end cap: nearest axis point is the endpoint b, not the projection.
  assert(near(surfaceGap({ x: 0, y: 0, z: 12 }, AXIS), 0), "beyond b, on cap, gap 0");
  assert(near(surfaceGap({ x: 0, y: 0, z: 15 }, AXIS), 3), "beyond b, gap = dist - r");
  // Before the start cap: nearest axis point is a.
  assert(near(surfaceGap({ x: 0, y: 0, z: -3 }, AXIS), 1), "before a, gap = dist - r");
});

Deno.test("surfaceGap is exact for the degenerate capsule a == b", () => {
  const sphere: Capsule = { a: { x: 1, y: 2, z: 3 }, b: { x: 1, y: 2, z: 3 }, radius: 0.5 };
  assert(near(surfaceGap({ x: 1, y: 2, z: 4 }, sphere), 0.5), "one out from centre -> gap 0.5");
  assert(near(surfaceGap({ x: 1, y: 2, z: 3 }, sphere), -0.5), "at centre -> gap -radius");
  assert(near(surfaceGap({ x: 1, y: 2, z: 2 }, sphere), 0.5), "symmetric on the other side");
});

// ------------------------------------------------------- guardVertices: deepest + count

Deno.test("guardVertices finds the deepest intrusion and counts every point inside", () => {
  const points: Vec3[] = [
    { x: 5, y: 0, z: 5 },  // gap +3
    { x: 1.5, y: 0, z: 5 }, // gap -0.5
    { x: 1, y: 0, z: 5 },  // gap -1
    { x: 0, y: 0, z: 5 },  // gap -2  <- deepest
  ];
  const rep = guardVertices(points, AXIS);
  assert(near(rep.worst, -2), `worst must be the deepest gap, got ${rep.worst}`);
  assert(rep.count === 3, `count must be 3, got ${rep.count}`);
  assert(rep.firstAt !== null && rep.firstAt.x === 1.5, "firstAt must be the first point inside");
  assert(rep.safe === false, "a penetrating sweep is not safe");

  const clean = guardVertices([{ x: 5, y: 0, z: 5 }, { x: 3, y: 0, z: 5 }], AXIS);
  assert(near(clean.worst, 1), "worst of a clean sweep is the smallest gap");
  assert(clean.count === 0 && clean.firstAt === null && clean.safe, "clean sweep: no intrusion");
});

Deno.test("guardVertices flips safe exactly at the margin", () => {
  const worst = -2;
  const points: Vec3[] = [{ x: 0, y: 0, z: 5 }]; // gap exactly -2
  assert(guardVertices(points, AXIS, worst).safe === true, "worst >= margin -> safe");
  assert(guardVertices(points, AXIS, worst + 1e-6).safe === false, "just above the margin -> unsafe");
  assert(guardVertices(points, AXIS, worst - 1e-6).safe === true, "below the margin -> safe");
  // Default margin is 0: on the surface counts as safe, just inside does not.
  assert(guardVertices([{ x: 2, y: 0, z: 5 }], AXIS).safe === true, "on-surface is safe at margin 0");
  assert(guardVertices([{ x: 1.999, y: 0, z: 5 }], AXIS).safe === false, "inside is unsafe at margin 0");
});

// ------------------------------------------------------- angleBudget: the equation

Deno.test("angleBudget tightens as the torso fattens", () => {
  const thin = angleBudget("shoulder", "human", 0.5, 0.15, 0.4);
  const fat = angleBudget("shoulder", "human", 0.7, 0.15, 0.4);
  assert(fat.max < thin.max, `fatter torso must allow less travel (${fat.max} vs ${thin.max})`);
});

Deno.test("angleBudget tightens as the limb fattens", () => {
  const slim = angleBudget("shoulder", "human", 0.6, 0.1, 0.4);
  const thick = angleBudget("shoulder", "human", 0.6, 0.2, 0.4);
  assert(thick.max < slim.max, `fatter limb must allow less travel (${thick.max} vs ${slim.max})`);
});

Deno.test("angleBudget loosens as the limb lengthens", () => {
  const short = angleBudget("shoulder", "human", 0.6, 0.15, 0.4);
  const long = angleBudget("shoulder", "human", 0.6, 0.15, 0.5);
  assert(long.max > short.max, `longer limb must allow more travel (${long.max} vs ${short.max})`);
});

Deno.test("angleBudget never loosens a joint past its own effective limits", () => {
  const joints: JointId[] = ["waist", "ribcage", "neckJoint", "shoulder", "elbow", "hip", "knee", "ankle"];
  for (const joint of joints) {
    const limits = effectiveLimits(joint, {});
    for (const [rt, rl, l] of [[0.01, 0.01, 10], [0.36, 0.1, 0.46], [5, 5, 0.01]] as [number, number, number][]) {
      const b = angleBudget(joint, "human", rt, rl, l);
      assert(b.min <= b.max, `${joint}: budget must be a valid interval`);
      assert(b.min >= limits.min - 1e-9, `${joint}: min ${b.min} loosened past ${limits.min}`);
      assert(b.max <= limits.max + 1e-9, `${joint}: max ${b.max} loosened past ${limits.max}`);
    }
  }
});

Deno.test("angleBudget names a binding constraint", () => {
  const names = new Set(["torsoRadius", "limbRadius", "limbLength"]);
  for (const [rt, rl, l] of [[0.36, 0.1, 0.46], [0.5, 0.05, 0.6], [0.3, 0.3, 0.3]]) {
    const b = angleBudget("shoulder", "human", rt, rl, l);
    assert(names.has(b.limiting), `limiting must name one of the three, got ${b.limiting}`);
  }
});

// ------------------------------------------------------- validatePose: the pre-flight gate

Deno.test("validatePose flags a penetrating pose and passes a clean one", () => {
  // The sampled point's radial distance shrinks as the angle grows: angle 1 drives it to
  // x=0.1, inside the human chest capsule (radius 0.36); angle 0 leaves it at 0.5, clear.
  const sample = (_joint: JointId, angle: number): Vec3[] => [{ x: 0.5 - angle * 0.4, y: 0.3, z: 0 }];

  const bad = validatePose({ shoulder: 1 }, "human", sample);
  assert(bad.safe === false, "a penetrating pose must be rejected");
  assert(bad.violations.length === 1, "exactly one joint is violating");
  assert(bad.violations[0].joint === "shoulder" && bad.violations[0].angle === 1, "the shoulder is named");
  assert(bad.violations[0].worst < 0, "the reported worst gap is an intrusion");

  const good = validatePose({ shoulder: 0 }, "human", sample);
  assert(good.safe === true && good.violations.length === 0, "a clean pose must pass");

  // Empty pose: nothing to check, nothing to violate.
  assert(validatePose({}, "human", sample).safe === true, "an empty pose is trivially safe");
});

// ------------------------------------------------------- totality: never NaN

Deno.test("no entry point returns NaN for non-finite input", () => {
  const nan = Number.NaN;
  const inf = Number.POSITIVE_INFINITY;

  assert(Number.isFinite(surfaceGap({ x: nan, y: inf, z: 0 }, AXIS)), "surfaceGap: non-finite point");
  assert(Number.isFinite(surfaceGap({ x: 1, y: 0, z: 1 }, { a: { x: nan, y: 0, z: 0 }, b: { x: nan, y: 0, z: 0 }, radius: nan })), "surfaceGap: non-finite capsule");

  const g = guardVertices([{ x: nan, y: 0, z: 0 }, { x: inf, y: 0, z: 0 }], AXIS);
  assert(Number.isFinite(g.worst) && g.count === 0 && g.safe, "guardVertices: all points skipped");

  const g2 = guardVertices([{ x: nan, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }], AXIS);
  assert(Number.isFinite(g2.worst) && near(g2.worst, 3), "guardVertices: skips NaN, keeps the real point");

  const b = angleBudget("shoulder", "human", nan, nan, nan);
  assert(Number.isFinite(b.min) && Number.isFinite(b.max) && b.min <= b.max, "angleBudget: non-finite params");
  assert(Number.isFinite(angleBudget("elbow", "nonsense", inf, inf, inf).max), "angleBudget: unknown race + Inf");

  const v = validatePose({ shoulder: nan }, "human", (_j, _a) => [{ x: nan, y: nan, z: nan }]);
  assert(v.safe === true && v.violations.length === 0, "validatePose: non-finite sample is skipped");

  const v2 = validatePose({ shoulder: nan }, "human", (_j, _a) => [{ x: 0.1, y: 0.3, z: 0 }]);
  assert(v2.safe === false && Number.isFinite(v2.violations[0].worst), "validatePose: non-finite angle, real points");
});
