// Render pipeline (wave G): scene -> HDR target (MSAA, depth texture) -> effects at reduced
// resolution (AO + GI + contact shadows, depth-aware blur) -> ray-marched reflections -> composite
// to the canvas (cloud shadows, ink edges, grading, rain, lightning, tone map + sRGB).
//
// Vocabulary: "output" = the canvas drawing buffer (set by the resolution choice); "render scale" =
// the scene target as a fraction of the output (dynamic resolution); "effects scale" = the AO/GI and
// SSR buffers as a fraction of the scene target. When the quality turns the pipeline off the scene
// is drawn straight to the canvas (the old path, cheapest).
// @deno-types="@types/three"
import * as THREE from "three";
import type { RenderQuality } from "./Quality.ts";
import { BLUR_FRAGMENT, COMPOSITE_FRAGMENT, EFFECTS_FRAGMENT, FULLSCREEN_VERTEX, SSR_FRAGMENT } from "./PostShaders.ts";

/** Per-frame inputs the engine supplies (world state that shades the post passes). */
export interface PostFrame {
  /** Unit direction TOWARD the key light, world space. */
  lightWorld: THREE.Vector3;
  /** Unit direction toward the sun, world space (cloud shadows; may differ from the key light at night). */
  sunWorld: THREE.Vector3;
  /** Share of the light that is direct (0..1): how much contact/cloud shadows can remove. */
  direct: number;
  exposure: number;
  saturation: number;
  wetness: number;
  gi: number;
  cloudShadow: number;
  cloudAtOrigin: number;
  rain: number;
  lightning: number;
  time: number;
  horizon: THREE.Color;
  zenith: THREE.Color;
  /** The sky's packed cloud layers (CloudField.packCloudLayers), shared by reference. */
  clouds: Float32Array;
  /** Situational events (WorldEvents effects): linear grade tint, heat shimmer, snowfall, wind slant. */
  tint: THREE.Color;
  shimmer: number;
  snow: number;
  slant: number;
}

/** What the last frame cost and how it was configured (snapshot / QA). */
export interface PipelineStats {
  post: boolean;
  outputWidth: number;
  outputHeight: number;
  sceneWidth: number;
  sceneHeight: number;
  effectsWidth: number;
  effectsHeight: number;
  renderScale: number;
  msaa: number;
  aoSamples: number;
  gi: boolean;
  contactSteps: number;
  ssrSteps: number;
  inkEdges: boolean;
  passes: number;
}

const INK = new THREE.Color("#172128");

function makeTarget(w: number, h: number, opts: { samples?: number; depth?: boolean; type?: THREE.TextureDataType } = {}): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: opts.type ?? THREE.HalfFloatType,
    samples: opts.samples ?? 0,
    depthBuffer: !!opts.depth,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  if (opts.depth) {
    t.depthTexture = new THREE.DepthTexture(Math.max(1, w), Math.max(1, h), THREE.FloatType);
    t.depthTexture.minFilter = THREE.NearestFilter;
    t.depthTexture.magFilter = THREE.NearestFilter;
  }
  return t;
}

export class RenderPipeline {
  #renderer: THREE.WebGLRenderer;
  #quality: RenderQuality;
  #scene!: THREE.WebGLRenderTarget;
  #fxA!: THREE.WebGLRenderTarget;
  #fxB!: THREE.WebGLRenderTarget;
  #ssr!: THREE.WebGLRenderTarget;
  #quadScene = new THREE.Scene();
  #quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  #quad: THREE.Mesh;
  #effectsMat!: THREE.ShaderMaterial;
  #blurMat!: THREE.ShaderMaterial;
  #ssrMat!: THREE.ShaderMaterial;
  #compositeMat!: THREE.ShaderMaterial;
  #outW = 1;
  #outH = 1;
  #renderScale = 1;
  #frame = 0;
  #viewUp = new THREE.Vector3();
  #lightView = new THREE.Vector3();
  #stats: PipelineStats;

  constructor(renderer: THREE.WebGLRenderer, quality: RenderQuality) {
    this.#renderer = renderer;
    this.#quality = { ...quality };
    this.#quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.#quad.frustumCulled = false;
    this.#quadScene.add(this.#quad);
    this.#stats = this.#emptyStats();
    this.#buildMaterials();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.#outW = size.x; this.#outH = size.y;
    this.#buildTargets();
  }

