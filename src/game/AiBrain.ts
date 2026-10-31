// Adaptive AI brain: a per-AI personality that mutates its own decision tree
// from the fight record and the live telemetry digest.
//
// The brain sits ON TOP of the hand-written decision tree (DecisionTree.ts) and
// the neural policy (balance/NeuralPolicy.ts). It does not replace them; it
// retunes the tree's thresholds and picks how much to trust the network, using:
//   - the career win rate (a winner gets bolder, a loser more cautious),
//   - the favourite technique and the damage actually dealt by it,
//   - how close fights run (avg distance to the enemy vs. weapon reach).
//
// Pure module: no Three.js, no DOM. decideBrain() is the single entry point the
// Engine calls each tick.

import { decide, defaultTree, type CombatView, type Decision, type TreeNode } from "./DecisionTree.ts";
import { NeuralPolicy, toFeatures } from "../balance/NeuralPolicy.ts";
import type { TelemetryDigest } from "./AiStats.ts";
import type { ArenaDigest } from "./arena/contracts.ts";
import type { Skill } from "./Skills.ts";

export type BrainMode = "tree" | "neural" | "hybrid";

/** The mutable knobs the adaptation loop tunes. All bounded. */
export interface Personality {
  /** Distance at which "in range" flips to "out of range" (m). */
  engageRange: number;
  /** HP ratio below which the AI turns defensive. */
  cowardice: number;
  /** HP ratio below which it presses a winning attack. */
  aggression: number;
  /** How much the neural policy overrides the tree, 0..1. */
  neuralTrust: number;
}

export const PERSONALITY_BOUNDS: Record<keyof Personality, [number, number]> = {
  engageRange: [1.0, 3.0],
  cowardice: [0.1, 0.7],
  aggression: [0.1, 0.7],
  neuralTrust: [0, 1],
};

function clamp(v: number, [lo, hi]: [number, number]): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * A fighting brain: identity, the base tree, a personality, an optional neural
 * policy, and the win/loss memory that adapts all three.
 */
export class Brain {
  mode: BrainMode;
  personality: Personality;
  /** The tree this brain actually walks (rebuilt when the personality changes). */
  #tree: TreeNode;
  #policy: NeuralPolicy | null;

  /**
   * `tree` (Wave J, optional): the tree to walk — e.g. DecisionTree.edgeAwareTree() for a bot fed
   * the arena digest features. Default defaultTree(), so existing callers are unchanged.
   */
  constructor(mode: BrainMode = "hybrid", personality?: Partial<Personality>, policy: NeuralPolicy | null = null, tree?: TreeNode) {
    this.mode = mode;
    this.personality = {
      engageRange: personality?.engageRange ?? 1.6,
      cowardice: personality?.cowardice ?? 0.3,
      aggression: personality?.aggression ?? 0.3,
      neuralTrust: personality?.neuralTrust ?? 0.4,
    };
    this.#tree = tree ?? defaultTree();
    this.#policy = policy;
  }

