// Wave Z (lane S): the derived statistics sheet (C-SHEET) — SPEC Z20..Z29.
//
// Every row is recomputed HERE from the game's own functions (independent of DerivedSheet's row
// table) for 50 rolled, tweaked, levelled profiles; deltas are checked against their documented
// reference; the agility tweak is checked against the Wave X influence graph's signs; the HTML is
// checked for CSP safety and escaping; and docs/wave-z/STATS.md must equal its generator.
//
// Regenerate the doc: WRITE_STATS=1 deno test -A tests/wave_z_stats_test.ts

import {
  applyProfileTweaks, DERIVED_ROWS, derivedReference, derivedSheet, evenFoe, fightStats, formatDelta, formatNumber,
  referenceProfiles, type Row, SHEET_ATTRS, SHEET_CASTER_CLASSES, sheetMarkdown, sheetWeapon,
} from "../src/game/DerivedSheet.ts";
import { GROUP_TITLE, SHEET_GROUPS, statSheetHtml } from "../src/ui/StatSheet.ts";
import { creatorSheet, rollProfile, tweakedStats } from "../src/ui/CreatorRoll.ts";
import { rng32 } from "../src/core/MathCore.ts";
import { applyLevel, attackDamage, createStats, criticalChance, DAMAGE_SCALE, HEALTH_SCALE } from "../src/game/Stats.ts";
import { applyRaceBonus, raceAffinity, raceById, raceBonus, statDelta, type StatName } from "../src/game/Races.ts";
import { applySecondary, combineSecondary, SECONDARY_BRIDGE } from "../src/game/SecondaryStats.ts";
import { startingStats } from "../src/game/Leveling.ts";
import { resourceRates } from "../src/game/Resources.ts";
import { agilityOf, dashMul, dodgeDivisor, effectiveAgility, moveSpeedMul, turnRateMul } from "../src/game/Agility.ts";
import { bodyFromStats, density, toughness, totalMass } from "../src/game/Physics.ts";
import { CAST_BASE_BY_KIND, castSeconds } from "../src/game/Cast.ts";
import { castFocus } from "../src/game/PowerCost.ts";
import { fatigueResist, traitsOf, woundFactor } from "../src/game/Potential.ts";
import { powerTailSeconds, skillsForClass } from "../src/game/Skills.ts";
import { birthsignById } from "../src/game/Birthsight.ts";
import { INFLUENCES } from "../src/game/Influence.ts";
import { resolveWeapon } from "../src/game/weapons/Loadout.ts";
import { BASELINE_INTERVAL, combatProfile } from "../src/game/weapons/Profile.ts";
import { nameSeed } from "../src/game/RaceAppearance.ts";
import { weaponForClass } from "../src/game/Weapon.ts";
import type { CharacterProfile } from "../src/game/Characters.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/** 50 rolled profiles; most get a random legal-ish tweak (±3 on two attributes) and a level 1..20. */
function profiles(n = 50): CharacterProfile[] {
  const out: CharacterProfile[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng32(0x5eed00 + i * 7919);
    const p = rollProfile(r).profile;
    p.level = 1 + Math.floor(r() * 20);
    if (i % 5 !== 0) {
      const a = SHEET_ATTRS[Math.floor(r() * 7)], b = SHEET_ATTRS[Math.floor(r() * 7)];
      p.allocated = { ...p.allocated, [a]: p.allocated[a] + Math.floor(r() * 7) - 3 };
      p.allocated[b] += Math.floor(r() * 4);
    }
    if (i % 7 === 3) delete p.weaponType; // the classic class weapon path
    out.push(p);
  }
  return out;
}

