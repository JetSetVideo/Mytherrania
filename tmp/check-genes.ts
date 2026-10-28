// Independent check of artifacts/design/race-genes.json. The authoring agent had no shell,
// so its claims were made by inspection; this recomputes them from the file itself.
import genes from "../artifacts/design/race-genes.json" with { type: "json" };

const g = genes as unknown as {
  parts: Record<string, { influences: { part: string; axis: string; weight: number; sign: number }[] }>;
  ratios: Record<string, { bounds: { min: number; max: number }; perRace: Record<string, number> }>;
  races: Record<string, { parts: Record<string, { axis: Record<string, { min: number; max: number }> }> }>;
};

const parts = Object.keys(g.parts);
const influences = Object.values(g.parts).flatMap((p) => p.influences);
const ratios = Object.keys(g.ratios);
const races = Object.keys(g.races);

console.log(`parts=${parts.length} ratios=${ratios.length} influences=${influences.length} races=${races.join("/")}`);

// 1. mutuality: if A lists B, B must list A.
const missing: string[] = [];
for (const [name, p] of Object.entries(g.parts)) {
  for (const inf of p.influences) {
    const back = g.parts[inf.part]?.influences.some((i) => i.part === name);
    if (!back) missing.push(`${name}->${inf.part}`);
  }
}
console.log(`MUTUALITY: ${missing.length === 0 ? "holds" : `BROKEN for ${missing.join(", ")}`}`);

// 2. every influence target exists, weight in (0,1], sign in {1,-1}
const bad = influences.filter((i) => !g.parts[i.part] || !(i.weight > 0 && i.weight <= 1) || (i.sign !== 1 && i.sign !== -1));
console.log(`INFLUENCE SANITY: ${bad.length === 0 ? "all valid" : `${bad.length} invalid`}`);

// 3. min < max everywhere, top level and per race
let inverted = 0;
for (const p of Object.values(g.parts) as unknown as { axis: Record<string, { min: number; max: number }> }[]) {
  for (const a of Object.values(p.axis)) if (!(a.min < a.max)) inverted++;
}
for (const r of Object.values(g.races)) {
  for (const p of Object.values(r.parts)) {
    for (const a of Object.values(p.axis)) if (!(a.min < a.max)) inverted++;
  }
}
console.log(`AXIS RANGES: ${inverted === 0 ? "all min<max" : `${inverted} inverted`}`);

// 4. THE KEY CLAIM: elf legs longest and dwarf shortest IN ABSOLUTE METRES
console.log("ABSOLUTE leg length (race central value, thigh.y then shin.y):");
const rank = races.map((r) => {
  const mid = (part: string, axis: string) => {
    const a = g.races[r].parts[part]?.axis[axis];
    return a ? (a.min + a.max) / 2 : NaN;
  };
  return { r, thigh: mid("thigh", "y"), shin: mid("shin", "y") };
});
for (const x of rank) console.log(`  ${x.r.padEnd(6)} thigh.y=${x.thigh.toFixed(4)}  shin.y=${x.shin.toFixed(4)}`);
const byThigh = [...rank].sort((a, b) => b.thigh - a.thigh).map((x) => x.r);
const byShin = [...rank].sort((a, b) => b.shin - a.shin).map((x) => x.r);
console.log(`  thigh order (longest first): ${byThigh.join(" > ")}`);
console.log(`  shin  order (longest first): ${byShin.join(" > ")}`);
const ok = byThigh[0] === "elf" && byThigh[3] === "dwarf" && byShin[0] === "elf" && byShin[3] === "dwarf";
console.log(`  CLAIM (elf longest, dwarf shortest, absolute): ${ok ? "CONFIRMED" : "REFUTED"}`);

// 5. waistToHips ordering: dwarf largest, elf smallest
const w = g.ratios.waistToHips;
if (!w) console.log("waistToHips: MISSING");
else {
  const order = Object.entries(w.perRace).sort((a, b) => b[1] - a[1]);
  console.log(`waistToHips order (largest first): ${order.map(([k, v]) => `${k}=${v}`).join(" > ")}`);
  console.log(`  CLAIM (dwarf largest, elf smallest): ${order[0][0] === "dwarf" && order[order.length - 1][0] === "elf" ? "CONFIRMED" : "REFUTED"}`);
}

// 6. every perRace ratio value inside its own bounds
const outside = ratios.filter((id) => {
  const r = g.ratios[id];
  return Object.values(r.perRace).some((v) => v < r.bounds.min || v > r.bounds.max);
});
console.log(`RATIO BOUNDS: ${outside.length === 0 ? "all perRace values in bounds" : `OUT OF BOUNDS: ${outside.join(", ")}`}`);
