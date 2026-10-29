// Lane O (V01): the occluder system on a synthetic THREE scene (no renderer needed).
// @deno-types="@types/three"
import * as THREE from "three";
import { OccluderSystem } from "../src/graphics/occlusion/Occluders.ts";
import { createFadeVariant, isFadeVariant, OCCLUSION_OPACITY_UNIFORM } from "../src/graphics/occlusion/FadeMaterials.ts";
import { celLighting, createCelMesh } from "../src/graphics/shaders/CelShader.ts";
import { createCelSkinnedMesh } from "../src/graphics/shaders/CelSkinned.ts";
import { createWeaponCelMaterial, createWeaponOutlineMaterial } from "../src/graphics/weapons/WeaponMaterial.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }

/** A 1.7 m subject (feet at y 0) at the origin, a camera 6 m behind it at 1.6 m, looking at its chest. */
function stage() {
  const scene = new THREE.Scene();
  const subject = new THREE.Group();
  subject.name = "subject";
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.3), new THREE.MeshLambertMaterial());
  body.position.y = 0.85;
  subject.add(body);
  scene.add(subject);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 300);
  camera.position.set(0, 1.6, 6);
  camera.lookAt(0, 1.2, 0);
  scene.add(camera);
  const system = new OccluderSystem();
  system.setSubject(subject);
  return { scene, subject, camera, system };
}

function box(scene: THREE.Scene, x: number, y: number, z: number, w: number, h: number, d: number, mat?: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat ?? new THREE.MeshLambertMaterial({ color: "#888" }));
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}

function run(system: OccluderSystem, camera: THREE.Camera, seconds: number, hz = 60) {
  const frames = Math.round(seconds * hz);
  for (let i = 0; i < frames; i++) system.update(camera, 1 / hz);
}

Deno.test("a pillar squarely between camera and subject fades to its minimum within ~0.3 s", () => {
  const { scene, camera, system } = stage();
  const pillar = box(scene, 0, 1.5, 3, 0.6, 3, 0.6);
  assert(system.register(pillar, { kind: "prop" }), "registered");
  run(system, camera, 0.3);
  const a = system.opacityOf(pillar);
  assert(system.isBlocked(pillar), "blocked");
  assert(a <= 0.15 + 0.05 * 0.85 + 1e-6, `95% faded after 0.3 s: ${a}`);
  const mat = pillar.material as THREE.MeshLambertMaterial;
  assert(isFadeVariant(mat) && mat.transparent && !mat.depthWrite, "alpha variant: transparent, no depth write");
  assert(Math.abs(mat.opacity - a) < 1e-9, "variant opacity = eased opacity");
  run(system, camera, 0.5);
  assert(Math.abs(system.opacityOf(pillar) - 0.15) < 0.01, `settles at the prop minimum 0.15: ${system.opacityOf(pillar)}`);
});

Deno.test("a pillar beside the corridor and one behind the subject stay opaque", () => {
  const { scene, camera, system } = stage();
  const beside = box(scene, 2.5, 1.5, 3, 0.6, 3, 0.6);
  const behind = box(scene, 0, 1.5, -2, 0.6, 3, 0.6);
  const behindWall = box(scene, 0, 1.5, -0.7, 4, 3, 0.35); // a wall right at the subject's back
  const mats = [beside.material, behind.material, behindWall.material];
  for (const m of [beside, behind, behindWall]) system.register(m, { kind: "wall" });
  run(system, camera, 1);
  for (const m of [beside, behind, behindWall]) assert(system.opacityOf(m) === 1, `${m.position.toArray()} stays opaque`);
  assert(beside.material === mats[0] && behind.material === mats[1] && behindWall.material === mats[2], "original materials kept");
});

