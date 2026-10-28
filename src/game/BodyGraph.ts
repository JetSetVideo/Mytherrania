// The body's nervous system: the connectivity graph that says which part is joined to
// which, through what joint, how deeply it is seated, and which muscle pair drives it.
//
// Why this exists: the rig is built from independently animated pivots, so nothing in the
// geometry itself knows that an arm belongs to a torso. That is how a limb ends up drawn
// as a separate tube butted against the chest with a step at the shoulder. This module is
// the single source of truth for the TOPOLOGY — every limb is declared as a link from a
// parent part through a named joint, and the connector loft between them is generated from
// the link's `seat` and `blend` rather than hand-placed. A part with no link is an ORPHAN,
// which is exactly the "disconnected" state the eye reads as floating.
//
// It also carries the muscle pairs: every joint has an agonist/antagonist pair that pull
// against each other, so a pose is never a bone swinging alone but a pair held in tension
// and extension.
//
// Pure module: no Three.js, no DOM.

import type { BodyPartName } from "./BodyProfile.ts";

/** Which side of the body a link lives on. Centre links are the spine chain. */
export type BodySide = "centre" | "left" | "right";

/** Every articulation the rig can drive. One joint id per anatomical joint. */
export type JointId =
  | "ribcage" | "waist" | "neckJoint"
  | "shoulder" | "elbow" | "wrist"
  | "hip" | "knee" | "ankle";

/**
 * One articulation between a parent part (nearer the spine) and a child part (further
 * out). `seat` is how far the child's first ring is pushed back INTO the parent, in
 * metres, so the two surfaces overlap instead of abutting; `blend` is the length of the
 * connector loft that carries the parent's section into the child's.
 *
 * Both are per-link rather than global because a shoulder needs a deep seat (the deltoid
 * mass overlaps the ribcage) while an ankle needs a shallow one.
 */
export interface BodyLink {
  from: BodyPartName;
  to: BodyPartName;
  joint: JointId;
  side: BodySide;
  /** Metres the child's root is driven into the parent, so the surfaces interpenetrate. */
  seat: number;
  /** Length of the connector loft bridging parent section to child section. */
  blend: number;
  /** Muscle pair driving this joint, as [agonist, antagonist] ids into MUSCLES. */
  muscles: [string, string];
}

/** A named muscle, and which end of its joint's range it works on. */
export interface Muscle {
  id: string;
  label: string;
  /** Peak force coefficient at full contraction. */
  strength: number;
  /** Resting tone — the tension always present, which is what keeps a pose alive. */
  tone: number;
}

/**
 * The muscle table. Each joint has an agonist that closes it and an antagonist that opens
 * it; they pull against each other, so `tensionAt` never returns two zeros for a live
 * pose. Strength is the peak coefficient, tone the always-present resting tension.
 */
export const MUSCLES: Record<string, Muscle> = {
  deltoid: { id: "deltoid", label: "deltoid", strength: 1.0, tone: 0.18 },
  latissimus: { id: "latissimus", label: "latissimus dorsi", strength: 0.95, tone: 0.2 },
  biceps: { id: "biceps", label: "biceps brachii", strength: 0.9, tone: 0.16 },
  triceps: { id: "triceps", label: "triceps brachii", strength: 1.0, tone: 0.18 },
  flexorCarpi: { id: "flexorCarpi", label: "flexor carpi", strength: 0.7, tone: 0.14 },
  extensorCarpi: { id: "extensorCarpi", label: "extensor carpi", strength: 0.6, tone: 0.12 },
  iliopsoas: { id: "iliopsoas", label: "iliopsoas", strength: 0.85, tone: 0.2 },
  gluteus: { id: "gluteus", label: "gluteus maximus", strength: 1.05, tone: 0.22 },
  quadriceps: { id: "quadriceps", label: "quadriceps", strength: 1.1, tone: 0.24 },
  hamstrings: { id: "hamstrings", label: "hamstrings", strength: 1.0, tone: 0.22 },
  tibialis: { id: "tibialis", label: "tibialis anterior", strength: 0.7, tone: 0.16 },
  gastrocnemius: { id: "gastrocnemius", label: "gastrocnemius", strength: 0.95, tone: 0.2 },
  sternocleidomastoid: { id: "sternocleidomastoid", label: "sternocleidomastoid", strength: 0.55, tone: 0.14 },
  trapezius: { id: "trapezius", label: "trapezius", strength: 0.6, tone: 0.18 },
  rectusAbdominis: { id: "rectusAbdominis", label: "rectus abdominis", strength: 0.8, tone: 0.2 },
  erectorSpinae: { id: "erectorSpinae", label: "erector spinae", strength: 0.9, tone: 0.26 },
  intercostals: { id: "intercostals", label: "intercostals", strength: 0.5, tone: 0.16 },
  serratus: { id: "serratus", label: "serratus anterior", strength: 0.65, tone: 0.18 },
  pectoralis: { id: "pectoralis", label: "pectoralis major", strength: 1.0, tone: 0.2 },
  rhomboid: { id: "rhomboid", label: "rhomboid", strength: 0.7, tone: 0.18 },
};

