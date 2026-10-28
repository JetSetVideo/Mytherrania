// FxDirector: the ONE object the engine talks to for skill effects (R05).
//
// It owns a fixed pool of per-fighter effect slots (weapon trail, charge effect,
// ring, shield), built once at construction — using a skill allocates nothing
// after that skill's first use (its FxIntensity is cached per slot). The skill's
// KIND picks the recipe (FxRecipes.FX_RECIPES), so EVERY skill gets an effect;
// the skill's parameters size it (FxRecipes.fxIntensity).
//
// Engine contract (seconds on one monotonic game clock, metres in world space):
//   attach(fighter, setup)                once per match, after the rig is built
//   beginSkill(fighter, skill, origin, aim, now, travelScale)   in #useSkill
//   impact(fighter, now, at?)             on the skill's hit frame (optional)
//   endSkill(fighter, now)                when the skill animation is over (idempotent)
//   update(fighter, now, bodyCentre, yaw) every frame, after the rig pose is set
//   detach / clearAll / dispose           match teardown
// Basic attacks need no call: the weapon trail emits whenever the blade tip
// moves faster than SWING_SPEED.

// @deno-types="@types/three"
import * as THREE from "three";
import type { Element, Skill } from "../../game/Skills.ts";
import type { WeaponPart } from "../../game/WeaponGen.ts";
import { BODY_CENTRE_HEIGHT, ChargeFx, type ChargeShape } from "./ChargeFx.ts";
import { RingDecal, ShieldArc } from "./Decals.ts";
import { bladeSpan, type FxIntensity, fxIntensity, hasLayer, trailPalette, type TrailPalette } from "./FxRecipes.ts";
import type { Vec3Like } from "./TrailBuffer.ts";
import { BladeSampler, WeaponTrail } from "./WeaponTrail.ts";

/** The blade keeps travelling through the first quarter of the recovery after the hit frame. */
export const FOLLOW_THROUGH_SHARE = 0.25;
/** Shield height = 1.05 x standing height: it must clear the head of the fighter it guards. */
export const SHIELD_HEIGHT_SHARE = 1.05;
/** The shield fades over half the skill's recovery time, never faster than 0.15 s (~9 frames: a visible fade, not a pop). */
const SHIELD_FALL_SHARE = 0.5;
const SHIELD_FALL_MIN = 0.15;
/** Default pool size: the arena has exactly two fighters. */
export const DEFAULT_MAX_FIGHTERS = 2;

/** What the director needs to know about one fighter. */
export interface FxFighterSetup {
  /** The fighter kit's element: colours basic-attack trails until a skill says otherwise. */
  element: Element;
  /** Standing height (m) = appearance.height. Default 1.7. */
  height?: number;
  /** Body centre above the soles (m) — the engine's body.y offset. Default BODY_CENTRE_HEIGHT (0.6). */
  centreHeight?: number;
  /**
   * Weapon root Object3D (its +y is the weapon axis, grip at y = 0). With it the
   * director samples the blade itself; without it call feedBlade() each frame.
   */
  weaponNode?: THREE.Object3D | null;
  /** The generated weapon's parts: where along the weapon the ribbon sits (FxRecipes.bladeSpan). */
  weaponParts?: readonly WeaponPart[];
}

/** Draw calls and triangles (both layers summed) the effects cost this frame. */
export interface FxCost {
  drawCalls: number;
  triangles: number;
  /** Fighters with at least one visible effect. */
  activeFighters: number;
}

/** One pooled fighter slot. Every field is allocated once, at director construction. */
interface FxSlot {
  key: object | null;
  element: Element;
  height: number;
  centreHeight: number;
  palette: TrailPalette;
  readonly weapon: WeaponTrail;
  readonly sampler: BladeSampler;
  readonly charge: ChargeFx;
  readonly ring: RingDecal;
  readonly shield: ShieldArc;
  /** Per-skill sizing, filled on a skill's first use (keyed by the static Skill object). */
  readonly intensities: Map<Skill, FxIntensity>;
  readonly shapes: Map<Skill, ChargeShape>;
  skill: Skill | null;
  intensity: FxIntensity | null;
  start: number;
  ringFired: boolean;
  readonly base: THREE.Vector3;
  readonly tip: THREE.Vector3;
  readonly ground: THREE.Vector3;
  readonly target: THREE.Vector3;
}

