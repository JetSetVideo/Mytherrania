# Mytherrania QA v4: Review A, round 3 (world, sky, lighting, camera, faces)

Reviewer: independent visual QA A (read-only). Inputs: `manifest.json` and the re-captured PNGs `01-*` … `06-*` (1280×800).
Method: full-frame vision pass plus `region` crops (faces, sun, horizon band, ground/rings, HUD) on every frame.
Colours and coordinates are vision-model estimates, not sampled pixels. Where passes disagreed I mark the finding **UNCERTAIN** and do not count it as evidence. No claimed fix is taken on trust.

## Verdict: **AGREE** (acceptable for this stylised cel-shaded prototype)

Round-2's five marquee blockers are resolved or substantially improved: the title dim is confined to a framed centre panel, the fight camera now puts the player right of centre, the sun disc has a defined edge, BOTH moons are framed together, and a blue iris is now present at gameplay distance. Remaining items are non-blocking notes (below).

## Round 2 → Round 3 delta

| Exp | R2 | R3 | Change driver (round-3 evidence) |
|---|---|---|---|
| E1 sky follows sun elevation | PARTIAL | **PASS** | Title noon now shows a bright blue sky outside the panel (sky ≈#A8C8E8). In-fight hours still correct (dawn peach, night navy ≈#1e2633). |
| E2 sun disc / glow | PARTIAL | PARTIAL | 03-sky-sun-16h and 03-sky-sunspire-clouds now show a **disc with a defined circular edge** (~40 px, ≈(590,400) in 16h) — previously bloom only. Dawn disc still floats well above the horizon (see below). |
| E3 two moons | PARTIAL | **PASS** | 03-sky-two-moons: two distinct discs in one frame — a larger bright-white moon centre-right and a smaller tan moon lower-left, close together. |
| E4 clouds by place | PASS | **PASS** | Frostford ≈40–50% cover vs Sunspire ≈10–15%, same 13h, both aimed at the sun. Ordering holds. |
| E5 light tint + shadows | PARTIAL | PARTIAL | Night is now cool: sky/ambient ≈#1e2633, cool cast on armour and skin. But low-sun long shadows (claim 9) are still absent (dawn 4.2°, Frostford 3.4°). |
| E6 fight-start camera | PARTIAL | PARTIAL | Player is now clearly right of centre (centre x ≈780 of 1280). Opponent visible ahead-left, but the player's head still overlaps the opponent's lower torso. |
| E7 rings + wedges | PARTIAL | **PASS** | Both ground rings are green with a facing notch pointing toward the opponent. (Orange/red ring states belong to the 07 frames.) |
| E8 faces | PARTIAL | PARTIAL | Iris now present and blue at 3rd-person distance (03-time-noon), close (05) and first-person (06), with catch-light. Nostrils remain unidentifiable and ears are lost at 3rd-person distance. |
| E9 HUD vs manifest | PASS | **PASS** | HUD crops read `30/30` both sides; `Sunspire Steppe · 17:54 · dusk` (17.9h); `Verdant Hills · 11:53 · day` (11.883h). The round-3 "50/50" was an OCR misread. |
| E10 artifacts / black void | PARTIAL | **PASS** | Iso and bird's-eye are solid lit olive ground (≈#4A5A3C–#6b7f4a), black fraction ≈0%. 3rd-person horizon band continuous (ground→wall→sky, no gap). |

Counts: R1 **1/5/4** → R2 **2/8/0** → R3 **6/4/0** (PASS/PARTIAL/FAIL).

## Per-claim fix verification

| Claimed fix | Verified? | Evidence |
|---|---|---|
| 1. Title dims only a framed centre panel | **YES** | 01-title-noon: sky above the panel ≈#A8C8E8 bright blue, ground outside the panel ≈#C2A67E, panel fill ≈#2A1F1A with a gold frame — dimming confined to the panel. Dusk/night titles are dark because the *world* is dark there, not a full-screen wash (sky still visible). |
| 2. Shoulder-shifted look-target | **PARTIAL** | 02-fight-start: player centre x ≈780 (right of centre) ✓; opponent ahead-left and visible ✓; but the player's head still occludes the opponent's lower torso. |
| 3. Sun halo cut + disc punches through | **YES (disc edge)** | 03-sky-sun-16h: distinct white disc, soft-but-defined edge, ~40 px, faint halo, no dominant bloom. 03-sky-sunspire-clouds: same. Halo amplitude not measured numerically. |
| 4. Two moons framed together | **YES** | 03-sky-two-moons (day 307, 21h): two discs, bright-white + tan, adjacent. HUD `21:00 · night` matches manifest. |
| 5. Stylised eyes (sclera/ring/iris/pupil/catch-light) | **YES** | Blue iris + pupil + white sclera + catch-light visible in 03-time-noon, 05-camera-close and 06-first-person. Iris is blue in every shot (consistent with the skin-blend auto-switch). |
| 6. Faces lit by scene light (night tints, not glows) | **YES (partial evidence)** | Night skin reads a cool peach/tan under the cool ambient rather than a flat glow; day faces are scene-lit. No emissive "hot" eyes observed. |
| 7. Cooler moonlight + bluer night ambient | **YES** | 03-time-night sky/ambient ≈#1e2633, cool cast on red armour (#9e4a4a-ish) and tan armour. One ground crop called the ground "neutral brown" — UNCERTAIN for the ground only; the ambient/sky cool key is confirmed. |
| 8. Valley floor 2400 m + fog 45–700 m | **YES** | Iso and bird's-eye ground is a solid lit plane to the frame edge (black ≈0%); 3rd-person horizon band continuous with no void. |
| 9. Sun shadow frustum widens at low sun | **NO** | 03-time-dawn (elev 4.2°) and 04-frostford (elev 3.4°): only a short rounded contact shadow; no long stretched shadows. The claim is not visible in either frame. |

## Per-expectation detail (round 3)

**E1 PASS.** Title noon: bright blue sky and tan ground outside the panel; only the framed panel is dark. In-fight dawn/morning/noon/dusk/night skies remain correctly ordered.

**E2 PARTIAL.** Disc now has a real edge when aimed at (16h, 13h) — the round-2 blocker. Still unresolved: the dawn disc at elev 4.2° floats well above the horizon. The two passes disagreed on the exact gap (≈90 px vs ≈160 px) → the pixel gap is **UNCERTAIN**; both agree the disc is well above the horizon line. The disc→screen elevation mapping still looks off, or the reference line is the arena wall rather than the true horizon.

**E3 PASS.** Two moons, one frame, adjacent.

**E4 PASS.** Frostford ≈40–50% vs Sunspire ≈10–15% at the same hour; sun partially veiled at Frostford, clean disc at Sunspire.

**E5 PARTIAL.** Working: cool night key, occlusion-softened shadows, warm dawn/dusk tints. Missing: long low-sun shadows (claim 9). Ground tint at night is UNCERTAIN (cool sky vs a "neutral brown" ground crop).

**E6 PARTIAL.** Player right of centre (x ≈780); opponent visible. Head-over-lower-torso overlap persists, so "unobstructed" is not met.

**E7 PASS.** Green rings with a facing notch toward the opponent in 3rd person.

**E8 PARTIAL.** Present: sclera, blue iris, pupil, catch-light, brows, nose, lips, hair, chin (and ears in close/FP). Missing: nostrils (never identifiable), ears at 3rd-person distance. The round-2 "no iris anywhere" blocker is fixed.

**E9 PASS.** All HUD lines match the manifest for place, rounded time and phase.

**E10 PASS.** No black void in any camera; the title wash is gone.

## Score: **7.5 / 10** (round 2: 6.0)

Earned: title dim confined to a framed panel; both moons framed; sun disc edge; blue iris at distance; cool night; solid ground plane.
Held back: low-sun long shadows not delivered (claim 9); dawn sun elevation mapping still off; fight-start head still clips the opponent's lower torso; nostrils/ears not readable at gameplay distance.

## Non-blocking notes

1. Claim 9 (long shadows at dawn/dusk/Frostford) is **not visible** — either the frustum change did not take effect or the shadow is faded to nothing. Re-check.
2. Dawn sun disc sits far above the horizon at 4.2°; verify the sun direction→screen mapping (or confirm the reference horizon).
3. Fight-start: reduce the residual head/opponent overlap if "opponent unobstructed" is a hard acceptance.
4. Nostrils and 3rd-person ears are still not identifiable.

## Evidence limitations
- No pixel sampler; all hex values and bboxes are vision estimates.
- Two passes contradicted each other on the dawn sun/horizon gap and on the night ground tint → marked UNCERTAIN, not counted as evidence.
- Halo amplitude (claim 3) was judged by eye only; no numeric measurement.
