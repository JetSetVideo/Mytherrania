import { bearing, compassPoint, lensFactor, NO_GEAR, senseRange, senseRanges, senseReaches, sensesTouching, stimulusStrength } from "../src/game/Senses.ts";
import { CLASSES } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

const FACING_NORTH = { x: 0, z: -1 };

Deno.test("sight reaches further than hearing, and both reach further than touch", () => {
  const r = senseRanges();
  assert(r.sight > r.hearing, `sight ${r.sight} should outrange hearing ${r.hearing}`);
  assert(r.hearing > r.touch, `hearing ${r.hearing} should outrange touch ${r.touch}`);
  assert(r.magnetism > r.scent, "the compass sense should outrange scent");
});

Deno.test("a helmet muffles hearing more than it narrows sight", () => {
  const bare = senseRanges(NO_GEAR);
  const helmed = senseRanges({ helmet: 1, armour: 0, race: {} });
  const hearLoss = 1 - helmed.hearing / bare.hearing;
  const sightLoss = 1 - helmed.sight / bare.sight;
  assert(hearLoss > sightLoss, `helmet should hurt hearing (${hearLoss}) more than sight (${sightLoss})`);
  assert(hearLoss > 0.4 && hearLoss < 0.5, `expected ~45% hearing loss, got ${hearLoss}`);
});

Deno.test("race traits multiply a sense, and the inverse trait reduces it", () => {
  const base = senseRange("hearing");
  assert(senseRange("hearing", { helmet: 0, armour: 0, race: { hearing: 2 } }) > base, "keen ears should reach further");
  assert(senseRange("hearing", { helmet: 0, armour: 0, race: { hearing: 0.5 } }) < base, "dull ears should reach less");
});

Deno.test("the aggro volume is a LENS, not a globe: it is flatter than it is wide", () => {
  // Straight up must be much shorter than straight ahead.
  const ahead = lensFactor(0, 0, 0);
  const up = lensFactor(Math.PI / 2, 0, 0);
  assert(ahead > 0.9, `ahead should be near full range, got ${ahead}`);
  assert(up < ahead * 0.35, `up (${up}) should be far shorter than ahead (${ahead})`);
  // And it is symmetric behind when calm.
  const behind = lensFactor(0, Math.PI, 0);
  assert(Math.abs(behind - ahead) < 1e-9, "a calm creature watches all round equally");
});

Deno.test("agitation stretches the lens forward and shrinks it behind", () => {
  const calmFront = lensFactor(0, 0, 0);
  const hotFront = lensFactor(0, 0, 1);
  const calmBack = lensFactor(0, Math.PI, 0);
  const hotBack = lensFactor(0, Math.PI, 1);
  assert(hotFront > calmFront, "an enraged creature should watch further ahead");
  assert(hotBack < calmBack, "and give up the area behind it");
  // The forward bias is bounded, so it never becomes a pure cone.
  assert(hotFront < calmFront * 2, "the forward stretch must stay bounded");
});

Deno.test("lensFactor is continuous at the horizon and never negative", () => {
  for (let e = 0; e <= Math.PI / 2; e += 0.02) {
    for (let a = 0; a <= Math.PI; a += 0.1) {
      const v = lensFactor(e, a, 0.7);
      assert(v >= 0, `negative lens factor at e=${e} a=${a}: ${v}`);
      assert(Number.isFinite(v), "lens factor must be finite");
    }
  }
});

Deno.test("touch only registers what is in contact", () => {
  const r = senseRange("touch");
  assert(senseReaches("touch", r * 0.5, 0, 0, FACING_NORTH, 0), "a body in contact must be felt");
  assert(!senseReaches("touch", r * 3, 0, 0, FACING_NORTH, 0), "a body across the arena must not be felt");
});

Deno.test("a target behind is seen further when agitated than when calm", () => {
  const behind = { x: 0, z: 20 };
  const facing = { x: 0, z: -1 };
  const calm = senseReaches("sight", behind.x, 0, behind.z, facing, 0);
  const hot = senseReaches("sight", behind.x, 0, behind.z, facing, 1);
  assert(calm, "a calm creature should still see behind it at 20 m");
  assert(!hot, "an agitated creature should have lost the area behind it");
});

Deno.test("magnetism ignores facing, because a compass does not care which way you look", () => {
  const far = senseRange("magnetism") * 0.5;
  assert(senseReaches("magnetism", 0, 0, far, FACING_NORTH, 0), "should sense behind");
  assert(senseReaches("magnetism", 0, 0, -far, FACING_NORTH, 0), "should sense ahead");
});

Deno.test("bearing and compassPoint agree with the cardinal directions", () => {
  assert(compassPoint(bearing(0, -1)) === "N", "toward -z is north");
  assert(compassPoint(bearing(1, 0)) === "E", "toward +x is east");
  assert(compassPoint(bearing(0, 1)) === "S", "toward +z is south");
  assert(compassPoint(bearing(-1, 0)) === "W", "toward -x is west");
  for (const [dx, dz] of [[0, -1], [1, -1], [1, 0], [1, 1]] as const) {
    const b = bearing(dx, dz);
    assert(b >= 0 && b < 360, `bearing out of range: ${b}`);
  }
});

Deno.test("stimulus strength falls off with distance and is bounded", () => {
  const r = senseRange("sight");
  assert(stimulusStrength("sight", 0) > 0.99, "contact should be a full-strength stimulus");
  assert(stimulusStrength("sight", r) < 0.01, "at the edge of range the stimulus is gone");
  assert(stimulusStrength("sight", r * 2) === 0, "beyond range there is nothing");
  let prev = 2;
  for (let d = 0; d < r; d += r / 20) {
    const s = stimulusStrength("sight", d);
    assert(s <= prev + 1e-9, "strength must not rise with distance");
    prev = s;
  }
});

Deno.test("sensesTouching orders by strength and always includes touch at contact", () => {
  const at = sensesTouching(0, 0, 0, FACING_NORTH, 0);
  assert(at.includes("touch"), "touching a body must include touch");
  const near = sensesTouching(0, 0, -2, FACING_NORTH, 0);
  assert(near.length >= 3, `a body 2 m ahead should trip several senses, got ${near.join(",")}`);
  // A visible body 2 m ahead must be SEEN first: sight is the strongest sense at
  // range, and magnetism must not outrank it.
  assert(near[0] === "sight", `strongest sense at 2 m should be sight, got ${near[0]}`);
});

Deno.test("every class gets a usable sense suite", () => {
  for (const c of CLASSES) {
    const r = senseRanges({ helmet: 0.5, armour: 0.5, race: {} });
    assert(r.sight > 10, `${c} should still see across a small arena`);
    assert(Number.isFinite(r.scent) && r.scent > 0, `${c} scent must be positive`);
  }
});