/** Per-fighter skill effects behind one small API. `K` is the engine's fighter type. */
export class FxDirector<K extends object = object> {
  /** Root at the identity transform; holds every effect. Added to `parent` when one is given. */
  readonly root = new THREE.Group();
  readonly #slots: FxSlot[] = [];
  readonly #byKey = new Map<K, FxSlot>();

  constructor(parent: THREE.Object3D | null, options: { maxFighters?: number } = {}) {
    this.root.name = "fx-director";
    const n = Math.max(1, options.maxFighters ?? DEFAULT_MAX_FIGHTERS);
    const palette = trailPalette("fire");
    for (let i = 0; i < n; i++) {
      const slot: FxSlot = {
        key: null,
        element: "fire",
        height: 1.7,
        centreHeight: BODY_CENTRE_HEIGHT,
        palette,
        weapon: new WeaponTrail(palette),
        sampler: new BladeSampler(null, { base: 0.3, tip: 1 }),
        charge: new ChargeFx(palette),
        ring: new RingDecal(palette),
        shield: new ShieldArc(palette),
        intensities: new Map(),
        shapes: new Map(),
        skill: null,
        intensity: null,
        start: 0,
        ringFired: true,
        base: new THREE.Vector3(),
        tip: new THREE.Vector3(),
        ground: new THREE.Vector3(),
        target: new THREE.Vector3(),
      };
      this.root.add(slot.weapon.object, slot.charge.object, slot.ring.object, slot.shield.object);
      this.#slots.push(slot);
    }
    parent?.add(this.root);
  }

  /** Pool size (fighters that can be attached at once). */
  get capacity(): number {
    return this.#slots.length;
  }

  /** True when `key` holds a slot. */
  has(key: K): boolean {
    return this.#byKey.has(key);
  }

  /** The charge effect of `key`'s slot (debug overlays and tests), or null when not attached. */
  chargeOf(key: K): ChargeFx | null {
    return this.#byKey.get(key)?.charge ?? null;
  }

  /** The weapon trail of `key`'s slot (debug overlays and tests), or null when not attached. */
  weaponTrailOf(key: K): WeaponTrail | null {
    return this.#byKey.get(key)?.weapon ?? null;
  }

  /** Give `key` a pooled slot (once per match). Re-attaching an attached key re-configures it. */
  attach(key: K, setup: FxFighterSetup): void {
    let slot = this.#byKey.get(key);
    if (!slot) {
      slot = this.#slots.find((s) => s.key === null);
      if (!slot) throw new Error(`FxDirector pool exhausted (${this.#slots.length} fighters)`);
      slot.key = key;
      this.#byKey.set(key, slot);
    }
    this.#reset(slot);
    // Sizes depend on the body (height, centre height): re-derive them this match.
    slot.intensities.clear();
    slot.shapes.clear();
    slot.height = setup.height ?? 1.7;
    slot.centreHeight = setup.centreHeight ?? BODY_CENTRE_HEIGHT;
    this.#recolour(slot, setup.element);
    this.setWeapon(key, setup.weaponNode ?? null, setup.weaponParts ?? []);
  }

  /** Release `key`'s slot back to the pool and hide its effects. */
  detach(key: K): void {
    const slot = this.#byKey.get(key);
    if (!slot) return;
    this.#reset(slot);
    slot.key = null;
    slot.sampler.node = null;
    this.#byKey.delete(key);
  }

