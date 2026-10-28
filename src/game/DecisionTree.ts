export type Decision = "attack" | "advance" | "retreat" | "block" | "wait" | "flank";

export interface CombatView {
  distance: number;
  selfReach: number;
  enemyReach: number;
  selfHpRatio: number;
  enemyHpRatio: number;
  nearEdge: boolean;
  ready: boolean;
  // Adaptive fields
  enemyAttacking: number;    // 0=idle, 1=active attack animation
  selfDamagePercent: number; // accumulated damage %
  enemyDamagePercent: number;
  roundTime: number;         // seconds elapsed in the fight
}

export interface TreeNode {
  kind: "branch" | "leaf";
  field?: keyof CombatView;
  threshold?: number;
  less?: TreeNode;
  greater?: TreeNode;
  decision?: Decision;
}

// Richer decision tree with adaptive thresholds.
// Branches: edge danger, HP ratio, weapon reach, distance, and aggression.
export function decide(tree: TreeNode, view: CombatView): Decision {
  const v = (f: keyof CombatView) => view[f] as number;
  function walk(node: TreeNode): Decision {
    if (node.kind === "leaf") return node.decision!;
    const val = v(node.field!);
    if (val <= node.threshold!) return walk(node.less!);
    return walk(node.greater!);
  }
  return walk(tree);
}

// Default adaptive tree — more complex than the original.
export function defaultTree(): TreeNode {
  return {
    kind: "branch", field: "nearEdge",
    threshold: 0.5,
    // Not near edge (nearEdge=false, 0≤0.5 → less): normal combat
    less: {
      kind: "branch", field: "ready",
      threshold: 0,
      // ready=true (attack off cooldown) → attack logic
      greater: {
        kind: "branch", field: "distance",
        threshold: 1.5, // typical weapon reach
        // In range: attack or block
        less: {
          kind: "branch", field: "enemyAttacking",
          threshold: 0.5,
          less: { kind: "leaf", decision: "attack" },
          greater: {
            kind: "branch", field: "selfHpRatio",
            threshold: 0.5,
            less: { kind: "leaf", decision: "block" },
            greater: { kind: "leaf", decision: "attack" },
          },
        },
        // Out of range: advance
        greater: {
          kind: "branch", field: "selfHpRatio",
          threshold: 0.3,
          less: {
            kind: "branch", field: "enemyHpRatio",
            threshold: 0.3,
            less: { kind: "leaf", decision: "advance" },
            greater: { kind: "leaf", decision: "retreat" },
          },
          greater: { kind: "leaf", decision: "advance" },
        },
      },
      // On cooldown (ready=false)
      less: {
        kind: "branch", field: "distance",
        threshold: 2.0,
        less: {
          kind: "branch", field: "selfHpRatio",
          threshold: 0.5,
          less: { kind: "leaf", decision: "retreat" },
          greater: { kind: "leaf", decision: "block" },
        },
        greater: { kind: "leaf", decision: "advance" },
      },
    },
    // Near edge (nearEdge=true, 1>0.5 → greater): fight to survive
    greater: {
      kind: "branch", field: "selfHpRatio",
      threshold: 0.3,
      less: { kind: "leaf", decision: "block" },
      greater: {
        kind: "branch", field: "enemyAttacking",
        threshold: 0.5,
        less: { kind: "leaf", decision: "retreat" },
        greater: { kind: "leaf", decision: "block" },
      },
    },
  };
}

// Mutate: flip a random leaf's decision or tweak a threshold.
export function mutate(tree: TreeNode, rate: number, rng?: () => number): TreeNode {
  const rand = rng ?? (() => Math.random());
  const decisions: Decision[] = ["attack", "advance", "retreat", "block", "wait", "flank"];
  function walk(node: TreeNode): TreeNode {
    if (node.kind === "leaf") {
      if (rand() < rate) {
        return { ...node, decision: decisions[Math.floor(rand() * decisions.length)] };
      }
      return node;
    }
    const t = rand() < rate ? node.threshold! * (0.8 + rand() * 0.4) : node.threshold!;
    return { ...node, threshold: t, less: walk(node.less!), greater: walk(node.greater!) };
  }
  return walk(tree);
}