import { materialAt, surfaceFor } from "../src/game/Terrain.ts";
import { type GroundMaterial } from "../src/game/Terrain.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("each ground material has distinct movement modifiers", () => {
  const ice = surfaceFor("ice");
  const sand = surfaceFor("sand");
  const stone = surfaceFor("stone");
  assert(ice.speed > stone.speed, "ice is faster (slippery)");
  assert(sand.speed < stone.speed, "sand slows you");
  assert(ice.turn < stone.turn, "ice hampers turning");
  assert(ice.stop > stone.stop, "ice slides longer before stopping");
  assert(sand.stop < stone.stop, "sand stops you quickly");
});

Deno.test("materialAt zones the ring from stone centre to ice rim", () => {
  assert(materialAt(0, 0, 6) === "stone", "centre is stone");
  assert(materialAt(3, 0, 6) === "wood", "mid-ring is wood");
  assert(materialAt(4.2, 0, 6) === "sand", "outer ring is sand");
  assert(materialAt(5.5, 0, 6) === "ice", "rim is ice");
});

Deno.test("all four materials resolve to a surface", () => {
  for (const m of ["stone", "sand", "ice", "wood"] as GroundMaterial[]) {
    const s = surfaceFor(m);
    assert(s.speed > 0 && s.turn > 0 && s.stop > 0, `${m} has positive modifiers`);
    assert(s.step === m, `${m} step sound id matches`);
  }
});
