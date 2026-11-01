// Wave J (lane J-B): the HEADLESS match simulator — one duel on a 2-D arena, played by the same
// rules the live engine runs, fast and deterministic, for the batch back end.
//
// What it models (and the engine function it follows):
//   arena      ring outline ringRadiusAt(cfg, θ); the WallPlan's segment height per bearing — a wall
//              ≥ WALL_BLOCK_HEIGHT stops a knocked body (rebound e = bounce·(1 − J/R), breach when the
//              momentum beats the segment's resistance: Physics.hitWall), a lower one does not;
//              ring-out = the centre beyond the rim by the footprint on an open/breached bearing
//              (RingOut.checkRingOut's sumo rule); solid props are circles bodies are pushed out of.
//   ground     zoned stone / wood / sand / ice by radius (Terrain.materialAt), slide decay
//              exp(−(1.2 + 1/stop)·dt) (ArenaPhysics damping + the engine's surface stop).
//   movement   AI_MOVE_SPEED 4.2 m/s × stance speed; bodies kept BODY_SPACING 0.9 m apart.
//   swings     Engine.#swingCooldown (attackInterval · profile.cooldown · stance) and the engage
//              distance profile.reach + body radius (ranged capped at the legacy 2.8 m); a swing
//              lands after a wind-up if the target is still in reach (else it whiffs).
//   damage     Engine.#resolveHit's profile branch: rollStrike (accuracy, crit, damage roll) ×
//              Stats.attackDamage (class power, class crit, armour) re-armoured by armourPierce ×
//              Physics.physicsMultiplier × skill damageMul × block 0.4.
//   knockback  MatchRules.knockbackSpeed (the engine's Δv·6 capped at 4 m/s × (floor + %/60)), the
//              percent meter (MatchRules.meterGain) raised BEFORE the push (engine order), block ×0.55.
//   stun       SmashPhysics.stunDuration(damage, 1.2, 0) + the skill's stun.
//   resources  Resources (create / regen / trySpend) with the engine's SKILL_RESOURCE_COST.
//   skills     SkillRuntime + chooseAiSkill (strategy "full"): power/dash strike at hitAt with the
//              payload, dash lunges, defence stances fold in through effectiveStats.
//   AI         none  = walk at the enemy and swing;
//              basic = DecisionTree.defaultTree (+ the engine's "attack out of reach → advance");
//              full  = edgeAwareTree with the digest features + AiBrain.edgePlayTarget steering +
//                      skills. aiLevel sets the re-think period 0.05 + 0.25·(1 − aiLevel) s.
//   clock      6 s truce (Disposition.DEFAULT_TIMING), then MatchControl's limit (180 s default):
//              rules.timeLimit "tie" (engine today) or "judge" (judgeTimeLimit). KO when hp ≤ 0;
//              both at once: the higher hp wins (Engine.#checkEnd).
//
// Simplifications versus the engine (documented in docs/arena/lane-J-B.md):
//   no skeleton / swing rig / blade sweep (a swing lands by distance after a wind-up), no geometric
//   Impact (the profile branch instead; knockback impulse approximated by MatchRules.IMPULSE_K), no
//   vertical motion (no hop, no airborne time, no ragdoll), radial wall normals, no terrain relief,
//   no senses / fog / statuses / DoT / items / coins / buffs / wind, no A* (props push bodies out),
//   fighters hold their spawn during the truce, the brain does not adapt mid-batch.
//
// Pure module: no THREE, no DOM, no Math.random. Deterministic per conditions.seed.

import { WALL_BLOCK_HEIGHT, type ArenaDigest, type MatchConditions, type MatchOutcome, type WallPlan } from "../game/arena/contracts.ts";
import { ringRadiusAt, type ArenaConfig } from "../game/ArenaConfig.ts";
import { attackDamage, DAMAGE_SCALE } from "../game/Stats.ts";
import { hitWall, physicsMultiplier } from "../game/Physics.ts";
import { rollStrike } from "../game/weapons/Profile.ts";
import { regenResources, trySpend, type ResourceState } from "../game/Resources.ts";
import { arenaFeatures, decide, defaultTree, edgeAwareTree, type CombatView, type Decision, type TreeNode } from "../game/DecisionTree.ts";
import { edgePlayTarget, sensibleSkill, strafeToward } from "../game/AiBrain.ts";
import { beginSkill, chooseAiSkill, createRuntime, effectiveStats, endSkill, movementMul, tickRuntime, type SkillRuntime } from "../game/SkillRuntime.ts";
import type { Skill } from "../game/Skills.ts";
import { stunDuration } from "../physics/SmashPhysics.ts";
import { judgeTimeLimit, resolveTimeLimit } from "../game/MatchControl.ts";
import { materialAt, surfaceFor } from "../game/Terrain.ts";
import { truceSeconds } from "../game/Disposition.ts";
import { buildFighter, type BuiltFighter } from "./FighterBuild.ts";
import { knockbackSpeed, meterGain, WAVE_J_RULES, type MatchRules } from "./MatchRules.ts";
import { randomSource } from "./ArenaHarness.ts";
import { PropGrid, type PathPt } from "./SimPath.ts";
import { createNavPilot, type NavPilot } from "../game/NavPilot.ts";
import type { Obstacle } from "../world/PathFinder.ts";

