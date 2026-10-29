import { DEFAULT_ARENA, halfSize, makeArena, PARAMS, PARAM_BY_KEY, randomArena } from "../src/game/ArenaConfig.ts";
import { edgeDistance } from "../src/physics/ArenaPhysics.ts";
import { randomSource, wilsonInterval } from "../src/balance/ArenaHarness.ts";
import { seededRng, spawnItem, tickItem, itemRadius, decideDistraction, itemNoticed, ITEM_DEFS } from "../src/game/Items.ts";
import { applyStatus, attackMultiplier, canAct, cleanse, controller, createStatusState, hasStatus, speedMultiplier, statusLabel, tickStatuses } from "../src/game/Status.ts";


function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

// ---------------------------------------------------------------- arena params

Deno.test("the parameter list covers every category and is internally consistent", () => {
  const cats = new Set(PARAMS.map((p) => p.category));
  for (const c of ["space", "ground", "phases", "population", "items", "hazards", "atmosphere"]) {
    assert(cats.has(c as never), `missing category ${c}`);
  }
  for (const p of PARAMS) {
    assert(p.min <= p.def && p.def <= p.max, `${p.key}: default ${p.def} outside [${p.min}, ${p.max}]`);
    assert(p.note.length > 10, `${p.key} needs a documented reason`);
    assert(PARAM_BY_KEY[p.key] === p, `${p.key} missing from the index`);
  }
  const keys = PARAMS.map((p) => p.key);
  assert(new Set(keys).size === keys.length, "duplicate parameter key");
});

Deno.test("arena size spans the 2 m closet to the huge field the brief asks for", () => {
  const size = PARAM_BY_KEY.size;
  assert(size.min === 2, `minimum should be the 2 m^2 room, got ${size.min}`);
  assert(size.max >= 200, `maximum should be a much larger field now, got ${size.max}`);
  const tiny = makeArena({ size: 2 });
  const huge = makeArena({ size: 320 });
  assert(halfSize(tiny) === 1 && halfSize(huge) === 160, "half size should track the parameter");
  // The live ring-out boundary is the outline: 1 m in from the edge of a 2 m room,
  // and 159 m in from the edge of the 320 m field.
  assert(Math.abs(edgeDistance(tiny, 0, 0) - 1) < 1e-9 && Math.abs(edgeDistance(huge, 1, 0) - 159) < 1e-9, "edge distance tracks the size");
});

Deno.test("values outside the declared range are clamped, unknown keys pass through", () => {
  assert(makeArena({ size: 99999 }).size === 320, "size above max must clamp");
  assert(makeArena({ size: -5 }).size === 2, "size below min must clamp");
  assert(makeArena({ roamSeconds: 1e6 }).roamSeconds === 120, "roam above max must clamp");
  assert(makeArena({ fighters: 1 }).fighters === 2, "a fight needs at least two fighters");
  const cfg = DEFAULT_ARENA;
  assert(cfg.size === 12, `default size should be 12, got ${cfg.size}`);
  assert(cfg.roamSeconds === 6, "the truce defaults to the brief's 6 s (3 friendly + 3 neutral)");
});

Deno.test("randomArena is reproducible from a seed and always in range", () => {
  const a = randomArena(seededRng(7));
  const b = randomArena(seededRng(7));
  for (const k of Object.keys(DEFAULT_ARENA) as (keyof typeof DEFAULT_ARENA)[]) {
    assert(a[k] === b[k], `seed 7 should reproduce ${k}`);
  }
  const c = randomArena(seededRng(8));
  assert(Object.keys(DEFAULT_ARENA).some((k) => a[k as never] !== c[k as never]), "different seeds should differ");
  for (let seed = 0; seed < 40; seed++) {
    const r = randomArena(seededRng(seed));
    for (const p of PARAMS) {
      const v = (r as unknown as Record<string, number>)[p.key];
      assert(v >= p.min && v <= p.max, `seed ${seed}: ${p.key}=${v} outside [${p.min}, ${p.max}]`);
    }
  }
});

Deno.test("an explicit override beats the random preset", () => {
  for (let seed = 0; seed < 10; seed++) {
    const r = randomArena(seededRng(seed), { size: 33, fighters: 4 });
    assert(r.size === 33, "explicit size must win");
    assert(r.fighters === 4, "explicit fighter count must win");
  }
});

Deno.test("phase parameters are self-consistent: aggression reaches 1 as roam ends", () => {
  const cfg = makeArena({ roamSeconds: 10, aggressionRate: 0.1 });
  assert(Math.abs(cfg.roamSeconds * cfg.aggressionRate - 1) < 1e-9, "default rate should end the roam on time");
});

// ----------------------------------------------------------------------- items

