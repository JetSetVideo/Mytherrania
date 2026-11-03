// Wave THEME (lane T): generates docs/wave-theme/THEME.md — the palette / material / relation tables come from
// Theme.ts + ThemeTextures.ts by code (SPEC TH19 checks the doc carries exactly these tables), and the probe
// numbers from artifacts/qa-wave-theme/theme/report.json (tools/probe-wave-theme.ts).
//   deno run -A tools/theme-doc.ts
import {
  allSwatches, blend, CLASS_THEME, colourDistance, contrast, luminance, raceTheme, relation, SIGN_THEME, SUBRACE_SWATCH, subraceSwatch,
  weaponTheme, type Swatch,
} from "../src/ui/Theme.ts";
import { chipStack, materialStack, swatchChipStack, type Stack } from "../src/ui/ThemeTextures.ts";
import { RACES } from "../src/game/Races.ts";
import { CLASSES } from "../src/game/Stats.ts";
import { BIRTHSIGNS } from "../src/game/Birthsight.ts";
import { ARCHETYPE_IDS, ARCHETYPES } from "../src/game/weapons/Archetypes.ts";

const f2 = (x: number) => x.toFixed(2);
function worst(st: Stack, sw: Swatch): [number, number] {
  const c = (role: string) => st.tints.filter((t) => t.role === role).map((t) => contrast(sw.ink, blend(sw.base, t.color, t.alpha)));
  return [Math.min(contrast(sw.ink, sw.base), ...c("field")), Math.min(99, ...c("mark"))];
}
const swatchCells = (s: Swatch) => `\`${s.base}\` · \`${s.light}\` · \`${s.dark}\` · ink \`${s.ink}\` · accent \`${s.accent}\``;
const REL = { synchronous: "S", complementary: "c", opposite: "x" } as const;

export function themeDocTables(): string {
  const out: string[] = [];
  out.push("### Race -> material, sub-race -> palette (name plaque)", "",
    "| race | material | sub-race | palette | swatch (base · light · dark · ink · accent) | L(base) | ink/base | worst field tint | worst mark | nearest sibling ΔE76 |",
    "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of RACES) {
    const m = raceTheme(r.id);
    for (const s of r.subspecies) {
      const sw = subraceSwatch(r.id, s.id), meta = SUBRACE_SWATCH[r.id][s.id];
      const [fw, mw] = worst(materialStack(m.material, sw), sw);
      const near = Math.min(...r.subspecies.filter((o) => o.id !== s.id).map((o) => colourDistance(sw.base, subraceSwatch(r.id, o.id).base)));
      out.push(`| ${r.name} | ${m.material} (${m.label}) | ${s.name} | ${meta.name} — ${meta.why} | ${swatchCells(sw)} | ${luminance(sw.base).toFixed(3)} | ${f2(contrast(sw.ink, sw.base))} | ${f2(fw)} | ${f2(mw)} | ${near.toFixed(1)} |`);
    }
  }
  out.push("", "### Class -> palette + pattern (class chip)", "", "| class | pattern | why | swatch | ink/base | accent/base | worst field | worst mark |", "|---|---|---|---|---|---|---|---|");
  for (const c of CLASSES) {
    const t = CLASS_THEME[c], [fw, mw] = worst(chipStack(t.pattern, t.swatch), t.swatch);
    out.push(`| ${c} | ${t.pattern} | ${t.why} | ${swatchCells(t.swatch)} | ${f2(contrast(t.swatch.ink, t.swatch.base))} | ${f2(contrast(t.swatch.accent, t.swatch.base))} | ${f2(fw)} | ${f2(mw)} |`);
  }
  out.push("", "### Birth sign -> palette + emblem (sign chip)", "", "| sign | pattern | why | swatch | ink/base | accent/base | worst field | worst mark |", "|---|---|---|---|---|---|---|---|");
  for (const b of BIRTHSIGNS) {
    const t = SIGN_THEME[b.id], [fw, mw] = worst(chipStack(t.pattern, t.swatch), t.swatch);
    out.push(`| ${b.name} | ${t.pattern} | ${t.why} | ${swatchCells(t.swatch)} | ${f2(contrast(t.swatch.ink, t.swatch.base))} | ${f2(contrast(t.swatch.accent, t.swatch.base))} | ${f2(fw)} | ${f2(mw)} |`);
  }
  out.push("", "### Weapon -> palette + pattern (weapon chip, + New weapon socket)", "", "| weapon | family | pattern | swatch | ink/base | accent/base | worst field | worst mark |", "|---|---|---|---|---|---|---|---|");
  for (const w of ARCHETYPE_IDS) {
    const t = weaponTheme(w), [fw, mw] = worst(chipStack(t.pattern, t.swatch), t.swatch);
    out.push(`| ${ARCHETYPES[w].label} | ${ARCHETYPES[w].family} | ${t.pattern} | ${swatchCells(t.swatch)} | ${f2(contrast(t.swatch.ink, t.swatch.base))} | ${f2(contrast(t.swatch.accent, t.swatch.base))} | ${f2(fw)} | ${f2(mw)} |`);
  }
  const all = allSwatches().map((x) => contrast(x.swatch.ink, x.swatch.base));
  out.push("", `Ink-on-base over all ${all.length} swatches: min ${f2(Math.min(...all))}, mean ${f2(all.reduce((a, x) => a + x, 0) / all.length)}. Sub-race chips (strip + material base): min field ${f2(Math.min(...RACES.flatMap((r) => r.subspecies.map((s) => worst(swatchChipStack(subraceSwatch(r.id, s.id), raceTheme(r.id).material), subraceSwatch(r.id, s.id))[0]))))}.`);
  out.push("", "### Relations (S synchronous · c complementary · x opposite)", "", `| class \\ weapon | ${ARCHETYPE_IDS.join(" | ")} |`, `|---|${ARCHETYPE_IDS.map(() => "---").join("|")}|`);
  for (const c of CLASSES) out.push(`| ${c} | ${ARCHETYPE_IDS.map((w) => REL[relation("class-weapon", c, w)]).join(" | ")} |`);
  out.push("", `| class \\ sign | ${BIRTHSIGNS.map((b) => b.id).join(" | ")} |`, `|---|${BIRTHSIGNS.map(() => "---").join("|")}|`);
  for (const c of CLASSES) out.push(`| ${c} | ${BIRTHSIGNS.map((b) => REL[relation("class-sign", c, b.id)]).join(" | ")} |`);
  out.push("", `| race \\ class | ${CLASSES.join(" | ")} |`, `|---|${CLASSES.map(() => "---").join("|")}|`);
  for (const r of RACES) out.push(`| ${r.name} | ${CLASSES.map((c) => REL[relation("race-class", r.id, c)]).join(" | ")} |`);
  return out.join("\n");
}

