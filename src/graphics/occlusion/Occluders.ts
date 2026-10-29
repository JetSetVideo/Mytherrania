// Camera occlusion (lane O, V01): every registered object standing between the camera and the
// VIEWED character fades, then returns to opaque once it clears the view.
//
// Vocabulary:
// - occluder: a registered THREE.Object3D (its ROOT) and the meshes under it, with a bounding
//   volume in root space (sphere, oriented box or vertical capsule) and a KIND (prop, wall,
//   terrain, fighter, weapon) that sets its minimum opacity and fade style.
// - subject: the viewed character's root (the player's rig; the AI's in spectate). It and every
//   occluder inside it (its own weapon) never fade.
// - target points: 3 points on the subject at fractions of its standing height (head, chest,
//   knees), each with a half-width; one corridor (Corridor.ts) runs from the eye to each, so a
//   crate hiding only the legs still fades.
// - opacity: 1 = untouched (the ORIGINAL material is on the mesh), < 1 = a fade variant
//   (FadeMaterials.ts) is swapped in. Eased per frame with Corridor.stepFade (half-lives in s).
//
// Per frame (update): bound-vs-corridor tests only (sphere broad phase, then box slab / capsule
// segment-segment), an optional mesh raycast for occluders registered `precise`, no allocation.
// Materials change only at transitions (swap in on the first faded frame, swap back when the
// opacity snaps to 1); a variant is created lazily ONCE per mesh material and then reused.

// @deno-types="@types/three"
import * as THREE from "three";
import {
  boxBlocksCorridor, capsuleBlocksCorridor, Corridor, CORRIDOR_IN, FADE_IN_HALF_LIFE, FADE_OUT_HALF_LIFE, FADE_SNAP,
  type FadeTiming, loadCorridor, sphereBlocksCorridor, stepFade,
} from "./Corridor.ts";
import { createFadeVariant, type FadeStyle, type FadeVariant, isFadeVariant, isUnfadeable } from "./FadeMaterials.ts";

/** What an occluder is: sets its minimum opacity, default bound shape and fade style. */
export type OccluderKind = "prop" | "wall" | "terrain" | "fighter" | "weapon";
/** The bounding volume tested against the view corridors (root space). */
export type OccluderShape = "sphere" | "box" | "capsule";

/**
 * Lowest opacity per kind (unitless). Props and walls 0.15: their edges stay visible so the
 * player still sees what they would walk into. Detached terrain pieces 0.25: large masses keep
 * their volume readable. The other fighter and weapons 0.35 (6 of 16 dither pixels): their pose
 * and blade are combat information and must stay readable through the fade.
 */
export const MIN_OPACITY: Readonly<Record<OccluderKind, number>> = {
  prop: 0.15, wall: 0.15, terrain: 0.25, fighter: 0.35, weapon: 0.35,
};

/** Default bound shape per kind: bodies are capsules, blades spheres, static scenery boxes. */
export const DEFAULT_SHAPE: Readonly<Record<OccluderKind, OccluderShape>> = {
  prop: "box", wall: "box", terrain: "box", fighter: "capsule", weapon: "sphere",
};

/**
 * Default fade style per kind: scenery blends (smooth, few overlapping layers), bodies and
 * weapons dither (cel ShaderMaterials + inverted hulls: see FadeMaterials.ts).
 */
export const DEFAULT_STYLE: Readonly<Record<OccluderKind, FadeStyle>> = {
  prop: "alpha", wall: "alpha", terrain: "alpha", fighter: "dither", weapon: "dither",
};

/** Roots/meshes whose name matches are never faded: the sky, the void, water/lava surfaces. */
export const NEVER_FADE_NAME = /sky|void|water|ocean|lava|magma|surround/i;

