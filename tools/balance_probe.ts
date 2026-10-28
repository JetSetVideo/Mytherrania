// Balance probe: expected damage per second per archetype through combat/Impact.ts, with
// randomised contacts (feature by the weapon's own features, alignment, speed, zone), against
// light (0.2) and heavy (0.65) armour. Run: deno run --allow-read balance_probe.ts
import { ARCHETYPE_IDS } from "../src/game/weapons/Archetypes.ts";
import { weaponFromArchetype } from "../src/game/weapons/Generate.ts";
import { combatProfile } from "../src/game/weapons/Profile.ts";
import { resolveImpact } from "../src/combat/Impact.ts";
import { rng32, summarize } from "../src/core/MathCore.ts";
import type { Contact, HitZone, Hitbox } from "../src/combat/contracts.ts";

// Surface-weighted zones (rough share of a standing body's hittable surface).
const ZONES: [HitZone, number][] = [["head", 0.08], ["neck", 0.03], ["chest", 0.2], ["abdomen", 0.12], ["pelvis", 0.07],
  ["upperArm", 0.1], ["foreArm", 0.08], ["hand", 0.04], ["thigh", 0.15], ["shin", 0.1], ["foot", 0.03]];
function pickZone(r: () => number): HitZone {
  let u = r();
  for (const [z, w] of ZONES) { if ((u -= w) <= 0) return z; }
  return "chest";
}
const EFF = { cut: [] as number[], thrust: [] as number[], blunt: [] as number[] };
const rows: { id: string; cls: string; light: number; heavy: number }[] = [];
for (const id of ARCHETYPE_IDS) {
  if (id === "bow") continue; // ranged: no melee contact model yet
  for (const armour of [0.2, 0.65]) {
    const dps: number[] = [];
    for (let k = 0; k < 40; k++) {
      const spec = weaponFromArchetype(id, rng32(1000 + k));
      const prof = combatProfile(spec);
      const r = rng32(7 + k * 31);
      let total = 0;
      const N = 400;
      for (let i = 0; i < N; i++) {
        const fi = Math.floor(r() * spec.features.length);
        const f = spec.features[fi];
        const zone = pickZone(r);
        const hb: Hitbox = { zone, side: "C", bone: "x", a: [0, 0, 0], b: [0, 0.3, 0], radius: 0.1, wa: [0, 1, 0], wb: [0, 1.3, 0] };
        const speed = 6 + r() * 8;
        const ang = r() * 0.9; // 0..~52° from the normal
        const align = 0.55 + r() * 0.45;
        const local = f.points[Math.min(f.points.length - 1, Math.floor(r() * f.points.length))];
        const c: Contact = {
          hitbox: hb, feature: f.kind, point: [0, 1.1, 0], normal: [0, 0, -1],
          velocity: [speed * Math.sin(ang), 0, speed * Math.cos(ang)], t: 0.5,
          edgeAlignment: f.kind === "edge" ? align : 0, thrustAlignment: f.kind === "point" ? align : 0,
          local, featureIndex: fi,
        } as Contact;
        const res = resolveImpact({
          contact: c, weapon: spec, profile: prof, handsUsed: spec.hands === 2 ? 2 : 1,
          attacker: { mass: 80, strength: 6, attackPower: 1, velocity: [0, 0, 0] },
          defender: { mass: 80, armour, blocking: false, balance: 0.5, velocity: [0, 0, 0] }, rng: r,
        });
        total += res.damage;
        const m = /delivery cut ([0-9.]+) thrust ([0-9.]+) blunt ([0-9.]+)/.exec(res.notes.join(' '));
        if (m) { const mix = f.mix; if (mix.cut > 0.5) EFF.cut.push(+m[1]); if (mix.thrust > 0.5) EFF.thrust.push(+m[2]); if (mix.blunt > 0.5) EFF.blunt.push(Math.min(1.15, +m[3])); }
      }
      dps.push(total / N / prof.cooldown);
    }
    const m = summarize(dps).mean;
    const row = rows.find((x) => x.id === id) ?? (rows.push({ id, cls: weaponFromArchetype(id, rng32(1)).weaponClass, light: 0, heavy: 0 }), rows[rows.length - 1]);
    if (armour < 0.5) row.light = m; else row.heavy = m;
  }
}
const all = rows.flatMap((r) => [r.light, r.heavy]);
const s = summarize(all);
console.log("archetype     class     DPS@armour0.2  DPS@armour0.65  (relative to the overall mean)");
for (const r of rows) console.log(`${r.id.padEnd(12)}  ${r.cls.padEnd(8)}  ${(r.light / s.mean).toFixed(2).padStart(6)}         ${(r.heavy / s.mean).toFixed(2).padStart(6)}`);
console.log(`spread max/min: ${(s.max / s.min).toFixed(2)}  (min ${(s.min / s.mean).toFixed(2)}, max ${(s.max / s.mean).toFixed(2)})`);

console.log("mean efficiency by kind (reference contacts):", Object.fromEntries(Object.entries(EFF).map(([k, v]) => [k, v.length ? +summarize(v).mean.toFixed(3) : null])));
