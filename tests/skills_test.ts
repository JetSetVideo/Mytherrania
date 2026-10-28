import { ALL_SKILLS, ELEMENTS, skillsForClass, SKILLS_BY_CLASS } from "../src/game/Skills.ts";
import { CLASSES } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("every class owns exactly three skills: a dash, a power and a defence", () => {
  for (const c of CLASSES) {
    const list = skillsForClass(c);
    assert(list.length === 3, `${c} has ${list.length} skills, expected 3`);
    const kinds = list.map((s) => s.kind).sort().join(",");
    assert(kinds === "dash,defense,power", `${c} kinds were ${kinds}`);
    // Inversion: the three kinds must be distinct, never duplicated.
    assert(new Set(list.map((s) => s.kind)).size === 3, `${c} repeats a kind`);
  }
  assert(ALL_SKILLS.length === 24, `expected 24 skills, got ${ALL_SKILLS.length}`);
});

Deno.test("skill ids are unique", () => {
  const ids = ALL_SKILLS.map((s) => s.id);
  assert(new Set(ids).size === ids.length, "duplicate skill id");
});

Deno.test("every skill is named, described, and carries a valid element", () => {
  for (const s of ALL_SKILLS) {
    assert(s.name.trim().length > 2, `${s.id} has no name`);
    assert(s.blurb.trim().length > 20, `${s.id} has no description`);
    assert(ELEMENTS[s.element] !== undefined, `${s.id} has an unknown element`);
    assert(s.cooldown > 0, `${s.id} cooldown must be positive`);
    assert(s.animation.duration > 0, `${s.id} animation must last longer than 0s`);
    assert(s.animation.tracks.length >= 4, `${s.id} animates only ${s.animation.tracks.length} joints`);
  }
});

Deno.test("the hit frame falls inside the animation, and the peak is where the strike lands", () => {
  for (const s of ALL_SKILLS) {
    const { hitAt, duration } = s.animation;
    assert(hitAt > 0 && hitAt < 1, `${s.id} hitAt ${hitAt} outside (0,1)`);
    assert(duration >= 0.3 && duration <= 1.5, `${s.id} duration ${duration} out of range`);
    // The weapon arm must peak at the strike, not before or after it.
    const arm = s.animation.tracks.find((t) => t.joint === "shoulderR");
    assert(arm !== undefined, `${s.id} does not animate the weapon arm`);
    assert(Math.abs(arm.peak - hitAt) < 1e-9, `${s.id} arm peaks at ${arm.peak}, strike at ${hitAt}`);
  }
});

Deno.test("power skills hit hardest and defence skills are the tanky-but-slow trade", () => {
  for (const c of CLASSES) {
    const [dash, power, defense] = ["dash", "power", "defense"].map(
      (k) => skillsForClass(c).find((s) => s.kind === k)!,
    );
    assert(power.payload.damageMul > dash.payload.damageMul, `${c}: power must out-damage dash`);
    assert(power.payload.damageMul > defense.payload.damageMul, `${c}: power must out-damage defence`);
    // A defensive stance always buys armour and always pays for it somewhere.
    assert((defense.payload.armorMul ?? 1) > 1, `${c}: defence must add armour`);
    assert(defense.payload.damageMul < dash.payload.damageMul, `${c}: defence must cost damage`);
    const pays = (defense.payload.speedMul ?? 1) < 1 ||
      (defense.payload.attackIntervalMul ?? 1) > 1 ||
      defense.payload.damageMul < 0.5;
    assert(pays, `${c}: defence takes no trade-off at all`);
    // Dash = ground gained; defence = ground held.
    assert(dash.animation.lunge !== 0, `${c}: dash must move the fighter`);
    assert(defense.animation.lunge === 0, `${c}: defence must not lunge`);
  }
});

Deno.test("class flavour holds: the Warrior's power stuns, his dash closes the gap", () => {
  const warrior = skillsForClass("Warrior");
  const power = warrior.find((s) => s.kind === "power")!;
  const dash = warrior.find((s) => s.kind === "dash")!;
  const defense = warrior.find((s) => s.kind === "defense")!;
  assert(power.name === "Crushing Blow", `warrior power is ${power.name}`);
  assert(power.payload.stun >= 0.5, "Crushing Blow must stun");
  assert(dash.animation.lunge > 2, "Shield Dash must close a real gap");
  assert((defense.payload.armorMul ?? 1) >= 1.8, "Bulwark must be a heavy armour boost");
  assert((defense.payload.speedMul ?? 1) <= 0.7, "Bulwark must slow the warrior down");
  // The class roster must not share skill names.
  const names = ALL_SKILLS.map((s) => s.name);
  assert(new Set(names).size === names.length, "two skills share a name");
});

Deno.test("elements are class-appropriate and each class keeps a single element", () => {
  const expected: Record<string, string> = {
    Barbarian: "fury", Warrior: "fire", Rogue: "poison", Assassin: "shadow",
    Mage: "arcane", Necromancer: "necrotic", Archer: "wind", Priest: "holy",
  };
  for (const c of CLASSES) {
    const els = new Set(SKILLS_BY_CLASS[c].map((s) => s.element));
    assert(els.size === 1, `${c} mixes elements: ${[...els].join(",")}`);
    assert([...els][0] === expected[c], `${c} element was ${[...els][0]}, expected ${expected[c]}`);
  }
  // Every element must be used by exactly one class, so no art/effect is orphaned.
  const used = new Set(ALL_SKILLS.map((s) => s.element));
  assert(used.size === CLASSES.length, `${used.size} elements used for ${CLASSES.length} classes`);
});
