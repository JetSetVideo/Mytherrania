import type { ArenaDigest } from "./arena/contracts.ts";
import { engagement, type Stance } from "./Engagement.ts";
import type { PoolKind, PoolLevel } from "./Potential.ts";

/** Wave Y (C-AI): the seven primary attributes (runtime CombatStats scale). */
export type AttributeKey = "vitality" | "resilience" | "focus" | "reflex" | "strength" | "intelligence" | "agility";
export const ATTRIBUTE_KEYS: readonly AttributeKey[] = ["vitality", "resilience", "focus", "reflex", "strength", "intelligence", "agility"];

/**
 * Wave Y (C-AI): what the AI knows about one fighter beyond hp — all seven attributes and each
 * pool's {max, potential, current} (Potential.ts), plus the exhaustion flag and the fatigue
 * overload of the spend pools (Potential.fatigueReading, 0 = a sustainable pace).
 */
export interface FighterKnowledge {
  attributes: Record<AttributeKey, number>;
  pools: Record<PoolKind, PoolLevel>;
  exhausted: boolean;
  fatigue: { mana: number; stamina: number };
}

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
  // Wave J: what the arena digest says about the two knockback lines. All optional: a caller
  // without a digest leaves them out and every pre-Wave-J tree decides exactly as before.
  /** Distance from self to the rim along the line a blow would throw self (enemy -> self), m. */
  rimBehind?: number;
  /** Wall height where that line meets the rim, m (0 = open edge). */
  wallBehind?: number;
  /** 1 when that rim point is an open edge (a knocked body leaves the ring there), else 0. */
  openBehind?: number;
  /** The same three for the enemy, along self -> enemy (the line self's blows throw it). */
  enemyRimBehind?: number;
  enemyWallBehind?: number;
  enemyOpenBehind?: number;
  /** Angle (rad, 0..π) between self's current push line and the enemy's nearest ring-out lane. */
  laneOffset?: number;
  /** Fraction of the rim that is open (digest.openFraction). */
  openFraction?: number;
  // Wave M (lane M-B): the engagement inputs. Both optional — a caller without telemetry leaves
  // them out and every pre-Wave-M tree decides exactly as before (quietS reads as 0).
  /** Seconds since EITHER fighter last landed a hit — the quiet stretch (M-A's `quietS`), s. */
  quietS?: number;
  /** The fighter's stance, shaping the engagement intent. */
  stance?: Stance;
  // Wave Y (lane P, C-AI): both fighters' attributes and pools. Optional — absent, every tree and
  // every pool-aware hook decides exactly as before.
  self?: FighterKnowledge;
  enemy?: FighterKnowledge;
}

/** Distances the digest features report when the ray never meets an open edge (finite, for trees). */
export const FAR_EDGE = 99;

export interface TreeNode {
  kind: "branch" | "leaf";
  field?: keyof CombatView;
  threshold?: number;
  less?: TreeNode;
  greater?: TreeNode;
  decision?: Decision;
  /**
   * Wave J: the branch taken when the field is ABSENT (undefined / NaN). Default "greater" —
   * exactly what `undefined <= t` (false) always did, so old trees are unchanged.
   */
  missing?: "less" | "greater";
  /**
   * Wave M (lane M-B): an intent hook. Before the field comparison, a branch may compute a Decision
   * from the whole view (the engagement intent) — returning it takes the branch; returning
   * `undefined` falls through to the field comparison. Absent on every pre-Wave-M tree.
   */
  compute?: (view: CombatView) => Decision | undefined;
}

