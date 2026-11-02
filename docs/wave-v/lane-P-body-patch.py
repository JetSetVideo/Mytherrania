#!/usr/bin/env python3
"""Wave V lane P -> the body surface lane's files (src/graphics/body/BodyMesh.ts) + one restated pin.

The final symmetry step (src/graphics/body/Anatomy.ts finalSymmetryPass) puts the seeded natural
asymmetry on DetailedAnatomy.skinRoot and keeps plan.root the exact mirror (physics: Hitboxes'
full-field fit reads bodyField(plan), so the combat capsules and the ragdoll never move). The RENDERED
skin must polygonise skinRoot: that is BodyMesh.ts, owned by another lane this wave, hence this patch.
Without it the body renders exactly as before (mirrored) — no other effect.

  python3 docs/wave-v/lane-P-body-patch.py            # dry run (anchors must occur exactly once)
  python3 docs/wave-v/lane-P-body-patch.py --apply

Edits:
  B1 BodyMesh.ts: new skinField(plan) (skinRoot ?? root, same strokes); meshPlan + generateBody use it.
  T1 tests/body_detail_test.ts "the skin is mirror-symmetric": RESTATED — the physics mesh keeps the
     pre-wave < 1 % cell bound; the rendered skin is bounded at 6 % of a cell (measured 0.662 mm =
     2.4 % of the dwarf's 27.3 mm cell). The pin asserted exactly what the user asked to change.
Verified on HEAD + lane P + this patch: tests/body_detail_test.ts 6/6, ragdoll_model + ragdoll_fall +
combat_hitboxes green (see docs/wave-v/lane-P.md).
"""
import sys

EDITS = [
    ("src/graphics/body/BodyMesh.ts", "B1a skinField + meshPlan",
     """/** Polygonise a plan at `cell` (default: the plan's own) and apply its mesh brushes. */
export function meshPlan(plan: AnatomyPlan, cell = plan.cell): { mesh: MeshData; field: BodyField } {
  const field = bodyField(plan);""",
     """/**
 * Wave V lane P: the RENDERED skin's field — the plan's skinRoot (the mirror plus the seeded natural
 * asymmetry, Anatomy.finalSymmetryPass) wrapped by the same strokes. Physics keeps bodyField (the
 * exact mirror: Hitboxes' full-field fit reads it, so the ragdoll and the combat capsules never move).
 */
export function skinField(plan: AnatomyPlan): BodyField {
  return applyFieldBrushes(compileSdf((plan as Partial<DetailedAnatomy>).skinRoot ?? plan.root), plan.strokes);
}

/** Polygonise a plan at `cell` (default: the plan's own) and apply its mesh brushes. */
export function meshPlan(plan: AnatomyPlan, cell = plan.cell): { mesh: MeshData; field: BodyField } {
  const field = skinField(plan);"""),
    ("src/graphics/body/BodyMesh.ts", "B1b generateBody",
     """  const t1 = performance.now();
  const field = bodyField(plan);""",
     """  const t1 = performance.now();
  const field = skinField(plan); // wave V lane P: the rendered skin (natural asymmetry)"""),
    ("tests/body_detail_test.ts", "T1a import meshPlan",
     'import { generateBody } from "../src/graphics/body/BodyMesh.ts";',
     'import { generateBody, meshPlan } from "../src/graphics/body/BodyMesh.ts";'),
    ("tests/body_detail_test.ts", "T1b restated mirror pin",
     'Deno.test("the skin is mirror-symmetric (left and right limbs are built and sampled alike)", () => {\n  const body = generateBody(SPECS.dwarf);\n  const pos = body.mesh.positions, n = pos.length / 3, c = body.plan.cell;\n  const grid = new Map<string, number[]>();\n  const key = (x: number, y: number, z: number) => `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`;\n  for (let v = 0; v < n; v++) { const k = key(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(v); }\n  let sum = 0;\n  for (let v = 0; v < n; v++) {\n    const x = -pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];\n    let best = c;\n    const [i, j, k] = [Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)];\n    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {\n      for (const u of grid.get(`${i + a},${j + b},${k + d}`) ?? []) best = Math.min(best, Math.hypot(pos[u * 3] - x, pos[u * 3 + 1] - y, pos[u * 3 + 2] - z));\n    }\n    sum += best;\n  }\n  assert(sum / n < 0.01 * c, `mean mirror distance ${(sum / n * 1000).toFixed(3)} mm`);\n});\n\n',
     '/** Mean distance (m) from each vertex\'s mirror image (x -> -x) to the nearest vertex of the mesh. */\nfunction meanMirrorDistance(pos: Float32Array, c: number): number {\n  const n = pos.length / 3;\n  const grid = new Map<string, number[]>();\n  const key = (x: number, y: number, z: number) => `${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`;\n  for (let v = 0; v < n; v++) { const k = key(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(v); }\n  let sum = 0;\n  for (let v = 0; v < n; v++) {\n    const x = -pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];\n    let best = c;\n    const [i, j, k] = [Math.floor(x / c), Math.floor(y / c), Math.floor(z / c)];\n    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {\n      for (const u of grid.get(`${i + a},${j + b},${k + d}`) ?? []) best = Math.min(best, Math.hypot(pos[u * 3] - x, pos[u * 3 + 1] - y, pos[u * 3 + 2] - z));\n    }\n    sum += best;\n  }\n  return sum / n;\n}\n\nDeno.test("the skin is mirror-symmetric (left and right limbs are built and sampled alike)", () => {\n  // Wave V lane P RESTATED this pin (it asserted the rendered skin is an exact mirror, which the\n  // user asked to change): the PHYSICS body — plan.root, what the hitboxes and the ragdoll read —\n  // keeps the pre-wave bound (< 1 % of a cell), and the RENDERED skin carries the seeded natural\n  // asymmetry of Anatomy.finalSymmetryPass, bounded: measured 0.662 mm (2.4 % of the dwarf\'s 27.3 mm cell)\n  // for seed 7; the bound is 6 % of a cell.\n  const body = generateBody(SPECS.dwarf);\n  const c = body.plan.cell;\n  const physicsPlan: typeof body.plan = { ...body.plan, skinRoot: body.plan.root };\n  const physics = meshPlan(physicsPlan).mesh;\n  const phys = meanMirrorDistance(physics.positions, c), skin = meanMirrorDistance(body.mesh.positions, c);\n  console.log(`mirror distance: physics ${(phys * 1000).toFixed(3)} mm, skin ${(skin * 1000).toFixed(3)} mm (cell ${(c * 1000).toFixed(1)} mm)`);\n  assert(phys < 0.01 * c, `physics mean mirror distance ${(phys * 1000).toFixed(3)} mm`);\n  assert(skin < 0.06 * c, `skin mean mirror distance ${(skin * 1000).toFixed(3)} mm`);\n});\n\n'),
]


def main() -> int:
    apply = "--apply" in sys.argv
    texts = {}
    ok = True
    for path, name, old, new in EDITS:
        src = texts.get(path) or open(path, encoding="utf-8").read()
        n, done = src.count(old), src.count(new)
        print(f"{name} ({path}): anchor x{n}, already applied x{done}")
        if n == 0 and done >= 1:
            texts[path] = src
            continue
        if n != 1:
            ok = False
            continue
        texts[path] = src.replace(old, new)
    if not ok:
        print("ABORT: an anchor does not occur exactly once; nothing written")
        return 1
    if apply:
        for path, src in texts.items():
            open(path, "w", encoding="utf-8").write(src)
            print(f"wrote {path}")
    else:
        print("dry run OK (use --apply to write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
