// FxRecipes + FxDirector: every skill gets an effect, sized from its own
// parameters, served from a fixed pool (lane D, R05). Runs headless: three's
// geometry and material classes need no WebGL context.

// @deno-types="@types/three"
import * as THREE from "three";
import { ALL_SKILLS, type Skill, type SkillKind } from "../src/game/Skills.ts";
import { lungeAt } from "../src/game/AnimationCurve.ts";
import { generateClassWeapon } from "../src/game/WeaponGen.ts";
import { CLASSES } from "../src/game/Stats.ts";
import {
  ARRIVAL_SHARE,
  arrivalFraction,
  bladeSpan,
  envelope,
  FX_RECIPES,
  fxIntensity,
  GHOST_COUNT_MAX,
  GHOST_COUNT_MIN,
  hasLayer,
  MIN_TRAIL_BASE_SHARE,
  recipeForKind,
  ROSTER_RANGES,
  skillMetrics,
} from "../src/graphics/fx/FxRecipes.ts";
import { FxDirector } from "../src/graphics/fx/FxDirector.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const KINDS: readonly SkillKind[] = ["dash", "power", "defense"];

Deno.test("every skill kind in Skills.ts maps to a recipe with layers", () => {
  const seen = new Set<SkillKind>(ALL_SKILLS.map((s) => s.kind));
  for (const k of KINDS) seen.add(k);
  for (const kind of seen) {
    const r = recipeForKind(kind);
    assert(r && r.layers.length > 0, `kind ${kind} has a non-empty recipe`);
    assert(FX_RECIPES[kind] === r, `kind ${kind} resolves through FX_RECIPES`);
  }
  for (const s of ALL_SKILLS) assert(recipeForKind(s.kind).layers.length > 0, `skill ${s.id} has an effect`);
  // The brief's minimum per kind.
  for (const l of ["telegraph", "bodyTrail", "afterimages"] as const) assert(hasLayer(FX_RECIPES.dash, l), `dash draws ${l}`);
  for (const l of ["weaponTrail", "impactRing"] as const) assert(hasLayer(FX_RECIPES.power, l), `power draws ${l}`);
  assert(hasLayer(FX_RECIPES.defense, "shieldArc"), "defense draws the shield arc");
  let threw = false;
  try {
    recipeForKind("teleport" as SkillKind);
  } catch {
    threw = true;
  }
  assert(threw, "an unknown kind fails loudly instead of drawing nothing");
});

Deno.test("intensities are derived from skill parameters, not constants", () => {
  for (const s of ALL_SKILLS) {
    const I = fxIntensity(s);
    assert(I.ghostCount >= GHOST_COUNT_MIN && I.ghostCount <= GHOST_COUNT_MAX, `${s.id}: ghosts ${I.ghostCount} in 3..5`);
    assert(I.speedLineCount >= 4 && I.speedLineCount <= 10, `${s.id}: speed lines ${I.speedLineCount}`);
    assert(I.brightness > 0 && I.brightness <= 1, `${s.id}: brightness ${I.brightness} <= 1 (hue stays dominant)`);
    assert(I.trailLifetime > Math.max(I.travelTime, I.strikeTime), `${s.id}: trail outlives the travel`);
    assert(I.windUp === I.strikeTime && I.windUp > 0, `${s.id}: telegraph lands with the hit`);
    assert(I.telegraphWidth > 0 && I.ringRadius > 0 && I.shieldRadius > 0, `${s.id}: positive sizes`);
    for (const k of ["speedN", "damageN", "knockbackN", "armourN", "glowN"] as const) {
      assert(I[k] >= 0 && I[k] <= 1, `${s.id}: ${k} normalised`);
    }
  }
  // Extremes of the roster hit the ends of the derived ranges.
  const dashes = ALL_SKILLS.filter((s) => s.kind === "dash");
  const bySpeed = [...dashes].sort((a, b) => skillMetrics(a).speed - skillMetrics(b).speed);
  assert(skillMetrics(bySpeed.at(-1)!).speed === ROSTER_RANGES.speed.max, "the fastest dash is the roster's fastest skill");
  assert(fxIntensity(bySpeed.at(-1)!).ghostCount === GHOST_COUNT_MAX, "fastest dash leaves the most ghosts");
  // Monotonic: more damage -> bigger power ring; more armour -> more opaque shield.
  const monotonic = (skills: Skill[], key: (s: Skill) => number, out: (s: Skill) => number, label: string) => {
    const sorted = [...skills].sort((a, b) => key(a) - key(b));
    for (let i = 1; i < sorted.length; i++) {
      assert(out(sorted[i]) >= out(sorted[i - 1]) - 1e-12, `${label}: ${sorted[i - 1].id} -> ${sorted[i].id}`);
    }
  };
  monotonic(ALL_SKILLS.filter((s) => s.kind === "power"), (s) => s.payload.damageMul, (s) => fxIntensity(s).ringRadius, "ring grows with damage");
  monotonic(ALL_SKILLS.filter((s) => s.kind === "defense"), (s) => s.payload.armorMul ?? 1, (s) => fxIntensity(s).shieldOpacity, "shield opacity grows with armour");
  monotonic(dashes, (s) => skillMetrics(s).speed, (s) => fxIntensity(s).ghostCount, "ghosts grow with speed");
  // Body scale: decal widths scale with the fighter's height.
  const s0 = dashes[0];
  const small = fxIntensity(s0, 1.2), tall = fxIntensity(s0, 2.4);
  assert(Math.abs(tall.telegraphWidth / small.telegraphWidth - 2) < 1e-9, "telegraph width is proportional to height");
});

