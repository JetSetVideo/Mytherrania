// deno-lint-ignore-file no-explicit-any -- QA verifier: loads lane modules by path (they may not exist yet) and reads untyped debug globals.
// Wave FALL — agent V's INDEPENDENT verifier (forces, collisions, falls). It reuses no lane probe or test.
//
//   deno run -A tools/verify-wave-fall.ts batch <label> [root] [matches]  # MatchSim batch (seeded) from <root>/src -> artifacts/wave-fall/verify/batch-<label>.json
//   deno run -A tools/verify-wave-fall.ts fuzz                            # Deno property fuzz of Collision.ts / Fall.ts / damage path -> fuzz.json
//   deno run -A tools/verify-wave-fall.ts browser [distDir] [port]        # Chrome: fight, QA push/trip, debugFall timeline, rig low point -> browser.json + PNGs
//   deno run -A tools/verify-wave-fall.ts doc                             # docs/wave-fall/VERIFY.md from the JSON
//
// "before" = `git archive HEAD | tar -x -C <scratch>` (skill pitfall 24) and `batch before <scratch>`.

const ROOT = "artifacts/wave-fall/verify";
const mode = Deno.args[0] ?? "fuzz";
await Deno.mkdir(ROOT, { recursive: true });

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const exists = async (p: string) => { try { await Deno.stat(p); return true; } catch { return false; } };
const toUrl = (p: string) => new URL(p.startsWith("/") ? `file://${p}` : `file://${Deno.cwd()}/${p}`).href;

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (b) MatchSim batch
// ══════════════════════════════════════════════════════════════════════════════════════════════════
const STUDY_CLASSES = ["Barbarian", "Warrior", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"];
/** Kinds whose event opens a "downed" interval for `seat` (the faller) and closes it. */
const DOWN_OPEN = /^(fall|down|falling|knockdown)$/i, DOWN_CLOSE = /^(rise|risen|stand|getup|up)$/i;

async function batch(label: string, root: string, matches: number) {
  const B = await import(toUrl(`${root}/src/balance/Batch.ts`));
  const D = await import(toUrl(`${root}/src/game/Disposition.ts`));
  const truce: number = D.truceSeconds();
  // Downed (penalties apply) = down | rising: the trace's "fall" fires as the body starts FALLING, so the
  // downed window opens FALL_SECONDS later; "rise" fires back at stand.
  const FS: number = await import(toUrl(`${root}/src/game/Fall.ts`)).then((m) => m.FALL_SECONDS ?? 0).catch(() => 0);
  const seed = 4242;
  const t0 = performance.now();
  let curEv: any[] = [];
  const perMatch: any[] = [];
  const kindCounts: Record<string, number> = {};
  const forcesAgg: any = { n: 0, causes: {} };
  const digestParts: string[] = [];
  const dmgRatios: number[] = [], kbRatios: number[] = [];
  const critN: Record<string, number> = {}, critC: Record<string, number> = {};
  const traceCauses: Record<string, number> = {};
  const records = B.runBatch({
    matches, seed, design: "random",
    sim: { ...(label === "off" ? { falls: false } : label === "unaware" ? { fallAware: [false, false] } : {}), trace: (e: any) => { if (e.kind !== "think") curEv.push(e); } },
    onRecord: (r: any) => {
      const o = r.outcome;
      const ev = curEv; curEv = [];
      digestParts.push(JSON.stringify([o.winner, o.reason, o.duration, o.hpLeft, o.damageDealt, o.hits, o.swings, o.wallHits, o.edgeTime]));
      for (const e of ev) kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
      // Downed intervals per seat from the trace (open on fall/down, close on rise; an open interval ends at the match end).
      const down: [number, number][][] = [[], []];
      const openAt: (number | null)[] = [null, null];
      let falls = 0, collisions = 0;
      for (const e of ev) {
        if (e.kind === "collision") collisions++;
        if (e.kind === "fall") traceCauses[String(e.note ?? "?")] = (traceCauses[String(e.note ?? "?")] ?? 0) + 1;
        if (DOWN_OPEN.test(e.kind) || (e.kind === "fall" )) { falls++; if (openAt[e.seat] === null) openAt[e.seat] = e.t; }
        if (DOWN_CLOSE.test(e.kind) && openAt[e.seat] !== null) { down[e.seat].push([openAt[e.seat]!, e.t]); openAt[e.seat] = null; }
      }
      for (const s of [0, 1]) if (openAt[s] !== null) down[s].push([openAt[s]!, o.duration]);
      for (const s of [0, 1]) down[s] = down[s].map(([a, b]) => [Math.min(b, a + FS), b] as [number, number]);
      // Outcome-side telemetry (M may put records on the outcome instead of / beside the trace).
      const tele = o.telemetry ?? o.fallTelemetry ?? o.records ?? null;
      const fo = o.forces ?? null;
      if (fo) {
        forcesAgg.n++;
        for (const k of ["collisions", "falls", "downS", "damageWhileDown"]) forcesAgg[k] = (forcesAgg[k] ?? 0) + ((fo[k]?.[0] ?? 0) + (fo[k]?.[1] ?? 0));
        for (const [c, v] of Object.entries(fo.causes ?? {})) forcesAgg.causes[c] = (forcesAgg.causes[c] ?? 0) + (v as number);
      }
      const teleFalls = Array.isArray(tele) ? tele.filter((x: any) => x?.kind === "fall").length : (o.falls ? (Array.isArray(o.falls) ? o.falls.length : (o.falls[0] ?? 0) + (o.falls[1] ?? 0)) : null);
      const teleCollisions = Array.isArray(tele) ? tele.filter((x: any) => x?.kind === "collision").length : (o.collisions ? (Array.isArray(o.collisions) ? o.collisions.length : (o.collisions[0] ?? 0) + (o.collisions[1] ?? 0)) : null);
      // Strikes landed on a downed vs a standing defender, per second of the defender's exposure (hostile time only).
      const hostile = Math.max(0, o.duration - truce);
      let onDown = 0, onStand = 0, downSec = 0;
      for (const s of [0, 1] as const) {
        const def = 1 - s;
        const iv = down[def];
        downSec += iv.reduce((t, [a, b]) => t + Math.max(0, b - a), 0);
        for (const e of ev) {
          if (e.kind !== "hit" || e.seat !== s) continue;
          if (iv.some(([a, b]) => e.t >= a && e.t <= b)) onDown++; else onStand++;
        }
      }
      const standSec = Math.max(0, 2 * hostile - downSec);
      // The real damage path (MatchSim.resolveHit): hit events carry the defender's phase -> per attacker,
      // plain strikes ("hit"/"crit" notes, no skill) on a downed vs a standing defender.
      for (const s of [0, 1] as const) {
        const hs = ev.filter((e) => e.kind === "hit" && e.seat === s && e.phase !== undefined && (e.note === "hit" || e.note === "critical"));
        const isDown = (e: any) => e.phase === "down" || e.phase === "rising";
        const dPlain = hs.filter((e) => isDown(e) && e.note === "hit").map((e) => e.damage), sPlain = hs.filter((e) => !isDown(e) && e.note === "hit" && e.phase === "stand").map((e) => e.damage);
        if (dPlain.length && sPlain.length) dmgRatios.push(median(dPlain) / median(sPlain));
        const dKb = hs.filter((e) => isDown(e)).map((e) => e.knockback), sKb = hs.filter((e) => e.phase === "stand").map((e) => e.knockback);
        if (dKb.length && sKb.length) kbRatios.push(median(dKb) / median(sKb));
        for (const e of hs) { const k = isDown(e) ? "down" : e.phase === "stand" ? "stand" : "other"; critN[k] = (critN[k] ?? 0) + 1; if (e.note === "critical") critC[k] = (critC[k] ?? 0) + 1; }
      }
      const downDur = [...down[0], ...down[1]].map(([a, b]) => b - a);
      perMatch.push({
        reason: o.reason, winner: o.winner, duration: o.duration, classes: r.conditions.fighters.map((f: any) => f.className),
        falls, collisions, teleFalls, teleCollisions, downDur, onDown, onStand, downSec, standSec,
        extraKeys: Object.keys(o).filter((k) => !["winner", "reason", "duration", "hpLeft", "hpFracLeft", "damageDealt", "hits", "swings", "wallHits", "edgeTime", "error"].includes(k)),
      });
    },
  });
  const secs = (performance.now() - t0) / 1000;
  const reasons: Record<string, number> = {};
  const wins: Record<string, number> = {}, apps: Record<string, number> = {};
  const durs: number[] = [];
  for (const m of perMatch) {
    reasons[m.reason] = (reasons[m.reason] ?? 0) + 1;
    if (m.winner === null) continue;
    durs.push(m.duration);
    if (m.classes[0] === m.classes[1]) continue;
    for (const s of [0, 1]) { apps[m.classes[s]] = (apps[m.classes[s]] ?? 0) + 1; if (m.winner === s) wins[m.classes[s]] = (wins[m.classes[s]] ?? 0) + 1; }
  }
  const classWinShare: Record<string, number> = {};
  for (const c of STUDY_CLASSES) classWinShare[c] = r4((wins[c] ?? 0) / Math.max(1, apps[c] ?? 0));
  const mad = STUDY_CLASSES.reduce((t, c) => t + Math.abs(classWinShare[c] - 0.5), 0) / STUDY_CLASSES.length;
  const allDown = perMatch.flatMap((m) => m.downDur);
  const sum = (k: string) => perMatch.reduce((t, m) => t + (m[k] ?? 0), 0);
  const onDown = sum("onDown"), onStand = sum("onStand"), downSec = sum("downSec"), standSec = sum("standSec");
  const tF = perMatch.filter((m) => m.teleFalls !== null);
  const dig = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digestParts.join("\n"))))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const summary = {
    label, root, outcomeDigest: dig, matches: records.length, seed, seconds: Math.round(secs),
    errors: reasons.error ?? 0,
    reasons, ringOutShare: r4((reasons.ringout ?? 0) / records.length), koShare: r4((reasons.ko ?? 0) / records.length),
    medianDuelSeconds: Math.round((median(durs) - truce) * 100) / 100,
    classWinShare, classMeanAbsDev: r4(mad),
    traceKinds: kindCounts,
    fallsPerMatch: r4(sum("falls") / records.length),
    collisionsPerMatch: r4(sum("collisions") / records.length),
    telemetryFallsPerMatch: tF.length ? r4(tF.reduce((t, m) => t + m.teleFalls, 0) / tF.length) : null,
    telemetryCollisionsPerMatch: tF.length ? r4(tF.reduce((t, m) => t + (m.teleCollisions ?? 0), 0) / tF.length) : null,
    downWindowOpensAfterFallS: FS,
    meanDownSeconds: allDown.length ? r4(mean(allDown)) : null,
    downIntervals: allDown.length,
    strikesOnDownPerSec: downSec > 0 ? r4(onDown / downSec) : null,
    strikesOnStandPerSec: standSec > 0 ? r4(onStand / standSec) : null,
    strikesOnDown: onDown, strikesOnStand: onStand, downSeconds: r4(downSec), standSeconds: Math.round(standSec),
    forces: forcesAgg.n ? { matches: forcesAgg.n, collisionsPerMatch: r4(forcesAgg.collisions / forcesAgg.n), fallsPerMatch: r4(forcesAgg.falls / forcesAgg.n), downSecondsPerMatch: r4(forcesAgg.downS / forcesAgg.n), damageWhileDownPerMatch: r4(forcesAgg.damageWhileDown / forcesAgg.n), meanDownPerFall: forcesAgg.falls ? r4(forcesAgg.downS / forcesAgg.falls) : null, causes: forcesAgg.causes } : null,
    traceFallNotes: traceCauses,
    damagePath: {
      attackerMatchPairs: dmgRatios.length,
      medianDamageRatioDownOverStand: dmgRatios.length ? r4(median(dmgRatios)) : null,
      medianKnockbackRatioDownOverStand: kbRatios.length ? r4(median(kbRatios)) : null,
      critShareDown: critN.down ? r4((critC.down ?? 0) / critN.down) : null, critShareStand: critN.stand ? r4((critC.stand ?? 0) / critN.stand) : null,
      plainStrikesDown: critN.down ?? 0, plainStrikesStand: critN.stand ?? 0,
    },
    outcomeExtraKeys: [...new Set(perMatch.flatMap((m) => m.extraKeys))],
  };
  await Deno.writeTextFile(`${ROOT}/batch-${label}.json`, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (a) Deno fuzz — filled in against M's real exports once they exist (see fuzz.ts section below).
// ══════════════════════════════════════════════════════════════════════════════════════════════════
type Check = { id: string; lane: "M" | "A"; claim: string; method: string; pass: boolean | null; result: string };

async function fuzz(): Promise<Check[]> {
  const out: Check[] = [];
  const add = (c: Check) => { out.push(c); console.log(`${c.pass === null ? "SKIP" : c.pass ? "PASS" : "FAIL"} ${c.id} ${c.result}`); };
  const colP = "src/game/Collision.ts", fallP = "src/game/Fall.ts";
  if (!(await exists(colP))) add({ id: "V-C0", lane: "M", claim: "Collision.ts exists", method: "stat", pass: null, result: "absent" });
  else fuzzCollision(await import(toUrl(colP)), add);
  if (!(await exists(fallP))) add({ id: "V-F0", lane: "M", claim: "Fall.ts exists", method: "stat", pass: null, result: "absent" });
  else fuzzFall(await import(toUrl(fallP)), add);
  await Deno.writeTextFile(`${ROOT}/fuzz.json`, JSON.stringify(out, null, 2) + "\n");
  return out;
}

// ── fuzz helpers ────────────────────────────────────────────────────────────────────────────────────
/** Own PRNG (mulberry32) — independent of the game's rng32. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const U = (r: () => number, a: number, b: number) => a + (b - a) * r();
function randBody(r: () => number): any {
  return {
    mass: U(r, 45, 130), velocity: [U(r, -6, 6), U(r, -6, 6)], strength: U(r, 1, 12), agility: U(r, 1, 11), level: Math.floor(U(r, 1, 21)),
    stamina01: r(), hp01: r(), weaponMass: U(r, 0.3, 6), armourMass: U(r, 0, 30), guarding: r() < 0.25, downed: r() < 0.1,
  };
}
const allFinite = (o: any): boolean => typeof o === "number" ? Number.isFinite(o) : Array.isArray(o) ? o.every(allFinite) : o && typeof o === "object" ? Object.values(o).every(allFinite) : true;
const EPS = 1e-9;

type Add = (c: Check) => void;

function fuzzCollision(C: any, add: Add) {
  const N = 20000;
  const r = prng(0xfa11);
  // C1 symmetry: mirror inputs (b = a's stats, velocity mirrored) -> mirror outputs; and swap a<->b.
  let symWorst = 0, swapWorst = 0;
  for (let i = 0; i < N; i++) {
    const a = randBody(r), n: [number, number] = [U(r, -1, 1), U(r, -1, 1)];
    const b = { ...a, velocity: [-a.velocity[0], -a.velocity[1]] as [number, number] };
    const res = C.resolveCollision(a, b, n);
    symWorst = Math.max(symWorst, Math.abs(res.a.dv[0] + res.b.dv[0]), Math.abs(res.a.dv[1] + res.b.dv[1]), Math.abs(res.a.recoil - res.b.recoil),
      Math.abs(res.a.pushback - res.b.pushback), Math.abs(res.a.stagger - res.b.stagger), Math.abs(res.a.balanceLoss - res.b.balanceLoss));
    const c = randBody(r);
    const ab = C.resolveCollision(a, c, n), ba = C.resolveCollision(c, a, [-n[0], -n[1]]);
    swapWorst = Math.max(swapWorst, Math.abs(ab.a.dv[0] - ba.b.dv[0]), Math.abs(ab.a.dv[1] - ba.b.dv[1]), Math.abs(ab.b.stagger - ba.a.stagger),
      Math.abs(ab.a.pushback - ba.b.pushback), Math.abs(ab.b.balanceLoss - ba.a.balanceLoss), Math.abs(ab.impulse - ba.impulse));
  }
  add({ id: "V-C1", lane: "M", claim: "equal fighters, mirrored velocities -> mirror outputs; swapping a/b swaps outputs", method: `fuzz ${N}x2 random BodyStates`, pass: symWorst < 1e-9 && swapWorst < 1e-9, result: `worst mirror residual ${symWorst.toExponential(2)}, worst swap residual ${swapWorst.toExponential(2)}` });
  // C2 momentum in the stat-weighted effective masses; also real (carried-mass) momentum for the record.
  let momWorst = 0, realWorst = 0, approachOK = 0, approachN = 0;
  for (let i = 0; i < N; i++) {
    const a = randBody(r), b = randBody(r), n: [number, number] = [U(r, -1, 1), U(r, -1, 1)];
    const res = C.resolveCollision(a, b, n);
    const ma = res.a.effectiveMass, mb = res.b.effectiveMass;
    const px = ma * res.a.dv[0] + mb * res.b.dv[0], pz = ma * res.a.dv[1] + mb * res.b.dv[1];
    momWorst = Math.max(momWorst, Math.hypot(px, pz) / Math.max(1e-9, res.impulse));
    const ra = C.carriedMass(a) * res.a.dv[0] + C.carriedMass(b) * res.b.dv[0];
    realWorst = Math.max(realWorst, Math.abs(ra) / Math.max(1e-9, res.impulse));
    // after contact they no longer approach along n
    if (res.closingSpeed > 0) {
      approachN++;
      const va = [a.velocity[0] + res.a.dv[0], a.velocity[1] + res.a.dv[1]], vb = [b.velocity[0] + res.b.dv[0], b.velocity[1] + res.b.dv[1]];
      if ((va[0] - vb[0]) * res.normal[0] + (va[1] - vb[1]) * res.normal[1] <= 1e-9) approachOK++;
    }
  }
  add({ id: "V-C2", lane: "M", claim: "momentum conserved in the effective masses (m_eff,a dv_a + m_eff,b dv_b = 0); bodies separate after contact", method: `fuzz ${N}`, pass: momWorst < 1e-9 && approachOK === approachN, result: `worst |Σ m_eff dv|/J ${momWorst.toExponential(2)}; separating after ${approachOK}/${approachN}; carried-mass momentum residual up to ${r4(realWorst)}·J (by design: stability-weighted)` });
  // C3 monotonicity per stat.
  const stats: [string, number, number][] = [["mass", 45, 130], ["armourMass", 0, 30], ["weaponMass", 0.3, 6], ["strength", 1, 12], ["agility", 1, 11], ["level", 1, 20], ["stamina01", 0, 1], ["hp01", 0, 1]];
  const mono: Record<string, any> = {};
  let monoPass = true;
  for (const [k, lo, hi] of stats) {
    let viol = 0, strictPush = 0, strictStag = 0, otherViol = 0;
    const M = 4000;
    for (let i = 0; i < M; i++) {
      const a = randBody(r), b = randBody(r); a.downed = false;
      // a head-on charge so there is something to measure
      const n: [number, number] = [1, 0]; a.velocity = [U(r, 1, 7), 0]; b.velocity = [-U(r, 0, 7), 0];
      const x1 = U(r, lo, hi), x2 = U(r, lo, hi);
      const [s, t] = x1 < x2 ? [x1, x2] : [x2, x1];
      const A1 = { ...a, [k]: s }, A2 = { ...a, [k]: t };
      const r1 = C.resolveCollision(A1, b, n), r2 = C.resolveCollision(A2, b, n);
      const dv1 = Math.hypot(...r1.a.dv as [number, number]), dv2 = Math.hypot(...r2.a.dv as [number, number]);
      // Mass terms: dv falls with more mass. Recoil is speed away; for mass we compare dv/pushback/stagger/balance.
      if (dv2 > dv1 + EPS || r2.a.stagger > r1.a.stagger + EPS || r2.a.balanceLoss > r1.a.balanceLoss + EPS || r2.a.pushback > r1.a.pushback + EPS) viol++;
      if (Math.hypot(...r2.b.dv as [number, number]) < Math.hypot(...r1.b.dv as [number, number]) - EPS) otherViol++;
      if (r2.a.pushback < r1.a.pushback - 1e-6) strictPush++;
      if (r2.a.stagger < r1.a.stagger - 1e-6) strictStag++;
    }
    mono[k] = { violations: viol, otherSideViolations: otherViol, strictlyLessPushedShare: r4(strictPush / M), strictlyShorterStaggerShare: r4(strictStag / M) };
    if (viol || otherViol) monoPass = false;
  }
  add({ id: "V-C3", lane: "M", claim: "more mass/armour/weapon/strength/agility/level/stamina/hp -> less |dv|, pushback, stagger, balance loss (the other side more)", method: "fuzz 4000 pairs per stat, head-on charge", pass: monoPass, result: Object.entries(mono).map(([k, v]) => `${k}: viol ${v.violations}/${v.otherSideViolations}, strict push ${v.strictlyLessPushedShare}, strict stagger ${v.strictlyShorterStaggerShare}`).join("; ") });
  // Stagger is driven by strength/agility/level/stamina (recover), mass via dv: report which stats ever STRICTLY shorten the stagger.
  const noEffect = Object.entries(mono).filter(([, v]) => v.strictlyLessPushedShare === 0).map(([k]) => k);
  add({ id: "V-C3b", lane: "M", claim: "every listed stat actually matters for pushback (not flat)", method: "share of pairs with strictly less pushback", pass: noEffect.length === 0, result: noEffect.length ? `no effect on pushback: ${noEffect.join(",")}` : "all stats strictly reduce pushback on some pairs" });
  // C4 determinism + C5 totality
  let det = true, fin = true;
  for (let i = 0; i < 3000; i++) {
    const a = randBody(r), b = randBody(r);
    if (JSON.stringify(C.resolveCollision(a, b)) !== JSON.stringify(C.resolveCollision(structuredClone(a), structuredClone(b)))) det = false;
    const g = (x: any) => { const y: any = { ...x }; for (const key of Object.keys(y)) if (r() < 0.3) y[key] = [NaN, Infinity, -Infinity, -5, 0, 1e9, undefined][Math.floor(r() * 7)]; if (r() < 0.2) y.velocity = [NaN, Infinity]; return y; };
    let res: any;
    try { res = C.resolveCollision(g(a), g(b), r() < 0.5 ? [NaN, 0] : [0, 0]); } catch { fin = false; continue; }
    if (!allFinite(res)) fin = false;
  }
  add({ id: "V-C4", lane: "M", claim: "deterministic and total (finite outputs for NaN/Inf/negative/undefined fields)", method: "fuzz 3000 + garbage fields", pass: det && fin, result: `deterministic ${det}, finite ${fin}` });
  // C6 concrete: equal vs unequal fighters (head-on charge, 4 m/s each).
  const base = { mass: 80, velocity: [4, 0], strength: 5.5, agility: 5, level: 1, stamina01: 1, hp01: 1, weaponMass: 2, armourMass: 5, guarding: false, downed: false };
  const eq = C.resolveCollision(base, { ...base, velocity: [-4, 0] }, [1, 0]);
  const heavy = { ...base, mass: 110, strength: 9, agility: 3, level: 15, armourMass: 20, weaponMass: 4 };
  const light = { ...base, mass: 60, strength: 3, agility: 9, level: 1, armourMass: 2.5, weaponMass: 0.8, velocity: [-4, 0] };
  const uq = C.resolveCollision(heavy, light, [1, 0]);
  const tired = C.resolveCollision(base, { ...base, velocity: [-4, 0], stamina01: 0.05, hp01: 0.2 }, [1, 0]);
  const dn = C.resolveCollision(base, { ...base, velocity: [0, 0], downed: true }, [1, 0]), up = C.resolveCollision(base, { ...base, velocity: [0, 0] }, [1, 0]);
  const f2 = (x: number) => Math.round(x * 100) / 100;
  const okUq = uq.a.pushback < uq.b.pushback && uq.a.stagger <= uq.b.stagger;
  add({ id: "V-C5", lane: "M", claim: "equal charge = equal push; heavy/strong/levelled vs light pushes the light one further", method: "fixed fighters 4 m/s head-on", pass: Math.abs(eq.a.pushback - eq.b.pushback) < 1e-12 && okUq && tired.b.pushback > tired.a.pushback,
    result: `equal: push ${f2(eq.a.pushback)}/${f2(eq.b.pushback)} m stagger ${f2(eq.a.stagger)}/${f2(eq.b.stagger)} s bal ${f2(eq.a.balanceLoss)}/${f2(eq.b.balanceLoss)}; heavy vs light: push ${f2(uq.a.pushback)}/${f2(uq.b.pushback)} m stagger ${f2(uq.a.stagger)}/${f2(uq.b.stagger)} s bal ${f2(uq.a.balanceLoss)}/${f2(uq.b.balanceLoss)}; fresh vs tired+wounded push ${f2(tired.a.pushback)}/${f2(tired.b.pushback)} m` });
  add({ id: "V-C6", lane: "M", claim: "a downed body is pushed further (DOWNED_KNOCKBACK) and gets no extra balance loss", method: "same charge into standing vs downed target at rest", pass: dn.b.pushback > up.b.pushback && dn.b.balanceLoss === 0,
    result: `standing target push ${f2(up.b.pushback)} m, downed ${f2(dn.b.pushback)} m (x${f2(dn.b.pushback / Math.max(1e-9, up.b.pushback))}), downed balanceLoss ${dn.b.balanceLoss}` });
}

function fuzzFall(F: any, add: Add) {
  const r = prng(0xd0e5);
  const f2 = (x: number) => Math.round(x * 1000) / 1000;
  // F1 get-up law monotonicity + clamp.
  const args: [string, number, number, 1 | -1][] = [["armourMass", 0, 40, 1], ["bodyMass", 40, 140, 1], ["agility", 1, 11, -1], ["hp01", 0, 1, -1], ["stamina01", 0, 1, -1]];
  const idx: Record<string, number> = { armourMass: 0, bodyMass: 1, agility: 2, hp01: 3, stamina01: 4 };
  const res: string[] = [];
  let pass = true, lo = Infinity, hi = -Infinity;
  for (const [k, a, b, sgn] of args) {
    let viol = 0, strict = 0;
    const M = 5000;
    for (let i = 0; i < M; i++) {
      const v = [U(r, 0, 40), U(r, 40, 140), U(r, 1, 11), r(), r()];
      const x1 = U(r, a, b), x2 = U(r, a, b), [s, t] = x1 < x2 ? [x1, x2] : [x2, x1];
      const v1 = [...v], v2 = [...v]; v1[idx[k]] = s; v2[idx[k]] = t;
      const T1 = F.riseSeconds(...v1), T2 = F.riseSeconds(...v2);
      lo = Math.min(lo, T1, T2); hi = Math.max(hi, T1, T2);
      if (sgn * (T2 - T1) < -1e-12) viol++;
      if (sgn * (T2 - T1) > 1e-6) strict++;
    }
    res.push(`${k}${sgn > 0 ? "↑slower" : "↑faster"}: viol ${viol}, strict ${r4(strict / M)}`);
    if (viol || strict === 0) pass = false;
  }
  const light = F.riseSeconds(0, 60, 9, 1, 1), heavy = F.riseSeconds(25, 110, 3, 0.2, 0.1), mid = F.riseSeconds(5, 75, 5, 1, 1);
  add({ id: "V-F1", lane: "M", claim: "riseSeconds monotone: heavier armour/body, wounded, tired -> slower; agile -> faster; clamped", method: "fuzz 5000 pairs per argument", pass: pass && lo >= 0.8 - 1e-9 && hi <= 3.5 + 1e-9 && light < mid && mid < heavy,
    result: `${res.join("; ")}; range [${f2(lo)}, ${f2(hi)}] s; agile light fresh ${f2(light)} s, average ${f2(mid)} s, plate heavy wounded tired ${f2(heavy)} s` });
  // F2 state machine: random triggers + steps; transitions legal (own table from the contract order) and never stuck.
  const OWN_NEXT: Record<string, string[]> = { stand: ["stagger", "stumble", "falling"], stagger: ["stand", "stumble", "falling"], stumble: ["stand", "falling"], falling: ["down"], down: ["rising"], rising: ["stand", "falling"] };
  const causes = ["collision", "hit", "edge", "backstep", "ledge", "exhaustion"];
  let illegal = 0, stuck = 0, worstReturn = 0, nanT = 0, falls = 0, skippedDown = 0;
  const RUNS = 4000;
  for (let run = 0; run < RUNS; run++) {
    const s = F.standing();
    const body = { armourMass: U(r, 0, 30), bodyMass: U(r, 45, 130), agility: U(r, 1, 11), hp01: r(), stamina01: r() };
    let prev = s.phase, sawDown = false;
    const steps = 30 + Math.floor(r() * 200);
    for (let i = 0; i < steps; i++) {
      if (r() < 0.08) F.triggerFall(s, { balanceLoss: r() < 0.1 ? [NaN, -1, 2][Math.floor(r() * 3)] : r(), cause: causes[Math.floor(r() * 6)], dir: [U(r, -1, 1), U(r, -1, 1)], facing: [U(r, -1, 1), U(r, -1, 1)], stagger: r() < 0.5 ? U(r, 0, 1.2) : 0, roll: r(), body });
      if (s.phase !== prev && !OWN_NEXT[prev].includes(s.phase)) illegal++;
      if (s.phase === "falling" && prev !== "falling") { falls++; sawDown = false; }
      prev = s.phase;
      F.stepFall(s, U(r, 0.001, 1 / 30));
      if (s.phase !== prev && !OWN_NEXT[prev].includes(s.phase)) illegal++;
      if (s.phase === "down") sawDown = true;
      if (prev === "falling" && s.phase !== "falling" && s.phase !== "down") skippedDown++;
      if (s.phase === "falling" && prev !== "falling") { falls++; sawDown = false; }
      if (!Number.isFinite(s.t) || !Number.isFinite(s.duration)) nanT++;
      prev = s.phase;
    }
    void sawDown;
    // No more triggers: it must return to stand within 0.9 (stumble) + 0.5 (fall) + 3.5 (get-up) + slack.
    let t = 0;
    while (s.phase !== "stand" && t < 30) { const d = U(r, 0.005, 1 / 30); const p0 = s.phase; F.stepFall(s, d); if (s.phase !== p0 && !OWN_NEXT[p0].includes(s.phase)) illegal++; t += d; }
    if (s.phase !== "stand") stuck++;
    worstReturn = Math.max(worstReturn, t);
  }
  const BOUND = 0.9 + 0.5 + 3.5 + 1.2 + 0.1;
  add({ id: "V-F2", lane: "M", claim: "fall state machine: only contract-order transitions, finite timers, always back to stand within a bound", method: `${RUNS} random runs (random triggers incl. NaN loss, dt <= 1/30), then free-run`, pass: illegal === 0 && stuck === 0 && nanT === 0 && worstReturn <= BOUND && skippedDown === 0,
    result: `illegal ${illegal}, stuck ${stuck}, non-finite ${nanT}, falling->not-down ${skippedDown}, falls seen ${falls}, worst return to stand ${f2(worstReturn)} s (bound ${f2(BOUND)} s)` });
  // F3 triggers by band + fallChance monotonicity.
  const body0 = { armourMass: 5, bodyMass: 75, agility: 5, hp01: 1, stamina01: 1 };
  const trig = (L: number, roll = 0.99, st = 0, b = body0) => F.triggerFall(F.standing(), { balanceLoss: L, cause: "collision", dir: [1, 0], facing: [-1, 0], stagger: st, roll, body: b });
  const pFall = trig(0.85), pStum = trig(0.5), pStag = trig(0.15), pNone = trig(0.05), pStagT = trig(0.0, 0.5, 0.3);
  const exh = trig(0.3, 0.99, 0, { ...body0, stamina01: 0.05 });
  let fcViol = 0;
  for (let i = 0; i < 5000; i++) {
    const L1 = r(), L2 = r(), a1 = U(r, 1, 11), a2 = U(r, 1, 11), s1 = r(), s2 = r();
    const base = F.fallChance(Math.min(L1, L2), Math.max(a1, a2), Math.max(s1, s2));
    if (F.fallChance(Math.max(L1, L2), Math.max(a1, a2), Math.max(s1, s2)) < base - 1e-12) fcViol++;
    if (F.fallChance(Math.min(L1, L2), Math.min(a1, a2), Math.max(s1, s2)) < base - 1e-12) fcViol++;
    if (F.fallChance(Math.min(L1, L2), Math.max(a1, a2), Math.min(s1, s2)) < base - 1e-12) fcViol++;
  }
  // roll decides a stumble's outcome: low roll falls, high roll recovers
  const sLow = trig(0.6, 0.01), sHigh = trig(0.6, 0.999);
  add({ id: "V-F3", lane: "M", claim: "balance-loss bands trigger falling/stumble/stagger; exhaustion adds loss; fallChance monotone (loss up, agility down, stamina down -> more falls)", method: "fixed triggers + 5000 fallChance triples",
    pass: pFall.phase === "falling" && pStum.phase === "stumble" && pStag.phase === "stagger" && pNone.phase === "stand" && pStagT.phase === "stagger" && exh.phase === "stumble" && exh.cause === "exhaustion" && fcViol === 0 && sLow.willFall === true && sHigh.willFall === false && pFall.plan && Math.abs(pFall.plan.down + pFall.plan.rise - F.riseSeconds(5, 75, 5, 1, 1)) < 1e-9,
    result: `L0.85->${pFall.phase} L0.5->${pStum.phase} L0.15->${pStag.phase} L0.05->${pNone.phase} stagger0.3s->${pStagT.phase}; L0.3 at stamina 0.05 -> ${exh.phase}/${exh.cause}; fallChance violations ${fcViol}; stumble roll 0.01 willFall ${sLow.willFall}, roll 0.999 ${sHigh.willFall}; plan down+rise = riseSeconds ${pFall.plan ? f2(pFall.plan.down + pFall.plan.rise) : "-"}` });
  // F4 edge / backstep / ledge rules.
  const fp = 0.35;
  const outside = F.teeterLoss({ beyond: fp + 0.05, footprint: fp, outwardSpeed: 3, open: true });
  const inside = F.teeterLoss({ beyond: -0.5, footprint: fp, outwardSpeed: 3, open: true });
  const brink = F.teeterLoss({ beyond: 0, footprint: fp, outwardSpeed: 2, open: true });
  const brinkFast = F.teeterLoss({ beyond: 0, footprint: fp, outwardSpeed: 4, open: true });
  const brinkSlow = F.teeterLoss({ beyond: 0, footprint: fp, outwardSpeed: 0.2, open: true });
  const walled = F.teeterLoss({ beyond: 0, footprint: fp, outwardSpeed: 2, open: false });
  const bsDrop = F.backstepLoss(true, 0.6, 0.3, false), bsFlat = F.backstepLoss(true, 0.1, 0.3, false), bsFwd = F.backstepLoss(false, 0.6, 0.3, false), bsObs = F.backstepLoss(true, 0, 0.3, true);
  const lf = F.ledgeFall(0.6, 0.3, 2), lfWalk = F.ledgeFall(0.6, 0.3, 0.5), lfStep = F.ledgeFall(0.2, 0.3, 2);
  add({ id: "V-F4", lane: "M", claim: "edge: outside = ring-out (no teeter), brink + outward -> teeter (faster = more loss), walled/inside/slow -> none; back-step into drop/obstacle stumbles; pushed over a ledge falls",
    method: "fixed probes", pass: outside === null && inside === null && walled === null && brinkSlow === null && brink !== null && brinkFast > brink && brink >= 0.4 && bsDrop !== null && bsObs !== null && bsFlat === null && bsFwd === null && lf && !lfWalk && !lfStep,
    result: `teeter outside ${outside} inside ${inside} walled ${walled} slow ${brinkSlow} brink2m/s ${brink} brink4m/s ${brinkFast}; backstep drop ${bsDrop} obstacle ${bsObs} flat ${bsFlat} forward ${bsFwd}; ledge pushed ${lf} walked ${lfWalk} small step ${lfStep}` });
  // F6 the get-up split: down + rising = riseSeconds exactly; rising never shorter than RISE_PHASE_MIN (A's get-up needs time).
  if (typeof F.risePlan === "function") {
    let sumErr = 0, minRise = Infinity, minDown = Infinity;
    for (let i = 0; i < 20000; i++) {
      const b = { armourMass: U(r, 0, 40), bodyMass: U(r, 40, 140), agility: U(r, 1, 11), hp01: r(), stamina01: r() };
      const pl = F.risePlan(b), T = F.riseSeconds(b.armourMass, b.bodyMass, b.agility, b.hp01, b.stamina01);
      sumErr = Math.max(sumErr, Math.abs(pl.down + pl.rise - T)); minRise = Math.min(minRise, pl.rise); minDown = Math.min(minDown, pl.down);
    }
    const floorR = F.RISE_PHASE_MIN ?? 0;
    add({ id: "V-F6", lane: "M", claim: "get-up split: down + rising = riseSeconds; rising >= RISE_PHASE_MIN; down > 0", method: "fuzz 20000 bodies", pass: sumErr < 1e-9 && minRise >= floorR - 1e-9 && minDown > 0,
      result: `max |down+rise-T| ${sumErr.toExponential(1)}; min rising ${f2(minRise)} s (RISE_PHASE_MIN ${F.RISE_PHASE_MIN}); min down ${f2(minDown)} s` });
  }
  // F5 downed penalty constants: relationships (not literals).
  const dn = { ...F.standing(), phase: "down" }, ri = { ...F.standing(), phase: "rising" }, fa = { ...F.standing(), phase: "falling" };
  add({ id: "V-F5", lane: "M", claim: "downed penalties exist, point the right way and apply only down/rising", method: "constants + helpers",
    pass: F.DOWNED_DAMAGE_TAKEN > 1 && F.DOWNED_CRIT_BONUS > 0 && F.DOWNED_STATUS_DURATION > 1 && F.DOWNED_KNOCKBACK > 1 && F.downedDamageMul(dn) === F.DOWNED_DAMAGE_TAKEN && F.downedDamageMul(ri) === F.DOWNED_DAMAGE_TAKEN && F.downedDamageMul(fa) === 1 && F.downedCritBonus(F.standing()) === 0,
    result: `DAMAGE_TAKEN ${F.DOWNED_DAMAGE_TAKEN}, CRIT_BONUS ${F.DOWNED_CRIT_BONUS}, STATUS_DURATION ${F.DOWNED_STATUS_DURATION}, KNOCKBACK ${F.DOWNED_KNOCKBACK}; mul down ${F.downedDamageMul(dn)} rising ${F.downedDamageMul(ri)} falling ${F.downedDamageMul(fa)}` });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (d) Chrome
// ══════════════════════════════════════════════════════════════════════════════════════════════════
async function browser(dist: string, port: number) {
  const CLS = Deno.args[3] ?? "Warrior";
  const { chromium } = await import("playwright");
  const { serveAsset } = await import("./serve.ts");
  const OUT = `${ROOT}/browser${CLS === "Warrior" ? "" : "-" + CLS}`;
  await Deno.mkdir(OUT, { recursive: true });
  const server = Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, (r) => serveAsset(r, dist));
  const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const report: Record<string, any> = { dist, port };
  try {
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await p.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
    await p.waitForTimeout(600);
    const call = (fn: string, ...args: unknown[]) =>
      p.evaluate(([f, a]) => { const e = (globalThis as any).__MYTHERRANIA__.engine; if (typeof e[f as string] !== "function") throw new Error(`no engine.${f}`); return e[f as string].call(e, ...(a as unknown[])); }, [fn, args] as const);
    report.hooks = await p.evaluate(() => {
      const e = (globalThis as any).__MYTHERRANIA__.engine; const names = new Set<string>();
      for (let o = e; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const n of Object.getOwnPropertyNames(o)) if (/fall|shove|push|trip|collision|down/i.test(n)) names.add(n);
      return [...names];
    });
    await call("debugStartDuel", CLS, CLS);
    report.className = CLS;
    await p.waitForTimeout(1200);
    const running = async () => { const a = await call("debugClock") as any; await p.waitForTimeout(400); const c = await call("debugClock") as any; return c.sinceStart > a.sinceStart + 0.2; };
    for (let i = 0; i < 8 && !(await running()); i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(300); }
    report.running = await running();
    for (let i = 0; i < 30; i++) { const c = await call("debugClock") as any; if (c.hostile > 0.3) break; await p.waitForTimeout(400); }
    await p.screenshot({ path: `${OUT}/00-fight.png` });
    const sample = () => p.evaluate(() => {
      const e = (globalThis as any).__MYTHERRANIA__.engine;
      const fall = typeof e.debugFall === "function" ? e.debugFall.call(e) : null;
      const rig = e.debugRigInfo.call(e);
      const BONES = ["root", "spine", "abdomen", "neck", "head", "shoulderL", "shoulderR", "elbowL", "elbowR", "hipL", "hipR", "kneeL", "kneeR", "ankleL", "ankleR", "toeL", "toeR"];
      const piv = Object.entries(rig.pivots as Record<string, number[]>).filter(([n]) => BONES.includes(n));
      let low = Infinity, lowName = "";
      for (const [n, v] of piv) if (v[1] < low) { low = v[1]; lowName = n; }
      const hip = (rig.pivots.root ?? null) as number[] | null;
      const head = (rig.pivots.head ?? null) as number[] | null;
      const at = hip ?? [0, 0, 0];
      const fl = e.debugFloorAt.call(e, at[0], at[2]);
      const floor = fl.floor ?? fl.field ?? 0;
      // The true lowest SKIN point: CPU-skin every 7th vertex of the player's skinned meshes (the group whose root bone is at rig.pivots.root).
      let skinLow = Infinity, skinX = 0, skinZ = 0, clear = Infinity, clearName = "";
      const floorY = floor;
      const scene = e.debugScene.call(e);
      const bonesW: Record<string, number[]> = {};
      scene.traverse((o: any) => {
        if (o.name !== "skinned-humanoid" || !hip) return;
        let rootPos: any = null;
        o.traverse((c: any) => { if (c.isBone && c.name === "root" && !rootPos) { rootPos = new c.position.constructor(); c.getWorldPosition(rootPos); } });
        if (!rootPos || Math.hypot(rootPos.x - hip[0], rootPos.y - hip[1], rootPos.z - hip[2]) > 0.02) return;
        o.traverse((c: any) => { if (c.isBone && BONES.includes(c.name) && !bonesW[c.name]) { const w = new c.position.constructor(); c.getWorldPosition(w); bonesW[c.name] = [w.x, w.y, w.z]; } });
        o.traverse((m: any) => {
          if (!m.isSkinnedMesh || !m.visible) return;
          const v = new m.position.constructor(), n = m.geometry.attributes.position.count;
          for (let i = 0; i < n; i += 7) {
            m.getVertexPosition(i, v); m.localToWorld(v);
            if (v.y < skinLow) { skinLow = v.y; skinX = v.x; skinZ = v.z; }
            // Clearance = height above the floor DIRECTLY UNDER this vertex (on a slope the absolute lowest vertex is not the closest one).
            if (v.y - floorY - 0.6 < clear) { const fv = e.debugFloorAt.call(e, v.x, v.z); const c = v.y - (fv.floor ?? fv.field ?? 0); if (c < clear) { clear = c; clearName = m.name || "skin"; } }
          }
        });
      });
      // Bones only (isBone): a weapon part may also be NAMED "head" in debugRigInfo's pivot map.
      if (Object.keys(bonesW).length) {
        low = Infinity;
        for (const [n, v] of Object.entries(bonesW)) if (v[1] < low) { low = v[1]; lowName = n; }
      }
      const headB = bonesW.head ?? head;
      const clock = e.debugClock.call(e);
      return { t: clock.sinceStart, fall, lowJoint: low - floor, lowName, hip: hip ? hip[1] - floor : null, head: headB ? headB[1] - floor : null, skinLowAbs: Number.isFinite(skinLow) ? skinLow - ((f) => f.floor ?? f.field ?? 0)(e.debugFloorAt.call(e, skinX, skinZ)) : null, skinLow: Number.isFinite(clear) ? clear : null, clearName, floor, bones: piv.length };
    });
    report.idle = await sample();
    // Collisions in the live engine: equal fighters, then heavy/strong/agile player vs light/weak opponent.
    const settle = async () => { for (let i = 0; i < 40; i++) { const f = await call("debugFall") as any; if (f.seats.every((x: any) => x.phase === "stand")) return true; await p.waitForTimeout(150); } return false; };
    const slide = async (ms: number) => { const a = await call("debugFall") as any; await p.waitForTimeout(ms); const b2 = await call("debugFall") as any; return a.seats.map((x: any, i: number) => Math.hypot(b2.seats[i].x - x.x, b2.seats[i].z - x.z)); };
    void slide;
    await settle();
    report.forceEqual = await call("debugForce", { speed: 4.2 });
    await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/01-shove-equal.png` });
    await p.waitForTimeout(1200); await settle();
    report.heavyStats = await call("debugFallStats", 0, { strength: 9, agility: 8, armor: 8, vitality: 9 });
    report.lightStats = await call("debugFallStats", 1, { strength: 2, agility: 2, armor: 0, vitality: 2 });
    report.forceUnequal = await call("debugForce", { speed: 4.2 });
    await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/02-shove-unequal.png` });
    report.afterUnequal = (await call("debugFall") as any).seats.map((x: any) => ({ phase: x.phase, cause: x.cause }));
    await p.waitForTimeout(1500); await settle();
    // Fall: push the player (seat 0) over with a full balance loss; sample phase + rig vs floor.
    const hookName = "debugPush";
    report.hookUsed = (report.hooks as string[]).includes(hookName) ? hookName : null;
    const timeline: any[] = [];
    const shots: Record<string, boolean> = {};
    if (report.hookUsed) {
      report.trials = [];
      for (const dir of [[1, 0], [-1, 0], [0, 1]] as [number, number][]) {
        await settle();
        const res = await call(hookName, 0, dir, 1, "hit");
        const t0 = Date.now(), start = timeline.length;
        while (Date.now() - t0 < 4500) {
          const s = await sample();
          timeline.push(s);
          const ph = phaseOf(s.fall);
          const pose = s.fall?.seats?.[0]?.pose ?? "?";
          const key = ph === "down" ? `down-${pose}` : ph ?? "";
          if (ph && !shots[key]) { shots[key] = true; await p.screenshot({ path: `${OUT}/phase-${key}.png` }); }
          await p.waitForTimeout(50);
        }
        const tr = timeline.slice(start);
        report.trials.push({ dir, res, pose: tr.find((x) => x.fall?.seats?.[0]?.phase === "down")?.fall.seats[0].pose ?? null, plan: tr.find((x) => x.fall?.seats?.[0]?.plan)?.fall.seats[0].plan ?? null, from: start, to: timeline.length });
      }
      report.fallPlan = report.trials[0]?.plan ?? null;
    }
    // Keep only the player's seat in the stored timeline (smaller JSON).
    for (const x of timeline) if (x.fall?.seats) x.fall = { seats: [x.fall.seats[0]], lastCollision: null };
    report.timeline = timeline;
    // (c) telemetry: every array of {kind: collision|fall|rise} in the engine's telemetry / match report, with its field set.
    report.telemetry = await p.evaluate(() => {
      const e = (globalThis as any).__MYTHERRANIA__.engine;
      const found: any[] = [];
      const seen = new Set<any>();
      const walk = (o: any, path: string, depth: number) => {
        if (!o || typeof o !== "object" || seen.has(o) || depth > 6) return;
        seen.add(o);
        if (Array.isArray(o)) {
          const hits = o.filter((x) => x && typeof x === "object" && ["collision", "fall", "rise"].includes(x.kind));
          if (hits.length) found.push({ path, n: hits.length, kinds: [...new Set(hits.map((x: any) => x.kind))], fields: [...new Set(hits.flatMap((x: any) => Object.keys(x)))], first: hits.slice(0, 3) });
          o.slice(0, 200).forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
          return;
        }
        for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`, depth + 1);
      };
      for (const f of ["debugFall", "debugFightTelemetry", "debugMatchReport"]) { try { if (typeof e[f] === "function") walk(e[f].call(e), f, 0); } catch (err) { found.push({ path: f, error: String(err) }); } }
      return found;
    });
  } catch (e) {
    report.error = String(e);
  } finally {
    report.pageErrors = errors;
    await b.close();
    await server.shutdown();
  }
  report.checks = judgeBrowser(report);
  for (const c of report.checks) console.log(`${c.pass === null ? "SKIP" : c.pass ? "PASS" : "FAIL"} ${c.id} ${c.result}`);
  await Deno.writeTextFile(CLS === "Warrior" ? `${ROOT}/browser.json` : `${ROOT}/browser-${CLS}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, timeline: (report.timeline ?? []).length }, null, 2));
}

async function judgeBatch() {
  const rd = (n: string) => Deno.readTextFile(`${ROOT}/${n}`).then(JSON.parse).catch(() => null);
  const B = await rd("batch-before.json"), O = await rd("batch-off.json"), A = await rd("batch-after.json"), N = await rd("batch-unaware.json");
  const F = await import(toUrl("src/game/Fall.ts")).catch(() => ({} as any));
  const out: Check[] = [];
  if (B && O) out.push({ id: "V-K1", lane: "M", claim: "SimOptions.falls=false plays HEAD exactly", method: `${O.matches} seeded matches, sha256 of every outcome's core fields`, pass: B.outcomeDigest === O.outcomeDigest && B.matches === O.matches, result: `HEAD ${B.outcomeDigest} vs falls:false ${O.outcomeDigest}` });
  if (A) {
    out.push({ id: "V-K2", lane: "M", claim: "batch with falls: no errors; collisions and falls happen; down time per fall inside the get-up clamp", method: `${A.matches} matches, MatchSim trace + outcome.forces`,
      pass: A.errors === 0 && A.fallsPerMatch > 0 && A.collisionsPerMatch > 0 && A.forces?.meanDownPerFall >= (F.RISE_MIN ?? 0.8) && A.forces?.meanDownPerFall <= (F.RISE_MAX ?? 3.5) && A.forces?.matches === A.matches,
      result: `errors ${A.errors}; collision events/match ${A.collisionsPerMatch} (2 per collision); falls/match ${A.fallsPerMatch}; down s/fall ${A.forces?.meanDownPerFall}; downed window (fall+FALL_SECONDS -> stand) ${A.meanDownSeconds} s; causes ${JSON.stringify(A.forces?.causes)}; forces on ${A.forces?.matches}/${A.matches} outcomes` });
    if (B) out.push({ id: "V-K3", lane: "M", claim: "balance after vs before: median duel inside 25-55 s, class mean |dev| not worse by > 0.02 (1.5 SE at 6000); ring-out share shift reported", method: "same 6000 seeded design points",
      pass: A.medianDuelSeconds >= 25 && A.medianDuelSeconds <= 55 && A.classMeanAbsDev <= B.classMeanAbsDev + 0.02,
      result: `ring-out ${B.ringOutShare} -> ${A.ringOutShare} (${A.ringOutShare >= B.ringOutShare ? "+" : ""}${r4(A.ringOutShare - B.ringOutShare)}), KO ${B.koShare} -> ${A.koShare}, median duel ${B.medianDuelSeconds} -> ${A.medianDuelSeconds} s, class |dev| ${B.classMeanAbsDev} -> ${A.classMeanAbsDev}` });
    const dp = A.damagePath ?? {};
    out.push({ id: "V-K4", lane: "M", claim: "downed penalties in the real damage path (MatchSim.resolveHit): plain-hit damage x DOWNED_DAMAGE_TAKEN, more crits on a downed defender", method: "hit events carry the defender's phase; per attacker-match median damage of plain hits down/stand, median of ratios; crit share among landed plain strikes",
      pass: dp.medianDamageRatioDownOverStand !== null && Math.abs(dp.medianDamageRatioDownOverStand - (F.DOWNED_DAMAGE_TAKEN ?? 1.3)) <= 0.05 && dp.critShareDown > dp.critShareStand,
      result: `damage ratio ${dp.medianDamageRatioDownOverStand} (DOWNED_DAMAGE_TAKEN ${F.DOWNED_DAMAGE_TAKEN}) over ${dp.attackerMatchPairs} attacker-matches; crit share down ${dp.critShareDown} vs stand ${dp.critShareStand} (+${r4((dp.critShareDown ?? 0) - (dp.critShareStand ?? 0))}, DOWNED_CRIT_BONUS ${F.DOWNED_CRIT_BONUS}); knockback ratio ${dp.medianKnockbackRatioDownOverStand} (confounded by damage % and blocks; DOWNED_KNOCKBACK ${F.DOWNED_KNOCKBACK})` });
    out.push({ id: "V-K5", lane: "M", claim: "AI strikes a downed enemy more than a standing one; fall-aware brains more than unaware; aware brains back-step into drops less", method: `strikes landed per second of the defender's downed (down|rising) vs standing exposure; same seeds with fallAware [false,false]`,
      pass: A.strikesOnDownPerSec > A.strikesOnStandPerSec && (!N || (A.strikesOnDownPerSec > N.strikesOnDownPerSec && (A.forces?.causes?.backstep ?? 0) < (N.forces?.causes?.backstep ?? Infinity))),
      result: `aware: ${A.strikesOnDownPerSec}/s on downed vs ${A.strikesOnStandPerSec}/s standing` + (N ? `; unaware: ${N.strikesOnDownPerSec}/s vs ${N.strikesOnStandPerSec}/s; backstep falls aware ${A.forces?.causes?.backstep} vs unaware ${N.forces?.causes?.backstep}, edge ${A.forces?.causes?.edge} vs ${N.forces?.causes?.edge}` : "") });
  }
  await Deno.writeTextFile(`${ROOT}/extra.json`, JSON.stringify(out, null, 2) + "\n");
  for (const c of out) console.log(`${c.pass === null ? "SKIP" : c.pass ? "PASS" : "FAIL"} ${c.id} ${c.result}`);
}

async function doc() {
  const rd = (n: string) => Deno.readTextFile(`${ROOT}/${n}`).then(JSON.parse).catch(() => null);
  const fz: Check[] = (await rd("fuzz.json")) ?? [];
  const br = await rd("browser.json");
  const ex: Check[] = (await rd("extra.json")) ?? [];
  const verdicts: any[] = (await rd("verdicts.json")) ?? [];
  const before = await rd("batch-before.json"), after = await rd("batch-after.json"), off = await rd("batch-off.json");
  const checks: Check[] = [...fz, ...(br?.checks ?? []), ...ex];
  const lastBoard = (lane: string) => [...verdicts].reverse().find((v) => v.lane === lane)?.board ?? "-";
  const esc = (x: string) => String(x).replace(/\|/g, "/").replace(/\n/g, " ");
  const L: string[] = [];
  L.push("# Wave FALL — independent verification (agent V)", "");
  L.push("Generated by `deno run -A tools/verify-wave-fall.ts doc` from artifacts/wave-fall/verify/*.json — no hand-typed numbers.", "");
  L.push("Reproduce: `deno run -A tools/verify-wave-fall.ts fuzz`; `BUILD_OUT=dist-vfall deno task build && deno run -A tools/verify-wave-fall.ts browser dist-vfall 8831`;",
    "`deno run -A tools/verify-wave-fall.ts batch after . 6000`; before = `git archive HEAD | tar -x -C <scratch>` then `batch before <scratch> 6000`.", "");
  L.push("## Checks", "", "| id | claim | lane | method | result | verdict | board id |", "|---|---|---|---|---|---|---|");
  for (const c of checks) L.push(`| ${c.id} | ${esc(c.claim)} | ${c.lane} | ${esc(c.method)} | ${esc(c.result)} | ${c.pass === null ? "SKIP" : c.pass ? "PASS" : "FAIL"} | ${lastBoard(c.lane)} |`);
  L.push("", "## MatchSim batch, before (HEAD 911a59a) vs after (working tree)", "");
  const rows: [string, (b: any) => any][] = [
    ["matches", (b) => b.matches], ["errors", (b) => b.errors], ["ring-out share", (b) => b.ringOutShare], ["KO share", (b) => b.koShare],
    ["median duel, s", (b) => b.medianDuelSeconds], ["class win-share mean |dev|", (b) => b.classMeanAbsDev],
    ["collisions / match (trace)", (b) => b.collisionsPerMatch], ["falls / match (trace)", (b) => b.fallsPerMatch], ["mean down interval, s (fall->rise)", (b) => b.meanDownSeconds],
    ["falls / match (outcome.forces)", (b) => b.forces?.fallsPerMatch ?? "-"], ["down s / fall (outcome.forces)", (b) => b.forces?.meanDownPerFall ?? "-"], ["damage while down / match", (b) => b.forces?.damageWhileDownPerMatch ?? "-"],
    ["strikes landed / s on a DOWNED defender", (b) => b.strikesOnDownPerSec ?? "-"], ["strikes landed / s on a STANDING defender", (b) => b.strikesOnStandPerSec],
    ["fall causes (outcome.forces)", (b) => JSON.stringify(b.forces?.causes ?? {})], ["wall-clock s", (b) => b.seconds], ["outcome digest (core fields)", (b) => b.outcomeDigest ?? "-"],
  ];
  const cols = [["before", before], ["after: falls off", off], ["after", after], ["after: fall-unaware AI", await rd("batch-unaware.json")]].filter(([, b]) => b) as [string, any][];
  L.push(`| metric | ${cols.map(([n]) => n).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
  for (const [n, f] of rows) L.push(`| ${n} | ${cols.map(([, b]) => esc(String(f(b)))).join(" | ")} |`);
  if (before && after) {
    L.push("", "Class win shares (cross-class matches):", "", `| class | ${cols.map(([n]) => n).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
    for (const c of Object.keys(before.classWinShare)) L.push(`| ${c} | ${cols.map(([, b]) => b.classWinShare[c]).join(" | ")} |`);
  }
  L.push("", "## Verdicts posted", "", "| board id | lane | READY | verdict | summary |", "|---|---|---|---|---|");
  for (const v of verdicts) L.push(`| ${v.board} | ${v.lane} | ${v.ready} | ${v.verdict} | ${esc(v.summary)} |`);
  const suite = await Deno.readTextFile(`${ROOT}/logs/full-suite.txt`).catch(() => "");
  const suiteLine = suite.split("\n").find((l) => /^(ok|FAILED) \|/.test(l)) ?? "not run";
  L.push("", "## Full suite", "", "`NO_COLOR=1 deno task test > artifacts/wave-fall/verify/logs/full-suite.txt` (tree after M r4 + A r2): `" + suiteLine + "`");
  const brB = await rd("browser-Barbarian.json");
  if (brB?.checks) {
    L.push("", "## Chrome, second pair (Barbarian vs Barbarian)", "", "| id | verdict | result |", "|---|---|---|");
    for (const c of brB.checks as Check[]) L.push(`| ${c.id} | ${c.pass === null ? "SKIP" : c.pass ? "PASS" : "FAIL"} | ${esc(c.result)} |`);
  }
  L.push("", "## Notes and limits (honest gaps)", "",
    "- Real momentum is not conserved by the collision law (V-C2: carried-mass residual up to several J); the contract asks for conservation in the stat-weighted effective masses, which holds to 1e-16.",
    "- The engine's damage path (Engine.#resolveHit) is private; the downed penalty in a real damage path is measured on MatchSim.resolveHit through the traced defender phase (V-K4). The crit share rises by less than DOWNED_CRIT_BONUS because the downed and standing strike populations have different attackers (a population comparison, not a paired one).",
    "- A downed body in a body-on-body collision is pushed ~x1.11 further (V-C6), not x DOWNED_KNOCKBACK: the law divides stability by it and the recoil depends on both effective masses.",
    "- V-B2/B3 meter history: the first meter took the absolute lowest vertex minus the floor under it; on sloped terrain that overstates floats. It was replaced by the clearance meter (min over vertices of y - floor under that vertex). The FRONT-pose sink it found first (elbow BONE 80-92 mm under the floor) was real (M's stale rotation.x after applyRootTilt, fixed in Z-21/Z-24). The root-height bound was restated 0.35 -> 0.45 m after a side pose read 0.37-0.39 m with the hips visibly on the ground (screenshot).",
    "- Not independently measured by V: shove/stagger/stumble foot slides and get-up planted-foot slide (A's fixture numbers only), blade-floor clipping while lying (A lists it open).",
    "- Balance flag (not a contract band): ring-out share rises with falls on (see the batch table); M's ablation attributes it to immobility near open rims.");
  const open = checks.filter((c) => c.pass === false);
  L.push("", "## Open FAILs", "", ...(open.length ? open.map((c) => `- ${c.id} (${c.lane}): ${esc(c.claim)} — ${esc(c.result)}`) : ["- none"]), "");
  await Deno.mkdir("docs/wave-fall", { recursive: true });
  await Deno.writeTextFile("docs/wave-fall/VERIFY.md", L.join("\n"));
  console.log(L.join("\n"));
}

/** The player's fall phase from whatever shape debugFall returns. */
function phaseOf(f: any): string | null {
  if (!f) return null;
  return f.seats?.[0]?.phase ?? f.player?.phase ?? f.player?.fall?.phase ?? (Array.isArray(f) ? f[0]?.phase ?? f[0]?.fall?.phase : null) ?? f.seats?.[0]?.phase ?? f.phase ?? null;
}

function judgeBrowser(rep: any): Check[] {
  const out: Check[] = [];
  const tl: any[] = rep.timeline ?? [];
  const phases = tl.map((s) => phaseOf(s.fall));
  const seq = phases.filter((p, i) => p && p !== phases[i - 1]);
  const down = tl.filter((s) => ["down"].includes(phaseOf(s.fall) ?? ""));
  const downed = tl.filter((s) => ["down", "rising"].includes(phaseOf(s.fall) ?? ""));
  const mm = (xs: number[]) => xs.length ? `${Math.round(Math.min(...xs) * 1000)}..${Math.round(Math.max(...xs) * 1000)} mm` : "-";
  out.push({ id: "V-B0", lane: "M", claim: "Chrome: fight runs (resumed from the headless pause), 0 page errors", method: "playwright, debugClock advances", pass: rep.running === true && (rep.pageErrors ?? []).length === 0 && !rep.error,
    result: `running ${rep.running}, page errors ${(rep.pageErrors ?? []).length}${rep.error ? `, harness error ${rep.error}` : ""}${(rep.pageErrors ?? []).length ? ": " + rep.pageErrors.slice(0, 2).join(" | ") : ""}` });
  out.push({ id: "V-B1", lane: "M", claim: "QA push/trip hook + debugFall exist; the pushed fighter goes falling -> down -> rising -> stand", method: `hook ${rep.hookUsed ?? "none"}, debugPush(0, dir, 1, "hit") for 3 dirs, debugFall sampled every ~55 ms for 4.5 s each`,
    pass: !!rep.hookUsed && ["falling", "down", "rising", "stand"].every((p) => seq.includes(p)) && seq.indexOf("falling") < seq.indexOf("down") && seq.indexOf("down") < seq.indexOf("rising") && seq.lastIndexOf("stand") > seq.indexOf("rising"),
    result: `hooks [${(rep.hooks ?? []).join(",")}]; phase sequence ${seq.join(">") || "-"}` });
  const sk = down.map((s) => s.skinLow).filter((x) => x !== null), hp = down.map((s) => s.hip).filter((x) => x !== null), hd = down.map((s) => s.head).filter((x) => x !== null);
  out.push({ id: "V-B2", lane: "A", claim: "lying (phase down): body on the floor — skin clearance within [-30, +60] mm, root bone <= 0.45 m and head <= 0.45 m (standing root 0.72-0.94 m; bound restated from 0.35 m after a side pose read 0.37-0.39 m with the hips visibly on the ground)", method: "min over CPU-skinned vertices (every 7th) of the player rig of (vertex y - debugFloorAt(vertex x,z)); bones via isBone",
    pass: down.length > 0 && sk.length > 0 && Math.min(...sk) >= -0.03 && Math.max(...sk) <= 0.06 && Math.max(...hp) <= 0.45 && Math.max(...hd) <= 0.45,
    result: `poses ${(rep.trials ?? []).map((x: any) => x.pose).join("/")}; ${down.length} down samples; skin low ${mm(sk)}, pelvis ${mm(hp)}, head ${mm(hd)}; standing before: skin low ${rep.idle ? Math.round(rep.idle.skinLow * 1000) : "-"} mm, pelvis ${rep.idle ? Math.round(rep.idle.hip * 1000) : "-"} mm` });
  const skAll = downed.map((s) => s.skinLow).filter((x) => x !== null);
  out.push({ id: "V-B3", lane: "A", claim: "no sinking and no floating at any downed sample (down + rising): lowest skin point within [-30, +80] mm of the floor", method: "same meter (every 7th vertex; idle standing reads 0..20 mm)", pass: skAll.length > 0 && Math.min(...skAll) >= -0.03 && Math.max(...skAll) <= 0.08,
    result: `${downed.length} downed samples, skin low ${mm(skAll)}; down ${mm(down.map((s) => s.skinLow))}, rising ${mm(downed.filter((s) => phaseOf(s.fall) === "rising").map((s) => s.skinLow))}; worst ${(() => { const w = [...downed].sort((a, b) => a.skinLow - b.skinLow)[0]; return w ? `${Math.round(w.skinLow * 1000)} mm at ${phaseOf(w.fall)} t01 ${w.fall.seats[0].t01.toFixed(2)}` : "-"; })()}; samples above +80 mm: ${downed.filter((s) => s.skinLow > 0.08).length}, below -30 mm: ${downed.filter((s) => s.skinLow < -0.03).length}` });
  const fe = rep.forceEqual, fu = rep.forceUnequal;
  out.push({ id: "V-B4", lane: "M", claim: "live engine: the push order follows effective mass (same-class pair; live hp/stamina differ so not exactly equal — exact symmetry is V-C1); heavy/strong/agile vs light/weak pushes the light one further, staggers it longer", method: "debugForce({speed:4.2}) Warrior vs Warrior mid-fight, then debugFallStats heavy/light",
    pass: !!fe && !!fu && Math.sign(fe.pushback[1] - fe.pushback[0]) === Math.sign(fe.effectiveMass[0] - fe.effectiveMass[1]) && fu.pushback[0] < fu.pushback[1] && fu.stagger[0] <= fu.stagger[1],
    result: fe && fu ? `equal: push ${fe.pushback.map((x: number) => x.toFixed(2)).join("/")} m stagger ${fe.stagger.map((x: number) => x.toFixed(2)).join("/")} s m_eff ${fe.effectiveMass.map((x: number) => x.toFixed(0)).join("/")} kg; unequal: push ${fu.pushback.map((x: number) => x.toFixed(2)).join("/")} m stagger ${fu.stagger.map((x: number) => x.toFixed(2)).join("/")} s balance ${fu.balance.map((x: number) => x.toFixed(2)).join("/")} m_eff ${fu.effectiveMass.map((x: number) => x.toFixed(0)).join("/")} kg -> phases ${(rep.afterUnequal ?? []).map((x: any) => x.phase).join("/")}` : "no debugForce result" });
  // Measured phase durations vs the plan.
  if (rep.fallPlan) {
    const t1 = rep.trials?.[0] ? tl.slice(rep.trials[0].from, rep.trials[0].to) : tl;
    const first = (ph: string) => t1.find((s) => phaseOf(s.fall) === ph)?.t ?? null;
    const tf = first("falling") ?? t1[0]?.t, td = first("down"), tr = first("rising");
    const ts = t1.find((s, i) => i > 0 && phaseOf(s.fall) === "stand" && phaseOf(t1[i - 1].fall) !== "stand")?.t ?? null;
    const plan = rep.fallPlan;
    const meas = ts !== null && tf !== undefined ? ts - tf : null;
    out.push({ id: "V-B5", lane: "M", claim: "live get-up follows the plan (falling 0.5 s + down + rising)", method: "game clock (debugClock.sinceStart) at the first sample of each phase", pass: meas !== null && Math.abs(meas - (0.5 + plan.down + plan.rise)) < 0.35,
      result: `falling@${tf?.toFixed(2)} down@${td?.toFixed(2)} rising@${tr?.toFixed(2)} stand@${ts?.toFixed(2)}; measured ${meas?.toFixed(2)} s vs plan ${(0.5 + plan.down + plan.rise).toFixed(2)} s (down ${plan.down.toFixed(2)}, rise ${plan.rise.toFixed(2)})` });
  }
  const tel: any[] = rep.telemetry ?? [];
  const fields = new Set(tel.flatMap((x) => x.fields ?? []));
  const want = ["t", "kind", "who", "cause", "phase", "pushback", "duration", "hp01", "stamina01", "outcome"];
  const missing = want.filter((k) => !fields.has(k));
  const hasForce = [...fields].some((k) => /force|impulse/i.test(k));
  const kinds = new Set(tel.flatMap((x) => x.kinds ?? []));
  out.push({ id: "V-T1", lane: "M", claim: "engine telemetry stores collision/fall/rise records with the contract fields", method: "walk debugFightTelemetry()/debugMatchReport() for arrays of {kind}",
    pass: tel.length > 0 && kinds.has("fall") && missing.length === 0 && hasForce, result: tel.length ? `at ${tel.map((x) => `${x.path} (${x.n} ${(x.kinds ?? []).join("/")})`).join(", ")}; missing fields [${missing.join(",")}], force/impulse field ${hasForce}` : "no collision/fall/rise records found" });
  return out;
}

if (mode === "batch") {
  await batch(Deno.args[1] ?? "after", Deno.args[2] ?? Deno.cwd(), Number(Deno.args[3] ?? 3000) | 0);
} else if (mode === "fuzz") {
  await fuzz();
} else if (mode === "verdict") {
  // verdict <lane> <readyId> <PASS|FAIL> <boardId> "<summary>"
  const f = `${ROOT}/verdicts.json`;
  const list = await Deno.readTextFile(f).then(JSON.parse).catch(() => []);
  list.push({ lane: Deno.args[1], ready: Deno.args[2], verdict: Deno.args[3], board: Deno.args[4], summary: Deno.args[5] ?? "", at: new Date().toISOString() });
  await Deno.writeTextFile(f, JSON.stringify(list, null, 2) + "\n");
} else if (mode === "judge-batch") {
  await judgeBatch();
} else if (mode === "doc") {
  await doc();
} else if (mode === "browser") {
  await browser(Deno.args[1] ?? "dist-vfall", Number(Deno.args[2] ?? 8831));
} else {
  console.error(`unknown mode ${mode}`);
  Deno.exit(2);
}
