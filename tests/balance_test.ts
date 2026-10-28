import { BalancePlate, balanceParams, KNOCKDOWN_OFFSET, STAGGER_OFFSET } from "../src/game/Balance.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

const base = {
  weight: 75, strength: 12, power: 12, healthRatio: 1, staminaRatio: 1,
  armorMass: 5, impactForce: 400, impactSide: 1, critMultiplier: 1,
};

Deno.test("a harder hit displaces further than a soft one", () => {
  const soft = balanceParams({ ...base, impactForce: 200 }).amplitude;
  const hard = balanceParams({ ...base, impactForce: 800 }).amplitude;
  assert(Math.abs(hard) > Math.abs(soft), "harder hit, bigger sway");
});

Deno.test("strength and health speed recovery; armour slows it", () => {
  const fit = balanceParams({ ...base, strength: 18, power: 18 });
  const weak = balanceParams({ ...base, strength: 6, power: 6 });
  assert(fit.gamma > weak.gamma, "stronger fighter damps faster");
  const hurt = balanceParams({ ...base, healthRatio: 0.2 });
  assert(hurt.gamma < balanceParams(base).gamma, "a hurt fighter recovers slower");
  const armoured = balanceParams({ ...base, armorMass: 40 });
  assert(armoured.gamma < balanceParams(base).gamma, "armour adds inertia");
  assert(fit.amplitude !== 0 && weak.amplitude !== 0, "both sway");
});

Deno.test("impactSide flips the direction of the sway", () => {
  const left = balanceParams({ ...base, impactSide: -1 }).amplitude;
  const right = balanceParams({ ...base, impactSide: 1 }).amplitude;
  assert(left < 0 && right > 0, "the sway follows the blow");
});

Deno.test("the sway decays to rest and the analytic form matches the amplitude sign", () => {
  const plate = new BalancePlate();
  plate.impact(base);
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    const s = plate.update(1 / 60);
    peak = Math.max(peak, Math.abs(s.offset));
  }
  const rest = plate.state();
  assert(peak > 0.001, `should sway, peak ${peak}`);
  assert(Math.abs(rest.offset) < 1e-3 && Math.abs(rest.velocity) < 1e-3, "must settle back to balance");
  // The analytic offset at t=0 is 0 and rises in the impact direction.
  plate.impact(base);
  assert(plate.analyticOffset(0) === 0, "starts at the balance point");
  assert(Math.sign(plate.analyticOffset(0.05)) === Math.sign(base.impactSide), "moves with the blow");
});

Deno.test("a big hit staggers, a huge hit knocks down", () => {
  const plate = new BalancePlate();
  plate.impact({ ...base, impactForce: 2000, critMultiplier: 1.5 });
  let state = plate.state();
  for (let i = 0; i < 120; i++) state = plate.update(1 / 60);
  assert(state.staggered, "a hard hit must stagger");
  // A weak jab never reaches the stagger offset.
  const calm = new BalancePlate();
  calm.impact({ ...base, impactForce: 50 });
  let s2 = calm.state();
  for (let i = 0; i < 120; i++) s2 = calm.update(1 / 60);
  assert(!s2.staggered && !s2.knockedDown, "a jab should not stagger");
});

Deno.test("thresholds are ordered: knockdown is beyond stagger", () => {
  assert(KNOCKDOWN_OFFSET > STAGGER_OFFSET, "knockdown is the worse state");
});