/** How to register an occluder. Every field but `kind` has a per-kind default. */
export interface OccluderSpec {
  kind: OccluderKind;
  /** Bounding volume (default DEFAULT_SHAPE[kind]). */
  shape?: OccluderShape;
  /** Re-read its world transform every frame (default: fighter and weapon). */
  dynamic?: boolean;
  /** Lowest opacity, in [0, 1] (default MIN_OPACITY[kind]). */
  minOpacity?: number;
  /** Fade style of its built-in materials (ShaderMaterials always dither). */
  style?: FadeStyle;
  /** Confirm a bound hit with a raycast on its meshes (central rays only; default false). */
  precise?: boolean;
  /** Capsule radius, m (default min(bound half-width, capsuleRadiusPerHeight * height)). */
  radius?: number;
}

/** Tunable constants of the occlusion system (units in each field's comment). */
export interface OcclusionTuning {
  /** Half-life of the fade toward transparency, s (Corridor.FADE_IN_HALF_LIFE ~0.069). */
  fadeInHalfLife: number;
  /** Half-life of the return to opaque, s (Corridor.FADE_OUT_HALF_LIFE 0.25). */
  fadeOutHalfLife: number;
  /** Opacity gap below which the opacity snaps to its target, unitless. */
  snap: number;
  /** Target points as fractions of the subject's standing height (head, chest, knees). */
  pointHeights: readonly number[];
  /** Subject half-width at each point, as a fraction of its standing height. */
  pointRadii: readonly number[];
  /** Subject half-depth in front of its target points, as a fraction of its height (corridor end). */
  subjectDepthPerHeight: number;
  /** Extra radius, m, an already-fading occluder must clear before it is released (hysteresis). */
  releaseMargin: number;
  /** Largest frame step used for easing, s (a hitch must not snap fades). */
  maxDt: number;
  /** Capsule radius of a body as a fraction of its height (default capsule radius). */
  capsuleRadiusPerHeight: number;
  /** Eye radius when the camera is not perspective, m. */
  defaultEyeRadius: number;
}

/**
 * Defaults. Anthropometric fractions of standing height h: head centre ~0.93h (top eighth),
 * chest ~0.70h, knee ~0.28h -> points at 0.90 / 0.70 / 0.25 (below the hair, above the shin).
 * Half-widths: head breadth ~0.09h -> 0.05h; shoulders ~0.23h -> 0.13h with the guard arms;
 * two knees ~0.15h -> 0.08h. Torso half-depth ~0.07h plus the guard ~0.08h -> depth 0.15h.
 * Capsule radius 0.2h: shoulder half-width (0.115h) plus forearms raised in guard.
 */
export const DEFAULT_OCCLUSION_TUNING: Readonly<OcclusionTuning> = {
  fadeInHalfLife: FADE_IN_HALF_LIFE,
  fadeOutHalfLife: FADE_OUT_HALF_LIFE,
  snap: FADE_SNAP,
  pointHeights: [0.9, 0.7, 0.25],
  pointRadii: [0.05, 0.13, 0.08],
  subjectDepthPerHeight: 0.15,
  releaseMargin: 0.15,
  maxDt: 0.25,
  capsuleRadiusPerHeight: 0.2,
  defaultEyeRadius: 0.05,
};

/** Counters of the last update (and lifetime totals where noted). */
export interface OcclusionStats {
  /** Registered occluders. */
  registered: number;
  /** Narrow-phase bound tests run last frame. */
  narrowTests: number;
  /** Occluders blocking a corridor last frame. */
  blocked: number;
  /** Occluders with a fade variant on their meshes (opacity < 1). */
  fading: number;
  /** Fade variants created so far (lifetime; lazily, once per mesh material). */
  variantsCreated: number;
  /** Precise rays cast last frame. */
  rays: number;
}

