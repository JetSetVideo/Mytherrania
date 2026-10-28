// Which side is wrong: does applyInfluences move the right way when ALL of an axis's
// influencers agree? The failing test sets only ONE of chest.z's two influencers.
import { applyInfluences, resolvePartAxis } from "../src/game/RaceGenes.ts";
import genes from "../artifacts/design/race-genes.json" with { type: "json" };

const g = genes as unknown as {
  parts: Record<string, { influences: { part: string; axis: string; weight: number; sign: number }[] }>;
  races: Record<string, { parts: Record<string, { axis: Record<string, { min: number; max: number }> }> }>;
};

for (const race of ["human", "elf", "dwarf", "ork"]) {
  for (const part of ["chest", "neck", "upperArm"]) {
    const base = resolvePartAxis(part, "z", race);
    const baseC = (base.min + base.max) / 2;
    const ins = g.parts[part].influences.filter((i) => i.axis === "z");
    if (!ins.length) continue;
    // Push every z-influencer to its own maximum, so they agree on direction.
    const vals: Record<string, Record<string, number>> = {};
    for (const i of ins) {
      const n = g.races[race].parts[i.part]?.axis[i.axis];
      if (n) vals[i.part] = { [i.axis]: n.max };
    }
    const one = applyInfluences(part, "z", { [ins[0].part]: { z: (g.races[race].parts[ins[0].part]?.axis.z ?? { max: baseC }).max } }, race);
    const all = applyInfluences(part, "z", vals, race);
    const cOne = (one.min + one.max) / 2 - baseC;
    const cAll = (all.min + all.max) / 2 - baseC;
    console.log(`${race}/${part}.z influencers=${ins.map((i) => `${i.part}(w${i.weight},s${i.sign})`).join(",")}`);
    console.log(`   base=${baseC.toFixed(4)}  one-influencer shift=${cOne >= 0 ? "+" : ""}${cOne.toFixed(4)}  all-max shift=${cAll >= 0 ? "+" : ""}${cAll.toFixed(4)}`);
  }
}
