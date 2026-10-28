// The axis/trig envelope tree: exact sin/cos/tan min/max per joint per axis, coupled and
// race-scaled. These pin the guarantees the module exists for — the tree's structure is
// recovered from the coupling chain (JOINT_PARENT) rather than retyped, expand() yields
// parents before children, a root bounds its grandchildren, trigBounds is exact on the
// known cases and honest about a straddled tan asymptote, and no entry point returns NaN.
import {
  axisTree,
  boundsFor,
  expand,
  raceScaled,
  trigBounds,
  type Axis,
  type TrigBounds,
  type TrigNode,
} from "../src/game/AxisEnvelope.ts";
import { effectiveLimits } from "../src/game/PartHierarchy.ts";
import type { JointId } from "../src/game/BodyGraph.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const SQ2 = Math.SQRT2 / 2;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const width = (b: TrigBounds) => b.max - b.min;
/** A one-joint pose, typed so a union key cannot widen the literal. */
const at = (joint: JointId, angle: number): Partial<Record<JointId, number>> =>
  ({ [joint]: angle } as Partial<Record<JointId, number>>);

/** Find a node by joint on an axis anywhere in the tree. */
function nodeOf(tree: TrigNode[], joint: JointId, axis: Axis = "x"): TrigNode {
  for (const root of tree) for (const n of expand(root)) if (n.joint === joint && n.axis === axis) return n;
  throw new Error(`no node for ${joint}.${axis}`);
}

/** The joint that seats `joint` in the tree, or null if it is a root. */
function parentInTree(tree: TrigNode[], joint: JointId): JointId | null {
  for (const root of tree) for (const n of expand(root)) {
    if (n.children.some((c) => c.joint === joint)) return n.joint;
  }
  return null;
}

// ---------------------------------------------------------------- trigBounds is exact

Deno.test("trigBounds is exact on the five known cases", () => {
  const a = trigBounds(0, Math.PI / 2);
  assert(near(a.sin.min, 0) && near(a.sin.max, 1), "sin over [0,pi/2] is [0,1]");
  assert(near(a.cos.min, 0) && near(a.cos.max, 1), "cos over [0,pi/2] is [0,1]");

  const b = trigBounds(0, Math.PI);
  assert(near(b.sin.min, 0) && near(b.sin.max, 1), "sin over [0,pi] is [0,1]");
  assert(near(b.cos.min, -1) && near(b.cos.max, 1), "cos over [0,pi] is [-1,1]");

  const c = trigBounds(Math.PI / 4, (3 * Math.PI) / 4);
  assert(near(c.sin.min, SQ2) && near(c.sin.max, 1), `sin over [pi/4,3pi/4] is [sqrt2/2,1], got [${c.sin.min},${c.sin.max}]`);

  // A reversed interval normalises to the sorted one.
  const d = trigBounds(Math.PI / 2, 0);
  assert(near(d.sin.min, a.sin.min) && near(d.sin.max, a.sin.max), "reversed interval gives the same sin");
  assert(near(d.cos.min, a.cos.min) && near(d.cos.max, a.cos.max), "reversed interval gives the same cos");
});

Deno.test("a tan interval straddling pi/2 reports unbounded, not a lie", () => {
  const t = trigBounds(1, 2); // pi/2 ~ 1.5708 falls strictly inside
  assert(t.tan.min === Number.NEGATIVE_INFINITY && t.tan.max === Number.POSITIVE_INFINITY,
    `straddled tan should be unbounded, got [${t.tan.min},${t.tan.max}]`);
  // A branch with no asymptote inside stays finite and is the endpoint extremes.
  const f = trigBounds(-0.5, 0.5);
  assert(Number.isFinite(f.tan.min) && Number.isFinite(f.tan.max), "an asymptote-free interval stays finite");
  assert(near(f.tan.min, Math.tan(-0.5)) && near(f.tan.max, Math.tan(0.5)), "tan extremes are the endpoints on one branch");
});

