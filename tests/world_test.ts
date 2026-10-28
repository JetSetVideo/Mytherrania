import { canAttack, DEFAULT_TIMING, dispositionAt, dispositionColour, dispositionLabel, isHostile, roamIntent, truceProgress, truceRemaining, truceSeconds } from "../src/game/Disposition.ts";
import { makeIdentity, makeRoster } from "../src/game/Identity.ts";
import { clearVisible, createFog, exploredFraction, fogAscii, isSeen, isVisible, reveal, visibleFraction } from "../src/game/FogOfWar.ts";
import { adaptedRanges, NEUTRAL_ENV, senseAdaptation, senseRange } from "../src/game/Senses.ts";
import { DEFAULT_ARENA, insideRing, makeArena, objectSize, placeObjects, RING_SHAPES, ringRadiusAt, shapeOf } from "../src/game/ArenaConfig.ts";
import { seededRng } from "../src/game/Items.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

// ------------------------------------------------------------- disposition

Deno.test("the opening is friendly for 3 s, neutral for 3 s, then hostile", () => {
  const t = DEFAULT_TIMING;
  assert(truceSeconds(t) === 6, `truce should be 6 s, got ${truceSeconds(t)}`);
  assert(dispositionAt(0, t) === "friendly", "starts friendly");
  assert(dispositionAt(2.9, t) === "friendly", "still friendly at 2.9 s");
  assert(dispositionAt(3.0, t) === "neutral", "neutral at exactly 3 s");
  assert(dispositionAt(5.9, t) === "neutral", "still neutral at 5.9 s");
  assert(dispositionAt(6.0, t) === "enemy", "hostile at exactly 6 s");
  assert(dispositionAt(30, t) === "enemy", "stays hostile");
});

Deno.test("nobody may attack during the first six seconds", () => {
  let attacks = 0;
  for (let e = 0; e < 6; e += 0.01) if (canAttack(e)) attacks++;
  assert(attacks === 0, `${attacks} attack-permitted instants inside the truce`);
  assert(canAttack(6.0), "attacking is allowed once the truce lifts");
});

Deno.test("the disposition colour changes green -> amber -> red", () => {
  const f = dispositionColour("friendly"), n = dispositionColour("neutral"), e = dispositionColour("enemy");
  assert(f !== n && n !== e && f !== e, "all three dispositions need distinct colours");
  assert(f === "#82b970" && n === "#dfaa55" && e === "#ef7455", `got ${f}/${n}/${e}`);
});

Deno.test("hostility is per pair, so allies are not attacked", () => {
  assert(isHostile(10, 1, 2), "with no allies listed, everyone is fair game");
  assert(!isHostile(10, 1, 1), "never hostile to yourself");
  assert(isHostile(10, 1, 2, { 1: [2] }) === false, "a listed ally is not attacked");
  assert(isHostile(10, 1, 3, { 1: [2] }), "a non-ally is attacked");
  assert(!isHostile(2, 1, 2, { 1: [] }), "nobody is hostile during the truce");
});

Deno.test("the truce countdown runs down and the label reads for the HUD", () => {
  assert(Math.abs(truceProgress(0) - 0) < 1e-9, "progress starts at 0");
  assert(Math.abs(truceProgress(6) - 1) < 1e-9, "progress ends at 1");
  assert(Math.abs(truceRemaining(2) - 4) < 1e-9, "4 s left at t=2");
  assert(truceRemaining(99) === 0, "never negative");
  assert(dispositionLabel(1).startsWith("FRIENDLY"), `got ${dispositionLabel(1)}`);
  assert(dispositionLabel(99) === "HOSTILE", `got ${dispositionLabel(99)}`);
});

Deno.test("roaming stays inside the ring and is deterministic per bot", () => {
  for (let seed = 0; seed < 30; seed++) {
    for (let e = 0; e < 8; e += 0.5) {
      const i = roamIntent({ x: 0, z: 0, bound: 6, roll: 0.5, elapsed: e, seed });
      assert(Number.isFinite(i.tx) && Number.isFinite(i.tz), "roam target must be finite");
      assert(Math.hypot(i.tx, i.tz) < 6, `roam target ${Math.hypot(i.tx, i.tz)} left the ring`);
    }
  }
  const a = roamIntent({ x: 0, z: 0, bound: 6, roll: 0.5, elapsed: 3, seed: 11 });
  const b = roamIntent({ x: 0, z: 0, bound: 6, roll: 0.5, elapsed: 3, seed: 11 });
  assert(a.tx === b.tx && a.tz === b.tz, "same seed and time must give the same intent");
  const c = roamIntent({ x: 0, z: 0, bound: 6, roll: 0.5, elapsed: 3, seed: 12 });
  assert(a.tx !== c.tx || a.tz !== c.tz, "different seeds should differ");
});