/**
 * The topology. Every limb is a link from a parent part; a part that appears as no link's
 * `to` and is not the root is an orphan, and `orphans()` will say so.
 *
 * `seat` is deliberately generous at the shoulder and hip: the deltoid and gluteal masses
 * must overlap the torso so the limb emerges FROM the body rather than being pressed
 * against it. That overlap is what removes the step the eye reads as a detached limb.
 */
export const BODY_LINKS: BodyLink[] = [
  // ---- spine chain (centre) ----
  { from: "pelvis", to: "abdomen", joint: "waist", side: "centre", seat: 0.06, blend: 0.10, muscles: ["rectusAbdominis", "erectorSpinae"] },
  { from: "abdomen", to: "chest", joint: "ribcage", side: "centre", seat: 0.07, blend: 0.12, muscles: ["intercostals", "serratus"] },
  { from: "chest", to: "neck", joint: "neckJoint", side: "centre", seat: 0.05, blend: 0.07, muscles: ["sternocleidomastoid", "trapezius"] },
  { from: "neck", to: "head", joint: "neckJoint", side: "centre", seat: 0.04, blend: 0.05, muscles: ["sternocleidomastoid", "trapezius"] },

  // ---- chest-borne plates: the new geometries ----
  { from: "chest", to: "pectorals", joint: "ribcage", side: "centre", seat: 0.03, blend: 0.05, muscles: ["pectoralis", "rhomboid"] },
  { from: "chest", to: "scapulae", joint: "ribcage", side: "centre", seat: 0.03, blend: 0.05, muscles: ["rhomboid", "serratus"] },

  // ---- arms (mirrored) ----
  { from: "chest", to: "upperArm", joint: "shoulder", side: "left", seat: 0.13, blend: 0.09, muscles: ["deltoid", "latissimus"] },
  { from: "chest", to: "upperArm", joint: "shoulder", side: "right", seat: 0.13, blend: 0.09, muscles: ["deltoid", "latissimus"] },
  { from: "upperArm", to: "foreArm", joint: "elbow", side: "left", seat: 0.05, blend: 0.05, muscles: ["biceps", "triceps"] },
  { from: "upperArm", to: "foreArm", joint: "elbow", side: "right", seat: 0.05, blend: 0.05, muscles: ["biceps", "triceps"] },
  { from: "foreArm", to: "hand", joint: "wrist", side: "left", seat: 0.03, blend: 0.03, muscles: ["flexorCarpi", "extensorCarpi"] },
  { from: "foreArm", to: "hand", joint: "wrist", side: "right", seat: 0.03, blend: 0.03, muscles: ["flexorCarpi", "extensorCarpi"] },

  // ---- legs (mirrored) ----
  { from: "pelvis", to: "thigh", joint: "hip", side: "left", seat: 0.12, blend: 0.10, muscles: ["iliopsoas", "gluteus"] },
  { from: "pelvis", to: "thigh", joint: "hip", side: "right", seat: 0.12, blend: 0.10, muscles: ["iliopsoas", "gluteus"] },
  { from: "thigh", to: "shin", joint: "knee", side: "left", seat: 0.05, blend: 0.05, muscles: ["quadriceps", "hamstrings"] },
  { from: "thigh", to: "shin", joint: "knee", side: "right", seat: 0.05, blend: 0.05, muscles: ["quadriceps", "hamstrings"] },
  { from: "shin", to: "foot", joint: "ankle", side: "left", seat: 0.03, blend: 0.03, muscles: ["tibialis", "gastrocnemius"] },
  { from: "shin", to: "foot", joint: "ankle", side: "right", seat: 0.03, blend: 0.03, muscles: ["tibialis", "gastrocnemius"] },
];

