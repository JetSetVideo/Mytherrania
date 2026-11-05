// QC: vertex attributes + varyings of the full-feature skinned cel material (all USE_WAVE_TEX_* defines on), resolved #ifdef.
import { createCelSkinnedSurfaceMaterial } from "../../../../src/graphics/shaders/CelSkinned.ts";
const mat: any = createCelSkinnedSurfaceMaterial("#c08070", { vertexColors: true, detail: true, material: { emissive: true, lit: true, details: true, edge: true } } as any);
const defs = new Set(Object.keys(mat.defines ?? {})); defs.add("USE_COLOR"); defs.add("USE_SKINNING");
function pre(src: string): string {
  const out: string[] = []; const st: boolean[] = [];
  for (const line of src.split("\n")) {
    const t = line.trim(); let m;
    if ((m = t.match(/^#ifdef\s+(\w+)/))) { st.push(defs.has(m[1])); continue; }
    if ((m = t.match(/^#ifndef\s+(\w+)/))) { st.push(!defs.has(m[1])); continue; }
    if (/^#if\b/.test(t)) { st.push(true); continue; }
    if (/^#else/.test(t)) { st[st.length - 1] = !st[st.length - 1]; continue; }
    if (/^#endif/.test(t)) { st.pop(); continue; }
    if (st.every(Boolean)) out.push(line.replace(/\/\/.*$/, ""));
  }
  return out.join("\n");
}
const size: Record<string, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4, mat3: 9, mat4: 16 };
const vs = pre(mat.vertexShader), fs = pre(mat.fragmentShader);
const attrs = [...vs.matchAll(/^\s*(?:in|attribute)\s+(\w+)\s+(\w+)\s*;/gm)].map((m) => `${m[1]} ${m[2]}`);
const vary = [...new Set([...fs.matchAll(/^\s*(?:varying|in)\s+(\w+)\s+(\w+)\s*;/gm)].map((m) => `${m[1]} ${m[2]}`))];
const comps = vary.reduce((s, v) => s + (size[v.split(" ")[0]] ?? 4), 0);
// three built-in attributes for a skinned mesh with vertex colours: position normal skinIndex skinWeight color (+ uv if used)
console.log(`defines ${[...defs].join(",")}`);
console.log(`attributes (custom) ${attrs.length}: ${attrs.join(", ")}`);
console.log(`attributes total incl. three built-ins (position, normal, skinIndex, skinWeight, color) = ${attrs.length + 5} / 16`);
console.log(`varyings ${vary.length}: ${vary.join(", ")}`);
console.log(`varying components ${comps} (unpacked, each float own slot rounds: ${vary.length} vec4 slots worst) / WebGL2 min 60 components (15 vec4)`);