/** Engine constants the simulator shares (Engine.ts). */
export const AI_MOVE_SPEED = 4.2;
export const BODY_SPACING = 0.9;
/** Engine: Engine.#arenaState.wallImpactSpeed = MOVE_SPEED · 1.05 — slower contacts are leans. */
export const WALL_IMPACT_SPEED = 6.5 * 1.05;
/**
 * The one resource table (wave S). It used to be defined HERE and again in src/engine/Engine.ts -
 * two copies of a balance number, which is exactly the "why is it like that here and not there"
 * problem. `src/game/PowerCost.ts` owns it now; this re-export keeps every existing import working.
 */
import { SKILL_RESOURCE_COST } from "../game/PowerCost.ts";
export { SKILL_RESOURCE_COST };
/** Engine: a block holds 0.4 s, lets 40 % of the damage through and braces 45 % of the push. */
export const BLOCK_SECONDS = 0.4;
export const BLOCK_DAMAGE = 0.4;
export const BLOCK_KNOCK = 0.55;
/** Footprint radius: how far beyond the outline a centre must be to ring out, and the wall stand-off, m. */
export const FOOTPRINT = 0.35;
/** "Near the edge" for the tree (Engine: edgeDistance < 1.5). */
export const NEAR_EDGE = 1.5;
/** Share of the swing cooldown spent winding up before the blow lands (clamped 0.15–0.5 s). */
export const WINDUP_SHARE = 0.4;

export interface SimOptions {
  /** Fixed step, s (default 1/30). */
  dt?: number;
  /** Hostile seconds before the bell (default MatchControl.resolveTimeLimit() = 180). */
  timeLimit?: number;
  /** The rules (default WAVE_J_RULES). */
  rules?: MatchRules;
  /** Debug/QA: every swing, hit, skill, wall blow and ring-out as it happens. */
  trace?: (e: SimEvent) => void;
}

/** One traced event (SimOptions.trace). Positions in m, damage in HP, knockback in m/s. */
export interface SimEvent {
  t: number;
  kind: "swing" | "skill" | "hit" | "wall" | "ringout" | "think";
  seat: 0 | 1;
  x: number; z: number;
  damage?: number; knockback?: number; percent?: number; hp?: number; note?: string;
}

interface SimFighter {
  b: BuiltFighter;
  seat: 0 | 1;
  x: number; z: number; vx: number; vz: number;
  hp: number; dp: number;
  cooldown: number; stun: number; block: number;
  windup: number; pendingSkill: Skill | null; skillClock: number; skillDur: number; skillStruck: boolean;
  res: ResourceState; rt: SkillRuntime;
  rng: () => number;
  think: number; action: Decision; strafe: -1 | 0 | 1; skillPick: number;
  tree: TreeNode | null;
  exitAt: number | null; out: boolean;
  moving: boolean;
  detourProp: number; detourSign: number; detourUntil: number;
  path: PathPt[] | null; pathAge: number; pathGoalX: number; pathGoalZ: number;
  /** Edge play may bend the approach toward the push spot (false while self's back is to an open edge). */
  edgeBlend: boolean;
  /** Wave N (lane N-A): the pilot's stuck detector / bounded escape, and the last position it saw. */
  pilot: NavPilot; navPrevX: number; navPrevZ: number;
  dealt: number; hits: number; swings: number; wallHits: number; edgeTime: number;
}

const TAU = Math.PI * 2;

function segmentOf(plan: WallPlan, angle: number) {
  const n = plan.segments.length;
  if (n === 0) return -1;
  const a = ((angle % TAU) + TAU) % TAU;
  return Math.min(n - 1, Math.floor((a / TAU) * n));
}