  tree(): TreeNode { return this.#tree; }
  policy(): NeuralPolicy | null { return this.#policy; }

  /**
   * Adapt from a finished fight. `won` is the result, `digest` the telemetry.
   * The rules are small, monotone and bounded so adaptation is explainable:
   * a win reinforces what worked, a loss backs it off.
   */
  adapt(won: boolean, winRate: number, digest: TelemetryDigest): void {
    const p = this.personality;
    const step = 0.05;
    if (won) {
      // Winning: press harder, trust the winning network more.
      p.aggression = clamp(p.aggression + step, PERSONALITY_BOUNDS.aggression);
      p.cowardice = clamp(p.cowardice - step, PERSONALITY_BOUNDS.cowardice);
      p.neuralTrust = clamp(p.neuralTrust + step, PERSONALITY_BOUNDS.neuralTrust);
    } else {
      // Losing: get cautious, second-guess the network.
      p.aggression = clamp(p.aggression - step, PERSONALITY_BOUNDS.aggression);
      p.cowardice = clamp(p.cowardice + step, PERSONALITY_BOUNDS.cowardice);
      p.neuralTrust = clamp(p.neuralTrust - step, PERSONALITY_BOUNDS.neuralTrust);
    }
    // Engage range chases the reach the fights actually run at: if the average
    // distance-to-enemy was far beyond the engage range, the AI never closed.
    const avgDist = digest.distToEnemy.mean;
    if (digest.distToEnemy.n > 8 && avgDist > p.engageRange * 1.5) {
      p.engageRange = clamp(p.engageRange + step, PERSONALITY_BOUNDS.engageRange);
    }
    // A career-long loser loosens up so it tries something new.
    if (winRate < 0.35) p.engageRange = clamp(p.engageRange + step, PERSONALITY_BOUNDS.engageRange);
  }

  /** Decide one action for this tick. */
  decide(view: CombatView, rng: () => number = Math.random): Decision {
    const treeDecision = decide(this.#tree, view);
    if (this.mode === "tree" || !this.#policy) return treeDecision;
    const nn = this.#policy.decide(toFeatures({
      distance: view.distance,
      selfReach: view.selfReach,
      enemyReach: view.enemyReach,
      selfHpRatio: view.selfHpRatio,
      enemyHpRatio: view.enemyHpRatio,
      nearEdge: view.nearEdge,
      ready: view.ready,
    }));
    if (this.mode === "neural") return nn;
    // Hybrid: the network wins with probability = neuralTrust.
    return rng() < this.personality.neuralTrust ? nn : treeDecision;
  }
}

/**
 * Attach a personality's engage range to a tree: rewrite every branch that
 * thresholds on `distance` so the personality's value is the one used. Returns a
 * new tree; the input is untouched.
 */
export function applyPersonality(tree: TreeNode, p: Personality): TreeNode {
  if (tree.kind === "leaf") return tree;
  const threshold = tree.field === "distance" ? p.engageRange : tree.threshold;
  return { ...tree, threshold, less: applyPersonality(tree.less!, p), greater: applyPersonality(tree.greater!, p) };
}

// ---------------------------------------------------------------------------
// Data-driven action dispatch (replaces the per-caller if/else chains).
// ---------------------------------------------------------------------------

/** The world an action needs to move a fighter and signal the engine. */
export interface ActionContext {
  /** Unit vector toward the enemy. */
  dirX: number;
  dirZ: number;
  /** Distance to the enemy (m). */
  dist: number;
  /** Movement speed this frame (m/s). */
  speed: number;
  /** Frame delta (s). */
  dt: number;
  /** Move the fighter by (dx, dz) metres. */
  move(dx: number, dz: number): void;
  /** Set the block animation window. */
  block(seconds: number): void;
  /** Attempt the attack; returns true if it fired. */
  attack(): boolean;
}

/**
 * The action table: each decision maps to a movement vector (in the enemy frame)
 * and an optional effect. Advance/retreat/flank move; block signals; attack and
 * wait have no movement. Data, not branches, so a new action is a row, not a chain.
 */
export interface ActionDef {
  /** Movement as [toward, strafe] multipliers of speed*dt (0 = no move). */
  move?: [toward: number, strafe: number];
  blockFor?: number;
  isAttack?: boolean;
}

export const ACTIONS: Record<Decision, ActionDef> = {
  attack: { isAttack: true },
  advance: { move: [1, 0] },
  retreat: { move: [-1, 0] },
  block: { blockFor: 0.4 },
  flank: { move: [0, 1] },
  wait: {},
};

/**
 * Execute a decision against the context. Returns true when something happened
 * (a move, a block, or an attack that fired). One lookup, no else chain.
 */
export function executeAction(action: Decision, ctx: ActionContext): boolean {
  const def = ACTIONS[action];
  if (def.isAttack) return ctx.attack();
  if (def.blockFor !== undefined) { ctx.block(def.blockFor); return true; }
  if (def.move) {
    const [toward, strafe] = def.move;
    const step = ctx.speed * ctx.dt;
    // toward = along the enemy vector, strafe = perpendicular (right-hand).
    ctx.move(
      (ctx.dirX * toward + -ctx.dirZ * strafe) * step,
      (ctx.dirZ * toward + ctx.dirX * strafe) * step,
    );
    return true;
  }
  return false; // wait
}

// ---------------------------------------------------------------------------
// Wave J: edge play from the arena digest (StrategyLevel "full").
// ---------------------------------------------------------------------------

/**
 * Where a "full"-strategy fighter wants to stand: on the far side of the enemy from the enemy's
 * nearest OPEN rim point, at `standoff` metres, so every blow throws the enemy toward the open edge
 * (the knockback line runs attacker -> defender). Null when the arena has no open edge. The target
 * is pulled inside the rim by `margin` so the fighter never steers itself onto its own edge.
 */
export function edgePlayTarget(
  d: Pick<ArenaDigest, "rim" | "open">,
  enemy: { x: number; z: number },
  standoff: number,
  margin = 1,
): { x: number; z: number } | null {
  const n = d.rim.length;
  let ox = 0, oz = 0, best = Infinity;
  for (let i = 0; i < n; i++) {
    if ((d.open[i] ?? 0) < 0.5) continue;
    const a = (i / n) * Math.PI * 2;
    const px = Math.cos(a) * d.rim[i], pz = Math.sin(a) * d.rim[i];
    const dist = Math.hypot(px - enemy.x, pz - enemy.z);
    if (dist < best) { best = dist; ox = px; oz = pz; }
  }
  if (!Number.isFinite(best) || best < 1e-9) return null;
  const ux = (ox - enemy.x) / best, uz = (oz - enemy.z) / best;
  let tx = enemy.x - ux * standoff, tz = enemy.z - uz * standoff;
  // Keep the target inside the rim (bearing-wise) by `margin`.
  const r = Math.hypot(tx, tz);
  if (r > 1e-9) {
    const a = Math.atan2(tz, tx);
    const k = Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2 / n)) % n;
    const lim = Math.max(0, (d.rim[k] ?? r) - margin);
    if (r > lim) { tx *= lim / r; tz *= lim / r; }
  }
  return Number.isFinite(tx) && Number.isFinite(tz) ? { x: tx, z: tz } : null;
}