if (import.meta.main) {
  const report = await Deno.readTextFile("artifacts/qa-wave-theme/theme/report.json").then(JSON.parse).catch(() => null);
  const probe: string[] = [];
  if (report) {
    const s = report.summary;
    probe.push(`Run ${report.generated} on \`${report.dist}\` (tools/probe-wave-theme.ts, real Chrome).`, "",
      `- plaques ${s.plaques} (materials ${Object.entries(s.materials).map(([k, v]) => `${k}=${v}`).join(", ")}); distinct plaque backgrounds ${s.plaqueStylesDistinct}/12, sub-race chip colours ${s.subraceChipBgDistinct}/12`,
      `- chips distinct: class ${s.classChipsDistinct}/8, sign ${s.signChipsDistinct}/6, weapon ${s.weaponChipsDistinct}/17; relations on the page = Theme.relation: weapons ${s.weaponRelationsMatch}, signs ${s.signRelationsMatch}, pairs ${s.pairsMatch}`,
      `- contrast on PIXELS (glyphs hidden, median of the label box): plaque names min ${s.contrastMin.plaqueName}, chips min ${s.contrastMin.chips}, saved-hero names min ${s.contrastMin.heroName}`,
      `- CSP violations ${s.cspViolations}, page errors ${s.pageErrors}`, "",
      "| viewport | + New audit (overflow/clipped/tiny) · hero audit · plate checks · contrast |", "|---|---|");
    for (const [vp, v] of Object.entries(s.layout)) probe.push(`| ${vp} | ${v} |`);
    probe.push("", "| plaque | material | name contrast (px) | race chip | sub-race chip |", "|---|---|---|---|---|");
    for (const p of report.plaques) probe.push(`| ${p.race}/${p.subrace} | ${p.material} | ${p.contrastName?.ratio} | ${p.contrastRace?.ratio} | ${p.contrastSub?.ratio} |`);
    probe.push("", "| pair (class + weapon + sign, race) | expected class/sign/weapon | on the page | weapon ring |", "|---|---|---|---|");
    for (const p of report.pairs) probe.push(`| ${p.cls} + ${p.weapon} + ${p.sign} (${p.race}/${p.sub}) | ${p.expected.class}/${p.expected.sign}/${p.expected.weapon} | ${p.seen.class?.rel}/${p.seen.sign?.rel}/${p.seen.weapon?.rel} | ${p.seen.weapon?.border} ${p.seen.weapon?.ring} |`);
  }
  const doc = `# Wave THEME — lane T: identity-driven materials, palettes, patterns and relations

Generated by \`deno run -A tools/theme-doc.ts\` from Theme.ts / ThemeTextures.ts (tables) and
\`artifacts/qa-wave-theme/theme/report.json\` (probe). No number below is typed by hand.

## What it does
- **Race -> material of the name plaque** (\`.th-plaque\` around \`.hero-name\`, hero card and + New plate): Orc **clay** (a
  hand-formed fired tablet: seeded SVG crack network, matte pits, mottling, fired rim shadow), Elf **white scroll**
  (parchment with fibres, foxing, tanned edges and two ROLLED ends drawn as cylinders above and below), Human **wood**
  (figured grain that bends around two knots with growth rings, soft earlywood/latewood bands, pores, two pegs, lighter
  tones), Dwarf **stone / dark metal-rock** (slate cleavage, three speckle grains, iron/ember veins in the sub-race accent,
  cut bevel).
- **Sub-race -> palette** on that material; the race and sub-race chips show the material sample and the palette strip.
  The PURPLE ork palette is **Ironhide** ("war-forged in the Slag Pits"): slag cools into violet-black glass and forged
  iron tempers through purple, so the slag-pit clan wears temper-purple clay with a rust accent; Greenhide keeps the
  marsh green and Bloodfang the dried-blood red.
- **Class / birth sign / weapon -> palette + pattern** on their chips (SVG tiles or gradients, alpha <= 0.3 in the text
  field), the weapon also on the + New weapon socket; the Creator's class / weapon / sign lists wear the same swatches.
- **Relations** (Theme.relation, data-driven): class x weapon from \`Archetypes.CLASS_ARCHETYPE\` (+ same family/class
  and a hand table of good fits), class x sign from the cosine between the sign's modifiers and the class's distinguishing
  primaries (Stats), race x class from \`Races.defaultClass\` + the same cosine (humans are flat = adaptable), race x weapon
  via the race's calling. Rendered: synchronous = SOLID ring in the shared accent + a round pip; complementary = DOUBLE
  ring in the complementary accent (hue + 180°) + a half/half pip; opposite = DASHED ring in \`#ff4a5e\` + a diamond pip;
  each chip's title says it ("Bow with Archer: typical pair (shared accent)"). The Creator lists show the same ring/pip per
  row against the current class.
- CSP: tokens are written with \`el.style.setProperty\` (CSSOM, allowed by \`style-src 'self'\`); SVG tiles are
  \`data:image/svg+xml\` images (allowed by \`img-src 'self' data:\`); styles.css holds no data: URI.

## Click paths
- Fighters -> **+ New** -> Ancestry: click a sub-race chip -> the plate's plaque material/palette change.
- + New -> Calling: class row / weapon row -> the class and weapon chips, the weapon socket ring and every list row's pip change.
- + New -> Sign: a sign row -> the sign chip and its relation ring.
- + New -> **Save as profile** -> the hero card shows the same plaque + chips; the hero tab is underlined in the class accent.

## Tables (generated)

${themeDocTables()}

## Probe (generated)

${probe.join("\n") || "(run tools/probe-wave-theme.ts first)"}

## Known gaps
- The pixel contrast is the MEDIAN of the label box; a glyph crossing a crack/knot/vein (marks, <= 8 % of the area) sits on
  a darker/lighter spot whose computed floor is in the "worst mark" column (>= 3, WCAG's large-text/graphics floor).
- The wave X steel sign is no longer rendered on the page (wave Z replaced it by the race/sub-race chips), so it is not themed.
`;
  await Deno.mkdir("docs/wave-theme", { recursive: true });
  await Deno.writeTextFile("docs/wave-theme/THEME.md", doc);
  console.log("wrote docs/wave-theme/THEME.md");
}
