// P ring review of U (Z-91): does the GAME path (P applyPresetOverrides) honour the inspector's edits like the inspector shows?
import { reorderOverride, setOverride, applyLayerOverrides as uApply } from "../../../src/ui/TexState.ts";
import { layerRowsFor, operatorChoices } from "../../../src/ui/TexSources.ts";
import { rollProfile } from "../../../src/ui/CreatorRoll.ts";
import { mulberry32 } from "../../../src/ui/Menu.ts";
import { applyPresetOverrides, presetForProfile } from "../../../src/graphics/paint/Presets.ts";
import type { LayerOverride } from "../../../src/graphics/paint/LayerStack.ts";
const out: Record<string, unknown> = {};
let orderBad = 0, orderN = 0, flagBad = 0, flagN = 0;
for (let s = 0; s < 40; s++) {
  const profile = rollProfile(mulberry32(1000 + s)).profile;
  const base = layerRowsFor(profile), preset = presetForProfile(profile);
  const r = mulberry32(5000 + s);
  for (let k = 0; k < 20; k++) {
    let ov: LayerOverride[] = [];
    const editable = base.filter((x) => !x.editLocked);
    for (let d = 0; d < 1 + Math.floor(r() * 5); d++) {
      const kind = r();
      if (kind < 0.4) { const from = Math.floor(r() * base.length), to = Math.floor(r() * base.length); if (!base[from].editLocked) ov = reorderOverride(ov, base, from, to); }
      else if (kind < 0.7) { const row = editable[Math.floor(r() * editable.length)]; ov = setOverride(ov, base, row.id, { enabled: !row.enabled }); }
      else { const row = editable[Math.floor(r() * editable.length)]; const ch = Object.keys(row.ops ?? {})[0]; if (ch) { const choices = operatorChoices(ch as never); ov = setOverride(ov, base, row.id, { channel: ch as never, op: choices[Math.floor(r() * choices.length)] }); } else ov = setOverride(ov, base, row.id, { opacity: Math.round(r() * 20) / 20 }); }
    }
    const ui = uApply(base, ov);
    const game = applyPresetOverrides(preset, ov).finish.layers;
    orderN++;
    if (ui.map((x) => x.id).join() !== game.map((l) => `p:${l.id}`).join()) orderBad++;
    for (const row of ui) {
      const g = game.find((l) => `p:${l.id}` === row.id)!;
      flagN++;
      const opOk = Object.entries(row.blend ?? {}).every(([ch, op]) => (g.override?.[ch as never] ?? g.writes[ch as never]) === op || g.writes[ch as never] === op);
      if (g.enabled !== row.enabled || Math.abs(g.opacity - row.opacity) > 1e-9 || !opOk) flagBad++;
    }
  }
}
Object.assign(out, { orderSets: orderN, orderMismatch: orderBad, rowsChecked: flagN, rowMismatch: flagBad });
console.log(JSON.stringify(out));
await Deno.writeTextFile(new URL("./p-review-U.json", import.meta.url), JSON.stringify(out, null, 1));
