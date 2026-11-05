// QD diagnosis: which generated marks carry issues when re-resolved as the game does.
import * as lib from "../../../src/graphics/paint/marks/MarkLibrary.ts";
const races: [string, string][] = [["human", "imperial"], ["human", "islander"], ["elf", "high"], ["elf", "dark"], ["dwarf", "mountain"], ["dwarf", "forge"], ["ork", "greenhide"], ["ork", "bloodfang"]];
const classes = ["Warrior", "Barbarian", "Rogue", "Assassin", "Mage", "Necromancer", "Archer", "Priest"];
const signs = ["void", "mountain", "flame", "moon", "storm", "serpent"];
const LIFE: Record<string, number> = { human: 80, elf: 700, dwarf: 300, ork: 55 };
const tally: Record<string, number> = {};
const ex: unknown[] = [];
for (let s = 0; s < 2000; s++) {
  const [race, subrace] = races[s % 8];
  const input = { race, subrace, className: classes[(s >> 3) % 8], birthsign: signs[(s * 7) % 6], ageYears: Math.round(LIFE[race] * [0.25, 0.35, 0.5, 0.7, 0.85][s % 5]), seed: s * 2654435761 >>> 0 };
  const set = lib.defaultMarks(input);
  const res = lib.resolveMarks(set, { race, subrace });
  for (const r of res.placement.report) {
    if (!r.issues.length) continue;
    const m = res.marks.find((x) => x.id === r.id) ?? null;
    const isMirror = r.id.endsWith(".m");
    const key = `${r.issues.join("+")} ${isMirror ? "mirrorCopy" : "original"} ${m?.type}/${m?.scar?.kind ?? m?.tattoo?.style}/${m?.region}`;
    tally[key] = (tally[key] ?? 0) + 1;
    if (ex.length < 4) ex.push({ s, id: r.id, issues: r.issues, anchor: m?.anchor, region: m?.region, ext: m?.extentMm });
  }
}
console.log(JSON.stringify(tally, null, 1));
console.log(JSON.stringify(ex));
