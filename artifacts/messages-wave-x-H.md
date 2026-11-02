# Wave X — lane H (hair) messages for the parent

1. **The Creator preview will not refresh when only `appearance.age` (or `sex`) changes.**
   `src/graphics/PreviewScene.ts` (lane B) `previewKey(profile)` keys the rebuild on name/race/subrace/class/weapon/
   height/weight/hair/birthsign only. Hair now greys with `greyFraction(race, appearance.age)` and recedes for male
   elders, so an Age stepper (lane U) changes the hair but `setProfile` skips the rebuild. Ask: add
   `appearance.age` and `appearance.sex` to `previewKey` (one line). Lane H works around it in its probe by building
   heads through `buildPreviewRig` directly (src/graphics/body/HairQaPage.ts).

2. **Triangle budget.** `tests/ancestry_look_test.ts` pins the WHOLE live rig < 12 000 triangles and the rig without
   hair measured 9564–10144 in the probe, so grown hair is held to `HAIR_TRI_BUDGET = 1100` (src/graphics/body/HairMesh.ts). Measured in ancestry_look_test: worst rig human/islander
   11 888 before -> 11 822 after. The strand detail is in the shader. If the parent raises the rig budget (e.g.
   to 14 k) set `HAIR_TRI_BUDGET` to ~3000: the clump count is fitted to the budget automatically (more, narrower
   cards, finer curls). If lane B's body grows, the rig test may trip — hair is not where the headroom is.

3. Female characters no longer default to a beard (FaceParts: `a.beard ?? (sex === "female" ? false : build.beard)`);
   an ancestry that REQUIRES one (dwarves) still grows it. Tell U if the creator's beard toggle should follow sex.