// ---------------------------------------------------------------- identity

Deno.test("identities are deterministic, and the id is unique-looking", () => {
  const a = makeIdentity(42), b = makeIdentity(42);
  assert(a.id === b.id && a.full === b.full, "same seed must reproduce the identity");
  assert(/^MY-[0-9A-F]{6}$/.test(a.id), `id shape wrong: ${a.id}`);
  assert(makeIdentity(43).id !== a.id, "different seeds give different ids");
  assert(a.full.includes(a.name) && a.full.includes(a.title), "full name is name + title");
  assert(a.tag.length > 0, "a tag is needed for a crowded HUD");
});

Deno.test("a roster has no duplicate ids or names", () => {
  for (const n of [2, 4, 8]) {
    const r = makeRoster(n, 7);
    assert(r.length === n, `wanted ${n} identities, got ${r.length}`);
    assert(new Set(r.map((x) => x.id)).size === n, "duplicate id in roster");
    assert(new Set(r.map((x) => x.full)).size === n, "duplicate name in roster");
  }
});

// ---------------------------------------------------------------- fog of war

Deno.test("fog starts fully unexplored and fills as the fighter looks around", () => {
  const fog = createFog(6, 0.5);
  assert(exploredFraction(fog) === 0, "nothing seen at the start");
  clearVisible(fog);
  reveal(fog, 0, 0, 4);
  assert(exploredFraction(fog) > 0, "revealing must mark ground seen");
  assert(exploredFraction(fog) < 1, "a 4 m radius must not reveal a 12 m arena");
  assert(isSeen(fog, 0, 0), "the centre is seen");
  assert(!isSeen(fog, 5.5, 5.5), "a far corner is not seen");
  assert(isVisible(fog, 0, 0), "and it is currently visible");
});

Deno.test("visibility clears each frame but memory does not", () => {
  const fog = createFog(6, 0.5);
  clearVisible(fog);
  reveal(fog, 0, 0, 3);
  const seen = exploredFraction(fog);
  clearVisible(fog);
  assert(visibleFraction(fog) === 0, "nothing is visible after the clear");
  assert(Math.abs(exploredFraction(fog) - seen) < 1e-9, "what was seen stays seen");
  assert(isSeen(fog, 0, 0) && !isVisible(fog, 0, 0), "seen but not currently visible");
});

Deno.test("exploration grows monotonically and reaches everything in time", () => {
  const fog = createFog(6, 0.5);
  let last = 0;
  for (let i = 0; i < 40; i++) {
    clearVisible(fog);
    reveal(fog, Math.cos(i * 0.4) * 4, Math.sin(i * 0.4) * 4, 3);
    const f = exploredFraction(fog);
    assert(f >= last - 1e-9, "explored fraction must never fall");
    last = f;
  }
  assert(last > 0.8, `wandering should reveal most of the arena, got ${last.toFixed(2)}`);
});

Deno.test("a shaped reveal respects the shape it is given", () => {
  const fog = createFog(6, 0.5);
  clearVisible(fog);
  // Only the +x half is "visible".
  reveal(fog, 0, 0, 5, (dx) => (dx > 0 ? 1 : 0));
  assert(isVisible(fog, 3, 0), "the +x side should be revealed");
  assert(!isVisible(fog, -3, 0), "the -x side should not be");
});

Deno.test("the ascii minimap marks the fighter and the three fog states", () => {
  const fog = createFog(4, 0.5);
  clearVisible(fog);
  reveal(fog, 0, 0, 2);
  const art = fogAscii(fog, 0, 0, 12);
  assert(art.includes("@"), "the fighter must be marked");
  assert(art.includes("#"), "visible ground must be marked");
  assert(art.includes("."), "unseen ground must be marked");
  assert(art.split("\n").length > 3, "the map should have several rows");
});

