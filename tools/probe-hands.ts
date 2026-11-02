// Hand probe (wave W, lane H): fingers that close on the handle, measured and photographed.
//
//   deno run -A tools/probe-hands.ts            # offline: contact numbers + software close-ups
//   deno run -A tools/probe-hands.ts --browser  # real Chrome close-ups (needs deno task build)
//
// Offline part (no browser): for every race × sex the REAL rig (buildSkinnedHumanoid) is built with
// an axe, a dagger (reverse grip), a sword and a spear; the weapon hand's handle line is read from the
// rig's own scene graph in the hand frame (the same path the game poses the fingers from), the grip
// pose is solved at the lane-G guard wrist (handle 47° to the fingers) and at 30°/70°/90°, and
// Hands.contactReport gives the gap between the handle surface and each digit (capsule model and
// mesh vertices, mm), the palm clearance, the wrap angle. Close-ups (software rasteriser shared with
// tools/probe-body.ts): side / front / back of the hand, with the handle drawn, BEFORE (the wave-V
// mitten, from the body skin) beside AFTER (the fingered hand).
// Writes artifacts/wave-w/lane-H/hands/{report.json, <race>-<weapon>.png}.
// @deno-types="@types/three"
import * as THREE from "three";
import type { BodySpec, MeshData, Vec3 } from "../src/graphics/body/contracts.ts";
import { buildSkinnedHumanoid } from "../src/graphics/body/SkinnedHumanoid.ts";
import { generateBody } from "../src/graphics/body/BodyMesh.ts";
import { contactReport, gripPose, type HandleLine, type HandMesh, rotate } from "../src/graphics/body/Hands.ts";
import { compose, type Image, png, render, type View } from "./probe-body.ts";
import { weaponFromSeed } from "../src/game/weapons/Generate.ts";
import { toGeneratedWeapon } from "../src/game/weapons/Adapter.ts";
import type { ArchetypeId } from "../src/combat/contracts.ts";
import type { Appearance } from "../src/game/Characters.ts";

const OUT = "artifacts/wave-w/lane-H/hands";
const BASE: Record<string, { m: [number, number]; f: [number, number] }> = {
  human: { m: [1.76, 76], f: [1.66, 61] }, elf: { m: [1.84, 66], f: [1.75, 56] },
  dwarf: { m: [1.38, 78], f: [1.32, 66] }, ork: { m: [1.98, 118], f: [1.88, 96] },
};
export const WEAPONS: ArchetypeId[] = ["axe", "dagger", "longsword", "spear"];
const appearanceOf = (s: BodySpec): Appearance => ({ body: "#c98a63", accent: "#dfaa55", height: s.height, weight: s.weight, hair: "#172128", eyes: "#2f6fb5", race: s.race, subrace: s.subrace, sex: s.sex ?? undefined } as Appearance);

/** A cylinder (the handle) as MeshData, closed, CCW outward. */
function cylinder(h: HandleLine, half: number, sides = 14): { mesh: MeshData; colours: Float32Array } {
  const u = h.u, e1 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] as Vec3 : [1, 0, 0] as Vec3;
  const a1 = norm(cross(u, e1)), a2 = cross(u, a1);
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const s of [-half, half]) for (let k = 0; k < sides; k++) {
    const th = (2 * Math.PI * k) / sides, n: Vec3 = [a1[0] * Math.cos(th) + a2[0] * Math.sin(th), a1[1] * Math.cos(th) + a2[1] * Math.sin(th), a1[2] * Math.cos(th) + a2[2] * Math.sin(th)];
    pos.push(h.p[0] + u[0] * s + n[0] * h.r, h.p[1] + u[1] * s + n[1] * h.r, h.p[2] + u[2] * s + n[2] * h.r); nor.push(...n);
  }
  for (let k = 0; k < sides; k++) { const a = k, b = (k + 1) % sides, c = sides + k, d = sides + (k + 1) % sides; idx.push(a, b, c, b, d, c); }
  // End caps (so the handle reads end-on too).
  for (const [s, base, sign] of [[-half, 0, -1], [half, sides, 1]] as [number, number, number][]) {
    const ci = pos.length / 3;
    pos.push(h.p[0] + u[0] * s, h.p[1] + u[1] * s, h.p[2] + u[2] * s); nor.push(u[0] * sign, u[1] * sign, u[2] * sign);
    for (let k = 0; k < sides; k++) { const a = base + k, b = base + (k + 1) % sides; if (sign > 0) idx.push(a, b, ci); else idx.push(b, a, ci); }
  }
  const n = pos.length / 3;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colours.set([0.25, 0.14, 0.07], i * 3);
  return { mesh: { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx), region: new Uint8Array(n) }, colours };
}
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a: Vec3): Vec3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/** Merge meshes (+ colours) into one for the rasteriser. */
function merge(parts: { mesh: MeshData; colours: Float32Array }[]): { mesh: MeshData; colours: Float32Array } {
  const nv = parts.reduce((s, p) => s + p.mesh.positions.length / 3, 0), ni = parts.reduce((s, p) => s + p.mesh.indices.length, 0);
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), colours = new Float32Array(nv * 3), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.mesh.positions, vo * 3); normals.set(p.mesh.normals, vo * 3); colours.set(p.colours, vo * 3);
    for (let i = 0; i < p.mesh.indices.length; i++) indices[io + i] = p.mesh.indices[i] + vo;
    vo += p.mesh.positions.length / 3; io += p.mesh.indices.length;
  }
  return { mesh: { positions, normals, indices, region: new Uint8Array(nv) }, colours };
}