  #emptyStats(): PipelineStats {
    return { post: false, outputWidth: 0, outputHeight: 0, sceneWidth: 0, sceneHeight: 0, effectsWidth: 0, effectsHeight: 0, renderScale: 1, msaa: 0, aoSamples: 0, gi: false, contactSteps: 0, ssrSteps: 0, inkEdges: false, passes: 0 };
  }

  #common(): Record<string, THREE.IUniform> {
    return {
      tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
      uDepthTexel: { value: new THREE.Vector2(1, 1) }, uOrtho: { value: 0 },
    };
  }

  #buildMaterials() {
    for (const m of [this.#effectsMat, this.#blurMat, this.#ssrMat, this.#compositeMat]) m?.dispose();
    const q = this.#quality;
    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number>, toneMapped = false) =>
      new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped });
    this.#effectsMat = mk(EFFECTS_FRAGMENT, {
      ...this.#common(), tScene: { value: null }, uLightView: { value: new THREE.Vector3(0, 1, 0) }, uRadius: { value: 0.9 },
      uAoIntensity: { value: 1.1 }, uDirect: { value: 0.6 }, uContactLength: { value: 0.9 }, uFrame: { value: 0 },
    }, { AO_SAMPLES: Math.max(1, q.aoSamples), USE_GI: q.gi ? 1 : 0, CONTACT_STEPS: q.contactSteps });
    this.#blurMat = mk(BLUR_FRAGMENT, { ...this.#common(), tInput: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } }, {});
    this.#ssrMat = mk(SSR_FRAGMENT, {
      ...this.#common(), tScene: { value: null }, uViewUp: { value: new THREE.Vector3(0, 1, 0) },
      uHorizon: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uWetness: { value: 0 }, uMaxDistance: { value: 30 },
    }, { SSR_STEPS: Math.max(1, q.ssrSteps) });
    this.#compositeMat = mk(COMPOSITE_FRAGMENT, {
      ...this.#common(), tScene: { value: null }, tEffects: { value: null }, tSSR: { value: null },
      uClouds: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
      uViewInv: { value: new THREE.Matrix4() }, uSunWorld: { value: new THREE.Vector3(0, 1, 0) },
      uCloudShadow: { value: 0 }, uCloudAtOrigin: { value: 0 }, uDirect: { value: 0.6 }, uGi: { value: 0.8 },
      uInkColor: { value: INK.clone() }, uInk: { value: 0.85 }, uInkScale: { value: 1 },
      uExposure: { value: 1 }, uSaturation: { value: 1 }, uRain: { value: 0 }, uLightning: { value: 0 }, uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTint: { value: new THREE.Color(1, 1, 1) }, uShimmer: { value: 0 }, uSnow: { value: 0 }, uSlant: { value: 0 },
    }, {
      USE_EFFECTS: q.aoSamples > 0 || q.gi || q.contactSteps > 0 ? 1 : 0, USE_SSR: q.ssrSteps > 0 ? 1 : 0, USE_INK: q.inkEdges ? 1 : 0,
      CLOUD_OCTAVES: Math.max(2, Math.min(4, q.skyOctaves - 1)),
    }, true);
  }

  #buildTargets() {
    for (const t of [this.#scene, this.#fxA, this.#fxB, this.#ssr]) t?.dispose();
    const q = this.#quality;
    const sw = Math.max(1, Math.round(this.#outW * this.#renderScale)), sh = Math.max(1, Math.round(this.#outH * this.#renderScale));
    const ew = Math.max(1, Math.round(sw * q.effectsScale)), eh = Math.max(1, Math.round(sh * q.effectsScale));
    this.#scene = makeTarget(sw, sh, { samples: q.msaa, depth: true });
    this.#fxA = makeTarget(ew, eh);
    this.#fxB = makeTarget(ew, eh);
    this.#ssr = makeTarget(ew, eh);
  }

  get enabled(): boolean { return this.#quality.post; }

  /** Change quality knobs; rebuilds shaders and targets only when something they depend on changed. */
  setQuality(q: RenderQuality) {
    const old = this.#quality;
    this.#quality = { ...q };
    if (old.aoSamples !== q.aoSamples || old.gi !== q.gi || old.contactSteps !== q.contactSteps || old.ssrSteps !== q.ssrSteps || old.inkEdges !== q.inkEdges || old.skyOctaves !== q.skyOctaves) this.#buildMaterials();
    if (old.msaa !== q.msaa || old.effectsScale !== q.effectsScale) this.#buildTargets();
  }

  /** The canvas drawing-buffer size changed (resolution choice or window resize). */
  setOutputSize(w: number, h: number) {
    if (w === this.#outW && h === this.#outH) return;
    this.#outW = w; this.#outH = h;
    this.#buildTargets();
  }

  /** Dynamic resolution: the scene target as a fraction of the output (0.5..1). Rebuilds on a real change only. */
  setRenderScale(s: number) {
    const v = Math.max(0.5, Math.min(1, Math.round(s * 100) / 100));
    if (Math.abs(v - this.#renderScale) < 0.005) return;
    this.#renderScale = v;
    this.#buildTargets();
  }

  #fullscreen(mat: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.#quad.material = mat;
    this.#renderer.setRenderTarget(target);
    this.#renderer.render(this.#quadScene, this.#quadCam);
  }

  #setCamera(mat: THREE.ShaderMaterial, cam: THREE.Camera, texelW: number, texelH: number) {
    const u = mat.uniforms;
    u.tDepth.value = this.#scene.depthTexture;
    (u.uProj.value as THREE.Matrix4).copy(cam.projectionMatrix);
    (u.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (u.uDepthTexel.value as THREE.Vector2).set(1 / texelW, 1 / texelH);
    u.uOrtho.value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
  }

  /** Draw one frame. Without the pipeline (quality.post false) this is a plain render to the canvas. */
  render(scene: THREE.Scene, camera: THREE.Camera, f: PostFrame) {
    const r = this.#renderer;
    const q = this.#quality;
    if (!q.post) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      this.#stats = { ...this.#emptyStats(), outputWidth: this.#outW, outputHeight: this.#outH, sceneWidth: this.#outW, sceneHeight: this.#outH, renderScale: 1, passes: 1 };
      return;
    }
    this.#frame = (this.#frame + 1) % 64;
    const sw = this.#scene.width, sh = this.#scene.height;
    r.setRenderTarget(this.#scene);
    r.render(scene, camera);
    let passes = 1;

    camera.updateMatrixWorld();
    this.#viewUp.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    this.#lightView.copy(f.lightWorld).transformDirection(camera.matrixWorldInverse);
    const useEffects = q.aoSamples > 0 || q.gi || q.contactSteps > 0;
    if (useEffects) {
      const e = this.#effectsMat;
      this.#setCamera(e, camera, sw, sh);
      e.uniforms.tScene.value = this.#scene.texture;
      (e.uniforms.uLightView.value as THREE.Vector3).copy(this.#lightView);
      e.uniforms.uDirect.value = f.direct;
      e.uniforms.uFrame.value = this.#frame;
      this.#fullscreen(e, this.#fxA);
      const b = this.#blurMat;
      this.#setCamera(b, camera, sw, sh);
      b.uniforms.tInput.value = this.#fxA.texture;
      (b.uniforms.uDir.value as THREE.Vector2).set(1 / this.#fxA.width, 0);
      this.#fullscreen(b, this.#fxB);
      b.uniforms.tInput.value = this.#fxB.texture;
      (b.uniforms.uDir.value as THREE.Vector2).set(0, 1 / this.#fxA.height);
      this.#fullscreen(b, this.#fxA);
      passes += 3;
    }
    if (q.ssrSteps > 0) {
      const s = this.#ssrMat;
      this.#setCamera(s, camera, sw, sh);
      s.uniforms.tScene.value = this.#scene.texture;
      (s.uniforms.uViewUp.value as THREE.Vector3).copy(this.#viewUp);
      (s.uniforms.uHorizon.value as THREE.Color).copy(f.horizon);
      (s.uniforms.uZenith.value as THREE.Color).copy(f.zenith);
      s.uniforms.uWetness.value = f.wetness;
      this.#fullscreen(s, this.#ssr);
      passes += 1;
    }
    const c = this.#compositeMat;
    this.#setCamera(c, camera, sw, sh);
    const u = c.uniforms;
    u.tScene.value = this.#scene.texture;
    u.tEffects.value = this.#fxA.texture;
    u.tSSR.value = this.#ssr.texture;
    const cv = u.uClouds.value as THREE.Vector4[];
    for (let i = 0; i < 16; i++) cv[i].fromArray(f.clouds, i * 4);
    (u.uViewInv.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.uSunWorld.value as THREE.Vector3).copy(f.sunWorld);
    u.uCloudShadow.value = f.cloudShadow;
    u.uCloudAtOrigin.value = f.cloudAtOrigin;
    u.uDirect.value = f.direct;
    u.uGi.value = f.gi;
    u.uInkScale.value = Math.max(1, this.#outH / 1080);
    u.uExposure.value = f.exposure;
    u.uSaturation.value = f.saturation;
    u.uRain.value = f.rain;
    u.uLightning.value = f.lightning;
    u.uTime.value = f.time % 1000;
    (u.uTint.value as THREE.Color).copy(f.tint);
    u.uShimmer.value = f.shimmer;
    u.uSnow.value = f.snow;
    u.uSlant.value = f.slant;
    (u.uResolution.value as THREE.Vector2).set(this.#outW, this.#outH);
    this.#fullscreen(c, null);
    passes += 1;
    this.#stats = {
      post: true, outputWidth: this.#outW, outputHeight: this.#outH, sceneWidth: sw, sceneHeight: sh,
      effectsWidth: this.#fxA.width, effectsHeight: this.#fxA.height, renderScale: this.#renderScale,
      msaa: q.msaa, aoSamples: q.aoSamples, gi: q.gi, contactSteps: q.contactSteps, ssrSteps: q.ssrSteps, inkEdges: q.inkEdges, passes,
    };
  }

  stats(): PipelineStats { return { ...this.#stats }; }

  /** Compiled-program diagnostics of the post materials (QA: a GLSL error shows here). */
  materials(): THREE.ShaderMaterial[] { return [this.#effectsMat, this.#blurMat, this.#ssrMat, this.#compositeMat]; }

  dispose() {
    for (const t of [this.#scene, this.#fxA, this.#fxB, this.#ssr]) t.dispose();
    for (const m of this.materials()) m.dispose();
    this.#quad.geometry.dispose();
  }
}
