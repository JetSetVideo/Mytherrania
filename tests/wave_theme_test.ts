// Wave THEME (lane T): identity-driven materials, palettes, patterns and relations — C-THEME. SPEC TH1-TH19.
// The arithmetic (contrast, distances, relations) is proven here; tools/probe-wave-theme.ts proves the wiring in
// Chrome (computed styles, contrast on pixels, layout).
import {
  allSwatches, blend, CLASS_THEME, classTheme, colourDistance, contrast, FAMILY_PATTERN, hexToRgb, luminance, NEUTRAL_SWATCH,
  OPPOSITE_ACCENT, raceTheme, relation, relationAccent, RELATION_STYLE, rotateHue, signFit, signTheme, SUBRACE_SWATCH,
  subraceSwatch, themeFor, typicalWeapon, weaponTheme, type Relation, type Swatch,
} from "../src/ui/Theme.ts";
import { chipStack, materialStack, swatchChipStack, themeTokens, type Stack } from "../src/ui/ThemeTextures.ts";
import { RACES } from "../src/game/Races.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";
import { weaponForClass } from "../src/game/Weapon.ts";
import { ARCHETYPE_IDS, ARCHETYPES, CLASS_ARCHETYPE } from "../src/game/weapons/Archetypes.ts";
import { heroFloatHtml, heroTags, mulberry32 } from "../src/ui/Menu.ts";
import { creatorSheet, rollProfile } from "../src/ui/CreatorRoll.ts";
import { themeDocTables } from "../tools/theme-doc.ts";

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const HEX = /^#[0-9a-f]{6}$/i;
const css = await Deno.readTextFile(new URL("../styles.css", import.meta.url));
const menu = await Deno.readTextFile(new URL("../src/ui/Menu.ts", import.meta.url));
const textures = await Deno.readTextFile(new URL("../src/ui/ThemeTextures.ts", import.meta.url));
const hue = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};
const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

Deno.test("SPEC TH1: race -> plaque material (ork clay, elf white scroll, human wood, dwarf stone); unknown -> neutral", () => {
  assertEquals(RACES.map((r) => [r.id, raceTheme(r.id).material]), [["human", "wood"], ["elf", "scroll"], ["dwarf", "stone"], ["ork", "clay"]]);
  for (const x of ["", "goblin", null, undefined]) assertEquals(raceTheme(x as string).material, "neutral");
});

Deno.test("SPEC TH2: every race x sub-race of the game data has its OWN swatch (5 hex fields), no fallback used", () => {
  for (const r of RACES) for (const s of r.subspecies) {
    assert(SUBRACE_SWATCH[r.id]?.[s.id], `${r.id}/${s.id} has a swatch`);
    const sw = subraceSwatch(r.id, s.id);
    for (const k of ["base", "light", "dark", "ink", "accent"] as const) assert(HEX.test(sw[k]), `${r.id}/${s.id}.${k}`);
  }
  // A missing sub-race reads the race's first nation; an unknown race the neutral swatch.
  assertEquals(subraceSwatch("ork", null).base, SUBRACE_SWATCH.ork.greenhide.base);
  assertEquals(subraceSwatch("goblin", "x"), NEUTRAL_SWATCH);
});

Deno.test("SPEC TH3: every swatch's ink-on-base contrast >= 4.5 (computed, WCAG); chip accents >= 3 (icons, pips)", () => {
  const rows = allSwatches().map((x) => ({ ...x, c: contrast(x.swatch.ink, x.swatch.base) }));
  const worst = rows.slice().sort((a, b) => a.c - b.c)[0];
  assert(worst.c >= 4.5, `worst ${worst.group}/${worst.id} ${worst.c.toFixed(2)}`);
  for (const x of rows.filter((r) => /^(class|sign|weapon)$/.test(r.group))) assert(contrast(x.swatch.accent, x.swatch.base) >= 3, `${x.group}/${x.id} accent ${contrast(x.swatch.accent, x.swatch.base).toFixed(2)}`);
});