// ---------------------------------------------------------------- tree derives from JOINT_PARENT

Deno.test("the tree derives from JOINT_PARENT and matches it", () => {
  const tree = axisTree("human");
  // The parent chain is exactly the coupling table's, recovered by the module (JOINT_PARENT
  // is not exported), so we assert the chain it must reproduce.
  const expected: [JointId, JointId | null][] = [
    ["waist", null], ["ribcage", "waist"], ["neckJoint", "ribcage"],
    ["shoulder", "ribcage"], ["elbow", "shoulder"], ["wrist", "elbow"],
    ["hip", "waist"], ["knee", "hip"], ["ankle", "knee"],
  ];
  for (const [joint, parent] of expected) {
    assert(parentInTree(tree, joint) === parent, `${joint} should hang off ${parent}, got ${parentInTree(tree, joint)}`);
  }

  // And the chain is DERIVED, not retyped: a joint's parent is exactly the joint that
  // narrows it via effectiveLimits, and a non-ancestor never does.
  for (const [joint, parent] of expected) {
    const base = effectiveLimits(joint, {});
    const bw = base.max - base.min;
    if (parent !== null) {
      const coupled = effectiveLimits(joint, at(parent, 3));
      assert(coupled.max - coupled.min < bw - 1e-9, `${parent} must narrow ${joint}`);
    }
    // A joint's own child never narrows it.
    const child = expected.find(([, p]) => p === joint)?.[0];
    if (child) {
      const wrong = effectiveLimits(joint, at(child, 3));
      assert(near(wrong.max - wrong.min, bw), `${child} must NOT narrow ${joint}`);
    }
  }

  // The three chains the coupling relies on are real in the tree.
  assert(nodeOf(tree, "shoulder").children.some((c) => c.joint === "elbow"), "shoulder -> elbow");
  assert(nodeOf(tree, "elbow").children.some((c) => c.joint === "wrist"), "elbow -> wrist");
  assert(nodeOf(tree, "hip").children.some((c) => c.joint === "knee"), "hip -> knee");
  assert(nodeOf(tree, "knee").children.some((c) => c.joint === "ankle"), "knee -> ankle");
  assert(nodeOf(tree, "ribcage").children.some((c) => c.joint === "neckJoint"), "ribcage -> neckJoint");
});

// ---------------------------------------------------------------- expand order

Deno.test("parents precede children in expand()", () => {
  const tree = axisTree("human");
  assert(tree.length === 3, `three roots, one per axis, got ${tree.length}`);
  const axes = tree.map((r) => r.axis).sort();
  assert(axes.join(",") === "x,y,z", "one tree per axis x/y/z");

  for (const root of tree) {
    const flat = expand(root);
    assert(flat[0] === root && root.depth === 0, "the root is first and at depth 0");
    const index = new Map(flat.map((n, i) => [n, i] as const));
    for (let i = 0; i < flat.length; i++) {
      for (const child of flat[i].children) {
        assert(index.get(child)! > i, `child ${child.joint} must follow its parent ${flat[i].joint}`);
        assert(child.depth === flat[i].depth + 1, `${child.joint} depth follows its parent`);
      }
    }
    // Every joint appears once per axis.
    const joints = new Set(flat.map((n) => n.joint));
    assert(joints.size === 9, `all nine joints present, got ${joints.size}`);
  }
});

// ---------------------------------------------------------------- depth 0 wider than depth 2