// -------------------------------------------------------------- sense adaptation

Deno.test("night blinds sight but sharpens hearing, and weather masks sound", () => {
  const day = senseAdaptation({ ...NEUTRAL_ENV, luminosity: 1 });
  const night = senseAdaptation({ ...NEUTRAL_ENV, luminosity: 0.05 });
  assert(night.sight < day.sight * 0.5, `night sight ${night.sight} should collapse vs day ${day.sight}`);
  assert(night.hearing > day.hearing, "hearing should matter more at night");
  const rain = senseAdaptation({ ...NEUTRAL_ENV, luminosity: 1, weather: 1 });
  assert(rain.hearing < day.hearing * 0.6, "heavy weather should mask sound");
  assert(rain.sight < day.sight, "and scatter sight");
});

Deno.test("sight never reaches zero, and fatigue dulls touch", () => {
  const dark = senseAdaptation({ ...NEUTRAL_ENV, luminosity: 0, weather: 1, fatigue: 1 });
  assert(dark.sight > 0, `sight must never be zero, got ${dark.sight}`);
  const fresh = senseAdaptation({ ...NEUTRAL_ENV, fatigue: 0 });
  const tired = senseAdaptation({ ...NEUTRAL_ENV, fatigue: 1 });
  assert(tired.touch < fresh.touch, "an exhausted fighter feels less");
  const calm = senseAdaptation({ ...NEUTRAL_ENV, agitation: 0 });
  const hot = senseAdaptation({ ...NEUTRAL_ENV, agitation: 1 });
  assert(hot.touch > calm.touch, "adrenaline sharpens touch");
});

Deno.test("adapted ranges stay positive and ordered", () => {
  for (const lum of [0, 0.5, 1]) {
    for (const w of [0, 0.5, 1]) {
      const r = adaptedRanges({ helmet: 0.5, armour: 0.5, race: {} }, { ...NEUTRAL_ENV, luminosity: lum, weather: w });
      for (const k of ["sight", "hearing", "touch", "magnetism", "scent"] as const) {
        assert(r[k] > 0, `${k} must stay positive (lum=${lum} w=${w})`);
      }
      assert(r.sight > r.touch, "sight should outrange touch in every condition");
    }
  }
  const base = senseRange("sight");
  const adapted = adaptedRanges({ helmet: 0, armour: 0, race: {} }, NEUTRAL_ENV).sight;
  assert(adapted < base, "adaptation should reduce sight from the neutral baseline");
});

// --------------------------------------------------------------- ring shapes

Deno.test("every ring shape produces a finite, positive boundary", () => {
  for (let s = 0; s < RING_SHAPES.length; s++) {
    const cfg = makeArena({ size: 12, shape: s });
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const r = ringRadiusAt(cfg, a);
      assert(Number.isFinite(r) && r > 0, `${RING_SHAPES[s]} at ${a}: r=${r}`);
      assert(r <= 12, `${RING_SHAPES[s]} at ${a}: r=${r} exceeds the size`);
    }
    assert(insideRing(cfg, 0, 0), `${RING_SHAPES[s]}: the centre must be inside`);
    assert(!insideRing(cfg, 100, 0), `${RING_SHAPES[s]}: 100 m out must be a ring-out`);
  }
});

Deno.test("a triangle is not a circle: the boundary varies with direction", () => {
  const tri = makeArena({ size: 12, shape: 1 });
  assert(shapeOf(tri) === "triangle", "shape 1 should be a triangle");
  const rs = [] as number[];
  for (let a = 0; a < Math.PI * 2; a += 0.1) rs.push(ringRadiusAt(tri, a));
  const spread = Math.max(...rs) - Math.min(...rs);
  assert(spread > 1.5, `a triangle should vary a lot by direction, spread=${spread.toFixed(2)}`);
  // A circle must NOT vary.
  const circ = makeArena({ size: 12, shape: 0 });
  const cs = [] as number[];
  for (let a = 0; a < Math.PI * 2; a += 0.1) cs.push(ringRadiusAt(circ, a));
  assert(Math.max(...cs) - Math.min(...cs) < 1e-9, "a circle must be direction-invariant");
});

