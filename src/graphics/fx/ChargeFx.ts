// Charge / dash effect (R05): everything a dash draws from the start position
// to the target.
//   1. telegraph   a tapered arrow on the floor, origin -> landing point, that
//                  FILLS over the wind-up (it reaches the target on the hit frame);
//   2. body trail  a ribbon from hips to shoulders along the travelled path;
//   3. afterimages 3-5 fading ghost silhouettes dropped at even spacing;
//   4. speed lines streaks sliding past the body at its travel speed;
//   5. impact ring an expanding ground ring where the body actually arrives.
// The weapon trail lives in WeaponTrail.ts (re-exported here) and is fed the
// blade base/tip each frame by the director.
//
// Positions passed in are BODY-CENTRE points (the engine's f.body, whose y sits
// `centreHeight` above the soles); the effect derives ground, hip and shoulder
// heights from them. Everything is preallocated: begin/update/end allocate nothing.
//
// Cost while fully active (per charging fighter):
//   telegraph 2 draw calls x 28 tris, body trail 2 x <= 2*(rows-1), ghosts 1 x 2/ghost,
//   speed lines 1 x 2/line, ring 2 x 2.

// @deno-types="@types/three"
import * as THREE from "three";
import { clamp01, rng32, smoothstep } from "../../core/MathCore.ts";
import { ALL_SKILLS, type Element, ELEMENTS } from "../../game/Skills.ts";
import { type BodyLandmarks, bodyLandmarks, envelope, type FxIntensity, fxIntensity, trailPalette, type TrailPalette } from "./FxRecipes.ts";
import { RibbonTrail } from "./Trail.ts";
import { stripIndices, type Vec3Like } from "./TrailBuffer.ts";
import { asDecal, DECAL_LIFT, RingDecal } from "./Decals.ts";
import {
  applyPalette,
  createFxUniforms,
  createLayerMeshes,
  createLayerPair,
  DECAL_VERTEX,
  type FxUniforms,
  GHOST_FRAGMENT,
  GHOST_VERTEX,
  type LayerPair,
  SPEEDLINE_FRAGMENT,
  SPEEDLINE_VERTEX,
  TELEGRAPH_CORE_FRAGMENT,
  TELEGRAPH_OUTER_FRAGMENT,
} from "./FxShaders.ts";

export { BladeSampler, WeaponTrail } from "./WeaponTrail.ts";

/**
 * Metres from the engine's body centre down to the soles: Humanoid.ts places
 * the rig origin at BODY_RADIUS = 0.6 above the ground.
 */
export const BODY_CENTRE_HEIGHT = 0.6;
/** Shaft segments of the telegraph strip: 12 keeps the taper smooth for a 3.4 m dash (28 cm steps). */
export const TELEGRAPH_SEGMENTS = 12;
/** Strip rows = shaft rows (segments + 1) + head-base row + tip row. */
const TELEGRAPH_ROWS = TELEGRAPH_SEGMENTS + 3;
/** Shaft half-width at the origin as a share of its half-width at the head (the arrow widens toward the target). */
const TELEGRAPH_TAIL_SHARE = 0.7;
/** Head width = 1.9 x shaft width; head length = 1.5 x shaft width, capped at 40% of the path. */
const HEAD_WIDTH_SHARE = 1.9;
const HEAD_LENGTH_SHARE = 1.5;
const HEAD_MAX_PATH_SHARE = 0.4;
/** Chevron spacing along the strip = 1.2 x its width (square-ish chevrons). */
const CHEVRON_SPACING_SHARE = 1.2;
/** Most ghosts / speed lines a charge can draw (FxRecipes caps: 5 ghosts, 10 lines). */
export const MAX_GHOSTS = 5;
export const MAX_SPEED_LINES = 10;
/** Ghost quad width / height: the silhouette's arms span ~0.4 H; 0.5 leaves room for the halo. */
const GHOST_ASPECT = 0.5;
/** Peak ghost opacity: 0.8 keeps the fighter itself the most solid thing on screen. */
const GHOST_PEAK = 0.8;
/** Streak length = travel speed x 0.08 s, a ~5-frame motion-blur exposure at 60 Hz. */
const STREAK_EXPOSURE = 0.08;
/** Streak width (m) per metre of body height: ~2 cm on a 1.7 m fighter. */
const STREAK_WIDTH_SHARE = 0.012;
/** Metres a streak travels front -> back, per metre of body height (the zone the camera frames). */
const STREAK_SPAN_SHARE = 1.4;
/** Body-trail ring capacity: 32 samples at >= 5 cm spacing cover a 3.4 m dash with room to spare. */
const BODY_TRAIL_CAPACITY = 32;
const BODY_TRAIL_SPAWN = 0.05;