/** The worst ink contrast of a stack: every field tint composited over the base (>= 4.5) and every mark (>= 3). */
function stackWorst(st: Stack, sw: Swatch) {
  const field = st.tints.filter((t) => t.role === "field").map((t) => contrast(sw.ink, blend(sw.base, t.color, t.alpha)));
  const mark = st.tints.filter((t) => t.role === "mark").map((t) => contrast(sw.ink, blend(sw.base, t.color, t.alpha)));
  return { field: Math.min(contrast(sw.ink, sw.base), ...field), mark: Math.min(99, ...mark) };
}
Deno.test("SPEC TH4: the textures keep the ink legible — field tints over the base >= 4.5, sparse marks >= 3", () => {
  for (const r of RACES) for (const s of r.subspecies) {
    const sw = subraceSwatch(r.id, s.id), m = raceTheme(r.id).material;
    for (const [name, st] of [["plaque", materialStack(m, sw)], ["subrace chip", swatchChipStack(sw, m)]] as const) {
      const w = stackWorst(st, sw);
      assert(w.field >= 4.5 && w.mark >= 3, `${r.id}/${s.id} ${name}: field ${w.field.toFixed(2)} mark ${w.mark.toFixed(2)}`);
    }
  }
  const chips: [string, { swatch: Swatch; pattern: Parameters<typeof chipStack>[0] }][] = [
    ...CLASSES.map((c) => [c, classTheme(c)] as [string, ReturnType<typeof classTheme>]),
    ...BIRTHSIGNS.map((s) => [s.id, signTheme(s.id)] as [string, ReturnType<typeof signTheme>]),
    ...ARCHETYPE_IDS.map((w) => [w, weaponTheme(w)] as [string, ReturnType<typeof weaponTheme>]),
  ];
  for (const [id, t] of chips) {
    const w = stackWorst(chipStack(t.pattern, t.swatch), t.swatch);
    assert(w.field >= 4.5 && w.mark >= 3, `${id}: field ${w.field.toFixed(2)} mark ${w.mark.toFixed(2)}`);
  }
});

// Measured: the closest sub-race pair within a race is ork bloodfang/ironhide-class distances ~30+; the band is set
// below the measured minimum (printed by tools/theme-doc.ts) so a near-duplicate palette fails.
export const MIN_SUBRACE_DELTA_E = 15;
Deno.test("SPEC TH5: palettes are distinct — sub-races within a race (base ΔE76 >= 15), classes / signs / weapons among themselves", () => {
  for (const r of RACES) {
    const subs = r.subspecies.map((s) => subraceSwatch(r.id, s.id));
    for (let i = 0; i < subs.length; i++) for (let j = i + 1; j < subs.length; j++) {
      const d = Math.max(colourDistance(subs[i].base, subs[j].base), 0);
      assert(d >= MIN_SUBRACE_DELTA_E, `${r.id} ${r.subspecies[i].id}/${r.subspecies[j].id} ΔE ${d.toFixed(1)}`);
      assert(colourDistance(subs[i].accent, subs[j].accent) >= MIN_SUBRACE_DELTA_E, `${r.id} accents`);
    }
  }
  for (const group of ["class", "sign", "weapon"]) {
    const xs = allSwatches().filter((x) => x.group === group);
    const sig = new Set(xs.map((x) => `${x.swatch.base}|${x.swatch.accent}`));
    assertEquals(sig.size, xs.length, `${group} palettes unique`);
    let min = Infinity;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) min = Math.min(min, colourDistance(xs[i].swatch.base, xs[j].swatch.base) + colourDistance(xs[i].swatch.accent, xs[j].swatch.accent));
    assert(min >= 8, `${group} min base+accent ΔE ${min.toFixed(1)}`);
  }
});

Deno.test("SPEC TH6: ork palettes are DARK and exactly one is PURPLE (Ironhide, documented)", () => {
  const orks = RACES.find((r) => r.id === "ork")!.subspecies.map((s) => ({ id: s.id, sw: subraceSwatch("ork", s.id) }));
  for (const o of orks) assert(luminance(o.sw.base) < 0.06, `${o.id} dark (L ${luminance(o.sw.base).toFixed(3)})`);
  const purple = orks.filter((o) => hue(o.sw.base) >= 260 && hue(o.sw.base) <= 300);
  assertEquals(purple.map((o) => o.id), ["ironhide"]);
  assert(/PURPLE/.test(SUBRACE_SWATCH.ork.ironhide.why), "the reason is documented on the swatch");
  assert(hue(subraceSwatch("ork", "greenhide").base) > 70 && hue(subraceSwatch("ork", "greenhide").base) < 160, "greenhide green");
  assert(hue(subraceSwatch("ork", "bloodfang").base) < 20, "bloodfang red");
});