/** Engine.#startFight, recomputed independently (createFighter -> #applyTweaks -> applyLevel). */
function engineStats(p: CharacterProfile) {
  let s = applySecondary(applyRaceBonus(createStats(p.className), p.race, p.subrace, p.birthsign), p.subrace, p.birthsign);
  const base = startingStats(p.className, p.race, p.subrace).allocated;
  const cur: Partial<Record<StatName, number>> = {};
  let any = false;
  for (const k of Object.keys(base) as StatName[]) {
    const v = p.allocated?.[k];
    cur[k] = typeof v === "number" && Number.isFinite(v) ? v : base[k];
    if (cur[k] !== base[k]) any = true;
  }
  if (any) {
    const b0 = s;
    s = { ...s };
    const now = statDelta(cur), was = statDelta(base);
    for (const k of Object.keys(now) as (keyof typeof s)[]) s[k] = s[k] + ((now[k] as number) - (was[k] as number));
    const kh = raceAffinity(p.race, p.subrace).health;
    // Wave Z: the window clamps only what the tweak adds (a sheet already past a bound keeps its value).
    const keep = (v: number, lo: number, hi: number, b: number) => Math.max(Math.min(lo, b), Math.min(Math.max(hi, b), v));
    s.maxHealth = keep(s.maxHealth, 30 * HEALTH_SCALE * kh, 60 * HEALTH_SCALE * kh, b0.maxHealth);
    s.attackPower = keep(s.attackPower, 5 * DAMAGE_SCALE, 14 * DAMAGE_SCALE, b0.attackPower);
    s.armor = keep(s.armor, 1, 8, b0.armor);
    s.attackInterval = keep(s.attackInterval, 0.5, 1.5, b0.attackInterval);
  }
  return applyLevel(s, p.level ?? 1);
}

/** Every derived row recomputed straight from the game functions (no DerivedSheet code). */
function expected(p: CharacterProfile): Record<string, number> {
  const s = engineStats(p);
  const foe = evenFoe();
  const rr = resourceRates(s, { race: p.race, subrace: p.subrace });
  const tr = traitsOf(s, p.race, p.subrace);
  const body = bodyFromStats(s);
  let reach: number, tempo: number;
  if (p.weaponType) {
    const prof = combatProfile(resolveWeapon(p.className, p.weaponType, nameSeed(p.name)));
    reach = prof.reach; tempo = prof.cooldown / BASELINE_INTERVAL;
  } else {
    reach = weaponForClass(p.className).reach; tempo = 1;
  }
  const sk = skillsForClass(p.className);
  return {
    maxHealth: s.maxHealth, maxMana: rr.manaMax, maxStamina: rr.staminaMax, manaRegen: rr.manaRegen, staminaRegen: rr.staminaRegen,
    attackPower: s.attackPower, attackInterval: s.attackInterval, swingInterval: s.attackInterval * tempo, attacksPerSecond: 1 / (s.attackInterval * tempo),
    hit: attackDamage(s, foe, 0.5, 0.5), critChance: 100 * criticalChance(s.reflex, foe.resilience),
    woundDealt: 100 * woundFactor({ vitality: 5, resilience: 5 }, s.strength),
    armor: s.armor, hitTaken: attackDamage(foe, s, 0.5, 0.5), critTaken: 100 * criticalChance(foe.reflex, s.resilience),
    dodge: 100 * (1 - 1 / dodgeDivisor(s)), woundTaken: 100 * woundFactor(tr, 5), staminaFatigue: 100 * fatigueResist(tr, "stamina"),
    effectiveAgility: effectiveAgility(s), moveSpeed: 100 * moveSpeedMul(s), turnRate: 100 * turnRateMul(s), dash: 100 * dashMul(s),
    animSpeed: 100 * agilityOf(s).animSpeed, recovery: 100 * agilityOf(s).recovery,
    castTime: castSeconds({ base: CAST_BASE_BY_KIND.power, focus: castFocus(s), hastePct: 0, element: "", heavy: ["Mage", "Necromancer", "Priest"].includes(p.className) }),
    powerTail: powerTailSeconds(s), manaFatigue: 100 * fatigueResist(tr, "mana"),
    cooldown: sk.reduce((a, x) => a + x.cooldown, 0) / sk.length,
    mass: totalMass(body), density: density(body), toughness: toughness(body), reach,
  };
}

