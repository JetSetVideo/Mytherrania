import { beginSkill, canUse, chooseAiSkill, createRuntime, effectiveStats, endSkill, isReady, movementMul, tickRuntime } from "../src/game/SkillRuntime.ts";
import { skillsForClass } from "../src/game/Skills.ts";
import { createStats } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const warrior = () => createRuntime(skillsForClass("Warrior"));
const idx = (rt: ReturnType<typeof warrior>, kind: string) => rt.skills.findIndex((s) => s.kind === kind);

Deno.test("a fresh runtime is idle with every skill ready", () => {
  const rt = warrior();
  assert(rt.active === -1, "nothing animating");
  assert(rt.cooldowns.every((c) => c === 0), "all skills ready");
  assert(rt.armorMul === 1 && rt.speedMul === 1 && rt.attackIntervalMul === 1, "no buffs at rest");
  assert(isReady(rt, 0) && isReady(rt, 2), "dash and defence ready");
});

Deno.test("beginSkill applies the cooldown at once and the buffs for the stance", () => {
  const rt = warrior();
  const defense = idx(rt, "defense");
  const skill = beginSkill(rt, defense);
  assert(skill !== null, "the stance started");
  assert(rt.active === defense, "marked active");
  assert(rt.cooldowns[defense] === skill!.cooldown, "cooldown set on start, not on finish");
  assert(rt.armorMul > 1, "Bulwark raises armour");
  assert(rt.speedMul < 1, "Bulwark slows movement");
  assert(rt.attackIntervalMul > 1, "Bulwark slows the attack interval");
  assert(rt.buffRemaining > skill!.animation.duration, "buffs outlast the animation");
});

Deno.test("a skill cannot be started while another is animating, nor while stunned", () => {
  const rt = warrior();
  beginSkill(rt, idx(rt, "dash"));
  assert(!canUse(rt, idx(rt, "power"), false), "no second skill mid-animation");
  assert(beginSkill(rt, idx(rt, "power")) === null, "beginSkill must refuse mid-animation");
  endSkill(rt);
  assert(!canUse(rt, idx(rt, "power"), true), "stunned fighters cannot act");
  assert(beginSkill(rt, idx(rt, "power")) !== null, "free once the animation ends");
});

Deno.test("cooldowns tick down and a skill becomes ready again", () => {
  const rt = warrior();
  const power = idx(rt, "power");
  beginSkill(rt, power);
  endSkill(rt);
  assert(!isReady(rt, power), "on cooldown right after use");
  const cd = rt.cooldowns[power];
  tickRuntime(rt, cd / 2);
  assert(near(rt.cooldowns[power], cd / 2, 1e-9), "halved after half the cooldown");
  tickRuntime(rt, cd);
  assert(rt.cooldowns[power] === 0 && isReady(rt, power), "ready again");
});

Deno.test("stance buffs expire on their own and report the expiry", () => {
  const rt = warrior();
  beginSkill(rt, idx(rt, "defense"));
  endSkill(rt);
  assert(rt.armorMul > 1, "buff is on");
  let expired = false;
  for (let i = 0; i < 200 && !expired; i++) expired = tickRuntime(rt, 0.05);
  assert(expired, "the stance must expire");
  assert(rt.armorMul === 1 && rt.speedMul === 1 && rt.attackIntervalMul === 1, "buffs cleared");
});

Deno.test("effectiveStats folds the stance in: more armour, slower swings, base untouched", () => {
  const base = createStats("Warrior");
  const rt = warrior();
  const before = { ...base };
  beginSkill(rt, idx(rt, "defense"));
  const eff = effectiveStats(base, rt);
  assert(eff.armor > base.armor, "armour raised");
  assert(eff.attackInterval > base.attackInterval, "attack interval slowed");
  // Inverse: the base stats object must not be mutated by asking for effective ones.
  assert(base.armor === before.armor && base.attackInterval === before.attackInterval, "base stats mutated");
  assert(eff.maxHealth === base.maxHealth && eff.attackPower === base.attackPower, "unrelated stats changed");
  assert(movementMul(rt) < 1, "movement slowed while braced");
});

Deno.test("damage-over-time is set by the skill that carries it and expires", () => {
  const rogue = createRuntime(skillsForClass("Rogue"));
  const power = rogue.skills.find((s) => s.kind === "power")!;
  assert(power.payload.dot !== undefined, "Venom Strike must carry a DoT");
  rogue.dot = { dps: power.payload.dot!.total / power.payload.dot!.seconds, remaining: power.payload.dot!.seconds };
  assert(rogue.dot.dps > 0, "DoT ticks for a positive amount");
  let ticks = 0;
  while (rogue.dot) { tickRuntime(rogue, 0.25); ticks++; if (ticks > 100) break; }
  assert(rogue.dot === null, "the wound must close");
  assert(ticks >= power.payload.dot!.seconds / 0.25 - 1, "the DoT ran for roughly its stated duration");
});

Deno.test("the AI dashes from range, powers in reach, and braces when hurt", () => {
  const rt = warrior();
  const dash = idx(rt, "dash"), power = idx(rt, "power"), defense = idx(rt, "defense");
  const view = (distance: number, selfHp: number) => ({
    distance, selfReach: 1.7, selfHpRatio: selfHp, enemyHpRatio: 0.8, nearEdge: false,
  });
  assert(chooseAiSkill(rt, view(5, 1), false) === dash, "far away -> dash");
  assert(chooseAiSkill(rt, view(1.5, 1), false) === power, "in reach -> power");
  assert(chooseAiSkill(rt, view(1.5, 0.2), false) === defense, "hurt -> brace");
});

Deno.test("the AI never picks a skill that is cooling down, and gives up mid-animation", () => {
  const rt = warrior();
  const dash = idx(rt, "dash"), power = idx(rt, "power"), defense = idx(rt, "defense");
  const view = { distance: 5, selfReach: 1.7, selfHpRatio: 1, enemyHpRatio: 0.8, nearEdge: false };
  beginSkill(rt, dash);
  assert(chooseAiSkill(rt, view, false) === -1, "must not act mid-animation");
  endSkill(rt);
  // Everything on cooldown -> no choice at all.
  for (const i of [dash, power, defense]) rt.cooldowns[i] = 5;
  assert(chooseAiSkill(rt, view, false) === -1, "nothing ready -> no skill");
  assert(chooseAiSkill(rt, view, true) === -1, "stunned -> no skill");
});

Deno.test("an unknown skill index is refused rather than throwing", () => {
  const rt = warrior();
  assert(beginSkill(rt, -1) === null && beginSkill(rt, 99) === null, "out-of-range must be refused");
  assert(!canUse(rt, 99, false), "out-of-range is never usable");
  assert(!isReady(rt, 99), "out-of-range is never ready");
});