Deno.test("SPEC TH7: material ramps — elf parchment light, human woods lighter tones, dwarf rock dark; light/dark bracket the base", () => {
  for (const s of ["high", "wood", "dark"]) assert(luminance(subraceSwatch("elf", s).base) > 0.6, `elf ${s}`);
  for (const s of ["imperial", "nomad", "islander"]) { const L = luminance(subraceSwatch("human", s).base); assert(L > 0.25 && L < 0.75, `human ${s} ${L.toFixed(3)}`); }
  for (const s of ["mountain", "forge", "deep"]) assert(luminance(subraceSwatch("dwarf", s).base) < 0.08, `dwarf ${s}`);
  for (const x of allSwatches()) assert(luminance(x.swatch.light) > luminance(x.swatch.base) && luminance(x.swatch.dark) < luminance(x.swatch.base), `${x.group}/${x.id} light > base > dark`);
});

Deno.test("SPEC TH8: class -> palette + pattern (Archer fletching, Mage sigils, Warrior plates, Rogue/Assassin stitching, Necromancer bones, Priest halo, Barbarian fur)", () => {
  assertEquals(CLASSES.map((c) => [c, classTheme(c).pattern]), [
    ["Barbarian", "fur"], ["Warrior", "plates"], ["Rogue", "stitch"], ["Assassin", "crossstitch"],
    ["Mage", "sigils"], ["Necromancer", "bones"], ["Archer", "fletching"], ["Priest", "halo"],
  ]);
  assertEquals(Object.keys(CLASS_THEME).length, CLASSES.length);
  assertEquals(classTheme("Bard").pattern, "none");
});

Deno.test("SPEC TH9: sign -> emblem pattern (6 distinct); weapon -> pattern by family for all 17 archetypes + legacy types", () => {
  const p = BIRTHSIGNS.map((s) => signTheme(s.id).pattern);
  assertEquals(new Set(p).size, BIRTHSIGNS.length);
  assert(!p.includes("none"));
  for (const w of ARCHETYPE_IDS) assertEquals(weaponTheme(w).pattern, FAMILY_PATTERN[ARCHETYPES[w].family], w);
  for (const t of ["sword", "axe", "dagger", "staff", "scythe", "bow", "mace"]) assert(weaponTheme(t).pattern !== "none", t);
  assertEquals(weaponTheme("random").pattern, "none");
  assertEquals(signTheme("comet").pattern, "none");
});

Deno.test("SPEC TH10: class x weapon — the class's own archetype is the ONLY synchronous weapon (Archer + Bow, the longbow)", () => {
  assertEquals(relation("class-weapon", "Archer", "bow"), "synchronous");
  assertEquals(weaponForClass("Archer").name, "Longbow");
  assertEquals(relation("class-weapon", "Archer", weaponForClass("Archer").type), "synchronous", "the legacy Longbow type");
  for (const c of CLASSES) {
    const sync = ARCHETYPE_IDS.filter((w) => relation("class-weapon", c, w) === "synchronous");
    assertEquals(sync, [CLASS_ARCHETYPE[c]], c);
    assertEquals(typicalWeapon(c), CLASS_ARCHETYPE[c]);
    // A legacy type that is not itself an archetype id ("sword") resolves to the class's archetype.
    const legacy = weaponForClass(c).type;
    if (!(legacy in ARCHETYPES)) assertEquals(relation("class-weapon", c, legacy), "synchronous", `${c} legacy ${legacy}`);
    // Every class has complementary AND opposite weapons (the scale is used both ways).
    const kinds = new Set(ARCHETYPE_IDS.map((w) => relation("class-weapon", c, w)));
    assert(kinds.has("complementary") && kinds.has("opposite"), `${c} ${[...kinds]}`);
  }
  assertEquals(relation("class-weapon", "Archer", "maul"), "opposite");
  assertEquals(relation("class-weapon", "Archer", "dagger"), "complementary");
});

