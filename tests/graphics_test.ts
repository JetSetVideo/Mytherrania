// @deno-types="@types/three"
import * as THREE from "three";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("cel mesh shares geometry with a back-face inverted hull and linear color", async () => {
  const modulePath = "../src/graphics/shaders/CelShader.ts";
  const { createCelMesh } = await import(modulePath);
  const geometry = new THREE.BoxGeometry();
  const group: THREE.Group = createCelMesh(geometry, "#dfaa55");
  assert(group instanceof THREE.Group && group.children.length === 2, "surface + outline group");
  const surface = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const outline = group.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  assert(surface.geometry === geometry && outline.geometry === geometry, "share geometry, not copies");
  assert(surface.material instanceof THREE.ShaderMaterial, "custom surface GLSL");
  assert(outline.material instanceof THREE.ShaderMaterial, "custom outline GLSL");
  assert(surface.material !== outline.material, "distinct owned materials");
  assert(surface.material.side === THREE.FrontSide, "front face surface");
  assert(outline.material.side === THREE.BackSide, "inverted hull culls front faces");
  assert(surface.material.uniforms.baseColor.value.equals(new THREE.Color("#dfaa55")), "linear working color");
  assert(outline.material.uniforms.outlineWidth.value > 0, "positive extrusion");
  for (const mesh of [surface, outline]) {
    assert(mesh.material.vertexShader.includes("normalMatrix * normal"), "inverse transpose view normal");
    assert(mesh.material.fragmentShader.includes("colorspace_fragment"), "linear to output conversion");
    mesh.material.dispose();
  }
  assert(surface.material.vertexShader.includes("viewMatrix * vec4"), "light in same view space as normal");
  assert(surface.material.fragmentShader.includes("step("), "discrete cel lighting bands");
  assert(outline.material.vertexShader.includes("outlineWidth"), "normal extrusion, not scale hull");
  geometry.dispose();
});