/**
 * The strafe sign (+1 = the ACTIONS "flank" direction, right-hand of the enemy vector) that circles
 * self around the enemy toward `target`. 0 when already there (within 0.3 m).
 */
export function strafeToward(self: { x: number; z: number }, enemy: { x: number; z: number }, target: { x: number; z: number }): -1 | 0 | 1 {
  if (Math.hypot(target.x - self.x, target.z - self.z) < 0.3) return 0;
  const dirX = enemy.x - self.x, dirZ = enemy.z - self.z;
  // Flank moves along (-dirZ, dirX); project the wanted displacement on it.
  const along = (target.x - self.x) * -dirZ + (target.z - self.z) * dirX;
  return along >= 0 ? 1 : -1;
}

/**
 * Is a technique sensible to start here? A skill whose animation LUNGES BACKWARD (Archer "Rolling
 * Shot": lunge −2.6 m; "Piercing Shot" −0.4 m) carries its user away from the enemy, along the very
 * line a blow would throw it:
 *   - with the back to an OPEN edge closer than the roll (+ a 0.35 m footprint) it is a
 *     self-ring-out (needs the digest features; absent = not checked);
 *   - ending out of the user's own reach it only widens the gap. chooseAiSkill picks "dash" as its
 *     gap-closer when far, and the Archer's dash IS the backward roll: the live AI archer rolls away
 *     every 3.5 s and never closes (measured in the headless sim: 0 hits in 180 s).
 * A stance that SLOWS its user (payload.speedMul < 1, e.g. Archer "Steady Aim" ×0.4) started out
 * of reach only slows the approach against a longer weapon; it waits until in reach.
 * A forward or zero lunge without a slowing stance is always sensible.
 */
export function sensibleSkill(
  skill: Pick<Skill, "animation" | "payload">,
  view: Pick<CombatView, "openBehind" | "rimBehind" | "distance" | "selfReach">,
): boolean {
  if ((skill.payload.speedMul ?? 1) < 1 && view.distance > view.selfReach) return false;
  const lunge = skill.animation.lunge;
  if (!(lunge < 0)) return true;
  // A backward lunge that ends out of the user's own reach only opens the gap (a melee-armed
  // archer rolled 2.6 m away from a target it could hit, then could not close against a longer weapon).
  if (view.distance - lunge > view.selfReach) return false;
  if (view.openBehind === undefined || view.rimBehind === undefined) return true;
  return !(view.openBehind >= 0.5 && -lunge + 0.35 >= view.rimBehind);
}