Deno.test("shapeOf never returns undefined and ringRadiusAt never returns NaN", () => {
  // A non-finite or out-of-range shape index must fall back to a valid shape, not
  // produce an undefined shape and a NaN radius (which corrupted a body's position
  // through the wall-reset before this guard existed).
  for (const bad of [NaN, Infinity, -Infinity, -3, 99]) {
    const cfg = makeArena({ size: 18, shape: bad as unknown as number });
    const s = shapeOf(cfg);
    assert(RING_SHAPES.includes(s), `shape ${bad} must map to a real shape, got ${s}`);
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const r = ringRadiusAt(cfg, a);
      assert(Number.isFinite(r) && r > 0, `shape ${bad} at angle ${a.toFixed(2)} must give a finite radius, got ${r}`);
    }
  }
});

Deno.test("aspect stretches the ring on one axis and rotation spins it", () => {
  const round = makeArena({ size: 12, shape: 6, aspect: 1 });
  const long = makeArena({ size: 12, shape: 6, aspect: 2 });
  assert(ringRadiusAt(long, Math.PI / 2) > ringRadiusAt(round, Math.PI / 2) * 1.5, "aspect should lengthen the z axis");
  assert(Math.abs(ringRadiusAt(long, 0) - ringRadiusAt(round, 0)) < 1e-9, "and leave the x axis alone");
  const spun = makeArena({ size: 12, shape: 1, rotation: 180 });
  assert(Math.abs(ringRadiusAt(spun, 0) - ringRadiusAt(makeArena({ size: 12, shape: 1 }), Math.PI)) < 1e-6, "a 180 deg spin should map 0 to PI");
});

// ------------------------------------------------------------ arena objects

Deno.test("objects are placed inside the ring and never overlap", () => {
  for (let seed = 0; seed < 12; seed++) {
    const cfg = makeArena({ size: 20, objects: 12, gliderPads: 2, shape: seed % RING_SHAPES.length });
    const objs = placeObjects(cfg, seededRng(seed));
    assert(objs.length > 0, `seed ${seed}: no objects placed`);
    for (const o of objs) {
      assert(insideRing(cfg, o.x, o.z), `seed ${seed}: ${o.kind} at (${o.x.toFixed(1)},${o.z.toFixed(1)}) is outside the ring`);
      assert(o.scale > 0, "scale must be positive");
    }
    for (let i = 0; i < objs.length; i++) {
      for (let j = i + 1; j < objs.length; j++) {
        const a = objs[i], b = objs[j];
        const minGap = (objectSize(a.kind).r + objectSize(b.kind).r) * 1.15;
        assert(Math.hypot(a.x - b.x, a.z - b.z) >= minGap - 1e-6, `seed ${seed}: ${a.kind} overlaps ${b.kind}`);
      }
    }
  }
});

Deno.test("objects keep clear of the centre spawn lane", () => {
  const cfg = makeArena({ size: 20, objects: 20, objectSpread: 0.2 });
  for (const o of placeObjects(cfg, seededRng(3))) {
    assert(Math.hypot(o.x, o.z) >= 2.2 - 1e-6, `${o.kind} spawned on the spawn lane at ${Math.hypot(o.x, o.z).toFixed(2)}`);
  }
});

Deno.test("glider pads are non-solid and counted separately", () => {
  const cfg = makeArena({ size: 20, objects: 0, gliderPads: 3 });
  const objs = placeObjects(cfg, seededRng(5));
  const pads = objs.filter((o) => o.kind === "gliderPad");
  assert(pads.length === 3, `expected 3 pads, got ${pads.length}`);
  assert(pads.every((p) => !p.solid), "a launch pad must not block movement");
  assert(objectSize("pillar").solid, "a pillar must be solid");
});

Deno.test("new parameters are present, in range, and defaulted sanely", () => {
  const cfg = DEFAULT_ARENA;
  assert(cfg.glider === 0, "gliders are opt-in");
  assert(cfg.outsideGround === 1 && cfg.outsideCollision === 1, "solid ground outside is the default");
  assert(cfg.shape === 0, "the default outline is a circle");
  assert(cfg.aspect === 1, "the default is unstretched");
  const r = makeArena({ glider: 5, aspect: 99, outsideHeight: -900 });
  assert(r.glider === 1 && r.aspect === 2.5 && r.outsideHeight === -20, "new params must clamp");
});