/** Simulate one match. Total: any exception becomes reason "error" with the message. */
export function simulateMatch(cond: MatchConditions, opts: SimOptions = {}): MatchOutcome {
  try {
    return run(cond, opts);
  } catch (e) {
    return {
      winner: null, reason: "error", duration: 0, hpLeft: [0, 0], hpFracLeft: [0, 0], damageDealt: [0, 0], hits: [0, 0],
      swings: [0, 0], wallHits: [0, 0], edgeTime: [0, 0], error: e instanceof Error ? e.message : String(e),
    };
  }
}

function run(cond: MatchConditions, opts: SimOptions): MatchOutcome {
  const rules = opts.rules ?? WAVE_J_RULES;
  const dt = opts.dt && opts.dt > 0 && opts.dt <= 0.1 ? opts.dt : 1 / 30;
  const limit = resolveTimeLimit(opts.timeLimit);
  const truce = truceSeconds();
  const cfg: ArenaConfig = cond.arena;
  const digest: ArenaDigest = cond.digest;
  const walls: WallPlan = cond.walls;
  const half = Math.max(0.5, cfg.size / 2);
  const integrity = walls.segments.map(() => 1);
  const solidProps = digest.props.filter((p) => p.solid);
  const trace = opts.trace;
  // A* around props (the engine's GridPathFinder stand-in), built only when there are solid props.
  const grid = solidProps.length > 0
    ? new PropGrid(solidProps, Math.max(1, ...digest.rim) + 0.5, FOOTPRINT, (x, z) => Math.hypot(x, z) < ringRadiusAt(cfg, Math.atan2(z, x)) - FOOTPRINT)
    : null;
  // Wave N (lane N-A): the pilot's obstacle circles (radius = the prop's own radius).
  const navObstacles: Obstacle[] = solidProps.map((p) => ({ x: p.x, z: p.z, radius: p.r }));
  const make = (seat: 0 | 1): SimFighter => {
    const b = buildFighter(cond.fighters[seat], rules);
    const sp = digest.spawns.spawns[seat] ?? { x: seat === 0 ? -1 : 1, z: 0, yaw: 0 };
    const strat = b.spec.strategy;
    return {
      b, seat, x: sp.x, z: sp.z, vx: 0, vz: 0, hp: b.stats.maxHealth, dp: 0,
      cooldown: 0, stun: 0, block: 0, windup: 0, pendingSkill: null, skillClock: 0, skillDur: 0, skillStruck: false,
      res: b.resources, rt: createRuntime(strat === "full" ? b.skills : []),
      rng: randomSource((Math.imul(cond.seed >>> 0, 0x9e3779b1) ^ (seat === 0 ? 0x85ebca6b : 0xc2b2ae35)) >>> 0),
      think: 0, action: "wait", strafe: 1, skillPick: -1,
      tree: strat === "basic" ? defaultTree() : strat === "full" ? edgeAwareTree(b.reach) : null,
      exitAt: null, out: false, moving: false,
      detourProp: -1, detourSign: 1, detourUntil: 0,
      path: null, pathAge: 0, pathGoalX: 0, pathGoalZ: 0, edgeBlend: false,
      pilot: createNavPilot({}), navPrevX: sp.x, navPrevZ: sp.z,
      dealt: 0, hits: 0, swings: 0, wallHits: 0, edgeTime: 0,
    };
  };
  const F: [SimFighter, SimFighter] = [make(0), make(1)];
  let t = 0, tick = 0;
  const maxT = truce + limit + dt;

  const finish = (winner: 0 | 1 | null, reason: MatchOutcome["reason"]): MatchOutcome => ({
    winner, reason, duration: round(t),
    hpLeft: [round(Math.max(0, F[0].hp)), round(Math.max(0, F[1].hp))],
    hpFracLeft: [round(Math.max(0, F[0].hp) / F[0].b.stats.maxHealth, 1e4), round(Math.max(0, F[1].hp) / F[1].b.stats.maxHealth, 1e4)],
    damageDealt: [round(F[0].dealt), round(F[1].dealt)],
    hits: [F[0].hits, F[1].hits], swings: [F[0].swings, F[1].swings],
    wallHits: [F[0].wallHits, F[1].wallHits], edgeTime: [round(F[0].edgeTime, 100), round(F[1].edgeTime, 100)],
  });

  // ─── per-fighter steps (closures over the arena) ────────────────────────────────────────────

  function rimAt(x: number, z: number): number { return ringRadiusAt(cfg, Math.atan2(z, x)); }

  function act(f: SimFighter, o: SimFighter, dt: number, hostileT: number): void {
    f.moving = false;
    // Wave N (lane N-A): the displacement the pilot will read as velocity this tick.
    const navVx = (f.x - f.navPrevX) / dt, navVz = (f.z - f.navPrevZ) / dt;
    f.navPrevX = f.x; f.navPrevZ = f.z;
    const dx = o.x - f.x, dz = o.z - f.z;
    const dist = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / dist, uz = dz / dist;
    if (Math.hypot(f.x, f.z) > rimAt(f.x, f.z) - NEAR_EDGE) f.edgeTime += dt;
    if (f.stun > 0 || f.windup > 0) return;
    if (f.rt.active >= 0) { skillMotion(f, o, ux, uz, dist, dt); return; }
    const strat = f.b.spec.strategy;
    const ready = f.cooldown <= 0;
    f.think -= dt;
    if (f.think <= 0) {
      f.think = strat === "none" ? 0.1 : 0.05 + 0.25 * (1 - clamp01(f.b.spec.aiLevel));
      if (strat === "none") {
        // Walk at the enemy until in reach, then stand and swing whenever the swing is ready.
        f.action = dist > f.b.reach ? "advance" : ready ? "attack" : "wait";
      } else {
        const view: CombatView = {
          distance: dist, selfReach: f.b.reach, enemyReach: o.b.reach,
          selfHpRatio: f.hp / f.b.stats.maxHealth, enemyHpRatio: o.hp / o.b.stats.maxHealth,
          nearEdge: Math.hypot(f.x, f.z) > rimAt(f.x, f.z) - NEAR_EDGE, ready,
          enemyAttacking: o.windup > 0 || o.rt.active >= 0 ? 1 : 0,
          selfDamagePercent: f.dp, enemyDamagePercent: o.dp, roundTime: hostileT,
        };
        if (strat === "full") Object.assign(view, arenaFeatures(digest, f, o));
        // A straight advance always moves away from the drop behind; only a safe back may bend it.
        f.edgeBlend = strat === "full" && !((view.openBehind ?? 0) >= 0.5 && (view.rimBehind ?? Infinity) < 2.5);
        f.skillPick = strat === "full"
          ? chooseAiSkill(f.rt, { distance: dist, selfReach: f.b.reach, selfHpRatio: view.selfHpRatio, enemyHpRatio: view.enemyHpRatio, nearEdge: view.nearEdge }, false)
          : -1;
        // The full brain never starts a backward roll toward its own open edge, a backward roll out
        // of reach, or a slowing stance out of reach (AiBrain.sensibleSkill).
        if (f.skillPick >= 0 && !sensibleSkill(f.rt.skills[f.skillPick], view)) f.skillPick = -1;
        const d = decide(f.tree!, view);
        f.action = d === "attack" && dist > f.b.reach ? "advance" : d;
        f.strafe = 1;
        trace?.({ t, kind: "think", seat: f.seat, x: f.x, z: f.z, note: `${f.action} d${dist.toFixed(2)} ready${ready ? 1 : 0} open${view.openBehind ?? "-"} rim${view.rimBehind?.toFixed(2) ?? "-"} eopen${view.enemyOpenBehind ?? "-"}` });
        if (strat === "full") {
          const target = edgePlayTarget(digest, o, Math.max(0.9, f.b.reach * 0.8));
          // Flank: circle toward the push spot (or toward the centre when there is no open edge).
          f.strafe = strafeToward(f, o, target ?? { x: 0, z: 0 }) || 1;
        }
      }
    }
    // A skill first (the engine's AI triage), paid atomically.
    if (f.skillPick >= 0) {
      const pick = f.skillPick;
      f.skillPick = -1;
      if (useSkill(f, pick)) return;
    }
    const speed = AI_MOVE_SPEED * movementMul(f.rt) * surfaceFor(materialAt(f.x, f.z, half)).speed;
    const step = speed * dt;
    switch (f.action) {
      case "attack":
        if (ready && dist <= f.b.reach) {
          f.cooldown = effectiveStats(f.b.stats, f.rt).attackInterval * (f.b.swingCooldown / f.b.stats.attackInterval);
          f.windup = Math.max(0.15, Math.min(0.5, WINDUP_SHARE * f.cooldown));
          f.pendingSkill = null;
          f.swings++;
          trace?.({ t, kind: "swing", seat: f.seat, x: f.x, z: f.z });
        }
        break;
      case "advance": {
        let tx = ux, tz = uz;
        if (f.edgeBlend && dist > f.b.reach) {
          // Approach from the inside: head for the push spot behind the enemy's ring-out lane.
          const target = edgePlayTarget(digest, o, Math.max(0.9, f.b.reach * 0.8));
          if (target) {
            const gx = target.x - f.x, gz = target.z - f.z, gl = Math.hypot(gx, gz);
            if (gl > 0.3) { tx = 0.5 * ux + 0.5 * gx / gl; tz = 0.5 * uz + 0.5 * gz / gl; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; }
          }
        }
        // Around props: follow an A* route to the enemy when the straight line is blocked
        // (Engine.#aiHeading); the push-spot blend above only applies on a clear line.
        let routed = false;
        if (grid && dist > f.b.reach && !grid.lineClear(f.x, f.z, o.x, o.z)) {
          const h = heading(f, o.x, o.z, dt);
          tx = h[0]; tz = h[1];
          routed = f.path !== null;
          // No route (a pocket sealed by props and the rim) while a longer weapon reaches over the
          // prop: the full brain steps OUT of that reach instead of standing in it.
          if (!routed && strat === "full" && dist <= o.b.reach + 0.3) { tx = -ux; tz = -uz; }
        } else f.path = null;
        // Wave N (lane N-A): the pilot detects a stalled approach (no closure on the enemy) and,
        // past its bound, sidesteps for a bounded burst — a body pinned on a prop or the rim does
        // not grind until the bell.
        f.pilot.plan({ x: o.x, z: o.z }, { x: f.x, z: f.z }, navObstacles);
        const nav = f.pilot.step(dt, { x: f.x, z: f.z, vx: navVx, vz: navVz });
        if (f.pilot.escaping) { tx = nav.dirX; tz = nav.dirZ; routed = true; }
        // Engine: an advance always moves; walking into the other body SHOVES it (the separation).
        walk(f, tx * step, tz * step, false, !routed);
        break;
      }
      case "retreat": walk(f, -ux * step, -uz * step); break;
      case "flank": walk(f, -uz * f.strafe * step, ux * f.strafe * step); break;
      case "block": f.block = BLOCK_SECONDS; break;
      case "wait": break;
    }
  }

  /**
   * The engine walks bots along an A* route around props (Engine.#aiHeading); the headless stand-in
   * steers the step tangentially around the nearest solid prop that blocks it (within 0.6 m ahead):
   * on the side of the target, unless the gap between that prop and the rim is too narrow to pass —
   * then on the centre side. The chosen side is kept for 1 s so the body does not dither.
   */
  function aroundProps(f: SimFighter, mx: number, mz: number): [number, number] {
    const len = Math.hypot(mx, mz);
    if (len < 1e-9 || solidProps.length === 0) return [mx, mz];
    const dx = mx / len, dz = mz / len;
    let best = Infinity, tx = mx, tz = mz;
    for (let i = 0; i < solidProps.length; i++) {
      const p = solidProps[i];
      const cx = p.x - f.x, cz = p.z - f.z;
      const along = cx * dx + cz * dz;
      const clear = p.r + FOOTPRINT;
      if (along <= 0 || along > clear + len + 0.6) continue;
      const perp = Math.abs(cx * dz - cz * dx);
      if (perp >= clear || along >= best) continue;
      best = along;
      const cl = Math.hypot(cx, cz) || 1;
      const t1x = -cz / cl, t1z = cx / cl; // c rotated +90°
      let sgn: number;
      if (f.detourProp === i && f.detourUntil > t) sgn = f.detourSign;
      else {
        const pr = Math.hypot(p.x, p.z);
        const outerGap = rimAt(p.x, p.z) - FOOTPRINT - (pr + clear);
        // Centre side: the arena centre (−f) relative to the line f -> prop.
        const centreSide = cx * -f.z - cz * -f.x > 0 ? 1 : -1;
        sgn = outerGap < 2 * FOOTPRINT ? centreSide : (t1x * dx + t1z * dz >= 0 ? 1 : -1);
        f.detourProp = i; f.detourSign = sgn; f.detourUntil = t + 1;
      }
      tx = t1x * sgn * len; tz = t1z * sgn * len;
    }
    return [tx, tz];
  }

  /** Unit heading toward (gx, gz): straight when clear, else along a (re)planned A* route. */
  function heading(f: SimFighter, gx: number, gz: number, dt: number): [number, number] {
    const dx = gx - f.x, dz = gz - f.z, d = Math.hypot(dx, dz) || 1;
    if (!grid || grid.lineClear(f.x, f.z, gx, gz)) { f.path = null; return [dx / d, dz / d]; }
    f.pathAge += dt;
    // Hysteresis: keep a route while its next waypoint stays visible (re-planning every few frames
    // flipped between the two ways round a prop and the body dithered in place).
    const stale = !f.path || f.path.length === 0 || f.pathAge > 1.5 || Math.hypot(f.pathGoalX - gx, f.pathGoalZ - gz) > 1 ||
      !grid.lineClear(f.x, f.z, f.path[0].x, f.path[0].z);
    if (stale) {
      f.path = grid.find(f.x, f.z, gx, gz);
      f.pathAge = 0; f.pathGoalX = gx; f.pathGoalZ = gz;
    }
    while (f.path && f.path.length > 1 && Math.hypot(f.path[0].x - f.x, f.path[0].z - f.z) < 0.3) f.path.shift();
    if (!f.path || f.path.length === 0) return [dx / d, dz / d];
    const wx = f.path[0].x - f.x, wz = f.path[0].z - f.z, wl = Math.hypot(wx, wz) || 1;
    return [wx / wl, wz / wl];
  }

  /** A voluntary step (lunge = false) or an animation-driven skill lunge (lunge = true). */
  function walk(f: SimFighter, mx0: number, mz0: number, lunge = false, steer = true): void {
    const [mx, mz] = lunge || !steer ? [mx0, mz0] : aroundProps(f, mx0, mz0);
    let nx = f.x + mx, nz = f.z + mz;
    const r = Math.hypot(nx, nz), rim = rimAt(nx, nz);
    // A wall of any height (curb included) stops walking; an open edge does not — unless the
    // rules' walk-off guard is on (the "full" brain never steps onto its own open edge).
    const seg = segmentOf(walls, Math.atan2(nz, nx));
    const h = seg >= 0 && cfg.walls >= 1 ? walls.segments[seg].height : 0;
    // A skill's lunge is the animation, not a choice: only a wall or the rules' guard stops it.
    const guard = h > 0 || rules.walkOffGuard || (!lunge && f.b.spec.strategy === "full");
    if (guard && r > rim - FOOTPRINT) { const k = Math.max(0, rim - FOOTPRINT) / Math.max(1e-6, r); nx *= k; nz *= k; }
    f.x = nx; f.z = nz; f.moving = true;
  }

  function useSkill(f: SimFighter, index: number): boolean {
    const skill = f.rt.skills[index];
    if (!skill || f.rt.active >= 0 || f.rt.cooldowns[index] > 0) return false;
    const cost = SKILL_RESOURCE_COST[skill.kind] ?? { mana: 0, stamina: 0 };
    const m = cost.mana > 0 ? trySpend(f.res, "mana", cost.mana) : f.res;
    if (!m) return false;
    const s = cost.stamina > 0 ? trySpend(m, "stamina", cost.stamina) : m;
    if (!s) return false;
    if (!beginSkill(f.rt, index)) return false;
    f.res = s;
    f.skillClock = 0;
    f.skillDur = Math.max(0.1, skill.animation.duration);
    f.skillStruck = false;
    f.swings++;
    trace?.({ t, kind: "skill", seat: f.seat, x: f.x, z: f.z, note: `${skill.kind}:${skill.id}` });
    return true;
  }

  function skillMotion(f: SimFighter, o: SimFighter, ux: number, uz: number, dist: number, dt: number): void {
    const skill = f.rt.skills[f.rt.active];
    f.skillClock += dt;
    // Lunge along the facing (negative = backward, e.g. Rolling Shot), spread over the animation,
    // never through the other body.
    const lunge = (skill.animation.lunge / f.skillDur) * dt;
    if (lunge > 0 && dist > BODY_SPACING + 0.05) walk(f, ux * Math.min(lunge, dist - BODY_SPACING), uz * Math.min(lunge, dist - BODY_SPACING), true);
    else if (lunge < 0) walk(f, ux * lunge, uz * lunge, true);
    if (!f.skillStruck && f.skillClock >= skill.animation.hitAt * f.skillDur) {
      f.skillStruck = true;
      if (skill.payload.damageMul > 0 && Math.hypot(o.x - f.x, o.z - f.z) <= f.b.reach + 0.4) resolveHit(f, o, skill);
    }
    if (f.skillClock >= f.skillDur) endSkill(f.rt);
  }

  function strikeTick(f: SimFighter, o: SimFighter, dt: number): void {
    if (f.windup <= 0) return;
    f.windup -= dt;
    if (f.windup > 0) return;
    f.windup = 0;
    // The blow lands if the target is still inside the reach plus the swing's step-in.
    if (Math.hypot(o.x - f.x, o.z - f.z) <= f.b.reach + 0.25) resolveHit(f, o, null);
  }

  function resolveHit(a: SimFighter, d: SimFighter, skill: Skill | null): void {
    const prof = a.b.profile;
    const strike = rollStrike(prof, a.rng);
    if (strike.outcome === "miss") return;
    const dStats = effectiveStats(d.b.stats, d.rt);
    const classHit = attackDamage(a.b.stats, dStats, a.rng(), 0.5);
    const armourDiv = 1 + dStats.armor * 0.04;
    const base = classHit * strike.multiplier * armourDiv / (1 + dStats.armor * 0.04 * (1 - prof.armourPierce));
    const closing = a.moving ? AI_MOVE_SPEED : 0;
    const phys = physicsMultiplier(a.b.body, d.b.body, closing);
    const blocking = d.block > 0;
    const mul = skill?.payload.damageMul ?? 1;
    const dmg = base * mul * phys * (blocking ? BLOCK_DAMAGE : 1);
    if (!Number.isFinite(dmg) || dmg <= 0) return;
    d.hp -= dmg;
    d.dp += meterGain(rules, dmg, d.b.stats.maxHealth, DAMAGE_SCALE);
    a.dealt += dmg;
    a.hits++;
    const steal = skill?.payload.lifesteal ?? 0;
    if (steal > 0) a.hp = Math.min(a.b.stats.maxHealth, a.hp + dmg * steal);
    d.stun = Math.max(d.stun, stunDuration(dmg / DAMAGE_SCALE, 1.2, 0)) + (skill?.payload.stun ?? 0);
    // An interrupted wind-up is lost (the stun cancels it).
    if (d.stun > 0) d.windup = 0;
    const kb = knockbackSpeed(rules, prof.impact, a.b.stats.strength, d.b.mass, d.dp, a.b.level, d.b.level, skill?.payload.knockbackMul ?? 1)
      * (blocking ? BLOCK_KNOCK : 1);
    let kx = d.x - a.x, kz = d.z - a.z;
    const kl = Math.hypot(kx, kz);
    if (kl < 1e-9) { kx = 1; kz = 0; } else { kx /= kl; kz /= kl; }
    d.vx += kx * kb;
    d.vz += kz * kb;
    trace?.({ t, kind: "hit", seat: a.seat, x: d.x, z: d.z, damage: dmg, knockback: kb, percent: d.dp, hp: d.hp, note: skill ? skill.id : strike.outcome });
  }

  function physics(f: SimFighter, hostile: boolean, dt: number): void {
    let nx = f.x + f.vx * dt, nz = f.z + f.vz * dt;
    const r = Math.hypot(nx, nz);
    const ang = Math.atan2(nz, nx);
    const rim = ringRadiusAt(cfg, ang);
    if (r > rim - FOOTPRINT && r > 1e-9) {
      const si = segmentOf(walls, ang);
      const seg = si >= 0 && cfg.walls >= 1 ? walls.segments[si] : null;
      const standing = seg !== null && seg.height >= WALL_BLOCK_HEIGHT && integrity[si] > 0;
      const cx = nx / r, cz = nz / r;
      if (standing) {
        const vOut = f.vx * cx + f.vz * cz;
        let passes = false;
        if (vOut >= WALL_IMPACT_SPEED) {
          const hit = hitWall(f.b.body, vOut, { resistance: seg!.resistance, height: seg!.height, restitution: seg!.bounce }, integrity[si]);
          f.wallHits++;
          integrity[si] = hit.wallIntegrity;
          trace?.({ t, kind: "wall", seat: f.seat, x: nx, z: nz, note: hit.breached ? "breach" : "held" });
          if (hit.breached) {
            const k = Math.min(1, hit.retainedSpeed / Math.max(1e-6, vOut));
            f.vx *= k; f.vz *= k;
            passes = true;
          } else {
            const eff = seg!.resistance * Math.max(0, integrity[si]);
            const e = eff > 0 ? seg!.bounce * (1 - Math.min(1, (f.b.mass * vOut) / eff)) : 0;
            f.vx -= (1 + e) * vOut * cx; f.vz -= (1 + e) * vOut * cz;
            if (hostile && hit.selfDamage > 0) {
              const hurt = hit.selfDamage * DAMAGE_SCALE;
              f.hp -= hurt;
              f.stun = Math.max(f.stun, stunDuration(hurt / DAMAGE_SCALE, 1.2, 1));
            }
          }
        } else if (vOut > 0) {
          f.vx -= vOut * cx; f.vz -= vOut * cz; // a lean: the normal motion stops, the rest slides
        }
        if (!passes) { const k = (rim - FOOTPRINT) / r; nx *= k; nz *= k; }
      }
      if (r > rim) { if (f.exitAt === null) f.exitAt = t; } else f.exitAt = null;
      if (!standing || integrity[si] <= 0) {
        if (r > rim + FOOTPRINT && !f.out) { f.out = true; trace?.({ t, kind: "ringout", seat: f.seat, x: nx, z: nz, percent: f.dp, hp: f.hp }); }
      }
    } else f.exitAt = null;
    // Solid props (circles): push out radially, kill the inward velocity.
    for (const p of solidProps) {
      const rr = p.r + FOOTPRINT;
      const px = nx - p.x, pz = nz - p.z, pd = Math.hypot(px, pz);
      if (pd < rr) {
        const ux = pd < 1e-9 ? 1 : px / pd, uz = pd < 1e-9 ? 0 : pz / pd;
        nx = p.x + ux * rr; nz = p.z + uz * rr;
        const vn = f.vx * ux + f.vz * uz;
        if (vn < 0) { f.vx -= vn * ux; f.vz -= vn * uz; }
      }
    }
    f.x = nx; f.z = nz;
    const stop = surfaceFor(materialAt(f.x, f.z, half)).stop;
    const damp = Math.exp(-(1.2 + 1 / stop) * dt);
    f.vx *= damp; f.vz *= damp;
    if (Math.abs(f.vx) < 1e-4) f.vx = 0;
    if (Math.abs(f.vz) < 1e-4) f.vz = 0;
  }

  function separate(a: SimFighter, c: SimFighter): void {
    const sx = c.x - a.x, sz = c.z - a.z;
    const sd = Math.hypot(sx, sz);
    if (sd >= BODY_SPACING) return;
    const ux = sd < 1e-9 ? 1 : sx / sd, uz = sd < 1e-9 ? 0 : sz / sd;
    const overlap = BODY_SPACING - sd;
    // Engine: 50/50. rules.massPush: the lighter body gives way (share = the other's mass / total).
    const shareA = rules.massPush ? c.b.mass / Math.max(1e-6, a.b.mass + c.b.mass) : 0.5;
    a.x -= ux * overlap * shareA; a.z -= uz * overlap * shareA;
    c.x += ux * overlap * (1 - shareA); c.z += uz * overlap * (1 - shareA);
  }

  while (t < maxT) {
    t += dt;
    const hostile = t >= truce;
    for (const f of F) {
      f.cooldown = Math.max(0, f.cooldown - dt);
      f.stun = Math.max(0, f.stun - dt);
      f.block = Math.max(0, f.block - dt);
      tickRuntime(f.rt, dt);
      f.res = regenResources(f.res, dt);
    }
    if (hostile) {
      // Alternate who acts and strikes first each tick: a fixed seat-0-first order gave seat A a
      // measured +3 % decisive share in exact mirror matches.
      tick++;
      const order = tick % 2 === 0 ? F : [F[1], F[0]];
      for (const f of order) act(f, F[1 - f.seat], dt, t - truce);
      for (const f of order) strikeTick(f, F[1 - f.seat], dt);
    }
    // Physics: slides, walls, ring-out, props, spacing.
    for (const f of F) physics(f, hostile, dt);
    separate(F[0], F[1]);
    // Ring-out (RingOut.ringOutLoser: the earlier exit loses, then the lower hp fraction, then seat 0).
    const outs = F.filter((f) => f.out);
    if (outs.length > 0) {
      let loser = outs[0];
      if (outs.length === 2) {
        const [a, c] = outs;
        const ea = a.exitAt ?? t, ec = c.exitAt ?? t;
        loser = ea !== ec ? (ea < ec ? a : c) : (a.hp / a.b.stats.maxHealth <= c.hp / c.b.stats.maxHealth ? a : c);
      }
      return finish(loser.seat === 0 ? 1 : 0, "ringout");
    }
    // KO (Engine: both down -> the higher hp wins).
    if (F[0].hp <= 0 || F[1].hp <= 0) {
      if (F[0].hp <= 0 && F[1].hp <= 0) return finish(F[0].hp > F[1].hp ? 0 : 1, "ko");
      return finish(F[0].hp <= 0 ? 1 : 0, "ko");
    }
    if (hostile && t - truce >= limit) {
      if (rules.timeLimit === "judge") {
        const w = judgeTimeLimit(F[0].hp / F[0].b.stats.maxHealth, F[1].hp / F[1].b.stats.maxHealth);
        return finish(w, "time");
      }
      return finish(null, "time");
    }
  }
  return finish(null, "time");
}

function clamp01(v: number): number { return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
function round(v: number, p = 100): number { return Number.isFinite(v) ? Math.round(v * p) / p : 0; }
