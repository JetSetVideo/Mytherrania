// QC (parent fix Z-154): stage words vs M's drawn relief, both directions.
//  wrong-flat  = a keloid/hypertrophic scar drawn raised >= 0.3 mm but the words say 'fading' or 'mature' (QD Z-141's defect)
//  wrong-raise = words say 'raised' but drawn <= 0.1 mm (over-correction)
// Over (a) 2000 generated characters (QD's seed count) and (b) every kind x flag pair x age 0..3650 d step 1.
import { defaultMarks } from "../../../../src/graphics/paint/marks/MarkLibrary.ts";
import { scarLook, SCAR_KINDS } from "../../../../src/graphics/paint/marks/Scar.ts";
import { scarFlags, scarStageText } from "../../../../src/ui/MarkEdit.ts";
const h = (k: string, a: number, kel: boolean, hyp: boolean) => { const l: any = scarLook(k as any, a, kel, hyp); return l.heightMm ?? l.height ?? 0; };
const judge = (t: string, mm: number, path = true) => ({
  flat: path && mm >= 0.3 && (t.includes("fading") || t.startsWith("mature")),
  raise: t.includes("raised") && mm <= 0.1,
});
const races = ["human", "elf", "dwarf", "ork"], classes = ["Barbarian", "Warrior", "Rogue", "Mage"];
let scars = 0, raised = 0, wf = 0, wr = 0, kelN = 0, hypN = 0;
const ex: string[] = [];
for (let k = 0; k < 2000; k++) {
  const race = races[k % 4];
  const set = defaultMarks({ race, subrace: null, className: classes[(k >> 2) % 4], ageYears: 20 + (k % 7) * 30, seed: 9000 + k, heightM: 1.75 } as any);
  for (const s of set.scars ?? []) {
    scars++;
    const fl = scarFlags(s as any, race, null);
    if (fl.keloid) kelN++;
    if (fl.hypertrophic) hypN++;
    const mm = h(s.kind, s.ageDays, fl.keloid, fl.hypertrophic);
    if (mm >= 0.3) raised++;
    const t = scarStageText(s.ageDays, fl), j = judge(t, mm, fl.keloid || fl.hypertrophic);
    if (j.flat) { wf++; if (ex.length < 6) ex.push(`FLAT ${race} ${s.kind} ${s.ageDays}d k${+fl.keloid}h${+fl.hypertrophic} ${mm.toFixed(2)}mm '${t}'`); }
    if (j.raise) { wr++; if (ex.length < 6) ex.push(`RAISE ${race} ${s.kind} ${s.ageDays}d k${+fl.keloid}h${+fl.hypertrophic} ${mm.toFixed(2)}mm '${t}'`); }
  }
}
console.log(`generated: 2000 characters, ${scars} scars (keloid ${kelN}, hypertrophic ${hypN}), drawn raised >= 0.3 mm ${raised}; wrong 'fading/mature' on raised ${wf}; 'raised' on flat (<= 0.1 mm) ${wr}`);
let mf = 0, mr = 0, cells = 0;
const mex: string[] = [];
const rx: Record<string, number[]> = {};
for (const kind of SCAR_KINDS) for (const [kel, hyp] of [[false, false], [false, true], [true, false], [true, true]] as const) {
  for (let a = 0; a <= 3650; a++) {
    cells++;
    const mm = h(kind, a, kel, hyp), t = scarStageText(a, { keloid: kel, hypertrophic: hyp }), j = judge(t, mm, kel || hyp);
    if (j.flat) { mf++; if (mex.length < 8) mex.push(`FLAT ${kind} ${a}d k${+kel}h${+hyp} ${mm.toFixed(2)}mm '${t}'`); }
    if (j.raise) { mr++; rx[`${kind} k${+kel}h${+hyp}`] = [...(rx[`${kind} k${+kel}h${+hyp}`] ?? []), a]; if (mex.length < 8) mex.push(`RAISE ${kind} ${a}d k${+kel}h${+hyp} ${mm.toFixed(2)}mm '${t}'`); }
  }
}
console.log(`matrix: ${cells} cells (6 kinds x 4 flag pairs x 0..3650 d); wrong 'fading/mature' on raised ${mf}; 'raised' on flat ${mr}`);
console.log('raised-on-flat ranges: ' + Object.entries(rx).map(([k, v]) => `${k} ${v[0]}-${v[v.length - 1]} d (${v.length})`).join('; '));
console.log(`examples: ${[...ex, ...mex].join(" | ") || "none"}`);
for (const a of [10, 20, 21, 60, 120, 180, 300, 364, 365, 400, 600, 800, 3650]) {
  console.log(`${a}d plain '${scarStageText(a)}' ${h("laceration", a, false, false).toFixed(2)} | hyp '${scarStageText(a, { hypertrophic: true })}' ${h("laceration", a, false, true).toFixed(2)} | keloid '${scarStageText(a, { keloid: true })}' ${h("laceration", a, true, false).toFixed(2)}`);
}