/** The part every other part is reachable from. */
export const BODY_ROOT: BodyPartName = "pelvis";

/** Every link that attaches `part` to something, either as parent or as child. */
export function linksOf(part: BodyPartName): BodyLink[] {
  return BODY_LINKS.filter((l) => l.from === part || l.to === part);
}

/** The link that seats `part` into its parent, or null for the root. */
export function parentLink(part: BodyPartName): BodyLink | null {
  return BODY_LINKS.find((l) => l.to === part && l.side === "centre") ?? BODY_LINKS.find((l) => l.to === part) ?? null;
}

/** Is there a direct link between two parts, in either direction? */
export function isJoined(a: BodyPartName, b: BodyPartName): boolean {
  return BODY_LINKS.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));
}

/**
 * Walk the links breadth-first from the root and return everything reachable.
 *
 * This is the "is the body actually connected" answer: a part that exists in the geometry
 * but is not reachable from the root is drawn as a floating island.
 */
export function reachableFrom(root: BodyPartName = BODY_ROOT): BodyPartName[] {
  const seen = new Set<BodyPartName>([root]);
  const queue: BodyPartName[] = [root];
  while (queue.length) {
    const at = queue.shift()!;
    for (const l of BODY_LINKS) {
      const next = l.from === at ? l.to : l.to === at ? l.from : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return [...seen];
}

/**
 * The parts passed in that the graph cannot reach from the root — the disconnected ones.
 * Feed this every part the renderer actually builds and it names what is floating.
 */
export function orphans(allParts: readonly BodyPartName[]): BodyPartName[] {
  const reached = new Set(reachableFrom());
  return allParts.filter((p) => !reached.has(p));
}

/** Connected components of the link graph, largest first. More than one means a split body. */
export function components(): BodyPartName[][] {
  const parts = new Set<BodyPartName>();
  for (const l of BODY_LINKS) { parts.add(l.from); parts.add(l.to); }
  const left = new Set(parts);
  const out: BodyPartName[][] = [];
  while (left.size) {
    const seed = left.values().next().value as BodyPartName;
    const group = reachableFrom(seed).filter((p) => parts.has(p));
    for (const p of group) left.delete(p);
    left.delete(seed);
    out.push(group);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** True when every part is reachable from the root — the body is one piece. */
export function isConnected(allParts: readonly BodyPartName[] = [...new Set(BODY_LINKS.flatMap((l) => [l.from, l.to]))]): boolean {
  return orphans(allParts).length === 0;
}

/** Every link on a joint, so a joint can be posed on both sides at once. */
export function linksAtJoint(joint: JointId): BodyLink[] {
  return BODY_LINKS.filter((l) => l.joint === joint);
}

/**
 * Muscle activation at a joint.
 *
 * `angle` is the joint's normalised flexion in [-1, 1]: +1 is fully closed (flexed), -1
 * fully open (extended), 0 the neutral pose. The agonist closes the joint, the antagonist
 * opens it, and BOTH keep their resting tone — so a held pose is a pair pulling against
 * each other rather than a bone with slack muscle on one side.
 *
 * Returns the two muscle ids with their activation in [tone, tone + strength].
 */
export function tensionAt(link: BodyLink, angle: number): {
  agonist: string;
  antagonist: string;
  tension: number;
  extension: number;
} {
  const a = MUSCLES[link.muscles[0]];
  const b = MUSCLES[link.muscles[1]];
  const flex = Math.max(-1, Math.min(1, Number.isFinite(angle) ? angle : 0));
  const closing = Math.max(0, flex);
  const opening = Math.max(0, -flex);
  return {
    agonist: link.muscles[0],
    antagonist: link.muscles[1],
    tension: a.tone + a.strength * closing,
    extension: b.tone + b.strength * opening,
  };
}

/**
 * Seat and blend for a part, taken from its parent link — the numbers the rig uses to
 * push a limb's root into the torso and to size the connector loft between them.
 */
export function socketFor(part: BodyPartName): { seat: number; blend: number; joint: JointId } | null {
  const link = parentLink(part);
  return link ? { seat: link.seat, blend: link.blend, joint: link.joint } : null;
}