/** Three close-ups (side = along the handle, front = the palm side, back = the back of the hand). */
function closeups(scene: { mesh: MeshData; colours: Float32Array }, centre: Vec3, u: Vec3, Y: Vec3, half: number, size = 300): Image[] {
  const side = norm(u), back = norm(Y), front: Vec3 = [-Y[0], -Y[1], -Y[2]];
  const views: Vec3[] = [side, rotate(front, side, 0.35), back];
  return views.map((dir) => render(scene.mesh, scene.colours, { centre, dir, half, w: size, h: size } as View));
}

/** World↔hand-local helpers on a live rig: the hand frame (bind, in the elbow bone) → model space. */
export interface HandProbe { race: string; sex: string; weapon: string; rows: unknown[] }

if (import.meta.main) {
  const browser = Deno.args.includes("--browser");
  await Deno.mkdir(OUT, { recursive: true });
  if (browser) {
    const { browserHands } = await import("./probe-hands-browser.ts");
    await browserHands(OUT);
    Deno.exit(0);
  }
  const report: Record<string, unknown>[] = [];
  for (const race of Object.keys(BASE)) {
    for (const sex of ["male", "female"] as const) {
      const [height, weight] = BASE[race][sex === "male" ? "m" : "f"];
      const spec: BodySpec = { race, subrace: null, className: "Warrior", height, weight, seed: 7, sex };
      for (const id of WEAPONS) {
        const ws = weaponFromSeed(id, 11);
        const rig = buildSkinnedHumanoid(toGeneratedWeapon(ws), appearanceOf(spec), "fire", spec, { weaponSpec: ws });
        const H = rig.hands!;
        // Lane G's guard: handle 47° to the fingers; also the swing extremes 30° / 70° / 90°.
        const rows: Record<string, unknown>[] = [];
        for (const deg of [47, 30, 70, 90]) {
          const h = H.handleAt(deg);
          const pose = gripPose(H.size[1], h);
          const m = H.meshFor(1, pose);
          const c = contactReport(H.size[1], pose, h, m);
          rows.push({ deg, ...c });
        }
        // The live pose (whatever setGrip last asked) as the game shows it at rest.
        const live = H.liveContact(1);
        report.push({ race, sex, weapon: id, handleR: +(H.handleRadius * 1000).toFixed(2), live, rows });
        const r47 = rows[0] as unknown as ReturnType<typeof contactReport>;
        console.log(`${race.padEnd(5)} ${sex.padEnd(6)} ${id.padEnd(9)} r=${(H.handleRadius * 1000).toFixed(1)}mm tilt=${r47.tilt} dev=${r47.deviation} palm=${r47.palmClearMm}mm wrap=${r47.wrapDeg}° ` +
          r47.digits.map((d) => `${d.name[0]}:${d.gapMm}/${d.meshGapMm}`).join(" "));
        if (sex === "male" && (race === "human" || race === "ork" || id === "axe")) {
          // Close-ups at the guard handle: BEFORE = the wave-V mitten (body skin hand) + handle; AFTER = fingers.
          // Rows: BEFORE (mitten) at the guard's 47°, AFTER at 47°, AFTER at 90° (a square grip).
          const centre: Vec3 = [0.42 * H.size[1].H, 0, 0];
          const half = 0.75 * H.size[1].H;
          const imgs: Image[][] = [];
          for (const [deg, before] of [[47, true], [47, false], [90, false]] as [number, boolean][]) {
            const h = H.handleAt(deg);
            const handle = cylinder(h, 0.13);
            const scene = before ? merge([mittenScene(spec, H.toLocal), handle]) : merge([handScene(H.meshFor(1, gripPose(H.size[1], h)), H.colours(1)), handle]);
            imgs.push(closeups(scene, centre, h.u, [0, 1, 0], half, 340));
          }
          await Deno.writeFile(`${OUT}/${race}-${sex}-${id}.png`, await png(compose(imgs)));
        }
      }
    }
  }
  await Deno.writeTextFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log(`wrote ${OUT}/report.json`);
}

function handScene(m: HandMesh, colours: Float32Array): { mesh: MeshData; colours: Float32Array } {
  return { mesh: { positions: m.positions, normals: m.normals, indices: m.indices, region: new Uint8Array(m.part.length) }, colours };
}

/** The wave-V mitten (the body skin's right-hand triangles) in hand-local coordinates. */
function mittenScene(spec: BodySpec, toLocal: (p: Vec3, n: Vec3) => [Vec3, Vec3]): { mesh: MeshData; colours: Float32Array } {
  const b = generateBody(spec);
  const m = b.mesh, keep: number[] = [], map = new Map<number, number>();
  const pos: number[] = [], nor: number[] = [];
  const at = (i: number): Vec3 => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const loc = tri.map((i) => toLocal(at(i), [m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]));
    if (!loc.every(([p]) => p[0] > -0.12 && p[0] < 0.3 && Math.hypot(p[1], p[2]) < 0.12)) continue;
    for (let k = 0; k < 3; k++) {
      if (!map.has(tri[k])) { map.set(tri[k], pos.length / 3); pos.push(...loc[k][0]); nor.push(...loc[k][1]); }
      keep.push(map.get(tri[k])!);
    }
  }
  const n = pos.length / 3, colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colours.set([0.62, 0.42, 0.3], i * 3);
  return { mesh: { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(keep), region: new Uint8Array(n) }, colours };
}
void THREE;