  /** Detach every fighter (match teardown). */
  clearAll(): void {
    for (const key of [...this.#byKey.keys()]) this.detach(key);
  }

  /** Point the weapon trail at a (new) weapon node and part list. */
  setWeapon(key: K, node: THREE.Object3D | null, parts: readonly WeaponPart[]): void {
    const slot = this.#byKey.get(key);
    if (!slot) return;
    slot.sampler.node = node;
    if (parts.length > 0) slot.sampler.span = bladeSpan(parts);
  }

  /**
   * Start `skill`'s effect. `origin` = the caster's body centre, `aim` = the point
   * it lunges toward (the opponent's body centre), both in metres; the landing
   * point is origin + unit(aim - origin) * lunge * `travelScale` (pass the
   * engine's movementMul so the telegraph ends where the body will). Returns the
   * sizing used (cached per skill), or null when `key` is not attached.
   */
  beginSkill(key: K, skill: Skill, origin: Vec3Like, aim: Vec3Like, now: number, travelScale = 1): FxIntensity | null {
    const slot = this.#byKey.get(key);
    if (!slot) return null;
    let I = slot.intensities.get(skill);
    if (!I) {
      I = fxIntensity(skill, slot.height);
      slot.intensities.set(skill, I);
    }
    if (skill.element !== slot.element) this.#recolour(slot, skill.element);
    slot.skill = skill;
    slot.intensity = I;
    slot.start = now;
    slot.ringFired = !hasLayer(I.recipe, "impactRing") || skill.kind === "dash"; // a dash rings on arrival (ChargeFx)
    const duration = skill.animation.duration;

    if (hasLayer(I.recipe, "weaponTrail")) {
      const until = now + I.strikeTime + (duration - I.strikeTime) * FOLLOW_THROUGH_SHARE;
      slot.weapon.arm(until, I.weaponTrailLifetime, I.brightness);
    }
    if (hasLayer(I.recipe, "telegraph") || hasLayer(I.recipe, "bodyTrail")) {
      let dx = aim.x - origin.x, dz = aim.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) {
        dx /= d;
        dz /= d;
      } else {
        dx = 0;
        dz = 1;
      }
      const travel = I.travel * travelScale;
      slot.target.set(origin.x + dx * travel, origin.y, origin.z + dz * travel);
      let shape = slot.shapes.get(skill);
      if (!shape) {
        shape = { intensity: I, duration, bodyHeight: slot.height, centreHeight: slot.centreHeight };
        slot.shapes.set(skill, shape);
      }
      slot.charge.begin(origin, slot.target, skill.element, duration, now, shape);
    }
    if (hasLayer(I.recipe, "shieldArc")) {
      slot.shield.raise(I.shieldRadius, slot.height * SHIELD_HEIGHT_SHARE, I.shieldOpacity, now, I.strikeTime, I.brightness);
    }
    return I;
  }

  /**
   * The skill's hit frame landed. For a power or defense skill this fires the
   * impact ring under `at` (a body-centre point, e.g. the defender; default: the
   * blade tip for power, the caster for defense). Without this call the ring
   * fires on its own at strikeTime. A dash ignores it (it rings on arrival).
   */
  impact(key: K, now: number, at?: Vec3Like): void {
    const slot = this.#byKey.get(key);
    if (!slot || slot.ringFired || !slot.intensity) return;
    if (at) slot.ground.set(at.x, at.y - slot.centreHeight, at.z);
    this.#fireRing(slot, now, at !== undefined);
  }

  /** The skill animation is over: stop emitting, let every layer fade. Idempotent and allocation-free. */
  endSkill(key: K, now: number): void {
    const slot = this.#byKey.get(key);
    if (!slot || !slot.skill) return;
    const I = slot.intensity!;
    slot.charge.end(now);
    slot.shield.lower(now, Math.max(SHIELD_FALL_MIN, I.ringDuration * SHIELD_FALL_SHARE));
    slot.weapon.disarm();
    slot.skill = null;
  }

  /** Feed blade base/tip world points (m) yourself — only needed when no weaponNode was given. */
  feedBlade(key: K, base: Vec3Like, tip: Vec3Like, now: number): void {
    const slot = this.#byKey.get(key);
    if (!slot) return;
    slot.tip.set(tip.x, tip.y, tip.z);
    slot.weapon.feed(base, tip, now);
  }

  /**
   * Per-frame update for one fighter at time `now` (s): `bodyCentre` = the
   * physics body centre WITHOUT the hop (f.body, m), `yaw` = rig.group.rotation.y
   * (rad), `hop` = the skill's vertical hop this frame (m, hopAt). Call after the
   * rig pose, grip and rig.group position are set for this frame.
   */
  update(key: K, now: number, bodyCentre: Vec3Like, yaw: number, hop = 0): void {
    const slot = this.#byKey.get(key);
    if (!slot) return;
    if (slot.sampler.sample(slot.base, slot.tip)) slot.weapon.feed(slot.base, slot.tip, now);
    slot.weapon.update(now);
    if (slot.charge.active) slot.charge.update(now, bodyCentre, hop);
    const I = slot.intensity;
    if (I && slot.skill && !slot.ringFired && now - slot.start >= I.strikeTime) this.#fireRing(slot, now, false, bodyCentre);
    slot.ring.update(now);
    slot.ground.set(bodyCentre.x, bodyCentre.y - slot.centreHeight, bodyCentre.z);
    slot.shield.update(now, slot.ground, yaw);
  }

  /** Fire the slot's power/defense ring. `placed` = slot.ground already holds the point. */
  #fireRing(slot: FxSlot, now: number, placed: boolean, bodyCentre?: Vec3Like): void {
    const I = slot.intensity!;
    slot.ringFired = true;
    if (!placed) {
      const floor = bodyCentre ? bodyCentre.y - slot.centreHeight : slot.ground.y;
      if (slot.skill?.kind === "power" && slot.sampler.node) slot.ground.set(slot.tip.x, floor, slot.tip.z);
      else if (bodyCentre) slot.ground.set(bodyCentre.x, floor, bodyCentre.z);
    }
    slot.ring.fire(slot.ground, I.ringRadius, I.ringDuration, now, I.brightness);
  }