/** One mesh of an occluder and its material swap state. */
interface MeshSlot {
  mesh: THREE.Mesh;
  /** The material(s) the game put on the mesh (restored when the fade ends). */
  source: THREE.Material | THREE.Material[];
  /** Per source material: its fade variant (null = cannot/must not fade). Null until first fade. */
  variants: (FadeVariant | null)[] | null;
  /** What is put on the mesh while fading (variant, or an array mixing variants and sources). */
  faded: THREE.Material | THREE.Material[] | null;
}

/**
 * A registered occluder: bound, world cache, fade state and mesh slots.
 * NOTE (measured, V8 15 / Deno 2.9): no TypeScript constructor PARAMETER properties here. With
 * them the transpiled class defines its fields in a way that makes every later double store
 * allocate a fresh HeapNumber (~16 B per store, ~370 B per frame for 150 occluders); explicit
 * fields assigned in the constructor body keep the stores in place.
 */
class OccluderRecord {
  readonly root: THREE.Object3D;
  readonly kind: OccluderKind;
  shape: OccluderShape;
  style: FadeStyle;
  minOpacity: number;
  dynamic: boolean;
  precise: boolean;
  radiusOverride: number | undefined;
  /** Local AABB centre and half extents, root space, m. */
  lcx = 0; lcy = 0; lcz = 0; lhx = 0; lhy = 0; lhz = 0;
  /** Capsule radius in root space, m. */
  lcr = 0;
  /** World bounding sphere (broad phase), m. */
  wcx = 0; wcy = 0; wcz = 0; wr = 0;
  /** World capsule axis A->B and radius, m. */
  ax = 0; ay = 0; az = 0; bx = 0; by = 0; bz = 0; cr = 0;
  /** World -> root-space matrix (box test) and the root's axis scales. */
  readonly inv = new THREE.Matrix4();
  sx = 1; sy = 1; sz = 1;
  /** Current opacity and the opacity it eases toward, [0, 1] (Corridor.FadeState). */
  opacity = 1;
  targetOpacity = 1;
  /** Extra corridor radius this frame, m: tuning.releaseMargin while blocked (hysteresis), else 0. */
  margin = 0;
  blocked = false;
  isSubject = false;
  swapped = false;
  readonly slots: MeshSlot[] = [];
  readonly meshes: THREE.Mesh[] = [];

  constructor(root: THREE.Object3D, kind: OccluderKind, spec: OccluderSpec) {
    this.root = root;
    this.kind = kind;
    this.shape = spec.shape ?? DEFAULT_SHAPE[kind];
    this.style = spec.style ?? DEFAULT_STYLE[kind];
    this.minOpacity = spec.minOpacity ?? MIN_OPACITY[kind];
    this.dynamic = spec.dynamic ?? (kind === "fighter" || kind === "weapon");
    this.precise = spec.precise ?? false;
    this.radiusOverride = spec.radius;
  }
}

const scratchBox = new THREE.Box3();
const scratchMeshBox = new THREE.Box3();
const scratchRel = new THREE.Matrix4();
const scratchInv = new THREE.Matrix4();

/** Root-space AABB of `meshes` (geometry bounds through each mesh's transform relative to root). */
function localBoundsOf(root: THREE.Object3D, meshes: readonly THREE.Mesh[], out: THREE.Box3): THREE.Box3 {
  root.updateWorldMatrix(true, true);
  scratchInv.copy(root.matrixWorld).invert();
  out.makeEmpty();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox || g.boundingBox.isEmpty()) continue;
    scratchRel.multiplyMatrices(scratchInv, mesh.matrixWorld);
    out.union(scratchMeshBox.copy(g.boundingBox).applyMatrix4(scratchRel));
  }
  return out;
}

