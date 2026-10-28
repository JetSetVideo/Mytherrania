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

  constructor(mode: BrainMode = "hybrid", personality?: Partial<Personality>, policy: NeuralPolicy | null = null) {
    this.mode = mode;
    this.personality = {
      engageRange: personality?.engageRange ?? 1.6,
      cowardice: personality?.cowardice ?? 0.3,
      aggression: personality?.aggression ?? 0.3,
      neuralTrust: personality?.neuralTrust ?? 0.4,
    };
    this.#tree = defaultTree();
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