Deno.test("a low pillar hiding only the legs still fades", () => {
  const { scene, camera, system } = stage();
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.7, 12), new THREE.MeshLambertMaterial());
  stump.position.set(0, 0.35, 1.2);
  scene.add(stump);
  system.register(stump, { kind: "prop" });
  run(system, camera, 0.5);
  assert(system.isBlocked(stump), "the knee corridor is blocked");
  assert(system.opacityOf(stump) < 0.2, `legs-only blocker fades: ${system.opacityOf(stump)}`);
  // Proof it is the KNEE corridor: without the knee point the same stump stays opaque.
  const headChestOnly = new OccluderSystem({ pointHeights: [0.9, 0.7], pointRadii: [0.05, 0.13] });
  const s0 = new THREE.Mesh(stump.geometry, new THREE.MeshLambertMaterial());
  s0.position.copy(stump.position);
  scene.add(s0);
  headChestOnly.setSubject(scene.getObjectByName("subject")!);
  headChestOnly.register(s0, { kind: "prop" });
  run(headChestOnly, camera, 0.5);
  assert(headChestOnly.opacityOf(s0) === 1, "head + chest corridors pass over the stump");
  // Same stump moved 2 m aside: no corridor touches it.
  const aside = stage();
  const s2 = new THREE.Mesh(stump.geometry, new THREE.MeshLambertMaterial());
  s2.position.set(2, 0.35, 1.2);
  aside.scene.add(s2);
  aside.system.register(s2, { kind: "prop" });
  run(aside.system, aside.camera, 0.5);
  assert(aside.system.opacityOf(s2) === 1, "aside stays opaque");
});

Deno.test("opacity after 0.5 s is the same at 30, 60 and 144 Hz", () => {
  const results: number[] = [];
  for (const hz of [30, 60, 144]) {
    const { scene, camera, system } = stage();
    const p = box(scene, 0, 1.5, 3, 0.6, 3, 0.6);
    system.register(p, { kind: "prop", dynamic: true });
    // 1/6 s blocked, then moved away for 1/3 s (mid-release: no snap).
    const frames = Math.round(hz / 2), blockFrames = Math.round(hz / 6);
    for (let i = 0; i < frames; i++) {
      if (i === blockFrames) p.position.x = 8;
      system.update(camera, 1 / hz);
    }
    results.push(system.opacityOf(p));
  }
  assert(results[0] < 1 && results[0] > 0.15, `mid-release value ${results[0]}`);
  assert(Math.abs(results[0] - results[1]) < 1e-9 && Math.abs(results[1] - results[2]) < 1e-9, `30/60/144 Hz: ${results.join(" ")}`);
});

Deno.test("shared materials of non-occluding objects are untouched; the original comes back", () => {
  const { scene, camera, system } = stage();
  const shared = new THREE.MeshLambertMaterial({ color: "#6f7470" });
  const blocking = box(scene, 0, 1.5, 3, 0.6, 3, 0.6, shared);
  const clear = box(scene, 3, 1.5, 3, 0.6, 3, 0.6, shared);
  system.register(blocking, { kind: "prop", dynamic: true });
  system.register(clear, { kind: "prop" });
  run(system, camera, 0.5);
  assert(blocking.material !== shared, "the blocker wears its own variant");
  assert(clear.material === shared, "the other prop keeps the shared material");
  assert(shared.opacity === 1 && !shared.transparent && shared.depthWrite, "shared material never mutated");
  blocking.position.x = -6;
  run(system, camera, 3);
  assert(system.opacityOf(blocking) === 1, "released");
  assert(blocking.material === shared, "the original material is back after the fade");
  // Fade again: the SAME variant is reused (created once).
  const created = system.stats.variantsCreated;
  blocking.position.x = 0;
  run(system, camera, 0.5);
  assert(system.stats.variantsCreated === created, "variant reused, not recreated");
});