Deno.test("arrival is read off lungeAt and the envelope rises, holds and falls", () => {
  for (const s of ALL_SKILLS) {
    const a = arrivalFraction(s.animation);
    if (s.animation.lunge === 0) {
      assert(a === s.animation.hitAt, `${s.id}: no lunge -> arrives at the hit frame`);
      continue;
    }
    const goal = ARRIVAL_SHARE * Math.abs(s.animation.lunge);
    assert(Math.abs(lungeAt(s.animation, a)) >= goal, `${s.id}: covered 98% at the arrival fraction`);
    assert(Math.abs(lungeAt(s.animation, a - 0.005)) < goal, `${s.id}: not earlier than one search step`);
  }
  assert(envelope(0, 0, 1, Infinity, 1) === 0 && envelope(1, 0, 1, Infinity, 1) === 1, "rises over `rise`");
  assert(envelope(5, 0, 1, 4, 1) === 0 && envelope(4, 0, 1, 4, 1) === 1, "falls over `fall` after `stop`");
});

Deno.test("the weapon trail spans the striking parts and stays off the fist", () => {
  for (const c of CLASSES) {
    const w = generateClassWeapon(c);
    const span = bladeSpan(w.parts);
    assert(span.tip > 0 && span.base < span.tip, `${c} (${w.params.type}): base ${span.base} < tip ${span.tip}`);
    assert(span.base >= span.tip * MIN_TRAIL_BASE_SHARE - 1e-9, `${c}: base is at least 35% out along the weapon`);
  }
});

/** A fighter stand-in: position + a weapon node that the test swings. */
interface Dummy {
  body: THREE.Vector3;
  weapon: THREE.Object3D;
}

function makeDummy(scene: THREE.Scene, x: number): Dummy {
  const holder = new THREE.Group();
  holder.position.set(x, 0.6, 0);
  const weapon = new THREE.Object3D();
  holder.add(weapon);
  scene.add(holder);
  return { body: holder.position, weapon };
}

Deno.test("director: every skill draws, fades to zero draw calls, and never grows the pool", () => {
  const scene = new THREE.Scene();
  const director = new FxDirector<Dummy>(scene);
  const a = makeDummy(scene, -2.5), b = makeDummy(scene, 2.5);
  const parts = generateClassWeapon("Warrior").parts;
  director.attach(a, { element: "fire", height: 1.7, weaponNode: a.weapon, weaponParts: parts });
  director.attach(b, { element: "shadow", height: 1.8, weaponNode: b.weapon, weaponParts: parts });
  const objectsBefore = countObjects(director.root);
  let threw = false;
  try {
    director.attach({ body: new THREE.Vector3(), weapon: new THREE.Object3D() }, { element: "fire" });
  } catch {
    threw = true;
  }
  assert(threw, "a third fighter exceeds the 2-slot pool");

  const dt = 1 / 60;
  let now = 10;
  for (const skill of ALL_SKILLS) {
    a.body.set(-2.5, 0.6, 0);
    const origin = a.body.clone(), aim = b.body.clone();
    director.beginSkill(a, skill, origin, aim, now, 1);
    const anim = skill.animation;
    let peakCalls = 0, peakTris = 0, sawRing = false, sawTrail = false, sawShield = false;
    for (let t = 0; t < anim.duration + 1.5; t += dt) {
      now += dt;
      const u = Math.min(1, t / anim.duration);
      // Move along the lunge like Engine.#skillTick, and swing the weapon 3 rad over the strike.
      a.body.x = origin.x + lungeAt(anim, u);
      a.weapon.rotation.x = -3 * Math.min(1, u / Math.max(0.05, anim.hitAt));
      if (t >= anim.duration) director.endSkill(a, now);
      director.update(a, now, a.body, Math.PI / 2, 0);
      director.update(b, now, b.body, -Math.PI / 2, 0);
      const c = director.cost();
      peakCalls = Math.max(peakCalls, c.drawCalls);
      peakTris = Math.max(peakTris, c.triangles);
      sawRing ||= scanVisible(director.root, "fx-ring");
      sawTrail ||= scanVisible(director.root, "fx-ribbon-trail");
      sawShield ||= scanVisible(director.root, "fx-shield");
    }
    assert(peakCalls > 0 && peakTris > 0, `${skill.id}: drew something (${peakCalls} calls, ${peakTris} tris)`);
    if (skill.kind !== "defense") assert(sawTrail, `${skill.id}: a ribbon trail appeared`);
    assert(sawRing, `${skill.id}: an impact / arrival / bracing ring fired`);
    if (skill.kind === "defense") assert(sawShield, `${skill.id}: the shield arc rose`);
    const after = director.cost();
    assert(after.drawCalls === 0 && after.triangles === 0, `${skill.id}: everything faded (${after.drawCalls} calls left)`);
  }
  assert(countObjects(director.root) === objectsBefore, "no object was created by 24 skill uses (pooled)");
  director.detach(b);
  director.attach({ body: new THREE.Vector3(), weapon: new THREE.Object3D() }, { element: "holy" });
  director.dispose();
  assert(director.root.parent === null, "dispose detaches the root");
});