Deno.test("SPEC TH11: class x sign — one synchronous sign per class = the best attribute fit (Archer serpent, Mage moon, Necromancer void, Warrior mountain, Barbarian flame)", () => {
  for (const c of CLASSES) {
    const sync = BIRTHSIGNS.filter((s) => relation("class-sign", c, s.id) === "synchronous").map((s) => s.id);
    const best = BIRTHSIGNS.map((s) => s.id).sort((a, b) => signFit(c, b) - signFit(c, a))[0];
    assertEquals(sync, [best], c);
  }
  const want: Record<string, string> = { Archer: "serpent", Mage: "moon", Necromancer: "void", Warrior: "mountain", Barbarian: "flame", Rogue: "serpent", Priest: "void", Assassin: "serpent" };
  for (const [c, s] of Object.entries(want)) assertEquals(relation("class-sign", c, s), "synchronous", c);
  assertEquals(relation("class-sign", "Mage", "flame"), "opposite");
});

Deno.test("SPEC TH12: race x class — the race's defaultClass is synchronous; adaptable humans fit every calling; elves oppose Barbarian", () => {
  for (const r of RACES) assertEquals(relation("race-class", r.id, r.defaultClass), "synchronous", r.id);
  for (const c of CLASSES) if (c !== "Warrior") assertEquals(relation("race-class", "human", c), "complementary", c);
  assertEquals(relation("race-class", "elf", "Barbarian"), "opposite");
  assertEquals(relation("race-class", "ork", "Warrior"), "complementary");
  assertEquals(relation("race-class", "dwarf", "Mage"), "opposite");
});

Deno.test("SPEC TH13: total functions — race x weapon follows the race's calling; unknown ids never throw (neutral / complementary)", () => {
  assertEquals(relation("race-weapon", "ork", "greataxe"), "synchronous");
  assertEquals(relation("race-weapon", "elf", "staff"), "synchronous");
  const junk = ["", "x", null, undefined, "__proto__", "constructor", "toString"];
  for (const k of ["class-weapon", "class-sign", "race-class", "race-weapon"] as const) for (const a of junk) for (const b of junk) assertEquals(relation(k, a as string, b as string), "complementary", `${k} ${a} ${b}`);
  for (const a of junk) {
    assertEquals(classTheme(a as string).swatch, NEUTRAL_SWATCH);
    assertEquals(signTheme(a as string).swatch, NEUTRAL_SWATCH);
    assertEquals(weaponTheme(a as string).swatch, NEUTRAL_SWATCH);
    assertEquals(raceTheme(a as string).material, "neutral");
  }
  assert(Object.keys(themeFor({ race: "??", className: "??", birthsign: "??", weapon: "??" })).length > 30);
});

Deno.test("SPEC TH14: relation accents — synchronous shares the anchor, complementary turns its hue 180°, opposite = the contrast accent; three ring styles", () => {
  const a = "#a9d47a";
  assertEquals(relationAccent("synchronous", a), a);
  const c = relationAccent("complementary", a);
  assert(Math.abs(((hue(c) - hue(a) + 360) % 360) - 180) < 3, `hue ${hue(a).toFixed(0)} -> ${hue(c).toFixed(0)}`);
  assertEquals(rotateHue(rotateHue(a, 180), 180), a);
  assertEquals(relationAccent("opposite", a), OPPOSITE_ACCENT);
  const styles = (["synchronous", "complementary", "opposite"] as Relation[]).map((r) => RELATION_STYLE[r].border);
  assertEquals(styles, ["solid", "double", "dashed"]);
});

