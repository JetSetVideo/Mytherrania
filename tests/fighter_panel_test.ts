// FighterPanel's pure model: bars are total and ordered; the identity line names the sub-race.
import { barModel, identityLine } from "../src/ui/FighterPanel.ts";

function assert(ok: unknown, m = "assertion failed"): asserts ok { if (!ok) throw new Error(m); }

Deno.test("barModel: nominal over potential, fractions of the capacity", () => {
  const m = barModel({ nominal: 300, potential: 800, max: 1000 });
  assert(m.nominal === 0.3 && m.potential === 0.8 && m.text === "300 / 800", JSON.stringify(m));
  const full = barModel({ nominal: 1000, potential: 1000, max: 1000 });
  assert(full.nominal === 1 && full.potential === 1, "full");
});

Deno.test("barModel: total and ordered for garbage (NaN, negative, nominal > potential > max, max 0)", () => {
  for (const nominal of [NaN, -5, 0, 50, 2000, Infinity]) for (const potential of [NaN, -1, 0, 40, 5000]) for (const max of [NaN, -3, 0, 100]) {
    const m = barModel({ nominal, potential, max });
    assert(Number.isFinite(m.nominal) && Number.isFinite(m.potential), "finite");
    assert(m.nominal >= 0 && m.potential <= 1 && m.nominal <= m.potential, `ordered ${JSON.stringify([nominal, potential, max, m])}`);
    assert(!m.text.includes("NaN") && !m.text.includes("Infinity"), m.text);
  }
});

Deno.test("identityLine: race · sub-race · class · level", () => {
  assert(identityLine({ race: "Human", subrace: "Nomad", className: "Warrior", level: 3 }) === "Human · Nomad · Warrior · Lv 3", "with sub-race");
  assert(identityLine({ race: "Elf", subrace: null, className: "Mage", level: NaN }) === "Elf · Mage · Lv 1", "without");
});
