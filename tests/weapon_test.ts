import { buildWeapon, weaponForClass } from "../src/game/Weapon.ts";
import { CLASSES } from "../src/game/Stats.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("every class maps to a weapon with physical axes and a grip", () => {
  const seen = new Set<string>();
  for (const c of CLASSES) {
    const w = weaponForClass(c);
    assert(w.name.length > 0, `${c} has a name`);
    assert(w.weight >= 1 && w.weight <= 10, `${c} weight in range: ${w.weight}`);
    assert(w.balance >= 0 && w.balance <= 1, `${c} balance in range`);
    assert(w.sharpness >= 0 && w.sharpness <= 1, `${c} sharpness in range`);
    assert(w.damage >= 5 && w.damage <= 20, `${c} damage derived: ${w.damage}`);
    assert(w.cooldown > 0.3 && w.cooldown < 1.6, `${c} cooldown derived`);
    assert(w.grip.scale > 0, `${c} grip scale positive`);
    assert(Number.isFinite(w.grip.rx) && Number.isFinite(w.grip.ry) && Number.isFinite(w.grip.rz), `${c} grip rotation finite`);
    seen.add(w.name);
  }
  assert(seen.size === CLASSES.length, "weapon names unique");
});

Deno.test("weight, balance and sharpness change derived combat stats", () => {
  const light = buildWeapon("sword", 2, 0.5, 0.5, "Light Sword", "#fff");
  const heavy = buildWeapon("sword", 10, 0.5, 0.5, "Heavy Sword", "#fff");
  assert(heavy.damage > light.damage, "heavier hits harder");
  assert(heavy.cooldown > light.cooldown, "heavier swings slower");
  assert(heavy.knockback > light.knockback, "heavier launches farther");

  const dull = buildWeapon("sword", 6, 0.5, 0.1, "Dull", "#fff");
  const keen = buildWeapon("sword", 6, 0.5, 1.0, "Keen", "#fff");
  assert(keen.damage > dull.damage, "sharper deals more damage");

  const hilt = buildWeapon("sword", 6, 0.0, 0.5, "Hilt", "#fff");
  const tip = buildWeapon("sword", 6, 1.0, 0.5, "Tip", "#fff");
  assert(tip.reach > hilt.reach, "tip-heavy has more reach");
});

Deno.test("different weapon types sit on different axes", () => {
  const axe = buildWeapon("axe", 8, 0.7, 0.5, "Axe", "#fff");
  const bow = buildWeapon("bow", 3, 0.4, 0.4, "Bow", "#fff");
  const staff = buildWeapon("staff", 4, 0.5, 0.3, "Staff", "#fff");
  // Bow is held sideways (rotated on z), axe raised (negative pitch), staff tall.
  assert(Math.abs(bow.grip.rz) > 1.0, "bow held sideways");
  assert(axe.grip.rx < 0, "axe raised overhead");
  assert(staff.grip.y > axe.grip.y, "staff held higher than axe");
});