/** Sizes and timings of one charge (FxIntensity fields + the fighter's body). Metres and seconds. */
export interface ChargeShape {
  intensity: FxIntensity;
  /** Animation duration the timings were derived for (s). */
  duration: number;
  /** Standing height (m). */
  bodyHeight: number;
  /** Body centre above the soles (m). */
  centreHeight: number;
}

/**
 * Default shape for a bare `begin(origin, target, element, duration)` call: the
 * roster dash whose duration is closest, with every time scaled by
 * duration / thatDash.duration. Allocates (call once, outside the frame loop).
 */
export function defaultChargeShape(duration: number, bodyHeight = 1.7): ChargeShape {
  let best = ALL_SKILLS[0];
  for (const s of ALL_SKILLS) {
    if (s.kind !== "dash") continue;
    if (best.kind !== "dash" || Math.abs(s.animation.duration - duration) < Math.abs(best.animation.duration - duration)) best = s;
  }
  const base = fxIntensity(best, bodyHeight);
  const k = duration / best.animation.duration;
  return {
    intensity: {
      ...base,
      travelTime: base.travelTime * k,
      strikeTime: base.strikeTime * k,
      windUp: base.windUp * k,
      trailLifetime: base.trailLifetime * k,
      weaponTrailLifetime: base.weaponTrailLifetime * k,
      ghostLifetime: base.ghostLifetime * k,
      ringDuration: base.ringDuration * k,
    },
    duration,
    bodyHeight,
    centreHeight: BODY_CENTRE_HEIGHT,
  };
}

/** The charge effect for one fighter. Add `object` to the scene once; reuse it for every dash. */
export class ChargeFx {
  /** Root at the identity transform (the body trail is world-space). */
  readonly object = new THREE.Group();
  readonly bodyTrail: RibbonTrail;
  readonly ring: RingDecal;
  #shape: ChargeShape;
  #palette: TrailPalette;
  /** Landmarks of the current shape's body, cached at begin() (update must not allocate). */
  #body: BodyLandmarks;
  #bodyHeight: number;

  // Telegraph.
  readonly #telegraph = new THREE.Group();
  readonly #telegraphGeo = new THREE.BufferGeometry();
  readonly #telegraphPos = new Float32Array(TELEGRAPH_ROWS * 2 * 3);
  readonly #telegraphUv = new Float32Array(TELEGRAPH_ROWS * 2 * 2);
  readonly #telegraphU: FxUniforms;
  readonly #telegraphPair: LayerPair;
  // Ghosts.
  readonly #ghosts: THREE.InstancedMesh;
  readonly #ghostAlpha: THREE.InstancedBufferAttribute;
  readonly #ghostU: FxUniforms;
  readonly #ghostTimes = new Float64Array(MAX_GHOSTS);
  #ghostsSpawned = 0;
  // Speed lines.
  readonly #lines: THREE.Mesh;
  readonly #linesGeo = new THREE.BufferGeometry();
  readonly #lineAnchor: THREE.BufferAttribute;
  readonly #lineAngle = new Float32Array(MAX_SPEED_LINES);
  readonly #lineRadius = new Float32Array(MAX_SPEED_LINES);
  readonly #linesU: FxUniforms;