  /** Cost of everything visible this frame (debug / budget; allocates the result). */
  cost(): FxCost {
    let drawCalls = 0, triangles = 0, activeFighters = 0;
    for (const s of this.#slots) {
      const c = s.charge.cost();
      const d = c.drawCalls + s.weapon.trail.drawCalls + s.ring.drawCalls + s.shield.drawCalls;
      drawCalls += d;
      triangles += c.triangles + s.weapon.trail.triangleCount * 2 +
        (s.ring.active ? s.ring.triangleCount * 2 : 0) + (s.shield.active ? s.shield.triangleCount * 2 : 0);
      if (d > 0) activeFighters++;
    }
    return { drawCalls, triangles, activeFighters };
  }

  /** Re-colour every layer of a slot (allocates one palette object; per element change only). */
  #recolour(slot: FxSlot, element: Element): void {
    const pal = trailPalette(element);
    slot.element = element;
    slot.palette = pal;
    slot.weapon.setColours(pal);
    slot.charge.setColours(pal);
    slot.ring.setColours(pal);
    slot.shield.setColours(pal);
  }

  #reset(slot: FxSlot): void {
    slot.weapon.clear();
    slot.charge.stop();
    slot.ring.stop();
    slot.shield.stop();
    slot.skill = null;
    slot.intensity = null;
    slot.ringFired = true;
  }

  /** Free every GPU resource and detach the root. */
  dispose(): void {
    this.clearAll();
    for (const s of this.#slots) {
      s.weapon.dispose();
      s.charge.dispose();
      s.ring.dispose();
      s.shield.dispose();
    }
    this.root.removeFromParent();
  }
}
