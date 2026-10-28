import { allTensors, classTensors, powerTensor } from "../src/game/AnimTensor.ts";
import { skillsForClass } from "../src/game/Skills.ts";
import { CLASSES } from "../src/game/Stats.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

Deno.test("every class produces a tensor for all three powers", () => {
  for (const c of CLASSES) {
    const t = classTensors(c);
    assert(t.length === 3, `${c} should have 3 power tensors, got ${t.length}`);
    const kinds = t.map((x) => x.kind).sort();
    assert(kinds.join(",") === "dash,defense,power", `${c} has dash/power/defense`);
  }
});

Deno.test("each tensor reports finite min/max angles and cos/sin/tan bounds", () => {
  for (const t of allTensors()) {
    for (const j of t.joints) {
      assert(Number.isFinite(j.minAngle) && Number.isFinite(j.maxAngle), `${t.skill}.${j.joint} angles finite`);
      assert(j.maxAngle >= j.minAngle, `${t.skill}.${j.joint} max >= min`);
      assert(Number.isFinite(j.minCos) && Number.isFinite(j.maxCos), "cos finite");
      assert(Number.isFinite(j.minSin) && Number.isFinite(j.maxSin), "sin finite");
      assert(Number.isFinite(j.minTan) && Number.isFinite(j.maxTan), "tan finite");
      assert(j.maxCos >= j.minCos && j.maxSin >= j.minSin, "cos/sin ordered");
      assert(j.travel >= 0, "travel non-negative");
    }
  }
});

Deno.test("every power sweeps a meaningful arc and the prime joint is the weapon arm or spine", () => {
  for (const c of CLASSES) {
    const t = classTensors(c);
    const power = t.find((x) => x.kind === "power")!;
    assert(power.maxTravel > 1.0, `${c}: power strike should sweep meaningfully, got ${power.maxTravel.toFixed(2)} rad`);
    // The prime joint of a power strike is the weapon arm or the torso driving it.
    assert(["shoulderR", "shoulderL", "spine", "elbowR"].includes(power.primeJoint!), `${c}: prime joint ${power.primeJoint} should be the arm or spine`);
  }
});

Deno.test("the prime joint is the one with the largest travel and is named", () => {
  const power = skillsForClass("Warrior").find((s) => s.kind === "power")!;
  const t = powerTensor("Warrior", power);
  assert(t.primeJoint !== null, "a prime joint is named");
  const prime = t.joints.find((j) => j.joint === t.primeJoint)!;
  assert(prime.travel === t.maxTravel, "prime joint has the max travel");
  assert(t.maxTravel > 0.5, `a Warrior power strike sweeps meaningfully, got ${t.maxTravel.toFixed(2)} rad`);
});

Deno.test("the full envelope covers 8 classes x 3 powers = 24 tensors", () => {
  assert(allTensors().length === 24, `expected 24, got ${allTensors().length}`);
});