Deno.test("SPEC TH15: themeFor(profile) emits the C-THEME tokens on the root (--th-plaque-*, --th-chip-{race,subrace,class,sign,weapon}-*, --th-relation-*)", () => {
  const t = themeFor({ race: "elf", subrace: "wood", className: "Archer", birthsign: "serpent", weapon: "bow" }) as Record<string, string>;
  for (const p of ["plaque", "chip-race", "chip-subrace", "chip-class", "chip-sign", "chip-weapon"]) for (const k of ["base", "light", "dark", "ink", "accent"]) assert(HEX.test(t[`--th-${p}-${k}`]), `--th-${p}-${k}`);
  for (const r of ["class", "sign", "weapon"]) { assert(HEX.test(t[`--th-relation-${r}-color`])); assert(/^(solid|double|dashed)$/.test(t[`--th-relation-${r}-style`])); }
  assertEquals(t["--th-relation-weapon-style"], "solid", "Archer + bow synchronous");
  assertEquals(t["--th-relation-weapon-color"], classTheme("Archer").swatch.accent, "shared accent");
  assertEquals(t["--th-plaque-base"], SUBRACE_SWATCH.elf.wood.base);
  const atypical = themeFor({ race: "elf", subrace: "wood", className: "Archer", birthsign: "flame", weapon: "maul" }) as Record<string, string>;
  assertEquals([atypical["--th-relation-weapon-style"], atypical["--th-relation-weapon-color"]], ["dashed", OPPOSITE_ACCENT]);
});