// Richer decision tree with adaptive thresholds.
// Branches: edge danger, HP ratio, weapon reach, distance, and aggression.
export function decide(tree: TreeNode, view: CombatView): Decision {
  const v = (f: keyof CombatView) => view[f] as number;
  function walk(node: TreeNode): Decision {
    if (node.kind === "leaf") return node.decision!;
    const hooked = node.compute?.(view);
    if (hooked !== undefined) return hooked;
    const raw = view[node.field!];
    if (raw === undefined || (typeof raw === "number" && Number.isNaN(raw))) {
      return walk(node.missing === "less" ? node.less! : node.greater!);
    }
    const val = v(node.field!);
    if (val <= node.threshold!) return walk(node.less!);
    return walk(node.greater!);
  }
  return walk(tree);
}

// ---------------------------------------------------------------------------
// Wave J: arena-digest features and the edge-aware tree.
// ---------------------------------------------------------------------------

/** The digest-derived CombatView fields for one fighter (all finite). */
export type ArenaFeatures = Required<Pick<CombatView,
  "rimBehind" | "wallBehind" | "openBehind" | "enemyRimBehind" | "enemyWallBehind" | "enemyOpenBehind" | "laneOffset" | "openFraction">>;

const TAU = Math.PI * 2;
const wrapAngle = (a: number) => ((a % TAU) + TAU) % TAU;

/** Digest direction index nearest to an angle (rad, CCW from +x). */
export function digestDir(d: Pick<ArenaDigest, "rim">, angle: number): number {
  const n = Math.max(1, d.rim.length);
  return Math.round(wrapAngle(angle) / (TAU / n)) % n;
}

/**
 * Where a ray from (x, z) along the unit (ux, uz) leaves the rim polygon the digest samples:
 * the distance, the rim direction index nearest the exit point (`dir`) and the other ray that
 * brackets it (`other`). The polygon joins the rim points of the DIGEST_DIRS directions; a point
 * outside it reports distance 0.
 */
export function rayToRim(d: Pick<ArenaDigest, "rim">, x: number, z: number, ux: number, uz: number): { dist: number; dir: number; other: number } {
  const n = d.rim.length;
  if (n < 3) return { dist: FAR_EDGE, dir: 0, other: 0 };
  let best = Infinity, bestDir = 0, otherDir = 0;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
    const p0x = Math.cos(a0) * d.rim[i], p0z = Math.sin(a0) * d.rim[i];
    const p1x = Math.cos(a1) * d.rim[(i + 1) % n], p1z = Math.sin(a1) * d.rim[(i + 1) % n];
    // Solve (x, z) + t (ux, uz) = p0 + s (p1 - p0), t >= 0, s in [0, 1].
    const ex = p1x - p0x, ez = p1z - p0z;
    const den = ux * ez - uz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = p0x - x, wz = p0z - z;
    const t = (wx * ez - wz * ex) / den;
    const sg = (wx * uz - wz * ux) / den;
    if (t >= -1e-9 && sg >= -1e-9 && sg <= 1 + 1e-9 && t < best) {
      best = t;
      bestDir = sg < 0.5 ? i : (i + 1) % n;
      otherDir = sg < 0.5 ? (i + 1) % n : i;
    }
  }
  if (Number.isFinite(best)) return { dist: Math.max(0, best), dir: bestDir, other: otherDir };
  const k = digestDir(d, Math.atan2(z, x));
  return { dist: 0, dir: k, other: k };
}

/**
 * The digest features for `self` fighting `enemy` (positions in arena metres). Total: coincident
 * fighters push along self's own bearing, an empty rim reports FAR_EDGE, nothing is ever NaN.
 * `laneOffset` is the angle between the line self's blows throw the enemy (self -> enemy) and the
 * line from the enemy to its nearest OPEN rim point: 0 = lined up for a ring-out, π = opposite;
 * a fully walled arena reports π.
 */