Deno.test("SPEC Z20: every derived row equals the game function's own output (50 rolled, tweaked, levelled profiles)", () => {
  const ps = profiles();
  assert(ps.length === 50);
  let rows = 0;
  for (const p of ps) {
    const sh = derivedSheet(p);
    const want = expected(p);
    assert(sh.derived.length === Object.keys(want).length, `row count ${sh.derived.length} vs ${Object.keys(want).length}`);
    for (const r of sh.derived) {
      assert(r.key in want, `unexpected row ${r.key}`);
      assert(close(r.value, want[r.key]), `${p.name} ${r.key}: sheet ${r.value} vs game ${want[r.key]}`);
      rows++;
    }
    // the pipeline itself: fightStats == the engine's order, and CreatorRoll.tweakedStats delegates to it
    const s = engineStats(p), f = fightStats(p);
    for (const k of Object.keys(s) as (keyof typeof s)[]) assert(close(f[k], s[k]), `fightStats.${k}`);
    assert(JSON.stringify(tweakedStats(p)) === JSON.stringify(f), "CreatorRoll.tweakedStats = fightStats");
  }
  assert(rows === 50 * DERIVED_ROWS.length, `${rows} rows checked`);
  // Extreme tweaks drive every Engine clamp (health window x constitution, power, armour, interval).
  for (const [i, d] of [[1, 30], [2, -30], [3, 15]] as const) {
    const p = rollProfile(rng32(0xc1a + i)).profile;
    p.level = 7;
    p.allocated = Object.fromEntries(SHEET_ATTRS.map((k) => [k, p.allocated[k] + d]));
    const s = engineStats(p), f = fightStats(p);
    for (const k of Object.keys(s) as (keyof typeof s)[]) assert(close(f[k], s[k]), `clamped fightStats.${k}: ${f[k]} vs ${s[k]}`);
    const want = expected(p);
    for (const r of derivedSheet(p).derived) assert(close(r.value, want[r.key]), `clamped ${r.key}`);
  }
});

Deno.test("SPEC Z21: attribute rows — value = class sheet + modifier; modifier = fight − class preset; deltas sum to the modifiers", () => {
  for (const p of profiles()) {
    const sh = derivedSheet(p);
    const s = engineStats(p), cls = createStats(p.className), classSheet = startingStats(p.className, "", null).allocated;
    assert(sh.attributes.map((r) => r.key).join() === SHEET_ATTRS.join(), "seven attributes in sheet order");
    let sum = 0;
    for (const r of sh.attributes) {
      const k = r.key as StatName;
      assert(close(r.delta, s[k] - cls[k]), `${k} delta ${r.delta} vs ${s[k] - cls[k]}`);
      assert(close(r.value, classSheet[k] + r.delta), `${k} value`);
      sum += r.delta;
    }
    // The modifiers' total, from their sources: race + sub-race, birthsign, the hand-tweak and the
    // secondary crit bridge (Races.raceBonus, Birthsight mods, allocated − starting sheet, SECONDARY_BRIDGE).
    const race = raceById(p.race)!;
    const rb = raceBonus(race, race.subspecies.find((x) => x.id === p.subrace) ?? null);
    const sign = p.birthsign ? birthsignById(p.birthsign)?.mods ?? {} : {};
    const base = startingStats(p.className, p.race, p.subrace).allocated;
    const tweak = SHEET_ATTRS.reduce((a, k) => a + ((p.allocated?.[k] ?? base[k]) - base[k]), 0);
    const crit = combineSecondary(p.subrace, p.birthsign).crit * SECONDARY_BRIDGE.reflexPerCrit;
    const want = Object.values(rb).reduce((a, v) => a + (v ?? 0), 0) + Object.values(sign).reduce((a, v) => a + (v ?? 0), 0) + tweak + crit;
    assert(close(sum, want), `${p.name}: Σ attribute deltas ${sum} vs Σ modifiers ${want}`);
    // with no birthsign and no crit the sheet value is exactly the profile's allocated attribute
    if (!p.birthsign) for (const r of sh.attributes) if (r.key !== "reflex") assert(close(r.value, p.allocated?.[r.key] ?? base[r.key as StatName]), `${r.key} = allocated`);
  }
});

Deno.test("SPEC Z22: derived deltas are value − field mean; the 32 reference fighters' deltas average to 0", () => {
  const ref = derivedReference();
  const refs = referenceProfiles();
  assert(refs.length === 32, "8 classes x 4 races");
  const sheets = refs.map(derivedSheet);
  for (const d of DERIVED_ROWS) {
    assert(ref.span[d.key] > 0 && Number.isFinite(ref.span[d.key]), `${d.key} span`);
    const mean = sheets.reduce((a, sh) => a + sh.derived.find((r) => r.key === d.key)!.delta, 0) / sheets.length;
    assert(Math.abs(mean) < 1e-6 * Math.max(1, Math.abs(ref.mean[d.key])), `${d.key}: mean reference delta ${mean}`);
  }
  for (const p of profiles(10)) for (const r of derivedSheet(p).derived) assert(close(r.delta, r.value - ref.mean[r.key]), `${r.key} delta`);
});