Deno.test("the other fighter (cel surface + ink hull) dithers to 0.35; the hull fades in lockstep", () => {
  const { scene, camera, system } = stage();
  const other = createCelMesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 8), "#ef7455");
  other.children.forEach((c) => (c.position.y = 0.8));
  other.position.set(0, 0, 2.5);
  scene.add(other);
  const [surface, outline] = other.children as THREE.Mesh[];
  const surfaceSrc = surface.material as THREE.ShaderMaterial, outlineSrc = outline.material as THREE.ShaderMaterial;
  assert(system.register(other, { kind: "fighter" }), "fighter registered");
  run(system, camera, 1);
  const sv = surface.material as THREE.ShaderMaterial, ov = outline.material as THREE.ShaderMaterial;
  assert(isFadeVariant(sv) && isFadeVariant(ov), "both swapped to dither variants");
  assert(sv.fragmentShader.includes("occlusionBayer4") && ov.fragmentShader.includes("occlusionBayer4"), "discard injected");
  assert(!sv.transparent && sv.depthWrite, "dither stays in the opaque pass");
  const su = sv.uniforms[OCCLUSION_OPACITY_UNIFORM].value as number, ou = ov.uniforms[OCCLUSION_OPACITY_UNIFORM].value as number;
  assert(Math.abs(su - 0.35) < 0.01 && su === ou, `surface ${su} = hull ${ou} ~ 0.35`);
  assert(sv.uniforms.lightDirection === celLighting.lightDirection, "lighting uniform shared by reference");
  assert(sv.uniforms.baseColor === surfaceSrc.uniforms.baseColor, "base colour shared with the source");
  assert(!surfaceSrc.fragmentShader.includes("occlusionBayer4") && !outlineSrc.fragmentShader.includes("discard"), "sources untouched");
});

Deno.test("the subject and its own weapon never fade; a nested weapon is its own occluder", () => {
  const { scene, subject, camera, system } = stage();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.02), createWeaponCelMaterial());
  blade.position.set(0, 1.2, 1.0); // held out toward the camera, in front of the chest
  subject.add(blade);
  system.register(subject, { kind: "fighter" });
  system.register(blade, { kind: "weapon" });
  run(system, camera, 1);
  assert(system.opacityOf(subject) === 1 && system.opacityOf(blade) === 1, "subject and its blade stay opaque");
  // Another fighter becomes the subject: the blade now stands between the camera and IT.
  const other = new THREE.Group();
  other.add(box(scene, 0, 0.85, 0, 0.5, 1.7, 0.3));
  other.position.set(0, 0, -1.5);
  scene.add(other);
  system.setSubject(other);
  run(system, camera, 1);
  assert(system.opacityOf(blade) < 0.4, `the blade fades for the new subject: ${system.opacityOf(blade)}`);
  // The old subject now stands between the camera and the new one: it fades like any fighter.
  const bodyMesh = subject.children[0] as THREE.Mesh;
  assert(system.opacityOf(subject) < 0.4, `old subject fades: ${system.opacityOf(subject)}`);
  assert(isFadeVariant(bodyMesh.material as THREE.Material), "its Lambert body wears the built-in dither variant");
  assert(!blade.parent || isFadeVariant(blade.material as THREE.Material), "the blade wears its own variant");
});

Deno.test("the sky, void and water are never registered", () => {
  const { scene, system } = stage();
  for (const name of ["sky-dome", "void-plane", "surround-water"]) {
    const m = box(scene, 0, 0, 3, 50, 1, 50);
    m.name = name;
    assert(!system.register(m, { kind: "terrain" }), `${name} refused`);
  }
  assert(system.size === 0, "nothing registered");
});

Deno.test("orthographic (isometric) view: parallel corridors", () => {
  const { scene, camera: _persp, system } = stage();
  const iso = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 100);
  iso.position.set(8, 9, 8);
  iso.lookAt(0, 0.8, 0);
  scene.add(iso);
  // On the iso view line from the chest toward the camera, 2 m out.
  const dir = new THREE.Vector3(8, 9 - 1.2, 8).normalize();
  const p = box(scene, dir.x * 2, 1.2 + dir.y * 2, dir.z * 2, 0.8, 0.8, 0.8);
  const off = box(scene, -3, 0.5, 3, 0.8, 1, 0.8);
  system.register(p, { kind: "prop" });
  system.register(off, { kind: "prop" });
  run(system, iso, 0.5);
  assert(system.opacityOf(p) < 0.2, `iso blocker fades: ${system.opacityOf(p)}`);
  assert(system.opacityOf(off) === 1, "off-line prop stays");
});

