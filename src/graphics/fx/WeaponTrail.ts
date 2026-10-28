// Weapon-swing trail: a RibbonTrail stretched between the blade's BASE and TIP,
// fed their world positions every frame. It emits on its own whenever the tip
// moves fast enough to be a swing (so basic attacks get a trail too), and is
// forced on for the strike window of a skill.
//
// Vocabulary:
//   base / tip   world points (m) of the ribbon's inner / outer edge on the blade.
//   tip speed    |tip(now) - tip(prev)| / (now - prev), m/s.
//   armed        a skill forces emission until `armedUntil` (s) whatever the speed.

// @deno-types="@types/three"
import * as THREE from "three";
import { RibbonTrail } from "./Trail.ts";
import type { BladeSpan, TrailPalette } from "./FxRecipes.ts";
import type { Vec3Like } from "./TrailBuffer.ts";

/**
 * Tip speed (m/s) above which a moving blade counts as a swing. A walking arm
 * swing moves the hand ~1-1.5 m/s, a sword strike's tip 8-15 m/s; 4 m/s sits
 * between them with margin on both sides.
 */
export const SWING_SPEED = 4;
/** Emission stops only once the tip falls below this share of SWING_SPEED (hysteresis: no flicker mid-swing). */
export const SWING_RELEASE_SHARE = 0.5;
/**
 * Lifetime (s) of a basic-attack trail: 0.18 s ≈ 11 frames at 60 Hz — long enough
 * to read the arc, short enough not to smear into the next swing.
 */
export const BASIC_SWING_LIFETIME = 0.18;
/** Ring capacity: 24 stored samples cover a 0.4 s strike at 60 Hz; Catmull-Rom rows fill the arc between them. */
export const WEAPON_TRAIL_CAPACITY = 24;
/** Minimum spawn spacing (m): 1.5 cm keeps a still blade from stacking rows. */
export const WEAPON_TRAIL_SPAWN = 0.015;

/**
 * Turns a weapon node + blade span into world base/tip points, allocation-free.
 * `node` is the weapon's root Object3D (its local +y is the weapon axis, the grip
 * at y = 0) — HumanoidRig.weaponNode after the lane-D Humanoid patch.
 */
export class BladeSampler {
  node: THREE.Object3D | null;
  span: BladeSpan;

  constructor(node: THREE.Object3D | null, span: BladeSpan) {
    this.node = node;
    this.span = span;
  }

  /**
   * Write the CURRENT world base and tip into `base` / `tip`. Refreshes the
   * node's world matrix up its parent chain first, so the points match this
   * frame's pose even before the renderer's own matrix pass (a one-frame lag
   * shows as a gap between blade and ribbon). Returns false without a node.
   */
  sample(base: THREE.Vector3, tip: THREE.Vector3): boolean {
    const node = this.node;
    if (!node) return false;
    node.updateWorldMatrix(true, false);
    base.set(0, this.span.base, 0).applyMatrix4(node.matrixWorld);
    tip.set(0, this.span.tip, 0).applyMatrix4(node.matrixWorld);
    return true;
  }
}

/** Ribbon behind a swinging blade. */
export class WeaponTrail {
  readonly trail: RibbonTrail;
  /** Swing detection threshold (m/s). */
  swingSpeed = SWING_SPEED;
  /** Lifetime used for unforced (basic) swings. */
  basicLifetime = BASIC_SWING_LIFETIME;
  #prevTip = new THREE.Vector3();
  #prevTime = NaN;
  #emitting = false;
  #armedUntil = -Infinity;
  #armedLifetime = BASIC_SWING_LIFETIME;
  #armedBrightness = 1;
  /** Tip speed measured by the last feed (m/s). */
  tipSpeed = 0;

  constructor(palette: TrailPalette) {
    this.trail = new RibbonTrail({
      capacity: WEAPON_TRAIL_CAPACITY,
      lifetime: BASIC_SWING_LIFETIME,
      minSpawnDistance: WEAPON_TRAIL_SPAWN,
      colours: palette,
      // The tip leads: brightest along edge 1, and old rows shrink toward the tip
      // so the ribbon thins into a crescent instead of ending in a hard slab.
      profile: 0,
      taper: 0.7,
      taperPivot: 1,
    });
  }

  get object(): THREE.Object3D {
    return this.trail.object;
  }

  /**
   * Force emission until `until` (s) with the skill's `lifetime` (s) and colour
   * gain `brightness` — the strike window of a skill, swung fast or not.
   */
  arm(until: number, lifetime: number, brightness: number): void {
    this.#armedUntil = until;
    this.#armedLifetime = lifetime;
    this.#armedBrightness = brightness;
  }

  /** Stop forcing emission (the trail still fades out normally). */
  disarm(): void {
    this.#armedUntil = -Infinity;
  }

  /** True while a skill forces emission at time `now`. */
  armed(now: number): boolean {
    return now <= this.#armedUntil;
  }

  /** Feed this frame's blade `base` / `tip` world points at time `now` (s). */
  feed(base: Vec3Like, tip: Vec3Like, now: number): void {
    const dt = now - this.#prevTime;
    this.tipSpeed = dt > 0
      ? Math.hypot(tip.x - this.#prevTip.x, tip.y - this.#prevTip.y, tip.z - this.#prevTip.z) / dt
      : 0;
    this.#prevTip.set(tip.x, tip.y, tip.z);
    this.#prevTime = now;
    const forced = this.armed(now);
    const threshold = this.#emitting ? this.swingSpeed * SWING_RELEASE_SHARE : this.swingSpeed;
    const swinging = this.tipSpeed >= threshold;
    if (!forced && !swinging) {
      this.#emitting = false;
      return;
    }
    if (!this.#emitting) {
      // A new swing: forget the old one so the ribbon does not bridge two strikes.
      if (this.trail.buffer.pointCount > 0 && !forced) this.trail.buffer.clear();
      this.#emitting = true;
    }
    this.trail.lifetime = forced ? this.#armedLifetime : this.basicLifetime;
    this.trail.setIntensity(forced ? this.#armedBrightness : 0.75, 1);
    this.trail.push(base, tip, now);
  }

  /** Rebuild the ribbon at `now`. */
  update(now: number): void {
    this.trail.update(now);
  }

  setColours(palette: TrailPalette): void {
    this.trail.setColours(palette);
  }

  clear(): void {
    this.trail.clear();
    this.#emitting = false;
    this.#prevTime = NaN;
    this.#armedUntil = -Infinity;
  }

  dispose(): void {
    this.trail.dispose();
  }
}
