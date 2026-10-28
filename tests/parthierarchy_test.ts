// The constraint hierarchy: a part's limits are DERIVED from its parent's, not free.
// These pin the five guarantees the module exists for — the tree comes from the graph,
// a child narrows when its parent shrinks, joint coupling composes up the chain, an
// out-of-range silhouette is rejected with the offending part named, and no random draw
// or non-finite input can produce a broken (or NaN) silhouette.
import {
  effectiveLimits,
  PART_TREE,
  randomWithin,
  resolveRange,
  validateChain,
  type ShapeParam,
  type SilhouetteValues,
} from "../src/game/PartHierarchy.ts";
import { BODY_LINKS, BODY_ROOT, type BodySide } from "../src/game/BodyGraph.ts";
import { BODY_PARTS, BODY_PART_SHAPES } from "../src/game/BodyProfile.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const PARAMS: readonly ShapeParam[] = ["length", "rootRadius", "taper", "bulge", "pinch", "lobe", "depth"];

function allFinite(rec: Record<string, unknown>): boolean {
  return Object.values(rec).every((v) => {
    if (typeof v === "number") return Number.isFinite(v);
    const o = v as { min: number; max: number };
    return Number.isFinite(o.min) && Number.isFinite(o.max);
  });
}

// ---------------------------------------------------------------- tree derives from BODY_LINKS

Deno.test("the part tree is derived from BODY_LINKS and matches it", () => {
  // Every link's child is a node whose parent is that link's parent.
  for (const link of BODY_LINKS) {
    const node = PART_TREE[link.to];
    assert(node !== undefined, `link target ${link.to} is missing from the tree`);
    assert(node.parent === link.from, `${link.to} hangs off ${node.parent}, but the link says ${link.from}`);
  }
  // Centre links carry their side straight through.
  for (const link of BODY_LINKS.filter((l) => l.side === "centre")) {
    assert(PART_TREE[link.to].side === "centre", `${link.to} is a centre part but reads ${PART_TREE[link.to].side}`);
  }
  // Mirrored parts sit on their representative (left) link.
  for (const part of ["upperArm", "foreArm", "hand", "thigh", "shin", "foot"] as const) {
    assert(PART_TREE[part].side === "left", `${part} should record its left link`);
  }
});

Deno.test("the tree has exactly the declared parts, the root on top, depth increasing", () => {
  const keys = Object.keys(PART_TREE).sort();
  assert(keys.length === BODY_PARTS.length, `tree has ${keys.length} nodes, expected ${BODY_PARTS.length}`);
  for (const part of BODY_PARTS) assert(PART_TREE[part] !== undefined, `${part} is missing from the tree`);

  const root = PART_TREE[BODY_ROOT];
  assert(root.parent === null, "the root has no parent");
  assert(root.depth === 0, "the root is at depth 0");
  assert(root.side === "centre", "the root is a centre part");

  for (const part of BODY_PARTS) {
    const node = PART_TREE[part];
    const side: BodySide = node.side;
    assert(side === "centre" || side === "left" || side === "right", `${part} has a bad side ${side}`);
    if (node.parent !== null) {
      assert(PART_TREE[node.parent].depth < node.depth, `${part} is not deeper than its parent ${node.parent}`);
    }
  }
  // The chains the coupling relies on are real in the tree.
  assert(PART_TREE.upperArm.parent === "chest" && PART_TREE.foreArm.parent === "upperArm" && PART_TREE.hand.parent === "foreArm", "arm chain");
  assert(PART_TREE.thigh.parent === "pelvis" && PART_TREE.shin.parent === "thigh" && PART_TREE.foot.parent === "shin", "leg chain");
});

// ---------------------------------------------------------------- child range narrows with a small parent

Deno.test("a child's resolved range narrows when the parent is small", () => {
  const chestRoot = BODY_PART_SHAPES.chest.root;
  const big = resolveRange("upperArm", { rootRadius: chestRoot });
  const small = resolveRange("upperArm", { rootRadius: chestRoot * 0.5 });
  assert(small.rootRadius.max < big.rootRadius.max, "a smaller parent must lower the child's max radius");
  assert(small.rootRadius.min < big.rootRadius.min, "a smaller parent must lower the child's min radius");
  // Length follows the parent's length the same way.
  const bigLen = resolveRange("foreArm", { length: BODY_PART_SHAPES.upperArm.length });
  const smallLen = resolveRange("foreArm", { length: BODY_PART_SHAPES.upperArm.length * 0.5 });
  assert(smallLen.length.max < bigLen.length.max, "a shorter parent must shorten the child's range");
});

Deno.test("a child's max radius never exceeds the socket cap of its parent's radius", () => {
  // The upper arm at its base radius is the forearm's socket; the forearm's root radius
  // must stay a fraction of it, or the joint step comes back.
  const parentVal = BODY_PART_SHAPES.upperArm.root;
  const r = resolveRange("foreArm", { rootRadius: parentVal });
  assert(r.rootRadius.max <= parentVal + 1e-9, `forearm radius ${r.rootRadius.max} outgrew its socket ${parentVal}`);
  assert(r.rootRadius.max < BODY_PART_SHAPES.foreArm.root * 1.22, "the cap actually bites, it is not just the base spread");
});

// ---------------------------------------------------------------- effectiveLimits narrows monotonically