export function arenaFeatures(
  d: Pick<ArenaDigest, "rim" | "wallHeight" | "open" | "openFraction">,
  self: { x: number; z: number },
  enemy: { x: number; z: number },
): ArenaFeatures {
  let ux = self.x - enemy.x, uz = self.z - enemy.z;
  let len = Math.hypot(ux, uz);
  if (len < 1e-9) { ux = Math.cos(Math.atan2(self.z, self.x) || 0); uz = Math.sin(Math.atan2(self.z, self.x) || 0); len = 1; }
  ux /= len; uz /= len;
  const mine = rayToRim(d, self.x, self.z, ux, uz);
  const theirs = rayToRim(d, enemy.x, enemy.z, -ux, -uz);
  // Between two rays the digest cannot tell a gate from a wall: read the exit CONSERVATIVELY — open
  // if either bracketing ray is open, the lower of the two walls. (Measured: an exit point between a
  // walled and an open ray read "walled", and a backward roll there left the ring.)
  const wall = (r: { dir: number; other: number }) => Math.max(0, Math.min(d.wallHeight[r.dir] ?? 0, d.wallHeight[r.other] ?? 0));
  const open = (r: { dir: number; other: number }) => (d.open[r.dir] ?? 0) >= 0.5 || (d.open[r.other] ?? 0) >= 0.5 ? 1 : 0;
  // Nearest open rim point to the enemy, and the angle to the current push line.
  let lane = Math.PI, bestD = Infinity;
  const n = d.rim.length;
  for (let i = 0; i < n; i++) {
    if ((d.open[i] ?? 0) < 0.5) continue;
    const a = (i / n) * TAU;
    const rx = Math.cos(a) * d.rim[i] - enemy.x, rz = Math.sin(a) * d.rim[i] - enemy.z;
    const dist = Math.hypot(rx, rz);
    if (dist < bestD && dist > 1e-9) {
      bestD = dist;
      const c = Math.max(-1, Math.min(1, (rx * -ux + rz * -uz) / dist));
      lane = Math.acos(c);
    }
  }
  const fin = (v: number, dflt: number) => Number.isFinite(v) ? v : dflt;
  return {
    rimBehind: fin(Math.min(FAR_EDGE, mine.dist), FAR_EDGE),
    wallBehind: wall(mine),
    openBehind: open(mine),
    enemyRimBehind: fin(Math.min(FAR_EDGE, theirs.dist), FAR_EDGE),
    enemyWallBehind: wall(theirs),
    enemyOpenBehind: open(theirs),
    laneOffset: fin(lane, Math.PI),
    openFraction: fin(d.openFraction, 0),
  };
}

/**
 * Wave J edge-aware tree (StrategyLevel "full"): before the default tree, two arena questions —
 *   1. Is MY back to an open edge within 2.5 m?  -> strike if ready and in reach, otherwise
 *      ADVANCE: the drop lies on the enemy -> self line, so every step toward the enemy is a step
 *      away from it (and walking into a lighter body shoves it). Measured: a "flank" here circled
 *      at constant range forever against a longer weapon (0 hits in 180 s).
 *   2. Is the ENEMY's back to an open edge within 3 m and am I ready? -> attack in reach, else advance.
 * Without the digest features (openFraction absent) this tree decides exactly as defaultTree().
 * (A first draft flanked unconditionally: in a 2 m closet every back is within 2.5 m of the rim,
 * so the bot circled for the whole match and never swung.) The controller still uses "flank"
 * from the default subtree; AiBrain.strafeToward picks its side.
 */