  // Charge state (seconds / metres).
  #start = NaN;
  #endAt = Infinity;
  #arrived = false;
  #live = false;
  readonly #origin = new THREE.Vector3();
  readonly #target = new THREE.Vector3();
  readonly #dir = new THREE.Vector3(0, 0, 1);
  #distance = 0;
  readonly #lastGhost = new THREE.Vector3();
  readonly #hip = new THREE.Vector3();
  readonly #shoulder = new THREE.Vector3();
  readonly #ground = new THREE.Vector3();
  readonly #matrix = new THREE.Matrix4();
  readonly #quat = new THREE.Quaternion();
  readonly #scale = new THREE.Vector3();

  constructor(palette: TrailPalette, shape: ChargeShape = defaultChargeShape(0.5)) {
    this.#shape = shape;
    this.#palette = palette;
    this.#body = bodyLandmarks(shape.bodyHeight);
    this.#bodyHeight = shape.bodyHeight;
    this.object.name = "fx-charge";

    // 1. Telegraph strip: static index, positions/uv rewritten in place by begin().
    this.#telegraphGeo.setAttribute("position", new THREE.BufferAttribute(this.#telegraphPos, 3));
    this.#telegraphGeo.setAttribute("aUv", new THREE.BufferAttribute(this.#telegraphUv, 2));
    this.#telegraphGeo.setIndex(new THREE.BufferAttribute(stripIndices(TELEGRAPH_ROWS), 1));
    this.#telegraphGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.#telegraphU = createFxUniforms(palette, { uFill: { value: 0 }, uChevrons: { value: 4 } });
    this.#telegraphPair = createLayerPair(DECAL_VERTEX, TELEGRAPH_OUTER_FRAGMENT, TELEGRAPH_CORE_FRAGMENT, this.#telegraphU);
    asDecal(this.#telegraphPair);
    this.#telegraph.add(...createLayerMeshes(this.#telegraphGeo, this.#telegraphPair));
    this.#telegraph.visible = false;

    // 2. Body trail: symmetric profile (brightest mid-ribbon), tapering about its middle.
    this.bodyTrail = new RibbonTrail({
      capacity: BODY_TRAIL_CAPACITY,
      lifetime: shape.intensity.trailLifetime,
      minSpawnDistance: BODY_TRAIL_SPAWN,
      colours: palette,
      profile: 1,
      taper: 0.6,
      taperPivot: 0.5,
    });

    // 3. Ghosts: one InstancedMesh; instance matrices are written at spawn only.
    const ghostGeo = new THREE.PlaneGeometry(1, 1);
    this.#ghostAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GHOSTS), 1).setUsage(THREE.DynamicDrawUsage);
    ghostGeo.setAttribute("aGhost", this.#ghostAlpha);
    this.#ghostU = createFxUniforms(palette, { uAspect: { value: GHOST_ASPECT } });
    const ghostMat = new THREE.ShaderMaterial({
      uniforms: this.#ghostU,
      vertexShader: GHOST_VERTEX,
      fragmentShader: GHOST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.#ghosts = new THREE.InstancedMesh(ghostGeo, ghostMat, MAX_GHOSTS);
    this.#ghosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.#ghosts.count = 0;
    this.#ghosts.visible = false;
    // The vertex shader billboards each quad, moving vertices off the geometry's
    // own bounds; <= 5 quads are not worth a custom culling volume.
    this.#ghosts.frustumCulled = false;
    this.#ghosts.renderOrder = 9;

    // 4. Speed lines: MAX_SPEED_LINES quads; setDrawRange shows the active count.
    const verts = MAX_SPEED_LINES * 4;
    const corner = new Float32Array(verts * 2);
    const seed = new Float32Array(verts);
    const index: number[] = [];
    const rand = rng32(0x5eed11e5);
    for (let i = 0; i < MAX_SPEED_LINES; i++) {
      const s = rand();
      this.#lineAngle[i] = ((i + 0.5) / MAX_SPEED_LINES) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      this.#lineRadius[i] = 0.9 + 0.6 * rand(); // shoulder breadths from the body axis
      const corners = [-0.5, -1, 0.5, -1, 0.5, 1, -0.5, 1];
      for (let c = 0; c < 4; c++) {
        corner[(i * 4 + c) * 2] = corners[c * 2];
        corner[(i * 4 + c) * 2 + 1] = corners[c * 2 + 1];
        seed[i * 4 + c] = s;
      }
      const v = i * 4;
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    this.#lineAnchor = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this.#linesGeo.setAttribute("position", this.#lineAnchor); // anchors double as positions (bounds only)
    this.#linesGeo.setAttribute("aAnchor", this.#lineAnchor);
    this.#linesGeo.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    this.#linesGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.#linesGeo.setIndex(index);
    this.#linesU = createFxUniforms(palette, {
      uSpan: { value: 2 }, uLength: { value: 0.5 }, uWidth: { value: 0.02 }, uRate: { value: 1 },
    });
    const lineMat = new THREE.ShaderMaterial({
      uniforms: this.#linesU,
      vertexShader: SPEEDLINE_VERTEX,
      fragmentShader: SPEEDLINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.#lines = new THREE.Mesh(this.#linesGeo, lineMat);
    this.#lines.frustumCulled = false; // vertices are placed by the shader (camera-facing streaks)
    this.#lines.visible = false;
    this.#lines.renderOrder = 9;

    // 5. Arrival ring.
    this.ring = new RingDecal(palette);

    this.object.add(this.#telegraph, this.bodyTrail.object, this.#ghosts, this.#lines, this.ring.object);
  }

  /** True from begin() until every layer has faded. */
  get active(): boolean {
    return this.#live;
  }

  /** Telegraph fill 0..1 (share of the path lit so far). Read-only view for tests and debug overlays. */
  get telegraphFill(): number {
    return this.#telegraphU.uFill.value as number;
  }

  /** Ghost silhouettes dropped by the current charge. */
  get ghostsSpawned(): number {
    return this.#ghostsSpawned;
  }

  /** The palette currently applied. */
  get palette(): TrailPalette {
    return this.#palette;
  }

  /** Re-colour every layer in place. */
  setColours(palette: TrailPalette): void {
    this.#palette = palette;
    applyPalette(this.#telegraphU, palette);
    applyPalette(this.#ghostU, palette);
    applyPalette(this.#linesU, palette);
    this.bodyTrail.setColours(palette);
    this.ring.setColours(palette);
  }

  /**
   * Start a charge from body-centre `origin` to body-centre `target` (m) in the
   * colours of `element`, lasting `duration` seconds. `now` (s) defaults to the
   * time of the first update(). `shape` is the FxIntensity-derived sizing the
   * director passes; without it the current shape is kept, re-derived through
   * defaultChargeShape(duration) when `duration` differs from the shape's own
   * (that bare-API path allocates once; the director path never does).
   */
  begin(origin: Vec3Like, target: Vec3Like, element: Element, duration: number, now?: number, shape?: ChargeShape): void {
    if (shape) this.#shape = shape;
    else if (Math.abs(duration - this.#shape.duration) > 1e-6) {
      this.#shape = defaultChargeShape(duration, this.#shape.bodyHeight);
    }
    // Re-colour only on an element change (trailPalette allocates a palette object).
    const style = ELEMENTS[element];
    if (style.edge !== this.#palette.edge || style.core !== this.#palette.core) this.setColours(trailPalette(element));
    const s = this.#shape, I = s.intensity;
    if (this.#bodyHeight !== s.bodyHeight) {
      this.#bodyHeight = s.bodyHeight;
      this.#body = bodyLandmarks(s.bodyHeight); // allocates only when the fighter's height changes
    }
    this.#start = now ?? NaN;
    this.#endAt = Infinity;
    this.#arrived = false;
    this.#live = true;
    this.#origin.set(origin.x, origin.y - s.centreHeight, origin.z);
    this.#target.set(target.x, target.y - s.centreHeight, target.z);
    this.#dir.set(target.x - origin.x, 0, target.z - origin.z);
    this.#distance = this.#dir.length();
    if (this.#distance > 1e-4) this.#dir.divideScalar(this.#distance);
    else this.#dir.set(0, 0, 1);

    // Telegraph geometry for this path.
    this.#buildTelegraph(this.#distance, I.telegraphWidth);
    this.#telegraph.position.set(this.#origin.x, this.#origin.y + DECAL_LIFT, this.#origin.z);
    this.#telegraph.rotation.y = Math.atan2(this.#dir.x, this.#dir.z);
    this.#telegraph.visible = this.#distance > 0.05;
    this.#telegraphU.uBrightness.value = I.brightness;
    this.#telegraphU.uChevrons.value = this.#distance / (I.telegraphWidth * CHEVRON_SPACING_SHARE);
    this.#telegraphU.uFill.value = 0;

    // Body trail.
    this.bodyTrail.clear();
    this.bodyTrail.lifetime = I.trailLifetime;
    this.bodyTrail.setIntensity(I.brightness, 1);

    // Ghosts.
    this.#ghostsSpawned = 0;
    this.#ghosts.count = 0;
    this.#lastGhost.copy(this.#origin);
    this.#ghostU.uBrightness.value = I.brightness;

    // Speed lines: anchors around the chest axis, scaled to this fighter.
    const body = this.#body;
    const chest = (body.hip + body.shoulder) / 2 - s.centreHeight; // above the body centre
    const anchors = this.#lineAnchor.array as Float32Array;
    for (let i = 0; i < MAX_SPEED_LINES; i++) {
      const r = this.#lineRadius[i] * body.shoulderBreadth, a = this.#lineAngle[i];
      for (let c = 0; c < 4; c++) {
        const o = (i * 4 + c) * 3;
        anchors[o] = Math.cos(a) * r;
        anchors[o + 1] = chest + Math.sin(a) * r * 0.9;
        anchors[o + 2] = 0;
      }
    }
    this.#lineAnchor.needsUpdate = true;
    const travelTime = Math.max(0.05, I.travelTime);
    const speed = this.#distance / travelTime;
    const span = STREAK_SPAN_SHARE * s.bodyHeight;
    this.#linesU.uSpan.value = span;
    this.#linesU.uLength.value = Math.max(0.1, speed * STREAK_EXPOSURE);
    this.#linesU.uWidth.value = STREAK_WIDTH_SHARE * s.bodyHeight;
    this.#linesU.uRate.value = speed / span;
    this.#linesU.uBrightness.value = I.brightness;
    this.#linesGeo.setDrawRange(0, Math.min(MAX_SPEED_LINES, I.speedLineCount) * 6);
    this.#lines.visible = this.#distance > 0.05;
    this.#lines.rotation.y = this.#telegraph.rotation.y;
    this.ring.stop();
  }

  /** Write the tapered arrow (local +z = toward the target) for a path of `length` metres and shaft `width` metres. */
  #buildTelegraph(length: number, width: number): void {
    const pos = this.#telegraphPos, uv = this.#telegraphUv;
    const L = Math.max(0.05, length);
    const headLen = Math.min(HEAD_LENGTH_SHARE * width, HEAD_MAX_PATH_SHARE * L);
    const shaftLen = L - headLen;
    const half = width / 2;
    for (let i = 0; i <= TELEGRAPH_SEGMENTS; i++) {
      const t = i / TELEGRAPH_SEGMENTS;
      this.#telegraphRow(pos, uv, i, t * shaftLen, half * (TELEGRAPH_TAIL_SHARE + (1 - TELEGRAPH_TAIL_SHARE) * t), L);
    }
    this.#telegraphRow(pos, uv, TELEGRAPH_SEGMENTS + 1, shaftLen, half * HEAD_WIDTH_SHARE, L);
    this.#telegraphRow(pos, uv, TELEGRAPH_SEGMENTS + 2, L, 0, L);
    (this.#telegraphGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.#telegraphGeo.getAttribute("aUv") as THREE.BufferAttribute).needsUpdate = true;
    const sphere = this.#telegraphGeo.boundingSphere!;
    sphere.center.set(0, 0, L / 2);
    sphere.radius = L / 2 + half * HEAD_WIDTH_SHARE;
  }

  /** One telegraph row `r` at distance `z` (m) with half-width `h` (m) on a path of length `L` (m). */
  #telegraphRow(pos: Float32Array, uv: Float32Array, r: number, z: number, h: number, L: number): void {
    pos[r * 6] = -h;
    pos[r * 6 + 1] = 0;
    pos[r * 6 + 2] = z;
    pos[r * 6 + 3] = h;
    pos[r * 6 + 4] = 0;
    pos[r * 6 + 5] = z;
    uv[r * 4] = z / L;
    uv[r * 4 + 1] = -1;
    uv[r * 4 + 2] = z / L;
    uv[r * 4 + 3] = 1;
  }

  /**
   * Advance to time `now` (s) with the fighter's current body-centre position
   * `currentPos` (m, the physics centre WITHOUT the hop) and the current `hop`
   * (m above it). Floor decals use the floor under `currentPos`; the trail,
   * ghosts and streaks ride the hop. Call every frame while `active`.
   */
  update(now: number, currentPos: Vec3Like, hop = 0): void {
    if (!this.#live) return;
    if (Number.isNaN(this.#start)) this.#start = now;
    const s = this.#shape, I = s.intensity, body = this.#body;
    const elapsed = now - this.#start;
    const travelTime = Math.max(0.05, I.travelTime);
    const travelling = elapsed <= travelTime && now < this.#endAt;
    this.#ground.set(currentPos.x, currentPos.y - s.centreHeight, currentPos.z);
    // The layers stop at arrival or at end(), whichever comes first.
    const stopAt = Math.min(this.#start + travelTime, this.#endAt);
    const fall = Math.max(0.1, I.ringDuration * 0.6);

    // 1. Telegraph fills over the wind-up and fades after arrival.
    this.#telegraphU.uFill.value = clamp01(elapsed / Math.max(0.05, I.windUp));
    this.#telegraphU.uOpacity.value = envelope(now, this.#start, Math.min(0.08, I.windUp * 0.3), stopAt, fall);
    this.#telegraphU.uTime.value = now;
    if (now > stopAt + fall) this.#telegraph.visible = false;

    // 2. Body trail: hip -> shoulder at the current position while travelling.
    if (travelling) {
      this.#hip.set(this.#ground.x, this.#ground.y + hop + body.hip, this.#ground.z);
      this.#shoulder.set(this.#ground.x, this.#ground.y + hop + body.shoulder, this.#ground.z);
      this.bodyTrail.push(this.#hip, this.#shoulder, now);
    }
    this.bodyTrail.update(now);

    // 3. Ghosts: drop one each time the body covers distance / (count + 1).
    const count = Math.min(MAX_GHOSTS, I.ghostCount);
    const spacing = this.#distance / (count + 1);
    if (travelling && this.#ghostsSpawned < count && spacing > 0.05) {
      const dx = this.#ground.x - this.#lastGhost.x, dz = this.#ground.z - this.#lastGhost.z;
      if (Math.hypot(dx, dz) >= spacing) this.#spawnGhost(now, hop);
    }
    let anyGhost = false;
    for (let i = 0; i < this.#ghostsSpawned; i++) {
      const a = GHOST_PEAK * (1 - smoothstep(0, I.ghostLifetime, now - this.#ghostTimes[i]));
      this.#ghostAlpha.array[i] = a;
      if (a > 0.005) anyGhost = true;
    }
    this.#ghostAlpha.needsUpdate = true;
    this.#ghostU.uTime.value = now;
    if (!anyGhost && !travelling) this.#ghosts.count = 0;
    // An InstancedMesh with count 0 still enters the render list; hide it instead.
    this.#ghosts.visible = this.#ghosts.count > 0;

    // 4. Speed lines ride the body while it moves.
    this.#lines.position.set(currentPos.x, currentPos.y + hop, currentPos.z);
    this.#linesU.uTime.value = now;
    this.#linesU.uOpacity.value = envelope(now, this.#start, 0.15 * travelTime, stopAt, 0.3 * travelTime);
    if (now > stopAt + 0.3 * travelTime) this.#lines.visible = false;

    // 5. Arrival ring where the body actually stops.
    if (!this.#arrived && (elapsed >= travelTime || now >= this.#endAt)) {
      this.#arrived = true;
      this.ring.fire(this.#ground, I.ringRadius, I.ringDuration, now, I.brightness);
    }
    this.ring.update(now);

    this.#live = this.#telegraph.visible || this.bodyTrail.object.visible || this.#ghosts.count > 0 ||
      this.#lines.visible || this.ring.active || travelling;
  }

  /** Leave a ghost at the current floor point, raised by the current `hop` (m). */
  #spawnGhost(now: number, hop: number): void {
    const i = this.#ghostsSpawned++;
    const h = this.#shape.bodyHeight;
    this.#ghostTimes[i] = now;
    this.#lastGhost.copy(this.#ground);
    this.#scale.set(h * GHOST_ASPECT, h, 1);
    this.#hip.set(this.#ground.x, this.#ground.y + hop, this.#ground.z); // reuse a scratch vector
    this.#matrix.compose(this.#hip, this.#quat, this.#scale);
    this.#ghosts.setMatrixAt(i, this.#matrix);
    this.#ghosts.instanceMatrix.needsUpdate = true;
    this.#ghosts.count = this.#ghostsSpawned;
    this.#ghosts.visible = true;
  }

  /** Stop emitting at `now` (s); every layer fades out on its own. Idempotent. */
  end(now?: number): void {
    if (!this.#live || this.#endAt !== Infinity) return;
    this.#endAt = now ?? (Number.isNaN(this.#start) ? 0 : this.#start);
  }

  /** Hide everything immediately (match reset). */
  stop(): void {
    this.#live = false;
    this.#telegraph.visible = false;
    this.#lines.visible = false;
    this.#ghosts.count = 0;
    this.#ghosts.visible = false;
    this.#ghostsSpawned = 0;
    this.bodyTrail.clear();
    this.ring.stop();
  }

  /** Draw calls this frame and triangles drawn (both layers summed). Debug/budget only. */
  cost(): { drawCalls: number; triangles: number } {
    let drawCalls = this.bodyTrail.drawCalls + this.ring.drawCalls;
    let triangles = this.bodyTrail.triangleCount * 2 + (this.ring.active ? this.ring.triangleCount * 2 : 0);
    if (this.#telegraph.visible) {
      drawCalls += 2;
      triangles += (TELEGRAPH_ROWS - 1) * 2 * 2;
    }
    if (this.#ghosts.count > 0) {
      drawCalls += 1;
      triangles += this.#ghosts.count * 2;
    }
    if (this.#lines.visible) {
      drawCalls += 1;
      triangles += (this.#linesGeo.drawRange.count / 6) * 2;
    }
    return { drawCalls, triangles };
  }

  dispose(): void {
    this.object.removeFromParent();
    this.#telegraphGeo.dispose();
    this.#telegraphPair.outer.dispose();
    this.#telegraphPair.core.dispose();
    this.#ghosts.geometry.dispose();
    (this.#ghosts.material as THREE.Material).dispose();
    this.#ghosts.dispose();
    this.#linesGeo.dispose();
    (this.#lines.material as THREE.Material).dispose();
    this.bodyTrail.dispose();
    this.ring.dispose();
  }
}