Deno.test("a coin pops up, falls, and lands flat on the ground", () => {
  const coin = spawnItem(1, 3, -2, 0, { kind: "coin", pop: 4 });
  assert(coin.y > 3.5, `coin should start above the ground, got ${coin.y}`);
  assert(!coin.landed, "a popped coin is airborne");
  let landed = false;
  for (let t = 0; t < 600 && !landed; t++) landed = tickItem(coin, 1 / 60, 0, 18);
  assert(landed, "the coin must come back down");
  assert(coin.y === 0, `coin should rest on the ground, got ${coin.y}`);
  assert(coin.vy === 0, "a landed coin has no velocity");
  assert(ITEM_DEFS.coin.height < 0.1, "the coin is a very flat cylinder");
  assert(ITEM_DEFS.coin.color.startsWith("#e8"), "the coin should be yellow");
});

Deno.test("coin size scales with the arena parameter and is big by default", () => {
  const coin = spawnItem(1, 0, 0, 0, { kind: "coin" });
  assert(itemRadius(coin, 1) === ITEM_DEFS.coin.radius, "radius at size 1 is the definition");
  assert(itemRadius(coin, 3) === ITEM_DEFS.coin.radius * 3, "radius should scale with coinSize");
  assert(ITEM_DEFS.coin.radius >= 0.5, "the brief asks for a big coin");
});

Deno.test("a non-coin item is placed, not thrown", () => {
  const chest = spawnItem(2, 1, 1, 0, { kind: "chest" });
  assert(chest.landed, "a chest is placed on the ground, not popped");
});

Deno.test("a coin is only noticed when a sense reaches it", () => {
  const coin = spawnItem(1, 0, 0, 0, { kind: "coin", pop: 0 });
  coin.y = 0; coin.landed = true;
  const gear = { helmet: 0, armour: 0, race: {} };
  assert(itemNoticed(coin, 0, 0, -2, { x: 0, z: -1 }, 0, gear), "a coin 2 m ahead must be seen");
  const far = spawnItem(2, 0, 0, 0, { kind: "coin", pop: 0 });
  far.x = 500; far.z = 500;
  assert(!itemNoticed(far, 0, 0, 0, { x: 0, z: -1 }, 0, gear), "a coin across the map must not be noticed");
});

Deno.test("breaking off a fight for a coin is possible but uncommon", () => {
  const coin = spawnItem(1, 0, 0, 0, { kind: "coin" });
  coin.landed = true;
  const base = { item: coin, distance: 3, noticed: true, greed: 0.35, fighting: true, busy: false };
  // A low roll grabs it; a high roll does not.
  assert(decideDistraction({ ...base, roll: 0.01 }).chase, "a very low roll should chase");
  assert(!decideDistraction({ ...base, roll: 0.99 }).chase, "a very high roll should keep fighting");
  // And it must genuinely be a minority of the time.
  let chases = 0;
  for (let i = 0; i < 1000; i++) if (decideDistraction({ ...base, roll: i / 1000 }).chase) chases++;
  assert(chases > 20 && chases < 200, `breaking off should be uncommon, got ${chases}/1000`);
  // Fighting makes a fighter much less likely to break off than an idle one.
  const idle = { ...base, fighting: false };
  let idleChases = 0;
  for (let i = 0; i < 1000; i++) if (decideDistraction({ ...idle, roll: i / 1000 }).chase) idleChases++;
  assert(idleChases > chases, "an idle fighter should chase more readily than a busy one");
});

Deno.test("a fighter already chasing, or a coin already claimed, is not distracted", () => {
  const coin = spawnItem(1, 0, 0, 0, { kind: "coin" });
  const base = { item: coin, distance: 2, noticed: true, greed: 1, fighting: false, busy: false, roll: 0 };
  assert(!decideDistraction({ ...base, busy: true }).chase, "busy fighters do not re-target");
  coin.claimedBy = 2;
  assert(!decideDistraction(base).chase, "a claimed coin is not chased");
  coin.claimedBy = null;
  assert(!decideDistraction({ ...base, noticed: false }).chase, "an unnoticed coin is not chased");
});

// -------------------------------------------------------------------- statuses

Deno.test("stun stops the victim acting, and the timer ends it", () => {
  const st = createStatusState();
  applyStatus(st, "stunned", 1.0);
  assert(!canAct(st), "a stunned fighter cannot act");
  assert(speedMultiplier(st) === 0, "a stunned fighter does not move");
  tickStatuses(st, 0.6);
  assert(!canAct(st), "still stunned at 0.6s of 1.0s");
  tickStatuses(st, 0.5);
  assert(canAct(st), "the stun should have expired");
  assert(!hasStatus(st, "stunned"), "and be gone from the list");
});

Deno.test("control hands the steering to the caster, and holy magic breaks it", () => {
  const st = createStatusState();
  applyStatus(st, "controlled", 4, 7);
  const c = controller(st);
  assert(c.by === "caster" && c.source === 7, "control must name the caster");
  const cleared = cleanse(st, "holy");
  assert(cleared.includes("controlled"), "holy magic should break control");
  assert(controller(st).by === "self", "and give the body back");
});