Deno.test("every cel material of the game gets a working dither variant", () => {
  const bone = new THREE.Bone();
  const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const count = geo.attributes.position.count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const skinned = createCelSkinnedMesh(geo, new THREE.Skeleton([bone]), "#ffffff");
  const cel = createCelMesh(geo, "#ffffff");
  const sources: THREE.Material[] = [
    ...(cel.children as THREE.Mesh[]).map((m) => m.material as THREE.Material),
    skinned.surface.material as THREE.Material, skinned.outline.material as THREE.Material,
    createWeaponCelMaterial(), createWeaponOutlineMaterial(),
  ];
  for (const src of sources) {
    const v = createFadeVariant(src, "alpha")!; // ShaderMaterials always dither
    assert(v && v.style === "dither", `${src.name || src.type} dithers`);
    const sm = v.material as THREE.ShaderMaterial;
    assert(sm.fragmentShader.includes("discard") && sm.vertexShader === (src as THREE.ShaderMaterial).vertexShader, "fragment injected, vertex shared");
    v.setOpacity({ opacity: 0.5 });
    assert(sm.uniforms[OCCLUSION_OPACITY_UNIFORM].value === 0.5, "opacity uniform");
    v.dispose();
  }
  // Built-in (face parts are Lambert): onBeforeCompile injects into the library shader.
  const lambert = new THREE.MeshLambertMaterial({ color: "#172128" });
  const v = createFadeVariant(lambert, "dither")!;
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, vertexShader: THREE.ShaderLib.lambert.vertexShader };
  v.material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  assert(shader.fragmentShader.includes("occlusionBayer4") && OCCLUSION_OPACITY_UNIFORM in shader.uniforms, "built-in dither injected");
  assert(v.material.customProgramCacheKey() !== lambert.customProgramCacheKey(), "its own program");
});

Deno.test("precise occluders: an arch whose OPENING frames the subject stays opaque; without precise it fades", () => {
  const build = () => {
    const s = stage();
    const gate = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial();
    for (const [x, y, w, h] of [[-1.1, 1.5, 0.5, 3], [1.1, 1.5, 0.5, 3], [0, 3.25, 2.7, 0.5]]) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), mat);
      part.position.set(x, y, 0);
      gate.add(part);
    }
    gate.position.set(0, 0, 3);
    s.scene.add(gate);
    return { ...s, gate };
  };
  const loose = build();
  loose.system.register(loose.gate, { kind: "prop" });
  run(loose.system, loose.camera, 0.5);
  assert(loose.system.opacityOf(loose.gate) < 0.2, "bound-only test: the gate's box covers the view -> fades");
  const exact = build();
  exact.system.register(exact.gate, { kind: "prop", precise: true });
  run(exact.system, exact.camera, 0.5);
  assert(exact.system.opacityOf(exact.gate) === 1, "raycast: the view passes through the opening -> stays opaque");
  assert(exact.system.stats.rays > 0, "precise rays were cast");
});

Deno.test("unregister restores the original material of a faded occluder", () => {
  const { scene, camera, system } = stage();
  const mat = new THREE.MeshLambertMaterial();
  const p = box(scene, 0, 1.5, 3, 0.6, 3, 0.6, mat);
  system.register(p, { kind: "prop" });
  run(system, camera, 0.3);
  assert(p.material !== mat, "faded");
  assert(system.unregister(p) && p.material === mat && system.size === 0, "restored and forgotten");
});

Deno.test("clear(kinds) restores materials and forgets only those kinds", () => {
  const { scene, camera, system } = stage();
  const wallMat = new THREE.MeshLambertMaterial();
  const wall = box(scene, 0, 1.5, 3, 4, 3, 0.35, wallMat);
  const fighterish = box(scene, 0, 0.8, 2, 0.5, 1.6, 0.3);
  system.register(wall, { kind: "wall" });
  system.register(fighterish, { kind: "fighter" });
  run(system, camera, 0.5);
  assert(wall.material !== wallMat, "wall faded");
  system.clear(["wall", "prop"]);
  assert(wall.material === wallMat, "wall material restored at clear");
  assert(system.size === 1, "the fighter stays registered");
});