Deno.test("director: a dash telegraph fills to the landing point by the hit frame", () => {
  const scene = new THREE.Scene();
  const director = new FxDirector<Dummy>(scene);
  const a = makeDummy(scene, -2.5), b = makeDummy(scene, 2.5);
  director.attach(a, { element: "fury", height: 1.7 });
  director.attach(b, { element: "fire", height: 1.7 });
  const dash = ALL_SKILLS.find((s) => s.id === "barbarian-charge")!;
  const I = director.beginSkill(a, dash, a.body.clone(), b.body.clone(), 0, 1)!;
  const charge = director.chargeOf(a)!;
  let fillAtHit = 0, ghosts = 0;
  for (let t = 0; t <= dash.animation.duration; t += 1 / 120) {
    a.body.x = -2.5 + lungeAt(dash.animation, t / dash.animation.duration);
    director.update(a, t, a.body, Math.PI / 2, 0);
    if (t <= I.windUp) fillAtHit = charge.telegraphFill;
    ghosts = charge.ghostsSpawned;
  }
  assert(fillAtHit > 0.97, `telegraph ~full at the hit frame, got ${fillAtHit.toFixed(3)}`);
  assert(ghosts === I.ghostCount, `dropped exactly ${I.ghostCount} ghosts, got ${ghosts}`);
  director.dispose();
});

function scanVisible(root: THREE.Object3D, name: string): boolean {
  let found = false;
  root.traverse((o: THREE.Object3D) => {
    if (o.name === name && o.visible && (o.parent?.visible ?? true)) found = true;
  });
  return found;
}

function countObjects(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}

Deno.test("cost per active effect stays inside a small budget (peak per recipe, one fighter)", () => {
  const scene = new THREE.Scene();
  const director = new FxDirector<Dummy>(scene);
  const a = makeDummy(scene, -2.5), b = makeDummy(scene, 2.5);
  director.attach(a, { element: "fire", height: 1.7, weaponNode: a.weapon, weaponParts: generateClassWeapon("Warrior").parts });
  director.attach(b, { element: "fire", height: 1.7 });
  const rows: string[] = [];
  let now = 0;
  for (const kind of KINDS) {
    let peakCalls = 0, peakTris = 0, worst = "";
    for (const skill of ALL_SKILLS.filter((s) => s.kind === kind)) {
      a.body.set(-2.5, 0.6, 0);
      const origin = a.body.clone();
      director.beginSkill(a, skill, origin, b.body, now, 1);
      for (let t = 0; t < skill.animation.duration + 1.5; t += 1 / 60) {
        now += 1 / 60;
        const u = Math.min(1, t / skill.animation.duration);
        a.body.x = origin.x + lungeAt(skill.animation, u);
        a.weapon.rotation.x = -3 * Math.min(1, u / Math.max(0.05, skill.animation.hitAt));
        if (t >= skill.animation.duration) director.endSkill(a, now);
        director.update(a, now, a.body, Math.PI / 2, 0);
        const c = director.cost();
        if (c.drawCalls > peakCalls || c.triangles > peakTris) worst = skill.id;
        peakCalls = Math.max(peakCalls, c.drawCalls);
        peakTris = Math.max(peakTris, c.triangles);
      }
    }
    rows.push(`${kind.padEnd(8)} peak draw calls ${String(peakCalls).padStart(2)}  peak triangles ${String(peakTris).padStart(4)}  (${worst})`);
    assert(peakCalls <= 12, `${kind}: <= 12 draw calls per fighter, got ${peakCalls}`);
    assert(peakTris <= 1200, `${kind}: <= 1200 triangles per fighter, got ${peakTris}`);
  }
  console.log("\n" + rows.join("\n"));
  director.dispose();
});