/** Whether `node` is `ancestor` or lies under it. */
function isWithin(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

/** Whether every material of the mesh is excluded from fading. */
function meshUnfadeable(mesh: THREE.Mesh): boolean {
  const m = mesh.material;
  if (Array.isArray(m)) return m.every((x) => isUnfadeable(x));
  return isUnfadeable(m);
}

/** The camera's eye radius, m: half the near-plane height of a perspective camera. */
function eyeRadiusOf(camera: THREE.Camera, fallback: number): number {
  const p = camera as THREE.PerspectiveCamera;
  if (p.isPerspectiveCamera) return Math.min(0.25, p.near * Math.tan((p.fov * Math.PI) / 360));
  return fallback;
}

/** Most target points the system supports (corridors are preallocated). */
const MAX_POINTS = 4;

/**
 * The occlusion system: register occluders, set the subject, call update(camera, dt) once per
 * frame before rendering. See the file header for the vocabulary.
 */
export class OccluderSystem {
  readonly tuning: OcclusionTuning;
  readonly stats: OcclusionStats = { registered: 0, narrowTests: 0, blocked: 0, fading: 0, variantsCreated: 0, rays: 0 };
  #records: OccluderRecord[] = [];
  #byRoot = new Map<THREE.Object3D, OccluderRecord>();
  #owner = new Map<THREE.Mesh, OccluderRecord>();
  #subject: THREE.Object3D | null = null;
  /** The subject's bound: its record, or a private one when the subject is not registered. */
  #subjectBound: OccluderRecord | null = null;
  #corridors: Corridor[] = [];
  #corridorCount = 0;
  /** Easing constants + this frame's step (an object, not arguments: see Corridor.ts header). */
  #timing: FadeTiming;
  /** Scratch input of Corridor.loadCorridor. */
  #corridorIn = new Float64Array(CORRIDOR_IN.LENGTH);
  #raycaster = new THREE.Raycaster();
  #rayOrigin = new THREE.Vector3();
  #rayDir = new THREE.Vector3();
  #hits: THREE.Intersection[] = [];

  constructor(tuning: Partial<OcclusionTuning> = {}) {
    this.tuning = { ...DEFAULT_OCCLUSION_TUNING, ...tuning };
    this.#timing = { fadeInHalfLife: this.tuning.fadeInHalfLife, fadeOutHalfLife: this.tuning.fadeOutHalfLife, snap: this.tuning.snap, dt: 0 };
    for (let i = 0; i < MAX_POINTS; i++) this.#corridors.push(new Corridor());
  }

  /** Registered occluder count. */
  get size(): number { return this.#records.length; }

  /**
   * Register `root` as an occluder. Meshes already owned by a registered DESCENDANT root stay
   * with it; registering a root inside an existing occluder takes those meshes over (so register
   * a fighter's weapon as "weapon" and its rig as "fighter", in any order). Re-registering a root
   * replaces it. Returns false (nothing registered) when the root is the sky/void/water
   * (NEVER_FADE_NAME) or has no fadeable mesh. Allocates: call at build time, not per frame.
   */
  register(root: THREE.Object3D, spec: OccluderSpec): boolean {
    if (NEVER_FADE_NAME.test(root.name)) return false;
    if (this.#byRoot.has(root)) this.unregister(root);
    const rec = new OccluderRecord(root, spec.kind, spec);
    const found: THREE.Mesh[] = [];
    this.#collect(root, root, found);
    const robbed = new Set<OccluderRecord>();
    for (const mesh of found) {
      if (NEVER_FADE_NAME.test(mesh.name) || meshUnfadeable(mesh)) continue;
      const owner = this.#owner.get(mesh);
      if (owner) { this.#releaseSlot(owner, mesh); robbed.add(owner); }
      rec.slots.push({ mesh, source: mesh.material, variants: null, faded: null });
      rec.meshes.push(mesh);
      this.#owner.set(mesh, rec);
    }
    for (const r of robbed) this.#computeBound(r);
    if (rec.slots.length === 0) return false;
    this.#computeBound(rec);
    rec.isSubject = this.#subject !== null && isWithin(root, this.#subject);
    this.#records.push(rec);
    this.#byRoot.set(root, rec);
    this.stats.registered = this.#records.length;
    if (root === this.#subject) this.#subjectBound = rec;
    return true;
  }

  /** Forget `root`: its meshes get their original materials back and its variants are freed. */
  unregister(root: THREE.Object3D): boolean {
    const rec = this.#byRoot.get(root);
    if (!rec) return false;
    this.#forget(rec);
    const i = this.#records.indexOf(rec);
    if (i >= 0) this.#records.splice(i, 1);
    this.stats.registered = this.#records.length;
    return true;
  }

  /** Unregister every occluder of the given kinds (all when omitted), e.g. at an arena rebuild. */
  clear(kinds?: readonly OccluderKind[]): void {
    const keep: OccluderRecord[] = [];
    for (const rec of this.#records) {
      if (kinds && !kinds.includes(rec.kind)) keep.push(rec);
      else this.#forget(rec);
    }
    this.#records = keep;
    this.stats.registered = keep.length;
  }

  /**
   * Set the viewed character (null: no subject — every occluder eases back to opaque). The
   * subject and every occluder inside it snap opaque and never fade. Cheap when unchanged.
   */
  setSubject(root: THREE.Object3D | null): void {
    if (root === this.#subject) return;
    this.#subject = root;
    this.#subjectBound = null;
    this.#resolveSubjectBound();
    for (const rec of this.#records) {
      rec.isSubject = root !== null && isWithin(rec.root, root);
      if (rec.isSubject && rec.opacity < 1) { rec.opacity = 1; rec.targetOpacity = 1; rec.blocked = false; this.#apply(rec); }
    }
  }

  /** The current opacity of `root`'s occluder (1 when not registered). */
  opacityOf(root: THREE.Object3D): number {
    return this.#byRoot.get(root)?.opacity ?? 1;
  }

  /** Whether `root`'s occluder blocked a view corridor in the last update. */
  isBlocked(root: THREE.Object3D): boolean {
    return this.#byRoot.get(root)?.blocked ?? false;
  }

  /**
   * One frame: build the corridors from `camera` to the subject's target points, test every
   * occluder, ease its opacity (dt in s, clamped to tuning.maxDt) and swap materials at fade
   * transitions. Perspective cameras view from their position; orthographic cameras along their
   * forward axis (parallel corridors). Allocation-free.
   */
  update(camera: THREE.Camera, dt: number): void {
    this.#prepareCorridors(camera);
    this.#timing.dt = Math.min(Math.max(0, dt), this.tuning.maxDt);
    this.#run();
  }

  /** Restore every original material and free every variant. */
  dispose(): void {
    this.clear();
    this.#subject = null;
    this.#subjectBound = null;
  }

  // -- per frame ------------------------------------------------------------------------------

  /**
   * The subject's bound: its own record when registered, else a private record holding only the
   * bound of all its meshes (allocates once per subject change, never in steady state).
   */
  #resolveSubjectBound(): void {
    const root = this.#subject;
    if (!root || this.#subjectBound) return;
    const own = this.#byRoot.get(root);
    if (own) { this.#subjectBound = own; return; }
    const rec = new OccluderRecord(root, "fighter", { kind: "fighter" });
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) rec.meshes.push(o as THREE.Mesh); });
    if (rec.meshes.length === 0) return;
    this.#computeBound(rec);
    this.#subjectBound = rec;
  }

  #prepareCorridors(camera: THREE.Camera): void {
    this.#corridorCount = 0;
    if (!this.#subjectBound) this.#resolveSubjectBound();
    const s = this.#subjectBound;
    if (!s) return;
    s.root.updateWorldMatrix(true, false);
    this.#refreshWorld(s);
    camera.updateWorldMatrix(true, false);
    const ce = camera.matrixWorld.elements;
    const camX = ce[12], camY = ce[13], camZ = ce[14];
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    // Camera forward = -Z column of its world matrix.
    let fx = -ce[8], fy = -ce[9], fz = -ce[10];
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    const eyeR = eyeRadiusOf(camera, this.tuning.defaultEyeRadius);
    // Subject frame: the bound's vertical axis in world, standing height in m.
    const e = s.root.matrixWorld.elements;
    const height = 2 * s.lhy * s.sy;
    const footY = s.lcy - s.lhy;
    const depth = this.tuning.subjectDepthPerHeight * height;
    const n = Math.min(MAX_POINTS, this.tuning.pointHeights.length);
    for (let i = 0; i < n; i++) {
      const ly = footY + this.tuning.pointHeights[i] * 2 * s.lhy;
      const tx = e[0] * s.lcx + e[4] * ly + e[8] * s.lcz + e[12];
      const ty = e[1] * s.lcx + e[5] * ly + e[9] * s.lcz + e[13];
      const tz = e[2] * s.lcx + e[6] * ly + e[10] * s.lcz + e[14];
      const tr = (this.tuning.pointRadii[i] ?? 0.1) * height;
      const c = this.#corridors[this.#corridorCount], b = this.#corridorIn;
      b[3] = tx; b[4] = ty; b[5] = tz; b[7] = tr; b[8] = depth;
      if (perspective) {
        b[0] = camX; b[1] = camY; b[2] = camZ; b[6] = eyeR;
      } else {
        // Parallel view: the eye is the target point pulled back to the camera plane.
        const along = (tx - camX) * fx + (ty - camY) * fy + (tz - camZ) * fz;
        if (along <= depth) continue;
        b[0] = tx - fx * along; b[1] = ty - fy * along; b[2] = tz - fz * along; b[6] = tr;
      }
      loadCorridor(c, b);
      if (c.tEnd > 0) this.#corridorCount++;
    }
  }

  #run(): void {
    let narrow = 0, blockedCount = 0, fading = 0, rays = 0;
    const records = this.#records, timing = this.#timing;
    for (let r = 0; r < records.length; r++) {
      const rec = records[r];
      let blocked = false;
      if (!rec.isSubject && this.#corridorCount > 0) {
        if (rec.dynamic) { rec.root.updateWorldMatrix(true, false); this.#refreshWorld(rec); }
        rec.margin = rec.blocked ? this.tuning.releaseMargin : 0;
        for (let i = 0; i < this.#corridorCount && !blocked; i++) {
          const c = this.#corridors[i];
          if (!sphereBlocksCorridor(c, rec)) continue;
          narrow++;
          blocked = this.#narrow(rec, c);
        }
        if (blocked && rec.precise) {
          blocked = false;
          for (let i = 0; i < this.#corridorCount && !blocked; i++) { rays++; blocked = this.#rayHits(rec, this.#corridors[i]); }
        }
        if (blocked) blockedCount++;
      }
      rec.blocked = blocked;
      rec.targetOpacity = blocked ? rec.minOpacity : 1;
      const before = rec.opacity;
      if (rec.isSubject) rec.opacity = 1;
      else stepFade(rec, timing);
      if (rec.opacity !== before || (rec.opacity < 1) !== rec.swapped) this.#apply(rec);
      if (rec.swapped) fading++;
    }
    this.stats.narrowTests = narrow;
    this.stats.blocked = blockedCount;
    this.stats.fading = fading;
    this.stats.rays = rays;
  }

  /** The shape test after the sphere broad phase passed (sphere occluders: that WAS the test). */
  #narrow(rec: OccluderRecord, c: Corridor): boolean {
    if (rec.shape === "sphere") return true;
    if (rec.shape === "capsule") return capsuleBlocksCorridor(c, rec);
    return boxBlocksCorridor(c, rec);
  }

  /** Precise confirmation: the central ray eye -> target point, up to tEnd, hits a mesh. */
  #rayHits(rec: OccluderRecord, c: Corridor): boolean {
    if (c.length <= 1e-6) return false;
    this.#rayOrigin.set(c.ex, c.ey, c.ez);
    this.#rayDir.set(c.dx / c.length, c.dy / c.length, c.dz / c.length);
    this.#raycaster.set(this.#rayOrigin, this.#rayDir);
    this.#raycaster.near = 0;
    this.#raycaster.far = c.length * c.tEnd;
    this.#hits.length = 0;
    this.#raycaster.intersectObjects(rec.meshes, false, this.#hits);
    const hit = this.#hits.length > 0;
    this.#hits.length = 0;
    return hit;
  }

  /** World bounding sphere, capsule axis and inverse matrix from the root's matrixWorld. */
  #refreshWorld(rec: OccluderRecord): void {
    const e = rec.root.matrixWorld.elements;
    // Axis scales = column lengths (Math.sqrt, not Math.hypot: hypot is a builtin call whose
    // double result V8 boxes on the heap — measured as per-frame garbage).
    rec.sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) || 1;
    rec.sy = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]) || 1;
    rec.sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]) || 1;
    const maxS = Math.max(rec.sx, rec.sy, rec.sz);
    rec.wcx = e[0] * rec.lcx + e[4] * rec.lcy + e[8] * rec.lcz + e[12];
    rec.wcy = e[1] * rec.lcx + e[5] * rec.lcy + e[9] * rec.lcz + e[13];
    rec.wcz = e[2] * rec.lcx + e[6] * rec.lcy + e[10] * rec.lcz + e[14];
    const hx = rec.lhx * rec.sx, hy = rec.lhy * rec.sy, hz = rec.lhz * rec.sz;
    rec.wr = Math.sqrt(hx * hx + hy * hy + hz * hz);
    if (rec.shape === "capsule") {
      // Vertical capsule through the bound centre; the end caps reach the bound's top and bottom.
      const half = Math.max(0, rec.lhy - rec.lcr);
      const y0 = rec.lcy - half, y1 = rec.lcy + half;
      rec.ax = e[0] * rec.lcx + e[4] * y0 + e[8] * rec.lcz + e[12];
      rec.ay = e[1] * rec.lcx + e[5] * y0 + e[9] * rec.lcz + e[13];
      rec.az = e[2] * rec.lcx + e[6] * y0 + e[10] * rec.lcz + e[14];
      rec.bx = e[0] * rec.lcx + e[4] * y1 + e[8] * rec.lcz + e[12];
      rec.by = e[1] * rec.lcx + e[5] * y1 + e[9] * rec.lcz + e[13];
      rec.bz = e[2] * rec.lcx + e[6] * y1 + e[10] * rec.lcz + e[14];
      rec.cr = rec.lcr * Math.max(rec.sx, rec.sz);
      // Broad phase: the capsule's own bounding sphere (tighter than the AABB's for a body).
      rec.wr = Math.min(rec.wr, half * rec.sy + rec.cr);
    } else if (rec.shape === "box") {
      rec.inv.copy(rec.root.matrixWorld).invert();
    } else {
      rec.wr = Math.min(rec.wr, maxS * Math.sqrt(rec.lhx * rec.lhx + rec.lhy * rec.lhy + rec.lhz * rec.lhz));
    }
  }

  // -- registration helpers (allocate; build time only) ---------------------------------------

  /** Meshes under `node`, not descending into OTHER registered roots. */
  #collect(node: THREE.Object3D, root: THREE.Object3D, out: THREE.Mesh[]): void {
    if (node !== root && this.#byRoot.has(node)) return;
    if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh);
    for (const child of node.children) this.#collect(child, root, out);
  }

  #computeBound(rec: OccluderRecord): void {
    const box = localBoundsOf(rec.root, rec.meshes, scratchBox);
    if (box.isEmpty()) { rec.lcx = rec.lcy = rec.lcz = rec.lhx = rec.lhy = rec.lhz = rec.lcr = 0; }
    else {
      rec.lcx = (box.min.x + box.max.x) / 2; rec.lcy = (box.min.y + box.max.y) / 2; rec.lcz = (box.min.z + box.max.z) / 2;
      rec.lhx = (box.max.x - box.min.x) / 2; rec.lhy = (box.max.y - box.min.y) / 2; rec.lhz = (box.max.z - box.min.z) / 2;
      rec.lcr = rec.radiusOverride ?? Math.min(Math.max(rec.lhx, rec.lhz), this.tuning.capsuleRadiusPerHeight * 2 * rec.lhy);
    }
    this.#refreshWorld(rec);
  }

  /** Give `mesh` back its original material and drop it from `rec` (another occluder takes it). */
  #releaseSlot(rec: OccluderRecord, mesh: THREE.Mesh): void {
    const i = rec.slots.findIndex((s) => s.mesh === mesh);
    if (i < 0) return;
    this.#restoreSlot(rec.slots[i]);
    this.#disposeSlot(rec.slots[i]);
    rec.slots.splice(i, 1);
    const j = rec.meshes.indexOf(mesh);
    if (j >= 0) rec.meshes.splice(j, 1);
    this.#owner.delete(mesh);
  }

  #forget(rec: OccluderRecord): void {
    for (const slot of rec.slots) {
      this.#restoreSlot(slot);
      this.#disposeSlot(slot);
      if (this.#owner.get(slot.mesh) === rec) this.#owner.delete(slot.mesh);
    }
    rec.slots.length = 0;
    rec.meshes.length = 0;
    rec.swapped = false;
    rec.opacity = 1;
    if (this.#byRoot.get(rec.root) === rec) this.#byRoot.delete(rec.root);
    if (this.#subjectBound === rec) this.#subjectBound = null;
  }

  // -- materials (transitions only) -----------------------------------------------------------

  #apply(rec: OccluderRecord): void {
    if (rec.opacity >= 1) {
      if (rec.swapped) { for (const slot of rec.slots) this.#restoreSlot(slot); rec.swapped = false; }
      return;
    }
    if (!rec.swapped) { for (const slot of rec.slots) this.#swapIn(rec, slot); rec.swapped = true; }
    for (let s = 0; s < rec.slots.length; s++) {
      const vs = rec.slots[s].variants;
      if (!vs) continue;
      for (let v = 0; v < vs.length; v++) vs[v]?.setOpacity(rec);
    }
  }

  #swapIn(rec: OccluderRecord, slot: MeshSlot): void {
    const current = slot.mesh.material;
    if (current !== slot.source && current !== slot.faded) {
      // The game replaced the material since registration: adopt it as the new source.
      this.#disposeSlot(slot);
      slot.source = current;
    }
    if (!slot.variants) {
      const sources = Array.isArray(slot.source) ? slot.source : [slot.source];
      slot.variants = sources.map((m) => (isUnfadeable(m) || isFadeVariant(m) ? null : createFadeVariant(m, rec.style)));
      for (const v of slot.variants) if (v) this.stats.variantsCreated++;
      slot.faded = Array.isArray(slot.source)
        ? slot.variants.map((v, i) => v?.material ?? sources[i])
        : slot.variants[0]?.material ?? slot.source;
    } else {
      for (const v of slot.variants) v?.syncFromSource();
    }
    slot.mesh.material = slot.faded!;
  }

  #restoreSlot(slot: MeshSlot): void {
    if (slot.faded === null) return;
    if (slot.mesh.material === slot.faded) slot.mesh.material = slot.source;
    else if (slot.mesh.material !== slot.source) {
      // Replaced by the game while faded: keep the game's material, drop the stale variants.
      slot.source = slot.mesh.material;
      this.#disposeSlot(slot);
    }
  }

  #disposeSlot(slot: MeshSlot): void {
    if (slot.variants) for (const v of slot.variants) v?.dispose();
    slot.variants = null;
    slot.faded = null;
  }
}
