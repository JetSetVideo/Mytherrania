import { BalanceRig, balancePoint, instability, stanceFor, STANCE_THRESHOLD, supportRadius, type PlateInput } from "../src/game/BalancePlates.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

const base: PlateInput = { footSpread: 0.24, groundSlope: 0, pelvisTilt: 0, shoulderTilt: 0, mass: 75 };

Deno.test("a wider stance grows the support radius and lowers the balance point", () => {
  const narrow = supportRadius({ ...base, footSpread: 0.1 });
  const wide = supportRadius({ ...base, footSpread: 0.5 });
  assert(wide > narrow, "wider feet, bigger support polygon");
  const lowN = balancePoint({ ...base, footSpread: 0.1 }).height;
  const lowW = balancePoint({ ...base, footSpread: 0.5 }).height;
  assert(lowW < lowN, "a wide stance drops the balance point toward the ground");
});

Deno.test("a ground slope shrinks the support radius, so a slope tips the body sooner", () => {
  const flat = supportRadius(base);
  const slope = supportRadius({ ...base, groundSlope: 0.3 });
  assert(slope < flat, "a slope eats the support polygon");
  // The feet stay planted, so the slope does not itself move the balance point...
  const bp = balancePoint({ ...base, groundSlope: 0.3 });
  assert(Math.abs(bp.offset) === 0, "planted feet: the slope does not shift the point");
  // ...but with a smaller polygon the SAME lean tips past the edge sooner on a slope.
  const lean = { ...base, pelvisTilt: 0.45 };
  const flatLevel = instability(lean);
  const slopeLevel = instability({ ...lean, groundSlope: 0.5 });
  assert(slopeLevel > flatLevel, "the same lean is less stable on a slope");
});

Deno.test("pelvis and shoulder tilts move the composite off-centre, weighted by height", () => {
  // Same tilt on one plate at a time; the shoulder is higher, so its torque arm is
  // longer, but the pelvis carries more mass. Compare against a zero-tilt baseline.
  const neutral = balancePoint(base).offset;
  const pelvisOnly = balancePoint({ ...base, pelvisTilt: 0.25 }).offset;
  const shoulderOnly = balancePoint({ ...base, shoulderTilt: 0.25 }).offset;
  assert(pelvisOnly > neutral, "a pelvis tilt leans the point off-centre");
  assert(shoulderOnly > neutral, "a shoulder tilt leans the point off-centre");
  // Both contributions combine additively (superposition of the linear model).
  const both = balancePoint({ ...base, pelvisTilt: 0.25, shoulderTilt: 0.25 }).offset;
  assert(Math.abs(both - (pelvisOnly + shoulderOnly - neutral)) < 1e-9, "tilts superimpose linearly");
});

Deno.test("stance escalates standing -> staggered -> kneeling -> fallen as it tips", () => {
  assert(stanceFor(base) === "standing", "balanced is standing");
  // Tip the pelvis progressively until the stance changes.
  let staggered = false, kneeling = false, fallen = false;
  for (let tilt = 0; tilt < 1.6; tilt += 0.02) {
    const s = stanceFor({ ...base, pelvisTilt: tilt });
    if (s === "staggered") staggered = true;
    if (s === "kneeling") kneeling = true;
    if (s === "fallen") fallen = true;
  }
  assert(staggered && kneeling && fallen, "the stance passes through all four states");
  assert(STANCE_THRESHOLD.stagger < STANCE_THRESHOLD.kneel && STANCE_THRESHOLD.kneel < STANCE_THRESHOLD.fall, "thresholds ordered");
});

Deno.test("a knee strike drives the body toward a kneel or a fall", () => {
  const calm = stanceFor(base);
  assert(calm === "standing", "no force, standing");
  const struck = stanceFor(base, { impulse: 900, side: 1 });
  assert(struck === "kneeling" || struck === "fallen", `a hard knee strike must drop the stance, got ${struck}`);
});

Deno.test("instability is a ratio: <1 stable, >1 past the edge", () => {
  assert(instability(base) < STANCE_THRESHOLD.stagger, "balanced is stable");
  const tipped = instability({ ...base, pelvisTilt: 1.0 });
  assert(tipped > instability(base), "a tilt raises instability");
});

Deno.test("the rig tracks stance over frames and clears a one-frame knee impulse", () => {
  const rig = new BalanceRig();
  rig.setPlates(base);
  assert(rig.update(1 / 60).stance === "standing", "starts standing");
  rig.strikeKnee({ impulse: 900, side: 1 });
  const hit = rig.update(1 / 60);
  assert(hit.stance === "kneeling" || hit.stance === "fallen", "the strike drops the stance that frame");
  const after = rig.update(1 / 60);
  assert(after.stance === "standing", "the impulse clears the next frame and the body recovers");
  rig.setPlates({ pelvisTilt: 1.0 });
  assert(rig.update(1 / 60).stance !== "standing", "a sustained tilt holds a lower stance");
});
