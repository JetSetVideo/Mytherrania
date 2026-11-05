// QC: U/F healing-stage words (QD Z-121) vs M's drawn look on generated scars + a fixed age matrix.
import { defaultMarks } from "../../../../src/graphics/paint/marks/MarkLibrary.ts";
import { resolveHypertrophic, resolveKeloid, scarLook, SCAR_KINDS } from "../../../../src/graphics/paint/marks/Scar.ts";
import { scarFlags, scarStageText } from "../../../../src/ui/MarkEdit.ts";
const races = ["human", "elf", "dwarf", "ork"], classes = ["Barbarian", "Warrior", "Rogue", "Mage"];
let scars = 0, matureWords = 0, wrongMature = 0, keloids = 0, keloidWords = 0, hypAct = 0, hypWords = 0, youngRaisedAgeWords = 0;
const ex: string[] = [];
for (let k = 0; k < 400; k++) {
  const race = races[k % 4];
  const set = defaultMarks({ race, subrace: null, className: classes[(k >> 2) % 4], ageYears: 20 + (k % 7) * 30, seed: 9000 + k, heightM: 1.75 } as any);
  for (const s of set.scars ?? []) {
    scars++;
    const fl = scarFlags(s as any, race, null);
    const kel = resolveKeloid(s as any, race, null), hyp = resolveHypertrophic(s as any, race, null, kel);
    if (fl.keloid !== kel || fl.hypertrophic !== hyp) ex.push(`flags mismatch ${race} ${s.kind}`);
    const look: any = scarLook(s.kind as any, s.ageDays, kel, hyp);
    const h = look.heightMm ?? look.height ?? 0;
    const t = scarStageText(s.ageDays, fl);
    if (t.startsWith("mature")) { matureWords++; if (h > 0.1) { wrongMature++; if (ex.length < 4) ex.push(`${race} ${s.kind} ${s.ageDays}d kel ${kel} hyp ${hyp} h ${h.toFixed(2)} -> '${t}'`); } }
    if (kel) { keloids++; if (t.startsWith("keloid")) keloidWords++; else if (h > 0.1 && ex.length < 6) { youngRaisedAgeWords++; ex.push(`young keloid ${race} ${s.kind} ${s.ageDays}d h ${h.toFixed(2)} -> '${t}'`); } }
    if (hyp && h > 0.1) { hypAct++; if (t.includes("raised")) hypWords++; }
  }
}
console.log(`generated scars ${scars} (400 characters); 'mature' words ${matureWords}, of which drawn raised > 0.1 mm: ${wrongMature}`);
console.log(`keloids ${keloids}: keloid words ${keloidWords}; raised hypertrophic ${hypAct}: 'raised' words ${hypWords}`);
console.log(`examples: ${ex.join(" | ") || "none"}`);
// age matrix
const rows: string[] = [];
for (const a of [10, 60, 200, 364, 365, 400, 600, 800, 3650]) {
  const look = (k: boolean, h: boolean) => { const l: any = scarLook("laceration", a, k, h); return (l.heightMm ?? l.height ?? 0).toFixed(2); };
  rows.push(`${a}d plain '${scarStageText(a)}' h${look(false, false)} | hyp '${scarStageText(a, { hypertrophic: true })}' h${look(false, true)} | keloid '${scarStageText(a, { keloid: true })}' h${look(true, false)}`);
}
console.log(rows.join("\n"));
void SCAR_KINDS;
