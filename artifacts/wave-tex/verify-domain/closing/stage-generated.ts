// QD closing: how often the CURRENT stage text misdescribes a GENERATED scar (same 2000-seed design as tools/verify-wave-tex-domain.ts).
import { defaultMarks } from "../../../../src/graphics/paint/marks/MarkLibrary.ts";
import { scarStageText, scarFlags } from "../../../../src/ui/MarkEdit.ts";
import { scarLook, hypertrophicActivity } from "../../../../src/graphics/paint/marks/Scar.ts";
const races: [string, string][] = [["human", "imperial"], ["human", "islander"], ["elf", "high"], ["elf", "dark"], ["dwarf", "mountain"], ["dwarf", "forge"], ["ork", "greenhide"], ["ork", "bloodfang"]];
const classes = ["Warrior", "Barbarian", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"];
const signs = ["void", "mountain", "flame", "moon", "storm", "serpent"];
const LIFE: Record<string, number> = { human: 80, elf: 700, dwarf: 300, ork: 55 };
let n = 0; const bad: Record<string, number> = {}; const ex: any[] = []; let keloid = 0, hypActive = 0; const over: Record<string, number> = {}; const overEx: any[] = []; let flatRaisedWords = 0;
for (let s = 0; s < 2000; s++) {
  const [race, subrace] = races[s % races.length];
  const input: any = { race, subrace, className: classes[(s >> 3) % 8], birthsign: signs[(s * 7) % 6], ageYears: Math.round(LIFE[race] * [0.25, 0.35, 0.5, 0.7, 0.85][s % 5]), seed: s * 2654435761 >>> 0 };
  for (const sc of defaultMarks(input).scars) {
    n++;
    const f = scarFlags(sc as any, race, subrace), L = scarLook(sc.kind, sc.ageDays, f.keloid, f.hypertrophic), t = scarStageText(sc.ageDays, f);
    if (f.keloid) keloid++; if (f.hypertrophic && hypertrophicActivity(sc.ageDays) >= 0.1) hypActive++;
    // A text is WRONG when it says 'fading' or 'pale, flat' on a scar that is raised >= 0.3 mm by keloid/hypertrophic pathology.
    const raisedByPath = (f.keloid || f.hypertrophic) && L.heightMm >= 0.3;
    if (raisedByPath && /fading|pale, flat/.test(t)) { const k = `${f.keloid ? "keloid" : "hypertrophic"} '${t}'`; bad[k] = (bad[k] ?? 0) + 1; if (ex.length < 6) ex.push({ race, kind: sc.kind, ageDays: sc.ageDays, ...f, heightMm: +L.heightMm.toFixed(2), redness: +L.redness.toFixed(2), text: t }); }
    // Over-claim: text says 'raised' on a scar drawn < 0.1 mm high.
    if (/raised/.test(t) && L.heightMm < 0.1) { const k = `${f.keloid ? "keloid" : "hypertrophic"} '${t}'`; over[k] = (over[k] ?? 0) + 1; if (overEx.length < 6) overEx.push({ race, kind: sc.kind, ageDays: sc.ageDays, ...f, heightMm: +L.heightMm.toFixed(3), text: t }); }
    if (/raised/.test(t)) flatRaisedWords++;
  }
}
const out = { scars: n, keloid, hypertrophicActive: hypActive, wrongText: bad, wrongTotal: Object.values(bad).reduce((a, b) => a + b, 0), examples: ex, raisedWords: flatRaisedWords, overClaim: over, overClaimTotal: Object.values(over).reduce((a, b) => a + b, 0), overClaimExamples: overEx };
console.log(JSON.stringify(out, null, 1));
Deno.writeTextFileSync(new URL("./stage-generated.json", import.meta.url), JSON.stringify(out, null, 1));
