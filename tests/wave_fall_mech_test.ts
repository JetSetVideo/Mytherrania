// Wave FALL agent M: unit tests of the pure collision (C-FORCE) and fall (C-FALL) modules.
function assert(ok: unknown, msg = "assertion failed"): asserts ok { if (!ok) throw new Error(msg); }
function assertEquals<T>(a: T, b: T, msg = ""): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertAlmostEquals(a: number, b: number, eps = 1e-7, msg = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg} ${a} !~ ${b} (eps ${eps})`);
}
import {
  armourMassOf, type BodyState, effectiveMassOf, hitBalanceLoss, isCharge, resolveCollision, stabilityOf, STAGGER_MAX,
} from "../src/game/Collision.ts";
import {
  backstepLoss, canActIn, canGuardIn, DOWNED_KNOCKBACK, downedCritBonus, downedDamageMul, downedKnockMul, downedStatusMul,
  FALL_SECONDS, fallChance, type FallPhase, type FallRequest, isDowned, isLegal, LEGAL, ledgeFall, poseFor, RISE_MAX, RISE_MIN,
  riseSeconds, standing, stepFall, teeterLoss, triggerFall,
} from "../src/game/Fall.ts";

const body = (o: Partial<BodyState> = {}): BodyState => ({
  mass: 75, velocity: [0, 0], strength: 5.5, agility: 5, level: 5, stamina01: 1, hp01: 1,
  weaponMass: 1.2, armourMass: 10, guarding: false, downed: false, ...o,
});
const charge = (a: Partial<BodyState>, b: Partial<BodyState>) =>
  resolveCollision(body({ velocity: [4, 0], ...a }), body({ velocity: [-4, 0], ...b }), [1, 0]);

Deno.test("collision: equal bodies give mirror outputs and conserve effective momentum", () => {
  const r = charge({}, {});
  assertAlmostEquals(r.closingSpeed, 8, 1e-9);
  assertAlmostEquals(r.a.dv[0], -r.b.dv[0], 1e-9);
  assertAlmostEquals(r.a.recoil, r.b.recoil, 1e-9);
  assertAlmostEquals(r.a.stagger, r.b.stagger, 1e-12);
  assertAlmostEquals(r.a.balanceLoss, r.b.balanceLoss, 1e-12);
  assertAlmostEquals(r.a.impulse[0] + r.b.impulse[0], 0, 1e-9);
  // Asymmetric too: Σ m_eff·Δv = 0.
  const s = charge({ mass: 110, strength: 9, armourMass: 20 }, { mass: 58, agility: 9 });
  assertAlmostEquals(s.a.impulse[0] + s.b.impulse[0], 0, 1e-9);
  assertAlmostEquals(s.a.impulse[1] + s.b.impulse[1], 0, 1e-9);
});

Deno.test("collision: heavier / stronger / more agile / higher level / armoured / guarding -> less pushback and shorter stagger", () => {
  const base = charge({}, {});
  const cases: [string, Partial<BodyState>][] = [
    ["mass", { mass: 100 }], ["strength", { strength: 9 }], ["agility", { agility: 9 }], ["level", { level: 20 }],
    ["armour", { armourMass: 25 }], ["weapon", { weaponMass: 3.2 }], ["guard", { guarding: true }],
  ];
  for (const [name, o] of cases) {
    const r = charge(o, {});
    assert(r.a.recoil < base.a.recoil, `${name}: a recoils less (${r.a.recoil.toFixed(3)} < ${base.a.recoil.toFixed(3)})`);
    assert(r.b.recoil > base.b.recoil, `${name}: b recoils more`);
    assert(r.a.stagger <= base.a.stagger && r.a.balanceLoss <= base.a.balanceLoss, `${name}: a staggers/loses balance no more`);
  }
  // Recovery: stronger/more agile shortens the stagger for the SAME jolt.
  const tired = charge({ stamina01: 0 }, {}), wounded = charge({ hp01: 0 }, {});
  assert(tired.a.recoil > base.a.recoil && wounded.a.recoil > base.a.recoil, "a tired / wounded body gives way more");
});

Deno.test("collision: deterministic, total, clamped; a downed body loses no more balance", () => {
  const a = charge({ mass: 90 }, { agility: 2 }), b = charge({ mass: 90 }, { agility: 2 });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  const bad = resolveCollision(body({ mass: NaN, velocity: [NaN, Infinity], strength: -3, agility: NaN, level: NaN }), body({ velocity: [0, 0] }));
  for (const v of [bad.closingSpeed, bad.impulse, bad.a.recoil, bad.b.recoil, bad.a.stagger, bad.a.balanceLoss, ...bad.a.dv, ...bad.b.dv]) assert(Number.isFinite(v), "finite");
  const huge = charge({ velocity: [60, 0] }, { velocity: [-60, 0] });
  assert(huge.a.stagger <= STAGGER_MAX && huge.a.balanceLoss <= 1, "clamped");
  const down = charge({}, { downed: true });
  assertEquals(down.b.balanceLoss, 0);
  assert(down.b.recoil > charge({}, {}).b.recoil, "but it is pushed further (DOWNED_KNOCKBACK)");
  assert(stabilityOf(body({ downed: true })) < stabilityOf(body()), "downed stability is lower");
  assert(effectiveMassOf(body({ mass: 100 })) > effectiveMassOf(body()));
  assertEquals(armourMassOf(4), 10);
  assert(isCharge(0.9, 0.9, 2, 2) && !isCharge(0.9, 0.9, 4.2, 0) && isCharge(0.9, 0.9, 7, 0) && !isCharge(0.9, 0.9, 1, 0.5) && !isCharge(1.5, 0.9, 5, 5));
  assert(hitBalanceLoss(9, body()) > hitBalanceLoss(9, body({ mass: 110, strength: 9 })), "a heavy strong body keeps its feet under a blow");
  assertEquals(hitBalanceLoss(9, body({ downed: true })), 0);
});

Deno.test("collision: separating bodies do not collide (closing speed 0, no push)", () => {
  const r = resolveCollision(body({ velocity: [-2, 0] }), body({ velocity: [2, 0] }), [1, 0]);
  assertEquals(r.closingSpeed, 0);
  assertEquals(r.impulse, 0);
});

const fb = { armourMass: 10, bodyMass: 75, agility: 5, hp01: 1, stamina01: 1 };
const req = (o: Partial<FallRequest> = {}): FallRequest => ({ balanceLoss: 0, cause: "collision", dir: [1, 0], facing: [-1, 0], roll: 0.5, body: fb, ...o });

Deno.test("fall: get-up law is monotone (heavier/armoured/wounded/tired slower, agile faster) and clamped", () => {
  const t = (o: Partial<typeof fb>) => { const b = { ...fb, ...o }; return riseSeconds(b.armourMass, b.bodyMass, b.agility, b.hp01, b.stamina01); };
  const base = t({});
  assert(t({ armourMass: 25 }) > base && t({ bodyMass: 105 }) > base && t({ hp01: 0.2 }) > base && t({ stamina01: 0.1 }) > base);
  assert(t({ agility: 9 }) < base);
  assert(t({ armourMass: 200, bodyMass: 200, agility: 0, hp01: 0, stamina01: 0 }) === RISE_MAX);
  assert(t({ armourMass: 0, bodyMass: 40, agility: 10 }) >= RISE_MIN);
  assert(Number.isFinite(t({ armourMass: NaN, bodyMass: NaN, agility: NaN, hp01: NaN, stamina01: NaN })));
});

Deno.test("fall: state machine only takes legal transitions and its timings add up", () => {
  const s = standing();
  triggerFall(s, req({ balanceLoss: 0.9 }));
  assertEquals(s.phase, "falling");
  assertEquals(s.pose, "back", "thrown along +x while facing -x: a backward fall");
  const seen: FallPhase[] = ["falling"];
  let t = 0, prev: FallPhase = s.phase;
  while ((s.phase as FallPhase) !== "stand" && t < 10) {
    const tr = stepFall(s, 1 / 60);
    t += 1 / 60;
    if (tr) { assert(isLegal(tr.from, tr.to), `${tr.from} -> ${tr.to} legal`); assertEquals(tr.from, prev); prev = tr.to; seen.push(tr.to); }
  }
  assertEquals(seen, ["falling", "down", "rising", "stand"]);
  const T = riseSeconds(fb.armourMass, fb.bodyMass, fb.agility, fb.hp01, fb.stamina01);
  assertAlmostEquals(t, FALL_SECONDS + T, 2 / 60);
  for (const [from, tos] of Object.entries(LEGAL)) for (const to of tos) assert(isLegal(from as FallPhase, to));
  assert(!isLegal("down", "stand") && !isLegal("falling", "stand") && !isLegal("stand", "down"));
});

Deno.test("fall: thresholds — small loss staggers, mid stumbles (roll decides), big falls; falling/down ignore triggers", () => {
  const a = triggerFall(standing(), req({ balanceLoss: 0.2 }));
  assertEquals(a.phase, "stagger");
  const b = triggerFall(standing(), req({ balanceLoss: 0.5, roll: 0.99 }));
  assertEquals(b.phase, "stumble"); assertEquals(b.willFall, false);
  const c = triggerFall(standing(), req({ balanceLoss: 0.5, roll: 0.0 }));
  assertEquals(c.willFall, true);
  for (let i = 0; i < 120; i++) stepFall(b, 1 / 60);
  assertEquals(b.phase, "stand", "a recovered stumble stands");
  const d = triggerFall(standing(), req({ balanceLoss: 1 }));
  const before = JSON.stringify(d);
  triggerFall(d, req({ balanceLoss: 1, cause: "hit" }));
  assertEquals(JSON.stringify(d), before, "a falling body is not re-triggered");
  // Exhaustion tips a mid loss into a stumble.
  const e = triggerFall(standing(), req({ balanceLoss: 0.25, body: { ...fb, stamina01: 0.05 } }));
  assertEquals(e.phase, "stumble"); assertEquals(e.cause, "exhaustion");
  // Rising + a hard knock -> falls again.
  const r = triggerFall(standing(), req({ balanceLoss: 1 }));
  while ((r.phase as FallPhase) !== "rising") stepFall(r, 1 / 60);
  triggerFall(r, req({ balanceLoss: 0.6, cause: "hit" }));
  assertEquals(r.phase, "falling");
});

Deno.test("fall: fall chance monotone, poses, gates and downed penalties", () => {
  assert(fallChance(0.7, 5, 1) > fallChance(0.5, 5, 1));
  assert(fallChance(0.6, 2, 1) > fallChance(0.6, 9, 1));
  assert(fallChance(0.6, 5, 0.1) > fallChance(0.6, 5, 1));
  assertEquals(poseFor([1, 0], [1, 0]), "front");
  assertEquals(poseFor([0, 1], [1, 0]), "side");
  const s = triggerFall(standing(), req({ balanceLoss: 1 }));
  assert(!canActIn(s) && !isDowned(s));
  while ((s.phase as FallPhase) !== "down") stepFall(s, 1 / 60);
  assert(isDowned(s) && !canGuardIn(s));
  assertEquals(downedDamageMul(s), 1.3); assertEquals(downedCritBonus(s), 0.15); assertEquals(downedStatusMul(s), 1.4); assertEquals(downedKnockMul(s), DOWNED_KNOCKBACK);
  while ((s.phase as FallPhase) !== "rising") stepFall(s, 1 / 60);
  assert(isDowned(s) && canGuardIn(s) && !canActIn(s));
  assertEquals(downedDamageMul(standing()), 1);
});

Deno.test("fall: edge teeter only at an open brink, not inside, not walled, not really outside; back-step and ledge", () => {
  assertEquals(teeterLoss({ beyond: -1, footprint: 0.35, outwardSpeed: 3, open: true }), null);
  assertEquals(teeterLoss({ beyond: 0, footprint: 0.35, outwardSpeed: 3, open: false }), null);
  assertEquals(teeterLoss({ beyond: 0.5, footprint: 0.35, outwardSpeed: 3, open: true }), null);
  assertEquals(teeterLoss({ beyond: 0, footprint: 0.35, outwardSpeed: 0.2, open: true }), null);
  const l = teeterLoss({ beyond: 0, footprint: 0.35, outwardSpeed: 2, open: true })!;
  assert(l >= 0.4 && l <= 1);
  assert(teeterLoss({ beyond: 0, footprint: 0.35, outwardSpeed: 4, open: true })! > l, "faster -> worse");
  assertEquals(backstepLoss(false, 1, 0.3, true), null);
  assertEquals(backstepLoss(true, 0.1, 0.3, false), null);
  assert(backstepLoss(true, 0.5, 0.3, false)! > 0 && backstepLoss(true, 0, 0.3, true)! > 0);
  assert(ledgeFall(0.6, 0.3, 2) && !ledgeFall(0.6, 0.3, 0.5) && !ledgeFall(0.2, 0.3, 3));
});

// --- MatchSim parity, AI, telemetry (C-AI / C-LOG) ------------------------------------------------
import { runBatch } from "../src/balance/Batch.ts";
import { type SimEvent, simulateMatch } from "../src/balance/MatchSim.ts";
import { fallAwareStudy } from "../src/balance/FallStudy.ts";
import { forceAggregate } from "../src/balance/Summary.ts";
import { fallAwareTree, fallDecision, fallSafeDecision, fallView } from "../src/game/AiBrain.ts";
import { type CombatView, decide, defaultTree } from "../src/game/DecisionTree.ts";
import { createTelemetry, FORCE_EVENT_CAP, type ForceEvent } from "../src/game/FightTelemetry.ts";
import { buildReport, compactForces, encodedBytes, REPORT_BYTE_CAP, REPORT_FORCE_EVENTS } from "../src/game/MatchReport.ts";
import { fallChip } from "../src/ui/FighterPanel.ts";
import { FORCE_TEXT } from "../src/ui/CombatText.ts";

Deno.test("sim: falls on records forces, traces collision/fall/rise and is deterministic; falls off carries none", () => {
  const recs = runBatch({ matches: 80, seed: 99, design: "random" });
  assert(recs.every((r) => r.outcome.forces !== undefined), "every falls-on record carries a force tally");
  const agg = forceAggregate(recs)!;
  assert(agg.fallsPerMatch > 0 && agg.collisionsPerMatch > 0 && agg.meanDownS > 0.8, `falls happen (${JSON.stringify(agg)})`);
  const again = runBatch({ matches: 80, seed: 99, design: "random" });
  assertEquals(JSON.stringify(again.map((r) => r.outcome)), JSON.stringify(recs.map((r) => r.outcome)), "deterministic");
  const off = runBatch({ matches: 20, seed: 99, design: "random", sim: { falls: false } });
  assert(off.every((r) => r.outcome.forces === undefined));
  // Trace kinds, and every rise follows a fall of the same seat.
  const kinds = new Set<string>(); const open = [0, 0];
  let bad = 0;
  for (const r of recs.slice(0, 30)) {
    open[0] = 0; open[1] = 0;
    simulateMatch(r.conditions, { trace: (e: SimEvent) => {
      kinds.add(e.kind);
      if (e.kind === "fall") open[e.seat]++;
      if (e.kind === "rise") { if (open[e.seat] <= 0) bad++; else open[e.seat]--; }
    } });
  }
  assert(kinds.has("collision") && kinds.has("fall") && kinds.has("rise"), [...kinds].join(","));
  assertEquals(bad, 0, "a rise never comes without a fall");
});

Deno.test("AI: punish a downed enemy, never back to an open rim when shaken/tired, no tired head-on charge into a heavy body", () => {
  const v = (o: Partial<CombatView>): CombatView => ({
    distance: 3, selfReach: 1.5, enemyReach: 1.5, selfHpRatio: 1, enemyHpRatio: 1, nearEdge: false, ready: true,
    enemyAttacking: 0, selfDamagePercent: 0, enemyDamagePercent: 0, roundTime: 10, ...o,
  });
  const down = fallView({ phase: "down", t: 0.2, duration: 1, cause: "hit" });
  const stand = fallView({ phase: "stand", t: 0, duration: 0, cause: null });
  assertEquals(fallDecision(v({ enemyFall: down, selfFall: stand })), "advance");
  assertEquals(fallDecision(v({ enemyFall: down, selfFall: stand, distance: 1 })), "attack");
  assertEquals(fallDecision(v({ enemyFall: down, selfFall: stand, distance: 1, ready: false })), "wait");
  assertEquals(fallDecision(v({ enemyFall: stand, selfFall: stand })), undefined);
  assertEquals(fallSafeDecision("retreat", v({ selfStamina01: 0.2, openBehind: 1, rimBehind: 1 })), "flank");
  assertEquals(fallSafeDecision("retreat", v({ selfStamina01: 0.9, openBehind: 1, rimBehind: 1 })), "retreat");
  assertEquals(fallSafeDecision("retreat", v({ selfStamina01: 0.9, openBehind: 1, rimBehind: 1, lastCollision: { ago: 0.5, selfPushback: 1, enemyPushback: 0, selfBalanceLoss: 0.3 } })), "flank");
  assertEquals(fallSafeDecision("advance", v({ selfStamina01: 0.2, selfStability: 60, enemyStability: 120, distance: 2 })), "flank");
  assertEquals(fallSafeDecision("advance", v({ selfStamina01: 0.9, selfStability: 60, enemyStability: 120, distance: 2 })), "advance");
  // Without the Wave FALL fields the wrapped tree decides exactly as before.
  const t = defaultTree(), w = fallAwareTree(t);
  for (let i = 0; i < 200; i++) {
    const view = v({ distance: (i * 0.37) % 6, selfHpRatio: (i * 0.13) % 1, enemyHpRatio: (i * 0.29) % 1, nearEdge: i % 3 === 0, ready: i % 2 === 0, enemyAttacking: i % 5 === 0 ? 1 : 0 });
    assertEquals(decide(w, view), decide(t, view));
  }
});

Deno.test("AI: the fall-aware no-op control reads exactly 0.5, and the aware seat hits a downed enemy at a higher rate", () => {
  const noop = fallAwareStudy(60, 31, false);
  assertEquals(noop.awareWinRate, 0.5);
  const s = fallAwareStudy(60, 31, true);
  assert(s.hitRate.aware.downed > s.hitRate.aware.standing, `aware hits downed ${s.hitRate.aware.downed}/s > standing ${s.hitRate.aware.standing}/s`);
});

Deno.test("telemetry: force events fold into the summary, refuse non-finite, cap the log; report stays under its byte cap", () => {
  const acc = createTelemetry();
  const ev = (o: Partial<ForceEvent>): ForceEvent => ({ t: 1, kind: "collision", who: 0, cause: "charge", phase: "stagger", impulse: 400, balance: 0.3, pushback: 0.4, duration: 0.3, hp01: 1, stamina01: 1, outcome: "stagger", ...o });
  acc.force(ev({ who: 0 })); acc.force(ev({ who: 1 }));
  acc.force(ev({ kind: "fall", who: 1, cause: "collision", phase: "falling", duration: 1.6, outcome: "back" }));
  acc.downed(1, 1.5); acc.damageWhileDown(1, 300);
  acc.force(ev({ kind: "rise", who: 1, cause: "collision", phase: "stand", duration: 2.1, outcome: "rose" }));
  acc.force(ev({ impulse: NaN }));
  const f = acc.forceSummary();
  assertEquals(f.collisions, 1); assertEquals(f.falls, [0, 1]); assertEquals(f.rises, [0, 1]);
  assertEquals(f.downS, [0, 1.5]); assertEquals(f.meanDownS, 1.5); assertEquals(f.damageWhileDown, [0, 300]); assertEquals(f.causes, { collision: 1 });
  assertEquals(f.events.length, 4); assertEquals(acc.refused, 1);
  for (let i = 0; i < FORCE_EVENT_CAP + 10; i++) acc.force(ev({ t: i }));
  const g = acc.forceSummary();
  assertEquals(g.events.length, FORCE_EVENT_CAP); assertEquals(g.dropped, 14);
  const c = compactForces(g);
  assertEquals(c.events.length, REPORT_FORCE_EVENTS);
  const t = acc.summary();
  const rep = buildReport({ id: "RPT-1", createdAt: "2026-11-02T00:00:00Z", telemetry: [t, t], opponentIndex: 1, probableStrategies: [{ id: "attack", weight: 1 }],
    habits: { openingMove: "x", averageApproachS: 1, retreatThreshold: 0, favouredBand: "contact" }, outcome: "ko", forces: g });
  assert(rep.forces !== undefined && rep.forces.events.length === REPORT_FORCE_EVENTS);
  assert(encodedBytes(rep) <= REPORT_BYTE_CAP, `${encodedBytes(rep)} bytes`);
});

Deno.test("ui: DOWN chip for falling/down/rising only; force callouts are fixed words", () => {
  assertEquals(["stand", "stagger", "stumble", "falling", "down", "rising", undefined].map(fallChip), ["", "", "", "DOWN", "DOWN", "DOWN", ""]);
  assertEquals(FORCE_TEXT.down.text, "Down!"); assertEquals(FORCE_TEXT.shoved.text, "Shoved");
});