Deno.test("SPEC TH16: the textures are CSP-safe stacks — aligned layer lists, gradients + data:image/svg+xml only, each material its own recipe", () => {
  const sw = subraceSwatch("human", "imperial");
  const m = { clay: materialStack("clay", sw), scroll: materialStack("scroll", sw), wood: materialStack("wood", sw), stone: materialStack("stone", sw) };
  for (const [name, st] of Object.entries(m)) {
    const n = st.layers;
    const parts = (v: string) => v.split(/,(?![^(]*\))/).length;
    assertEquals([parts(st.size), parts(st.repeat)], [n, n], `${name} size/repeat lists`);
    for (const u of st.image.match(/url\("[^"]*"\)/g) ?? []) assert(u.startsWith('url("data:image/svg+xml,'), `${name}: only SVG data URIs (${u.slice(0, 30)})`);
    const svg = (st.image.match(/url\("data:image\/svg\+xml,([^"]*)"\)/g) ?? []).map((u) => decodeURIComponent(u.slice(25, -2))).join("");
    assert(!/javascript:|expression\(|<script|on\w+=/i.test(svg + st.image), name);
    for (const u of st.image.match(/url\("data:image\/svg\+xml,([^"]*)"\)/g) ?? []) assert(!/["<>]/.test(u.slice(25, -2)), `${name}: tile fully encoded`);
  }
  const dec = (st: Stack) => (st.image.match(/url\("data:image\/svg\+xml,([^"]*)"\)/g) ?? []).map((u) => decodeURIComponent(u.slice(25, -2))).join("");
  assert(/stroke-linejoin='bevel'/.test(dec(m.clay)), "clay: crack network (SVG polylines)");
  assert((m.wood.image.match(/repeating-linear-gradient/g) ?? []).length >= 2 && /<ellipse/.test(dec(m.wood)), "wood: grain bands + knots");
  assert((m.stone.image.match(/radial-gradient\(circle/g) ?? []).length >= 3 && /stroke='#/.test(dec(m.stone)), "stone: speckle + veins");
  assert((m.scroll.image.match(/repeating-linear-gradient/g) ?? []).length >= 2, "scroll: fibres");
  assertEquals(new Set(Object.values(m).map((s) => s.image)).size, 4);
  // No DOM style attribute: tokens go through setProperty only.
  assert(textures.includes("style.setProperty") && !/setAttribute\(\s*["']style/.test(textures) && !/\.style\.cssText/.test(textures));
  const tok = themeTokens({ race: "dwarf", subrace: "forge", className: "Warrior", birthsign: "flame", weapon: "longsword" });
  for (const p of ["plaque", "chip-race", "chip-subrace", "chip-class", "chip-sign", "chip-weapon"]) for (const k of ["img", "size", "pos", "repeat"]) assert(tok[`--th-${p}-${k}`], `--th-${p}-${k}`);
  assert(tok["--th-plaque-shadow"].includes("inset"));
});

const { profile } = rollProfile(mulberry32(11));
Deno.test("SPEC TH17: the markup — the name sits on .th-plaque, class/sign/weapon tags carry data-relation + a title, no inline style", () => {
  const p = { ...profile, race: "elf", subrace: "wood", className: "Archer" as const, birthsign: "serpent", weaponType: "bow" };
  const tags = heroTags(creatorSheet(p), p);
  const f = heroFloatHtml(p.name, tags);
  assert(f.includes(`<span class="th-plaque"><strong class="hero-name">`), "plaque wraps the name");
  assert(!f.includes("style="), "CSP");
  const w = tags.find((t) => t.kind === "weapon")!;
  assertEquals(w.relation, "synchronous");
  assert(/data-relation="synchronous" title="[^"]*Archer: typical pair[^"]*" data-tag="weapon"><svg/.test(f), "weapon tag: relation, title, icon");
  assertEquals(tags.find((t) => t.kind === "sign")?.relation, "synchronous");
  assertEquals(tags.find((t) => t.kind === "class")?.relation, "complementary", "elf archer");
  const odd = heroTags(creatorSheet({ ...p, weaponType: "maul", birthsign: "flame" }), { ...p, weaponType: "maul", birthsign: "flame" });
  assertEquals(odd.filter((t) => t.relation).map((t) => t.relation), ["complementary", "opposite", "opposite"]);
  // Without a profile (labels only) no relation is claimed.
  assert(heroTags(creatorSheet(p)).every((t) => !t.relation));
});

Deno.test("SPEC TH18: styles.css consumes the tokens — plaque per material (scroll rolls, wood pegs), chips per kind, relation rings + pips, socket, scoped to [data-th-material]", () => {
  for (const k of ["race", "subrace", "class", "sign", "weapon"]) assert(css.includes(`[data-th-material] .hero-tag[data-tag="${k}"]{`), k);
  for (const k of ["img", "size", "pos", "repeat", "shadow", "ink", "base"]) assert(css.includes(`var(--th-plaque-${k})`), `plaque ${k}`);
  assert(/\[data-th-material="scroll"\] \.th-plaque::before\{top:/.test(css) && /\[data-th-material="scroll"\] \.th-plaque::after\{bottom:/.test(css), "scroll: rolled top AND bottom");
  assert(/\[data-th-material="clay"\] \.th-plaque\{border-radius:[^}]+\/[^}]+\}/.test(css), "clay: an uneven hand-formed tablet");
  assert(css.includes('.hero-tag[data-relation="opposite"]::after') && css.includes('.hero-tag[data-relation="complementary"]::after'), "pips");
  assert(css.includes("border-style:var(--rel-s);border-color:var(--rel-c)"), "rings");
  assert(css.includes(".stage-plate[data-th-material] .equip-slot-weapon{"), "weapon socket");
  const theme = css.slice(css.indexOf("/* ── Wave THEME (lane T)"));
  for (const rule of theme.split("}").map((r) => r.trim()).filter((r) => r && !r.startsWith("/*") && r.includes("{"))) {
    const sel = rule.slice(0, rule.indexOf("{")).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert(/data-th-material|data-relation|^\.pick-row/.test(sel), `scoped: ${sel.slice(0, 80)}`);
  }
  assert(!/url\(\s*["']?data:/.test(theme), "no data: URI in the stylesheet itself (they arrive through tokens)");
});

Deno.test("SPEC TH19: wiring + docs — Menu themes .hero-card, .stage-plate, the tabs and the Creator lists; THEME.md tables are the generated ones", async () => {
  assert(menu.includes("if (card && character) applyTheme(card, themeProfileOf(character));"), "hero card");
  assert(menu.includes("if (plate) applyTheme(plate, themeProfileOf(this.#player));"), "+ New plate");
  assert(menu.includes("paintThemeHooks(this.#root,"), "Creator lists");
  assert(menu.includes('t.style.setProperty("--th-tab-accent"'), "tabs");
  const doc = await Deno.readTextFile(new URL("../docs/wave-theme/THEME.md", import.meta.url));
  assert(doc.includes(themeDocTables()), "THEME.md carries the tables tools/theme-doc.ts generates (no hand-typed numbers)");
  // Average plaque contrast is reported in the doc from the same function.
  assert(avg(allSwatches().map((x) => contrast(x.swatch.ink, x.swatch.base))) > 7);
});
