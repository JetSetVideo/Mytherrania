// Wave X (lane U): the value-tone law, the Creator's tweak limits, the reroll of one part, the sheet's
// tones and the forged-steel sign markup. Pure modules only (the browser evidence is
// tools/probe-wave-x-ui.ts). SPEC X30-X49 are lane U's pins.
function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} expected ${y}, got ${x}`);
}
import { contrastRatio, paintTones, signed, TONE_BACKGROUNDS, TONE_HUE_NEG, toneAttrs, toneClass, toneFor, toneRgb, toneT } from "../src/ui/ValueTone.ts";
import { ATTRS, attrBase, attrBounds, clampAttr, pointBudget, pointsLeft, silhouetteBand, SILHOUETTE_KEYS } from "../src/ui/CreatorTweak.ts";
import { creatorSheet, rerollPart, REROLL_PARTS, rollProfile, rolledStats, tweakedStats, withAncestry } from "../src/ui/CreatorRoll.ts";
import { creatorSheetHtml, mulberry32, rerollButtonHtml, statGapHtml, steelSignHtml } from "../src/ui/Menu.ts";
import { ageBounds } from "../src/game/Age.ts";
import { phonologyFor } from "../src/game/NameGen.ts";
import { heightBand, weightBand } from "../src/ui/CreatorSync.ts";
import { PER_STAT_CAP } from "../src/game/SpectateGen.ts";
import { fighterCard, INSPECT_GOOD_DEV } from "../src/ui/InspectOverlay.ts";
import { UI_TREE } from "../src/ui/UiTree.ts";

const rgb = (s: string) => s.match(/\d+/g)!.map(Number);

Deno.test("SPEC X30: toneFor is green above neutral, red below, grey at it", () => {
  const [pr, pg] = rgb(toneFor(3)), [nr, ng] = rgb(toneFor(-3)), [zr, zg, zb] = rgb(toneFor(0));
  assert(pg > pr + 40, `positive is green ${toneFor(3)}`);
  assert(nr > ng + 40, `negative is red ${toneFor(-3)}`);
  assert(Math.max(zr, zg, zb) - Math.min(zr, zg, zb) < 16, `neutral is grey ${toneFor(0)}`);
  // neutral / span move the reference.
  assertEquals(toneFor(12, { neutral: 12 }), toneFor(0));
  assertEquals(toneFor(10, { neutral: 8, span: 4 }), toneFor(1, { span: 2 }));
  // invert: lower is better.
  assertEquals(toneFor(-1, { invert: true }), toneFor(1));
});

Deno.test("SPEC X31: toneFor is smooth and monotone in the value (no jumps, saturates at the span)", () => {
  let prevT = -Infinity, maxStep = 0, prev = toneRgb(-6, { span: 5 });
  for (let v = -6; v <= 6.0001; v += 0.05) {
    const t = toneT(v, { span: 5 });
    assert(t >= prevT - 1e-12, "t is monotone");
    prevT = t;
    const c = toneRgb(v, { span: 5 });
    maxStep = Math.max(maxStep, ...c.map((x, i) => Math.abs(x - prev[i])));
    prev = c;
  }
  assert(maxStep <= 12, `max channel step per 0.05 = ${maxStep} (continuous)`);
  assertEquals(toneFor(5, { span: 5 }), toneFor(50, { span: 5 }), "saturates at the span");
  assertEquals(toneFor(NaN), toneFor(0), "non-finite reads neutral");
});

Deno.test("SPEC X32: every tone reaches WCAG 4.5:1 on its surface's reference backgrounds", () => {
  for (const surface of ["dark", "parchment"] as const) {
    let min = Infinity;
    for (let v = -6; v <= 6; v += 0.25) {
      for (const bg of TONE_BACKGROUNDS[surface]) min = Math.min(min, contrastRatio(toneRgb(v, { surface }), bg));
    }
    assert(min >= 4.5, `${surface}: min contrast ${min.toFixed(2)}`);
  }
});

Deno.test("signed / toneClass / toneAttrs", () => {
  assertEquals(signed(3), "+3");
  assertEquals(signed(-2), "\u22122");
  assertEquals(signed(0), "0");
  assertEquals(signed(1234.5, 1), "+1 234.5");
  assertEquals(toneClass(0.2), "tone-pos");
  assertEquals(toneClass(-0.2), "tone-neg");
  assertEquals(toneClass(0), "tone-zero");
  const a = toneAttrs(-2, { span: 4 });
  assert(a.includes('data-tone="-2"') && a.includes('data-tone-span="4"') && a.includes("tone-neg") && !a.includes("style="));
});

Deno.test("paintTones writes the colour through CSSOM, with the parchment inks inside a stepper", () => {
  const mk = (tone: string, inStepper: boolean) => ({
    attrs: { "data-tone": tone } as Record<string, string>,
    getAttribute(n: string) { return this.attrs[n] ?? null; },
    closest: (sel: string) => (inStepper && sel.includes(".stepper") ? {} : null),
    style: { color: "" },
  });
  const a = mk("2", false), b = mk("2", true), c = mk("x", false);
  const n = paintTones({ querySelectorAll: () => [a, b, c] });
  assertEquals(n, 2);
  assertEquals(a.style.color, toneFor(2));
  assertEquals(b.style.color, toneFor(2, { surface: "parchment" }));
  assertEquals(c.style.color, "");
});

Deno.test("SPEC X33: the creator sheet carries all SEVEN attributes (Agility, Focus) and tones every number", () => {
  for (let i = 0; i < 12; i++) {
    const { profile } = rollProfile(mulberry32(0x7a11 + i));
    const sheet = creatorSheet(profile);
    assertEquals(sheet.primary.map((r) => r.label), ["Vitality", "Resilience", "Focus", "Reflex", "Strength", "Intelligence", "Agility"]);
    for (const r of [...sheet.primary, ...sheet.derived, ...sheet.secondary]) assert(r.tone !== undefined, `${r.label} is toned`);
    assert(sheet.derived.find((r) => r.label === "Attack Interval")?.tone?.invert === true, "a shorter interval is the better one");
    const html = creatorSheetHtml(sheet);
    assert(!html.includes("style="), "CSP: no inline style");
    assert((html.match(/data-tone=/g) ?? []).length >= sheet.primary.length + sheet.derived.length, "the markup carries the tones");
  }
});

Deno.test("SPEC X34: a rolled name speaks its race + sub-race phonology; the roll is seeded and draws an age in ageBounds", () => {
  for (let i = 0; i < 40; i++) {
    const a = rollProfile(mulberry32(0xa9e + i)).profile, b = rollProfile(mulberry32(0xa9e + i)).profile;
    assertEquals(a, b, "same seed, same fighter");
    const onsets = phonologyFor(a.race, a.subrace).onsets.map((o) => o.toLowerCase());
    assert(onsets.some((o) => a.name.toLowerCase().startsWith(o)), `${a.name} starts with a ${a.subrace} onset`);
    const band = ageBounds(a.race);
    assert(typeof a.appearance.age === "number" && a.appearance.age >= band.min && a.appearance.age <= band.max, `age ${a.appearance.age} in ${band.min}..${band.max}`);
    assert(a.appearance.sex === "male" || a.appearance.sex === "female");
  }
});

Deno.test("SPEC X35: reroll ONE part changes that part and keeps the rest", () => {
  const p = rollProfile(mulberry32(42)).profile;
  for (const part of REROLL_PARTS) {
    let changed = 0;
    for (let k = 0; k < 8; k++) {
      const q = rerollPart(p, part, mulberry32(1000 + k));
      if (part !== "ancestry") { assertEquals(q.race, p.race); assertEquals(q.subrace, p.subrace); }
      if (part !== "class") assertEquals(q.className, p.className);
      if (part !== "name" && part !== "ancestry") assertEquals(q.name, p.name, `${part} keeps the name`);
      if (part !== "sign") assertEquals(q.birthsign, p.birthsign);
      if (JSON.stringify(q) !== JSON.stringify(p)) changed++;
      // Always legal: the body inside the race band, the age inside ageBounds.
      const [h0, h1] = heightBand(q.race, q.subrace), [w0, w1] = weightBand(q.race, q.subrace);
      assert(q.appearance.height >= h0 - 1e-9 && q.appearance.height <= h1 + 1e-9, `${part}: height in band`);
      assert(q.appearance.weight >= w0 - 1e-9 && q.appearance.weight <= w1 + 1e-9, `${part}: weight in band`);
      const ab = ageBounds(q.race);
      assert(q.appearance.age! >= ab.min && q.appearance.age! <= ab.max + 1, `${part}: age ${q.appearance.age} in band`);
      assert(pointsLeft(q) >= 0, `${part}: never over budget`);
    }
    assert(changed >= 6, `${part} rerolls actually change something (${changed}/8)`);
  }
});

Deno.test("SPEC X36: a new ancestry regenerates an untyped name in the new phonology, keeps a typed one", () => {
  const p = { ...rollProfile(mulberry32(7)).profile, race: "human", subrace: "imperial" };
  const q = withAncestry(p, "dwarf", "mountain", mulberry32(9));
  assert(phonologyFor("dwarf", "mountain").onsets.some((o) => q.name.toLowerCase().startsWith(o.toLowerCase())), q.name);
  assert(q.appearance.race === "dwarf" && q.appearance.subrace === "mountain");
  const typed = withAncestry({ ...p, name: "Typed Name" }, "elf", "high", mulberry32(9), { nameLocked: true });
  assertEquals(typed.name, "Typed Name");
  // The body keeps its place inside the band.
  const [a0, a1] = heightBand("human", "imperial"), [b0, b1] = heightBand("dwarf", "mountain");
  const rel = (p.appearance.height - a0) / (a1 - a0);
  assert(Math.abs((q.appearance.height - b0) / (b1 - b0) - Math.max(0, Math.min(1, rel))) < 1e-9);
});

Deno.test("SPEC X37: attribute tweaks stay inside the floor, the per-stat cap and the level budget", () => {
  const p = rollProfile(mulberry32(5)).profile;
  const base = attrBase(p);
  assertEquals(pointsLeft(p), pointBudget(p), "a fresh roll has the whole budget");
  let q = p;
  // Pour every point into strength: it stops at the budget.
  for (let i = 0; i < 100; i++) q = { ...q, allocated: { ...q.allocated, strength: clampAttr(q, "strength", (q.allocated.strength ?? 0) + 1) } };
  assertEquals(q.allocated.strength, base.strength + Math.min(pointBudget(p), PER_STAT_CAP));
  assertEquals(pointsLeft(q), 0);
  // Lowering another stat gives points back, down to its floor only.
  const b = attrBounds(q, "focus");
  q = { ...q, allocated: { ...q.allocated, focus: clampAttr(q, "focus", -50) } };
  assertEquals(q.allocated.focus, b.min);
  assert(pointsLeft(q) === base.focus - b.min, "the freed points are back in the pool");
  for (const s of ATTRS) {
    const bb = attrBounds(q, s);
    assert(bb.min >= 1 && bb.max >= bb.min, `${s} band ${bb.min}..${bb.max}`);
  }
});

Deno.test("SPEC X38: the sheet follows a tweak live — the derived numbers move by the game's own statDelta", () => {
  const p = rollProfile(mulberry32(11)).profile;
  const rolled = rolledStats(p);
  assertEquals(tweakedStats(p), rolled, "no tweak: the rolled numbers exactly");
  const base = attrBase(p);
  const q = { ...p, allocated: { ...p.allocated, vitality: base.vitality + 2, strength: base.strength + 2 } };
  const t = tweakedStats(q);
  assert(t.maxHealth > rolled.maxHealth, "more vitality, more health");
  assert(t.attackPower > rolled.attackPower, "more strength, more power");
  const sheet = creatorSheet(q);
  const hp = sheet.derived.find((r) => r.label === "Max Health")!;
  assert(hp.delta && hp.delta.value > 0 && hp.delta.text.startsWith("+"), `the delta is shown: ${hp.delta?.text}`);
  const str = sheet.primary.find((r) => r.label === "Strength")!;
  assertEquals(str.delta?.text, "+2");
});

Deno.test("SPEC X39: silhouette tweak bands sit around the race's own value, inside SILHOUETTE_TOP", () => {
  const p = rollProfile(mulberry32(3)).profile;
  for (const k of SILHOUETTE_KEYS) {
    const b = silhouetteBand(p, k);
    assert(b.min <= b.base + 1e-9 && b.base <= b.max + 1e-9 || b.max < b.base, `${k}: ${b.min}..${b.max} around ${b.base}`);
    assert(b.max - b.min > 0, `${k} has room to tweak`);
  }
});

Deno.test("SPEC X40: the forged-steel sign and the reroll dice are CSP-safe markup with the race + sub-race", () => {
  const html = steelSignHtml("Dwarf", "Deep Dwarf", "creator-steel-sign");
  assert(html.includes(">Dwarf<") && html.includes(">Deep Dwarf<") && html.includes('id="creator-steel-sign"'));
  assertEquals((html.match(/steel-rivet /g) ?? []).length, 4, "four rivets");
  assert(!html.includes("style="));
  const dice = rerollButtonHtml("name", "Name");
  assert(dice.includes('data-reroll="name"') && dice.includes(">Name<") && !dice.includes("style="), "a visible label (touch: no hover-only cue)");
});

Deno.test("SPEC X41: History's stat cell names FOC and AGI and tones each gap", () => {
  const a = { vitality: 8, resilience: 9, focus: 5, reflex: 5, strength: 8, intelligence: 4, agility: 7 };
  const b = { vitality: 9, resilience: 9, focus: 3, reflex: 5, strength: 8, intelligence: 4, agility: 4 };
  const html = statGapHtml(a, b);
  for (const ab of ["VIT", "RES", "FOC", "REF", "STR", "INT", "AGI"]) assert(html.includes(`${ab}&nbsp;`), ab);
  assert(!/\bW\d|WIL/.test(html), "no Willpower abbreviation");
  assert(html.includes('data-tone="-1"') && html.includes('data-tone="2"') && html.includes('data-tone="3"'));
  // A legacy record with no agility still renders.
  const { agility: _drop, ...old } = a;
  assert(statGapHtml(old, b).includes("AGI —"));
});

Deno.test("SPEC X42: the inspect card tones the primaries both ways and keeps 'bad' for below-average", () => {
  const card = fighterCard({
    seat: 0, name: "T", ancestry: "Human", subrace: null, className: "Warrior", level: 1, controller: "AI", generationId: null,
    stats: { vitality: 6, resilience: 10, focus: 10, reflex: 10, strength: 14, intelligence: 10, agility: 10 },
    combat: { maxHealth: 100, attackPower: 10, attackInterval: 1, armor: 4 }, hp: 100, mana: 1, manaMax: 1, stamina: 1, staminaMax: 1,
    dealt: 0, hits: 0, weapon: "", techniques: [], telemetry: { travelledM: 0, avgDistanceM: 0, peak5sDamage: 0 },
  });
  const by = new Map(card.rows.map((r) => [r.label, r]));
  assertEquals(by.get("Vitality")?.tone, "bad");
  assertEquals(by.get("Strength")?.tone, "good");
  assert((by.get("Strength")?.toneValue ?? 0) >= INSPECT_GOOD_DEV);
  assert(by.has("Agility") && by.has("Focus"));
});

Deno.test("SPEC X43: the UI tree describes seven attributes (Agility) and no Willpower", () => {
  const text = JSON.stringify(UI_TREE);
  assert(!/six attributes/i.test(text) && !/willpower/i.test(text), "no six / willpower");
  assert(/agility/i.test(text), "agility named");
});

Deno.test("SPEC X44: combat text wears the negative tone's hue in styles.css; misses are neutral", async () => {
  const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
  assert(css.includes(`.combat-text{color:hsl(${TONE_HUE_NEG} `), "combat numbers are losses: the red hue");
  const zero = toneFor(0);
  assert(css.includes(`.combat-text--miss,.combat-text--immune{color:${zero}}`), `neutral outcomes use toneFor(0) = ${zero}`);
  for (const sel of [".steel-sign", ".steel-rivet", ".reroll-btn", ".sheet-row-delta"]) assert(css.includes(sel), sel);
  assert(/\.reroll-btn\{[^}]*min-height:40px/.test(css), "the reroll dice is a 40 px touch target");
});
