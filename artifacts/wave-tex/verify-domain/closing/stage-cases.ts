import { scarStageText } from "../../../../src/ui/MarkEdit.ts";
import { scarLook, scarStage, scarStageOf, hypertrophicActivity } from "../../../../src/graphics/paint/marks/Scar.ts";
const cases: [string, number, boolean, boolean][] = [
  ["ordinary mature 400d", 400, false, false], ["ordinary 3000d", 3000, false, false], ["ordinary 30d", 30, false, false], ["ordinary 120d", 120, false, false],
  ["hypertrophic 30d", 30, false, true], ["hypertrophic 60d", 60, false, true], ["hypertrophic 4 months (120d)", 120, false, true], ["hypertrophic 200d", 200, false, true],
  ["hypertrophic 300d", 300, false, true], ["hypertrophic 400d", 400, false, true], ["hypertrophic 548d", 548, false, true], ["hypertrophic 600d", 600, false, true],
  ["hypertrophic regressed 3y (1095d)", 1095, false, true],
  ["keloid fresh 10d", 10, true, false], ["keloid 21d", 21, true, false], ["keloid 60d", 60, true, false], ["hypertrophic 21d", 21, false, true], ["hypertrophic 10d", 10, false, true], ["keloid 6 months (180d)", 180, true, false], ["keloid 300d", 300, true, false], ["keloid 2y (730d)", 730, true, false], ["keloid 10y", 3650, true, false],
];
const rows: any[] = [];
for (const [name, a, k, h] of cases) {
  const L = scarLook("laceration", a, k, h);
  rows.push({ name, ageDays: a, keloid: k, hypertrophic: h, ageStage: scarStage(a), shownStage: scarStageOf(a, k, h), activity: +hypertrophicActivity(a).toFixed(3),
    heightMm: +L.heightMm.toFixed(3), redness: +L.redness.toFixed(3), lift: +L.lift.toFixed(3), desat: +L.desat.toFixed(3), text: scarStageText(a, { keloid: k, hypertrophic: h }) });
}
console.table(rows.map(r => ({ case: r.name, stage: r.shownStage, act: r.activity, h: r.heightMm, red: r.redness, lift: r.lift, text: r.text })));
Deno.writeTextFileSync(new URL("./stage-cases.json", import.meta.url), JSON.stringify(rows, null, 1));