Deno.test("SPEC Z23: no NaN, deterministic, C-SHEET formats ('(+2)', '(−0.3)', '(0)', real minus, grouped digits)", () => {
  for (const p of profiles()) {
    const a = derivedSheet(p), b = derivedSheet(structuredClone(p));
    assert(JSON.stringify(a) === JSON.stringify(b), "deterministic");
    for (const r of [...a.attributes, ...a.derived]) {
      for (const v of [r.value, r.delta, r.span ?? 1]) assert(Number.isFinite(v), `${r.key} finite`);
      assert(/^\((0|[+\u2212]\d{1,3}( \d{3})*(\.\d{1,2})?)\)$/.test(r.deltaDisplay), `${r.key} delta format ${r.deltaDisplay}`);
      assert(!r.deltaDisplay.includes("-") && !r.display.includes("NaN"), `${r.key}: real minus, no NaN`);
      assert(["pools", "offence", "defence", "mobility", "magic", "body"].includes(r.group), r.group);
    }
  }
  assert(formatDelta(2) === "(+2)" && formatDelta(-0.3, 1) === "(\u22120.3)" && formatDelta(0.004, 2) === "(0)" && formatDelta(-1313) === "(\u22121 313)");
  assert(formatNumber(24823) === "24 823" && formatNumber(-0.25, 2) === "\u22120.25");
  // a broken profile is total (unknown race / sign, no allocation, absurd level)
  const odd = { ...rollProfile(rng32(1)).profile, race: "unknown", subrace: "nope", birthsign: "nope", level: Number.NaN, allocated: {} } as CharacterProfile;
  for (const r of [...derivedSheet(odd).attributes, ...derivedSheet(odd).derived]) assert(Number.isFinite(r.value) && Number.isFinite(r.delta), `odd ${r.key}`);
});

/** Influence graph `to` nodes -> sheet row and the row's direction relative to the node. */
const NODE_ROW: Record<string, [string, 1 | -1]> = {
  moveSpeed: ["moveSpeed", 1], turnRate: ["turnRate", 1], dashDistance: ["dash", 1], damageTaken: ["hitTaken", 1],
  attackInterval: ["attackInterval", 1], "agility.effective": ["effectiveAgility", 1], "anim.recoverTime": ["recovery", -1],
  "anim.windupTime": ["animSpeed", -1], "technique.recoveryTail": ["powerTail", 1], maxHealth: ["maxHealth", 1],
  staminaMax: ["maxStamina", 1], bodyMass: ["mass", 1], armor: ["armor", 1], manaMax: ["maxMana", 1], attackPower: ["attackPower", 1],
  critChance: ["critChance", 1], critTaken: ["critTaken", 1], manaRegen: ["manaRegen", 1], staminaRegen: ["staminaRegen", 1],
  "cast.channel": ["castTime", 1], "potential.woundTaken": ["woundTaken", 1], "potential.woundDealt": ["woundDealt", 1],
  "potential.manaFatigue": ["manaFatigue", -1], "potential.staminaFatigue": ["staminaFatigue", -1],
};

Deno.test("SPEC Z24: +2 on an attribute moves its rows the way the Wave X influence graph says (agility first)", () => {
  // A mid-field profile at level 1 so no clamp binds: a human Rogue (agility 15 sheet).
  const base: CharacterProfile = { ...rollProfile(rng32(42)).profile, race: "human", subrace: "nomad", className: "Rogue", birthsign: null, level: 1 };
  base.allocated = { ...startingStats("Rogue", "human", "nomad").allocated };
  base.appearance = { ...base.appearance, race: "human", subrace: "nomad" };
  const val = (p: CharacterProfile) => Object.fromEntries(derivedSheet(p).derived.map((r) => [r.key, r.value]));
  const before = val(base);
  let checked = 0, moved = 0;
  for (const attr of SHEET_ATTRS) {
    const after = val({ ...base, allocated: { ...base.allocated, [attr]: base.allocated[attr] + 2 } });
    for (const e of INFLUENCES) {
      if (e.from !== attr || !(e.to in NODE_ROW)) continue;
      const [key, dir] = NODE_ROW[e.to];
      const d = (after[key] - before[key]) * dir * e.sign;
      assert(d >= -1e-9, `${attr} -> ${e.to} (${key}): moved ${after[key] - before[key]} against sign ${e.sign}`);
      checked++;
      if (d > 1e-9) moved++;
    }
  }
  assert(checked >= 25, `${checked} edges checked`);
  assert(moved >= checked * 0.6, `${moved}/${checked} edges moved (the rest sit on a clamp, e.g. crit's 15 % cap)`);
  // agility, explicitly: every agility-driven row moves the right way
  const ag = val({ ...base, allocated: { ...base.allocated, agility: base.allocated.agility + 2 } });
  for (const k of ["effectiveAgility", "moveSpeed", "turnRate", "dash", "animSpeed", "recovery", "dodge"]) assert(ag[k] > before[k], `agility +2 raises ${k}`);
  for (const k of ["attackInterval", "hitTaken", "powerTail"]) assert(ag[k] < before[k], `agility +2 lowers ${k}`);
  // and the sheet's agility attribute shows the +2
  const row = derivedSheet({ ...base, allocated: { ...base.allocated, agility: base.allocated.agility + 2 } }).attributes.find((r) => r.key === "agility")!;
  const row0 = derivedSheet(base).attributes.find((r) => r.key === "agility")!;
  assert(row.value - row0.value === 2 && row.delta - row0.delta === 2, "agility +2 on the attribute row");
});

