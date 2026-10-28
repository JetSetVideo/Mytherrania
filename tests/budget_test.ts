import { assessBudget } from "../tools/budget.ts";
Deno.test("frame budget refuses unsupported, empty and over-budget GPU/CPU data", () => {
  for (
    const [cpu, gpu, supported] of [[[], [], true], [[1], [1], false], [[17], [1], true], [[1], [
      17,
    ], true]] as [number[], number[], boolean][]
  ) {
    if (assessBudget(cpu, gpu, supported).pass) throw Error("invalid timing passed");
  }
  if (!assessBudget([1, 2], [2, 3], true).pass) throw Error("valid timing failed");
});