Deno.test("statuses stack multiplicatively and refresh rather than duplicate", () => {
  const st = createStatusState();
  applyStatus(st, "slowed");
  applyStatus(st, "chilled");
  assert(st.active.length === 2, "two distinct statuses");
  assert(Math.abs(speedMultiplier(st) - 0.55 * 0.6) < 1e-9, "speed multipliers multiply");
  assert(Math.abs(attackMultiplier(st) - 0.8 * 0.75) < 1e-9, "attack multipliers multiply");
  applyStatus(st, "slowed", 9);
  assert(st.active.filter((a) => a.name === "slowed").length === 1, "re-applying must refresh, not duplicate");
  assert(st.active.find((a) => a.name === "slowed")!.remaining === 9, "and take the longer timer");
});

Deno.test("damage over time ticks, and healing is a negative dps", () => {
  const st = createStatusState();
  applyStatus(st, "burning", 4);
  assert(tickStatuses(st, 1) > 0, "burning deals damage");
  const heal = createStatusState();
  applyStatus(heal, "blessed", 8);
  assert(tickStatuses(heal, 1) < 0, "blessed heals");
});

Deno.test("a hypnosis is broken by arcane magic and the label reads for the HUD", () => {
  const st = createStatusState();
  applyStatus(st, "hypnotised", 3);
  assert(statusLabel(st).startsWith("hypnotised"), `label was ${statusLabel(st)}`);
  assert(cleanse(st, "arcane").includes("hypnotised"), "arcane should break hypnosis");
  assert(!cleanse(st, "fire").includes("hypnotised"), "fire should not");
});

// --------------------------------------------------------------------- ragdoll
// The particle ragdoll (src/game/Ragdoll.ts) was retired in wave 3: ring-outs now drive the
// real skinned body (src/physics/ragdoll/**, tests/ragdoll_*_test.ts).

// ----------------------------------------------------------------------------
// Reconstructed: this file previously held the two tests below and was
// overwritten by mistake. The bodies are rewritten against the same APIs.
// ----------------------------------------------------------------------------

Deno.test("arena RNG replays seeds without constant or out-of-range samples", () => {
  // Same seed -> same stream, so a run can be replayed.
  const a = randomSource(12345);
  const b = randomSource(12345);
  for (let i = 0; i < 200; i++) {
    const x = a();
    assert(x === b(), `seed 12345 diverged at sample ${i}`);
  }
  // Different seeds -> different streams.
  const c = randomSource(12345), d = randomSource(999);
  let same = 0;
  for (let i = 0; i < 100; i++) if (c() === d()) same++;
  assert(same < 5, `different seeds should not agree (${same}/100 identical)`);

  // Every sample is in [0,1), and the stream is not a constant.
  for (let seed = 0; seed < 25; seed++) {
    const r = randomSource(seed);
    const seen = new Set<number>();
    let sum = 0;
    for (let i = 0; i < 500; i++) {
      const v = r();
      assert(Number.isFinite(v), `seed ${seed}: non-finite sample`);
      assert(v >= 0 && v < 1, `seed ${seed}: sample ${v} outside [0,1)`);
      seen.add(v);
      sum += v;
    }
    assert(seen.size > 400, `seed ${seed}: stream looks constant (${seen.size} distinct of 500)`);
    const mean = sum / 500;
    assert(mean > 0.3 && mean < 0.7, `seed ${seed}: mean ${mean.toFixed(3)} is far from uniform`);
  }
});

Deno.test("Wilson 95% interval uses actual trial counts including boundaries", () => {
  // Zero wins pins the lower bound to 0; all wins pins the upper bound to 1.
  const [lo0, hi0] = wilsonInterval(0, 40);
  assert(lo0 === 0, `0 wins should give lo=0, got ${lo0}`);
  assert(hi0 > 0 && hi0 < 1, `0/40 still has an upper bound, got ${hi0}`);
  const [lo1, hi1] = wilsonInterval(40, 40);
  assert(hi1 === 1, `40/40 should give hi=1, got ${hi1}`);
  assert(lo1 > 0 && lo1 < 1, `40/40 still has a lower bound, got ${lo1}`);

  // The interval brackets the observed rate and stays inside [0,1].
  for (const [w, n] of [[1, 10], [5, 10], [28, 84], [3, 7], [99, 100]] as const) {
    const [lo, hi] = wilsonInterval(w, n);
    const p = w / n;
    assert(lo <= p && p <= hi, `${w}/${n}: interval [${lo}, ${hi}] must contain ${p}`);
    assert(lo >= 0 && hi <= 1, `${w}/${n}: interval left [0,1]`);
    assert(lo <= hi, `${w}/${n}: inverted interval`);
  }

  // It must actually use the trial count: more trials means a tighter interval.
  const [la, ha] = wilsonInterval(50, 100);
  const [lb, hb] = wilsonInterval(500, 1000);
  assert((hb - lb) < (ha - la), "1000 trials should give a tighter interval than 100");

  // No trials -> no interval.
  const [nl, nh] = wilsonInterval(0, 0);
  assert(Number.isNaN(nl) && Number.isNaN(nh), "0 trials should be NaN, not a fabricated interval");
});