Deno.test("SPEC Z25: the sheet's pipeline is the Engine's (text pin on #startFight / #applyTweaks / CASTER_CLASSES)", async () => {
  const engine = await Deno.readTextFile(new URL("../src/engine/Engine.ts", import.meta.url));
  const caster = engine.match(/CASTER_CLASSES: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/);
  assert(caster, "Engine.CASTER_CLASSES found");
  const names = caster[1].split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean).sort();
  assert(names.join() === [...SHEET_CASTER_CLASSES].sort().join(), `caster classes ${names}`);
  const usesShared = engine.includes("applyProfileTweaks(");
  if (!usesShared) {
    // Engine still carries its private copy: it must be the law applyProfileTweaks copies, line for line.
    const body = engine.slice(engine.indexOf("#applyTweaks(f: Fighter, prof: CharacterProfile): void {"), engine.indexOf("#applySpend(f: Fighter"));
    for (const line of [
      "const base = startingStats(prof.className, prof.race, prof.subrace).allocated;",
      "const now = statDelta(cur), was = statDelta(base);",
      "const kh = raceAffinity(prof.race, prof.subrace).health;",
      "Math.max(30 * HEALTH_SCALE * kh, Math.min(60 * HEALTH_SCALE * kh,",
      "Math.max(5 * DAMAGE_SCALE, Math.min(14 * DAMAGE_SCALE,",
      "Math.max(1, Math.min(8,",
      "Math.max(0.5, Math.min(1.5,",
    ]) assert(body.includes(line), `Engine.#applyTweaks still reads: ${line}`);
  }
  // order: createFighter (race -> secondary) then tweaks then applyLevel
  const sf = engine.slice(engine.indexOf("#startFight(player: CharacterProfile"));
  const iTweak = sf.search(/this\.#applyTweaks\(this\.#player|applyProfileTweaks\(/), iLevel = sf.indexOf("applyLevel(f.stats");
  assert(iTweak > 0 && iLevel > iTweak, "tweaks before the level growth");
  // applyProfileTweaks is the identity on an untouched profile
  const p = rollProfile(rng32(9)).profile;
  const s = createStats(p.className);
  assert(applyProfileTweaks(s, p) === s, "no tweak, same object");
});