export function edgeAwareTree(reach = 1.5): TreeNode {
  const fallback = defaultTree();
  // With the digest present, "near the edge" is answered by the arena itself: a WALLED rim behind
  // is not a danger, so the fight runs on the default tree's normal-combat subtree (its `less`
  // side). Without this a bot in an arena under ~3 m across is "near the edge" everywhere and the
  // default tree only ever blocks or retreats. Its distance thresholds (1.5 m "in range", 2.0 m
  // "close") are rescaled to THIS fighter's reach: fixed at 1.5 m, a 2.1 m spear never swung from
  // 1.6–2.1 m and had to walk into a longer weapon's range first (measured: 0 hits in 180 s).
  const r = Number.isFinite(reach) && reach > 0 ? reach : 1.5;
  const rescale = (n: TreeNode): TreeNode => n.kind === "leaf" ? n : {
    ...n,
    threshold: n.field === "distance" ? n.threshold! * (r / 1.5) : n.threshold,
    less: rescale(n.less!), greater: rescale(n.greater!),
  };
  const combat = rescale(fallback.less!);
  const pushOrFight: TreeNode = {
    kind: "branch", field: "enemyOpenBehind", threshold: 0.5, missing: "less",
    less: combat,
    greater: {
      kind: "branch", field: "enemyRimBehind", threshold: 3, missing: "greater",
      greater: combat,
      less: {
        kind: "branch", field: "ready", threshold: 0,
        less: combat,
        greater: { kind: "branch", field: "distance", threshold: r, less: { kind: "leaf", decision: "attack" }, greater: { kind: "leaf", decision: "advance" } },
      },
    },
  };
  const edgeAware: TreeNode = {
    kind: "branch", field: "openBehind", threshold: 0.5, missing: "less",
    less: pushOrFight,
    greater: {
      kind: "branch", field: "rimBehind", threshold: 2.5, missing: "greater",
      less: {
        kind: "branch", field: "ready", threshold: 0,
        less: { kind: "leaf", decision: "advance" },
        greater: { kind: "branch", field: "distance", threshold: r, less: { kind: "leaf", decision: "attack" }, greater: { kind: "leaf", decision: "advance" } },
      },
      greater: pushOrFight,
    },
  };
  // Presence gate: openFraction is >= 0 whenever the digest features are there; absent -> the
  // plain default tree, so a caller without a digest gets exactly defaultTree()'s decisions.
  return { kind: "branch", field: "openFraction", threshold: -1, missing: "less", less: fallback, greater: edgeAware };
}

// Default adaptive tree — more complex than the original.
export function defaultTree(): TreeNode {
  // Wave M (lane M-B): the survival subtree (near the edge) consults the ENGAGEMENT intent before
  // the pre-Wave-M block/retreat rules. A fighter near a rim whose enemy is OUTSIDE its own
  // striking band is told to APPROACH — this is what ends a stand-off, where both fighters backed
  // into opposite walls and only ever retreated (measured in the headless sim: 144 s of no hit at
  // ~25 m). Inside the band the hook returns undefined and the survival rules (block / retreat)
  // run exactly as before, so every pre-Wave-M behaviour test still holds.
  const survival: TreeNode = {
    kind: "branch",
    field: "selfHpRatio",
    threshold: 0.3,
    compute: engagementHook,
    less: { kind: "leaf", decision: "block" },
    greater: {
      kind: "branch",
      field: "enemyAttacking",
      threshold: 0.5,
      less: { kind: "leaf", decision: "retreat" },
      greater: { kind: "leaf", decision: "block" },
    },
  };
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
    // Near edge (nearEdge=true, 1>0.5 → greater): fight to survive, with the engagement hook
    greater: survival,
  };
}

/**
 * Wave M (lane M-B): the engagement hook, evaluated at the near-edge survival branch. It maps the
 * intent to a Decision the tree can take — `approach` -> "advance", `disengage` -> "retreat" — and
 * returns `undefined` for `hold`/`circle`/`bait`, so the pre-Wave-M survival rules decide those
 * (which is why every pre-Wave-M behaviour test still holds). One source of truth: the band and the
 * pull live in Engagement.ts.
 */
function engagementHook(view: CombatView): Decision | undefined {
  const e = engagement({
    distance: view.distance,
    selfReach: view.selfReach,
    quietS: view.quietS ?? 0,
    selfReady: view.ready,
    enemyAttacking: view.enemyAttacking >= 0.5,
    selfHpRatio: view.selfHpRatio,
    enemyHpRatio: view.enemyHpRatio,
    stance: view.stance ?? "neutral",
  });
  return e.intent === "approach" ? "advance" : e.intent === "disengage" ? "retreat" : undefined;
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