Deno.test("effectiveLimits narrows monotonically as the parent joint travels", () => {
  let prevMin = Number.NEGATIVE_INFINITY;
  let prevMax = Number.POSITIVE_INFINITY;
  let prevWidth = Number.POSITIVE_INFINITY;
  const widths: number[] = [];
  for (const shoulder of [0, 0.5, 1.0, 1.5, 2.0]) {
    const lim = effectiveLimits("elbow", { shoulder });
    const width = lim.max - lim.min;
    assert(lim.min >= prevMin - 1e-9, `min went backwards at shoulder=${shoulder}`);
    assert(lim.max <= prevMax + 1e-9, `max went forwards at shoulder=${shoulder}`);
    assert(width <= prevWidth + 1e-9, `range widened at shoulder=${shoulder}`);
    prevMin = lim.min;
    prevMax = lim.max;
    prevWidth = width;
    widths.push(width);
  }
  assert(widths[widths.length - 1] < widths[0] - 1e-6, "the fully travelled shoulder must actually narrow the elbow");
});

Deno.test("coupling composes three levels deep", () => {
  const elbowOnly = effectiveLimits("wrist", { elbow: 1.0 });
  const elbowAndShoulder = effectiveLimits("wrist", { elbow: 1.0, shoulder: 1.5 });
  const w1 = elbowOnly.max - elbowOnly.min;
  const w2 = elbowAndShoulder.max - elbowAndShoulder.min;
  assert(w2 < w1, `the shoulder must narrow the wrist on top of the elbow (${w2} !< ${w1})`);
  // The same composition on the leg chain: hip -> knee -> ankle.
  const kneeOnly = effectiveLimits("ankle", { knee: 1.0 });
  const kneeAndHip = effectiveLimits("ankle", { knee: 1.0, hip: 0.8 });
  assert(kneeAndHip.max - kneeAndHip.min < kneeOnly.max - kneeOnly.min, "the hip must narrow the ankle on top of the knee");
  // And the spine chain: waist -> ribcage -> neckJoint.
  const ribOnly = effectiveLimits("neckJoint", { ribcage: 0.35 });
  const ribAndWaist = effectiveLimits("neckJoint", { ribcage: 0.35, waist: 0.5 });
  assert(ribAndWaist.max - ribAndWaist.min < ribOnly.max - ribOnly.min, "the waist must narrow the neck on top of the ribcage");
});

// ---------------------------------------------------------------- validateChain

Deno.test("validateChain reports exactly the violating part", () => {
  const values: SilhouetteValues = { upperArm: { length: 999 } };
  const bad = validateChain("upperArm", values);
  assert(bad.length === 1, `expected one violation, got ${bad.length}`);
  assert(bad[0].part === "upperArm", "the violation names the offending part");
  assert(bad[0].param === "length", "the violation names the offending parameter");
  assert(bad[0].value === 999, "the violation reports the value");
  assert(bad[0].max < 999 && bad[0].min <= bad[0].max, "the violation reports the bound it broke");

  // A different part is untouched by the bad one's values.
  assert(validateChain("foreArm", values).length === 0, "an unrelated part must not be flagged");

  // A value inside the resolved range passes; an empty silhouette never violates.
  const r = resolveRange("upperArm", {});
  assert(validateChain("upperArm", { upperArm: { rootRadius: r.rootRadius.min } }).length === 0, "an in-range value passes");
  assert(validateChain("upperArm", {}).length === 0, "no values, no violation");
});

// ---------------------------------------------------------------- randomWithin stays in range

Deno.test("randomWithin never escapes the resolved range over many samples", () => {
  let state = 123456789;
  const rng = () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
  const parent = { rootRadius: BODY_PART_SHAPES.chest.root };
  const resolved = resolveRange("upperArm", parent);
  for (let i = 0; i < 3000; i++) {
    const v = randomWithin("upperArm", parent, rng);
    for (const p of PARAMS) {
      assert(v[p] >= resolved[p].min - 1e-9 && v[p] <= resolved[p].max + 1e-9,
        `sample ${i} param ${p} = ${v[p]} escaped [${resolved[p].min}, ${resolved[p].max}]`);
    }
  }
  // With the parent small, the sampled radius is bounded by the small resolved range too.
  const smallParent = { rootRadius: BODY_PART_SHAPES.chest.root * 0.4 };
  const smallResolved = resolveRange("upperArm", smallParent);
  for (let i = 0; i < 500; i++) {
    const v = randomWithin("upperArm", smallParent, rng);
    assert(v.rootRadius <= smallResolved.rootRadius.max + 1e-9, "a small parent bounds the random radius");
  }
});

// ---------------------------------------------------------------- totality

Deno.test("no entry point returns NaN for non-finite input", () => {
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const b of bad) {
    const r = resolveRange("upperArm", { rootRadius: b, length: b });
    assert(allFinite(r), `resolveRange produced NaN for ${b}`);
    assert(allFinite(resolveRange(BODY_ROOT, {})), "the root resolves finite with no parent values");

    const lim = effectiveLimits("wrist", { shoulder: b, elbow: b });
    assert(Number.isFinite(lim.min) && Number.isFinite(lim.max), `effectiveLimits produced NaN for ${b}`);

    const vs = validateChain("upperArm", { upperArm: { length: b, rootRadius: b } });
    for (const v of vs) {
      assert(Number.isFinite(v.value) && Number.isFinite(v.min) && Number.isFinite(v.max), `validateChain produced NaN for ${b}`);
    }

    const rw = randomWithin("hand", { rootRadius: b }, () => b);
    assert(allFinite(rw), `randomWithin produced NaN for ${b}`);
  }
});