Deno.test("depth 0 bounds are wider than depth 2 (a child cannot travel further than its root)", () => {
  // The limb chains the spec names: shoulder -> elbow -> wrist and hip -> knee -> ankle.
  // The chain root is depth 0, its grandchild depth 2.
  for (const race of ["human", "elf", "dwarf", "ork"]) {
    const tree = axisTree(race);
    for (const [rootJoint, grandchild] of [["shoulder", "wrist"], ["hip", "ankle"]] as const) {
      const root = nodeOf(tree, rootJoint);
      const deep = nodeOf(tree, grandchild);
      assert(root.depth + 2 === deep.depth, `${grandchild} sits two levels below ${rootJoint}`);
      assert(width(root.sin) > width(deep.sin), `${race}: ${rootJoint} sin bounds must be wider than ${grandchild}'s`);
    }
  }

  // And the general statement on EVERY edge: at its parent's extreme, a child's reachable
  // width is strictly narrower than the child's neutral width — the root bounds the child.
  const tree = axisTree("human");
  for (const node of expand(tree[0])) {
    const p = parentInTree(tree, node.joint);
    if (p === null) continue;
    const neutral = width(effectiveLimits(node.joint, {}));
    const coupled = width(effectiveLimits(node.joint, at(p, 3)));
    assert(coupled < neutral - 1e-9, `${p} must bound ${node.joint}: ${coupled} !< ${neutral}`);
  }
});

// ---------------------------------------------------------------- raceScaled

Deno.test("raceScaled differs between dwarf and elf and is monotone in the scale", () => {
  const b: TrigBounds = { min: -0.5, max: 0.5 };
  const dwarf = raceScaled(b, "dwarf");
  const elf = raceScaled(b, "elf");
  assert(!(near(dwarf.min, elf.min) && near(dwarf.max, elf.max)), "a dwarf and an elf must not scale a bound identically");

  // Monotone: order the races by their reach multiplier and the interval widens in step.
  const byScale = ["elf", "human", "dwarf", "ork"]; // width·limbLength ascending
  let prev = -Infinity;
  for (const race of byScale) {
    const w = width(raceScaled(b, race));
    assert(w >= prev - 1e-12, `${race} must not narrow the interval relative to the previous race`);
    prev = w;
  }
  assert(width(raceScaled(b, "elf")) < width(raceScaled(b, "ork")), "the elf envelope is strictly the narrowest");
});

// ---------------------------------------------------------------- boundsFor matches the tree

Deno.test("boundsFor matches the node in axisTree", () => {
  for (const [race, subrace] of [["human", null], ["elf", "high"], ["dwarf", "mountain"]] as const) {
    const tree = axisTree(race, subrace);
    for (const root of tree) {
      for (const n of expand(root)) {
        const b = boundsFor(n.joint, n.axis, race, subrace);
        assert(b.min === n.sin.min && b.max === n.sin.max,
          `boundsFor(${n.joint}.${n.axis}) = [${b.min},${b.max}] but the node says [${n.sin.min},${n.sin.max}]`);
      }
    }
  }
});

// ---------------------------------------------------------------- totality

Deno.test("no entry point returns NaN for non-finite input", () => {
  const noNaN = (b: TrigBounds) => !Number.isNaN(b.min) && !Number.isNaN(b.max);
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const x of bad) {
    const t = trigBounds(x, 1);
    assert(noNaN(t.sin) && noNaN(t.cos) && noNaN(t.tan), `trigBounds produced NaN for ${x}`);
    assert(noNaN(trigBounds(Number.NaN, Number.NaN).sin), "trigBounds(NaN,NaN) has no NaN");

    assert(noNaN(raceScaled({ min: Number.NaN, max: x }, "human")), `raceScaled produced NaN for ${x}`);
    assert(noNaN(raceScaled({ min: 0, max: 1 }, "not-a-race")), "an unknown race falls back to human");
    assert(noNaN(boundsFor("waist", "x", "human")), "boundsFor is total");
  }

  // An unknown race still builds a finite tree; expand of nothing is empty.
  const tree = axisTree("not-a-race", "nope");
  for (const root of tree) {
    for (const n of expand(root)) {
      assert(noNaN(n.sin) && noNaN(n.cos) && noNaN(n.tan), `${n.joint}.${n.axis} has a NaN bound`);
    }
  }
  assert(expand(null).length === 0 && expand(undefined).length === 0, "expand of nothing is empty");
});
