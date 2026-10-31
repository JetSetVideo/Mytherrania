// deno-lint-ignore-file no-explicit-any -- QA probe: reads the untyped window.__MYTHERRANIA__ debug global.
// Wave J arena geometry check, MEASURED (not read off screenshots): for spectated matches on
// generated arenas, every wall mesh must stand ON the rim (its centre's distance from the centre
// equals the outline radius at its bearing, within the chord sag), every prop must be inside the
// ring, and on symmetric maps every prop / wall height / seat must have its symmetry image.
//   deno task build && deno run -A tools/probe-arena-check.ts [matches=8]
import { chromium } from "playwright";
import { serveAsset } from "./serve.ts";
import { symmetryImages } from "../src/game/arena/symmetry.ts";
import { DIGEST_DIRS } from "../src/game/arena/contracts.ts";
import { ringRadiusAt } from "../src/game/ArenaConfig.ts";

const N = Number(Deno.args[0] ?? 8);
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (r) => serveAsset(r));
const PORT = (server.addr as Deno.NetAddr).port;
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => (globalThis as any).__MYTHERRANIA__, null, { timeout: 20000 });
const call = (fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (globalThis as any).__MYTHERRANIA__.engine[f as string](...(a as unknown[])), [fn, args] as const);

/** Rim radius at bearing θ from the digest's DIGEST_DIRS samples (linear in angle). */
function rimAt(rim: number[], th: number): number {
  const u = (((th / (2 * Math.PI)) % 1) + 1) % 1 * DIGEST_DIRS, i = Math.floor(u) % DIGEST_DIRS, f = u - Math.floor(u);
  return rim[i] * (1 - f) + rim[(i + 1) % DIGEST_DIRS] * f;
}

const SYMS = [{ symmetry: 3 }, { symmetry: 4, symmetryOrder: 4 }, { symmetry: 1 }, { symmetry: 2 }, { symmetry: 4, symmetryOrder: 3 }, { symmetry: 0 }];
const rows: any[] = [];
let first = true;
for (let m = 0; m < N; m++) {
  const over = { walls: 1, objects: 8, ...SYMS[m % SYMS.length] };
  await call("debugWorld", { nextArena: over });
  if (first) { await page.click('[data-action="spectate"]'); first = false; } else await page.keyboard.press("KeyR");
  await page.waitForTimeout(1200);
  const a = await call("debugArena") as any;
  const d = a.digest, sym = a.symmetry;
  // Every wall VERTEX in world space (merged runs make one mesh span several edges, so a mesh
  // centre says nothing): its radial distance must match the exact outline at its bearing within
  // the wall's own thickness (vertices sit +-thickness/2 off the outline line).
  const verts = await page.evaluate(() => {
    const out: number[] = [];
    let meshes = 0;
    (globalThis as any).__MYTHERRANIA__.engine.debugScene().traverse((o: any) => {
      if (o.name === "arena-wall" && o.visible && o.geometry) {
        meshes++;
        o.updateWorldMatrix(true, false);
        const pa = o.geometry.attributes.position, e = o.matrixWorld.elements;
        for (let i = 0; i < pa.count; i++) {
          const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
          out.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]);
        }
      }
    });
    return { meshes, xz: out };
  });
  const walls = { length: verts.meshes };
  let wallOffRim = 0, worstWall = 0, nanVerts = 0, nanRim = 0;
  for (let i = 0; i < verts.xz.length; i += 2) {
    const x = verts.xz[i], z = verts.xz[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) { nanVerts++; continue; }
    if (!Number.isFinite(ringRadiusAt(a.cfg, Math.atan2(z, x)))) { nanRim++; continue; }
    const err = Math.abs(Math.hypot(x, z) - ringRadiusAt(a.cfg, Math.atan2(z, x)));
    worstWall = Math.max(worstWall, err);
    if (err > 0.5) wallOffRim++;
  }
  // Props inside the ring; on symmetric maps each prop has its images among the props.
  let propsOutside = 0, propsUnmatched = 0;
  for (const p of d.props) {
    if (Math.hypot(p.x, p.z) > rimAt(d.rim, Math.atan2(p.z, p.x)) + 1e-3) propsOutside++;
    if (sym.kind !== "none") {
      for (const { x: ix, z: iz } of symmetryImages(sym, p.x, p.z)) {
        if (!d.props.some((q: any) => Math.hypot(q.x - ix, q.z - iz) < 0.35)) { propsUnmatched++; break; }
      }
    }
  }
  // Wall heights per digest direction vs their images (directions are exact only for some orders).
  let wallAsym = 0;
  if (sym.kind !== "none") {
    for (let k = 0; k < DIGEST_DIRS; k++) {
      const th = (k / DIGEST_DIRS) * 2 * Math.PI, x = Math.cos(th), z = Math.sin(th);
      for (const { x: ix, z: iz } of symmetryImages(sym, x, z)) {
        const tk = Math.round(((Math.atan2(iz, ix) / (2 * Math.PI)) * DIGEST_DIRS + DIGEST_DIRS) % DIGEST_DIRS) % DIGEST_DIRS;
        wallAsym = Math.max(wallAsym, Math.abs(d.wallHeight[k] - d.wallHeight[tk]));
      }
    }
  }
  // The PLAN's own symmetry: each segment's centre mapped through every symmetry op must land in a
  // segment of the same height (exact for orders dividing the 48 segments).
  let segAsym = 0;
  const segs = a.walls?.segments ?? [];
  if (sym.kind !== "none" && segs.length) {
    for (const sg of segs) {
      const mid = (sg.a0 + sg.a1) / 2;
      for (const { x: ix, z: iz } of symmetryImages(sym, Math.cos(mid), Math.sin(mid))) {
        const t = ((Math.atan2(iz, ix) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const img = segs.find((q: any) => t >= q.a0 - 1e-9 && t < q.a1 + 1e-9);
        if (img) segAsym = Math.max(segAsym, Math.abs(img.height - sg.height));
      }
    }
  }
  const sp = d.spawns.spawns;
  const row = {
    m, sym: `${sym.kind}/${sym.order}`, shape: d.shape, size: d.size, rules: a.walls?.rules.map((r: any) => r.kind).join("+"),
    wallMeshes: walls.length, wallVerts: verts.xz.length / 2, nanVerts, nanRim, aspect: a.cfg.aspect, wallOffRim, worstWallErrM: +worstWall.toFixed(3), props: d.props.length, propsOutside, propsUnmatched,
    wallHeightAsymM: +wallAsym.toFixed(3), planSegAsymM: +segAsym.toFixed(3), seatR: sp.map((s: any) => +Math.hypot(s.x, s.z).toFixed(3)), fair: d.spawns.fair,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
await Deno.mkdir("artifacts/qa-wave-j", { recursive: true });
await Deno.writeTextFile("artifacts/qa-wave-j/arena-check.json", JSON.stringify({ pageErrors, rows }, null, 1));
console.log(`page errors: ${pageErrors.length}`);
await browser.close();
await server.shutdown();
