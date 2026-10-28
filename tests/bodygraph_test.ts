// The nervous system: the body's connectivity graph. These pin the two things it exists
// to guarantee — that the body is ONE piece, and that every joint is held by a muscle
// pair that never both go slack.
import {
  BODY_LINKS,
  BODY_ROOT,
  components,
  isConnected,
  isJoined,
  linksAtJoint,
  linksOf,
  MUSCLES,
  orphans,
  parentLink,
  reachableFrom,
  socketFor,
  tensionAt,
  type JointId,
} from "../src/game/BodyGraph.ts";
import { BODY_PARTS, type BodyPartName } from "../src/game/BodyProfile.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(String(message)); }

Deno.test("every rendered part is reachable from the root — the body is one piece", () => {
  const floating = orphans(BODY_PARTS);
  assert(floating.length === 0, `parts the graph cannot reach (drawn as floating islands): ${floating.join(", ")}`);
  assert(isConnected(BODY_PARTS), "isConnected agrees with orphans()");
  assert(reachableFrom().length === BODY_PARTS.length, "the graph reaches exactly the declared parts");
});

Deno.test("orphans() actually detects a disconnection (it is not a stub that always passes)", () => {
  // A part the graph has never heard of must be reported, not silently accepted.
  const ghost = "tentacle" as BodyPartName;
  const found = orphans([...BODY_PARTS, ghost]);
  assert(found.length === 1 && found[0] === ghost, `expected only the ghost to be orphaned, got ${found.join(",")}`);
});

Deno.test("the link graph is a single connected component", () => {
  const parts = components();
  assert(parts.length === 1, `expected 1 component, got ${parts.length}: ${parts.map((p) => p.length).join("+")}`);
  assert(parts[0].length === BODY_PARTS.length, "the single component covers every part");
});

Deno.test("every link attaches a part to a part that itself exists in the graph", () => {
  for (const l of BODY_LINKS) {
    assert(BODY_PARTS.includes(l.from), `link parent ${l.from} is not a real part`);
    assert(BODY_PARTS.includes(l.to), `link child ${l.to} is not a real part`);
    assert(l.from !== l.to, `link ${l.from}->${l.to} attaches a part to itself`);
    // The parent must be nearer the root, or the chain is not a tree.
    assert(reachableFrom().includes(l.from), `link parent ${l.from} is unreachable from the root`);
  }
});

Deno.test("every limb is SEATED into its parent, never merely butted against it", () => {
  // A zero or negative seat is exactly the step at the shoulder the eye reads as a
  // detached arm, so this is the invariant that keeps limbs attached.
  for (const l of BODY_LINKS) {
    assert(l.seat > 0, `${l.from}->${l.to} (${l.joint}) has seat ${l.seat}; a limb must overlap its parent`);
    assert(l.blend > 0, `${l.from}->${l.to} (${l.joint}) has no connector loft (blend ${l.blend})`);
  }
});

Deno.test("the shoulder and hip seats are the deepest, so limbs emerge from the torso", () => {
  const seat = (j: JointId) => linksAtJoint(j)[0]?.seat ?? 0;
  for (const j of ["shoulder", "hip"] as JointId[]) {
    assert(seat(j) > seat("elbow"), `${j} must be seated deeper than the elbow`);
    assert(seat(j) > seat("knee"), `${j} must be seated deeper than the knee`);
    assert(seat(j) > seat("wrist"), `${j} must be seated deeper than the wrist`);
  }
});

Deno.test("every side-specific joint is mirrored left and right", () => {
  for (const j of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"] as JointId[]) {
    const sides = linksAtJoint(j).map((l) => l.side).sort();
    assert(sides.length === 2, `${j} has ${sides.length} links, expected one per side`);
    assert(sides[0] === "left" && sides[1] === "right", `${j} sides are ${sides.join("/")}, expected left/right`);
  }
});

Deno.test("every joint names a muscle pair, and both muscles exist", () => {
  for (const l of BODY_LINKS) {
    for (const id of l.muscles) {
      assert(MUSCLES[id] !== undefined, `${l.joint} names muscle '${id}' which is not in the table`);
      assert(MUSCLES[id].strength > 0, `${id} has no strength`);
    }
    assert(l.muscles[0] !== l.muscles[1], `${l.joint} pairs a muscle with itself`);
  }
});

Deno.test("muscles are ALWAYS opposing: neither side of a pair ever goes slack", () => {
  // The point of an antagonist pair: a held pose is two muscles pulling against each
  // other, never a bone with a limp muscle on the far side.
  for (const l of BODY_LINKS) {
    for (const angle of [-1, -0.5, 0, 0.5, 1]) {
      const t = tensionAt(l, angle);
      assert(t.tension > 0, `${l.joint} at ${angle}: agonist has no tension`);
      assert(t.extension > 0, `${l.joint} at ${angle}: antagonist has no tension`);
    }
  }
});

Deno.test("closing a joint loads the agonist and leaves the antagonist at tone", () => {
  const shoulder = linksAtJoint("shoulder")[0];
  const flexed = tensionAt(shoulder, 1);
  const relaxed = tensionAt(shoulder, 0);
  assert(flexed.tension > relaxed.tension, "closing the joint must raise agonist tension");
  assert(flexed.extension === MUSCLES[shoulder.muscles[1]].tone, "the antagonist holds only its tone");
  const opened = tensionAt(shoulder, -1);
  assert(opened.extension > relaxed.extension, "opening the joint must raise antagonist tension");
  assert(opened.tension === MUSCLES[shoulder.muscles[0]].tone, "the agonist holds only its tone");
});

Deno.test("tensionAt is total: a non-finite angle cannot produce NaN", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    const t = tensionAt(BODY_LINKS[0], bad);
    assert(Number.isFinite(t.tension) && Number.isFinite(t.extension), `angle ${bad} produced a non-finite tension`);
  }
});

Deno.test("connectivity queries agree with the link table", () => {
  assert(isJoined("chest", "upperArm"), "the arm is joined to the chest");
  assert(isJoined("upperArm", "chest"), "isJoined is symmetric");
  assert(!isJoined("chest", "shin"), "the shin is not directly joined to the chest");
  assert(linksOf("chest").length > 1, "the chest is a hub");
  assert(parentLink(BODY_ROOT) === null, "the root has no parent");
  const socket = socketFor("upperArm");
  assert(socket !== null && socket.joint === "shoulder", "an arm's socket is the shoulder");
  assert(socket!.seat === linksAtJoint("shoulder")[0].seat, "the socket reports the link's own seat");
  assert(socketFor(BODY_ROOT) === null, "the root has no socket");
});

Deno.test("the new plate geometries are attached to the ribcage, not floating", () => {
  for (const plate of ["pectorals", "scapulae"] as BodyPartName[]) {
    assert(isJoined("chest", plate), `${plate} must be joined to the chest`);
    const socket = socketFor(plate);
    assert(socket !== null && socket.seat > 0, `${plate} must be seated into the chest`);
  }
  assert(parentLink("pectorals")?.joint === "ribcage", "pectorals ride the ribcage");
  assert(parentLink("scapulae")?.joint === "ribcage", "scapulae ride the ribcage");
});
