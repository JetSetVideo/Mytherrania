# Wave V lane B → other lanes: requests

## R1 (lane P, `src/graphics/body/Anatomy.ts`): count the cell refinement on the reference forms

**Ask.** In `anatomyFor`, count the coarse sign changes on a plan built inside
`AnatomyParts.referenceForms(...)` instead of on `first`. The mechanical patch is
`docs/wave-v/lane-B-anatomy-patch.py` (dry run by default, `--apply` writes; two anchors, each must occur
once):

```ts
const ref = referenceForms(() => buildPlan(P, spec.seed, asym, pass));
const edges = countSignChanges(applyFieldBrushes(compileSdf(ref.root), ref.strokes), ref.bounds, coarse);
```

**Why (measured).** When the DuBois cell estimate is more than 5 % off (elves, dwarves), the cell is
re-derived from the surface's sign-change count, so **any** lane's surface change moves the polygonising
cell. The cell then sets the needed limb gap (`max(k, 2 cells)/2`), the solved abductions, and the grid
phase that several pins depend on (sole contact span, sole-edge count, ear standoff, the thumb tip staying
one component). Lane B's joint forms alone:

| body | cell HEAD → lane B | arm / leg / display abduction HEAD → lane B |
|---|---|---|
| elf male (1.84 m, 66 kg) | 0.02271 → 0.02286 m | 0.3187/0.0396/0.1000 → 0.3219/0.0410/0.1000 rad |
| dwarf male (1.38 m, 78 kg) | 0.02576 → 0.02590 m | display 0.3406 → 0.3438 rad |
| elf male, seeds 1-8 | 1 value (0.02271) | 6 distinct cells 0.02282-0.02289 m; arm 0.3219 rad, leg 0.0396 or 0.0410 rad |

With the patch applied in a scratch copy of the current tree: human, ork and elf at seeds 1-8 give
exactly the HEAD cell and abductions (`0.02271/0.3187/0.0396/0.1000` for every elf seed). The body,
ragdoll, anim, hitbox and lane-B suites run there: `ok | 84 passed | 0 failed`. Cost: one more
`buildPlan` per new body (~0.2-0.4 s; bodies are cached by spec). Without the patch everything is green
today, but a fragile pin can flip whenever any lane touches a surface.

## R2 (lane P / parent): `docs/wave-v/lane-P-body-patch.py` targets lane B's `BodyMesh.ts`

Lane P's patch (render `skinRoot`) edits `src/graphics/body/BodyMesh.ts`, which is lane B's file this
wave. Lane B did NOT apply it (it also restates a pin in `tests/body_detail_test.ts`); it does not
conflict with any lane-B edit (lane B left `BodyMesh.ts` untouched), so the parent can apply it as is.

## R3 (anim lane / parent): the ork thrust pins are chaotic to the chest capsule fit

`tests/anim_measure_test.ts` "hand inside the torso" (ork/ironhide thrust) and
`tests/combat_hitboxes_test.ts` "ork overshoot < 25 %" flip on sub-millimetre changes of the chest's
field near its primitives: Hitboxes fits a band (`k/4 + stroke`) of the real field around the positive
primitives, so even a pure CUTTER at the chest surface moved the thrust hand 0.9-9.7 mm inside its torso
capsule and the overshoot to 25.4 %. Lane B therefore left the torso geometry exactly pre-wave. If the
chest is to get real geometric detail later, those two pins need a margin (or the capsule fit a
smoothing step) first.
