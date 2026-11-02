#!/usr/bin/env python3
"""Wave V lane B -> lane P's file src/graphics/body/Anatomy.ts: count the grid-cell refinement on the
REFERENCE (pre-wave) forms, so surface detail can never move the polygonising cell.

WHY (measured, docs/wave-v/lane-B.md): anatomyFor refines the cell from the sign-change count of a first
plan (cell = coarse * sqrt(2 * edges / TRIANGLE_TARGET)) whenever the DuBois estimate is off by > 5 %
(elves and dwarves). Every surface change of ANY lane therefore moves the cell a little, and the cell sets
the needed limb gap (max(k, 2 cells) / 2), the solved abductions and the grid phase of the fragile pins
(sole contact span, sole-edge count, ear standoff, the thumb tip as one component). Lane B's joint forms
alone moved the elf male's cell 0.02271 -> 0.02286 m and its arm abduction by one bisection step
(0.3187 -> 0.3219 rad), the dwarf male's display abduction 0.3406 -> 0.3438 rad. With this patch the
count runs on AnatomyParts.referenceForms (lane B builds the exact pre-wave parts inside it), so the cell
and every solved joint are the HEAD values for every race and seed (verified in a scratch copy: human,
ork and elf, seeds 1-8, cell/arm/leg/display abduction identical to HEAD; tests/{ragdoll_model,
ragdoll_fall,anim_measure,body_detail,body_mass,body_mesh,sexbuild,planes_neck,bodybuilds,body_skin,
combat_hitboxes,wave_v_body_*} -> ok | 84 passed | 0 failed).

Cost: one more buildPlan per NEW body (~0.2-0.4 s; bodies are cached by spec).

  python3 docs/wave-v/lane-B-anatomy-patch.py            # dry run (anchors must occur exactly once)
  python3 docs/wave-v/lane-B-anatomy-patch.py --apply
"""
import sys

PATH = "src/graphics/body/Anatomy.ts"
EDITS = [
    ("import", "  armNode, type ArmAnchors,", "  armNode, referenceForms, type ArmAnchors,"),
    ("count on the reference forms",
     "  const edges = countSignChanges(applyFieldBrushes(compileSdf(first.root), first.strokes), first.bounds, coarse);",
     "  // Wave V lane B: count on the REFERENCE (pre-wave) forms so surface detail never moves the cell\n"
     "  // (and with it every cell-scaled gap, the solved abductions and the grid phase of the pins).\n"
     "  const ref = referenceForms(() => buildPlan(P, spec.seed, asym, pass));\n"
     "  const edges = countSignChanges(applyFieldBrushes(compileSdf(ref.root), ref.strokes), ref.bounds, coarse);"),
]


def main() -> int:
    apply = "--apply" in sys.argv
    src = open(PATH, encoding="utf-8").read()
    for name, old, new in EDITS:
        n = src.count(old)
        if n != 1:
            print(f"FAIL {name}: anchor occurs {n} times (want 1)")
            return 1
        src = src.replace(old, new)
        print(f"ok   {name}")
    if apply:
        open(PATH, "w", encoding="utf-8").write(src)
        print(f"applied to {PATH}")
    else:
        print("dry run: nothing written (pass --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