Deno.test("SPEC Z26: statSheetHtml — C-SHEET markup, CSP-safe (no style=), escaped, toned, compact mode", () => {
  const p = rollProfile(rng32(77)).profile;
  const sh = derivedSheet(p);
  for (const compact of [false, true]) {
    const html = statSheetHtml(sh, { compact });
    assert(!/style\s*=/.test(html), "no inline style");
    assert(compact === html.includes('data-compact="1"'), "compact flag");
    const rows = html.match(/<div class="zs-row" data-key="[^"]+" data-group="[^"]+">/g) ?? [];
    assert(rows.length === sh.attributes.length + sh.derived.length, `${rows.length} rows`);
    assert((html.match(/class="zs-delta" data-tone="/g) ?? []).length === rows.length, "every delta carries data-tone");
    assert((html.match(/data-tone-span="/g) ?? []).length === rows.length, "and its span");
    const order = [...html.matchAll(/<section class="zs-group" data-group="([a-z]+)">/g)].map((m) => m[1]);
    assert(order.join() === ["attributes", ...SHEET_GROUPS].join(), `sections ${order}`);
    for (const g of order) assert(html.includes(`>${GROUP_TITLE[g as keyof typeof GROUP_TITLE]}</h4>`), g);
    for (const r of sh.derived.filter((x) => x.invert)) assert(html.includes(`data-key="${r.key}"`) && new RegExp(`data-key="${r.key}"[^]*?data-tone-invert="1"`).test(html), `${r.key} inverted`);
  }
  const compact = statSheetHtml(sh, { compact: true });
  assert(compact.includes('title="Max health"') && compact.includes(">Health</span>"), "compact: short label, full label in title");
  // escaping: a hostile label never becomes markup
  const evil: Row = { key: "x\"><script>", label: "<img src=x onerror=1>", value: 1, display: "1 & <b>", delta: 0, deltaDisplay: "(0)", group: "pools" };
  const out = statSheetHtml({ attributes: [], derived: [evil] });
  assert(!out.includes("<script>") && !out.includes("<img") && !out.includes("<b>") && out.includes("&lt;img") && out.includes("1 &amp; &lt;b&gt;"), out);
});

Deno.test("SPEC Z27: the + New generator and the hero card read the same numbers (creatorSheet = derivedSheet)", () => {
  for (const p of profiles(20)) {
    const cs = creatorSheet(p), ds = derivedSheet(p);
    assert(JSON.stringify(cs.full) === JSON.stringify(ds), "creatorSheet.full is derivedSheet");
    for (const r of ds.attributes) assert(cs.primary.find((x) => x.label === r.label)?.value === r.display, `${r.label}: ${cs.primary.find((x) => x.label === r.label)?.value} vs ${r.display}`);
    const num = (s: string) => Number(s.replace(/[^\d.]/g, ""));
    const pick = (l: string) => cs.derived.find((x) => x.label === l)!.value;
    const dv = (k: string) => ds.derived.find((x) => x.key === k)!.value;
    assert(num(pick("Max Health")) === Math.round(dv("maxHealth")), "Max Health");
    assert(num(pick("Attack Power")) === Math.round(dv("attackPower")), "Attack Power");
    assert(close(num(pick("Attack Interval")), Math.round(dv("attackInterval") * 100) / 100), "Attack Interval");
    assert(close(num(pick("Armour")), Math.round(dv("armor") * 10) / 10), "Armour");
  }
});

Deno.test("SPEC Z28: docs/wave-z/STATS.md is GENERATED from derivedSheet (no hand-typed number)", async () => {
  const sample = rollProfile(rng32(20261102)).profile;
  sample.level = 12;
  const doc = await Deno.readTextFile(new URL("../docs/wave-z/STATS.md", import.meta.url)).catch(() => "");
  const start = "<!-- GENERATED:BEGIN -->", end = "<!-- GENERATED:END -->";
  const gen = `${start}\n${sheetMarkdown(sample)}${end}`;
  if (Deno.env.get("WRITE_STATS") === "1") {
    const head = doc.includes(start) ? doc.slice(0, doc.indexOf(start)) : doc;
    const tail = doc.includes(end) ? doc.slice(doc.indexOf(end) + end.length) : "\n";
    await Deno.writeTextFile(new URL("../docs/wave-z/STATS.md", import.meta.url), head + gen + tail);
    return;
  }
  assert(doc.includes(gen), "STATS.md's generated block is stale: run WRITE_STATS=1 deno test -A tests/wave_z_stats_test.ts");
  for (const d of DERIVED_ROWS) assert(doc.includes(`| ${d.key} |`), `STATS.md lists ${d.key}`);
});

Deno.test("SPEC Z29: DerivedSheet / StatSheet are pure (no Math.random, no DOM, no THREE)", async () => {
  for (const f of ["../src/game/DerivedSheet.ts", "../src/ui/StatSheet.ts"]) {
    const src = await Deno.readTextFile(new URL(f, import.meta.url));
    for (const bad of ["Math.random(", "document.", "window.", "from \"three\"", "localStorage"]) assert(!src.includes(bad), `${f} uses ${bad}`);
  }
  // the weapon row reads the forged weapon (name seed) or the classic class weapon
  const p = rollProfile(rng32(3)).profile;
  assert(sheetWeapon(p).reach > 0 && sheetWeapon({ ...p, weaponType: undefined }).tempo === 1);
});
