# Wave TEX — closing round (verification gaps + open WARNs)

Base: working tree after the 9-agent TEX swarm (not committed). Full suite on this tree: `ok | 2104 passed | 0 failed`.
Final full capture: `artifacts/wave-tex/captures/r06f-final/` (index.json; layout differs from the quick runs, so no diff).
Read `docs/wave-tex/BRIEF.md` (rules: don't delete, expand; ≥ 3 PASS per READY) and the lane docs
`docs/wave-tex/{LAYERS,RENDER,MARKS,ART,UI,CAPTURE,VERIFY-CODE,VERIFY-ART,VERIFY-DOMAIN}.md`.
Board: `BOARD_DIR=artifacts/wave-tex deno run -A tools/board.ts post <FROM> <TO|ALL> <TYPE> "msg"` (continue numbering).

## Gaps to close
| item | missing verdicts |
|---|---|
| R (render: CelSkinned/CelMaterial/MaterialChannels/MaterialRender/TexWiring/GlyphAtlas/SkinnedHumanoid) | QC (code), QA (pictures) |
| U (creator Surface panel: TexState/MarkEdit/TexSources/TexStudio, Menu/PreviewScene additions) | QC (code), QA (pictures) |
| M rounds 2-3 (face zones from real heads, hypertrophic branch, dotwork size) | QC re-check, QA (pictures) |
| P rounds 4-5 (stud heads to shader detail, edge-highlight raise) | QC re-check, QA + QD (pictures) |
| C round 2 (HUD fields, marked-bare, marks diff) | QC re-check |
| R's dotwork/face PASS (QD Z-102) | QD confirmation on C's capture r06f-final |

## Open QA WARNs to FIX (agent F) — then re-verified by QC + QA + QD
1. Miniature **edge highlight** invisible on captures (brightest 5 % moved −3..+1 levels).
2. **AO channel** empty in the rig (AO view p50 = p95 = 255).
3. **Scar relief** barely reaches shading (normal view 2–7.5 dE while height +15–20 levels).
4. **Mature scar height**: a 400-day laceration still raised +10 levels (QD to rule: atrophic/flat expected unless keloid/hypertrophic).
Also: arena frame +1.3 ms with defaults vs +1 ms budget (R's bench `tools/bench-wave-tex.ts`) — reduce if possible.

## Rule
Agent F posts READY with numbers and a fresh quick capture (`deno run -A tools/capture-wave-tex.ts capture --run r07q-closing --quick`).
QC, QA and QD each post PASS/FAIL on: every gap item above and F's READY. Nothing is done without all three.

## Agent F — fixes and measurements (closing round)

Numbers below are printed by code: `tools/probe-wave-tex-fix.ts` (GPU on/off toggles on the capture's own cameras, 420x560,
PreviewStage studio light; before = a snapshot of the pre-F tree, after = this tree; JSON in `artifacts/wave-tex/fix/probe-{before,after}.json`),
`tools/meter-wave-tex-fix.ts` (CPU, vertex paint), QA's `tools/verify-wave-tex-art.ts warns r07q-before-F r07q-closing`
(`artifacts/wave-tex/fix/warns.txt`), `tools/bench-wave-tex.ts`. Captures: `artifacts/wave-tex/captures/r07q-before-F` (pre-F) and
`artifacts/wave-tex/captures/r07q-closing` (this tree, quick). Probe masks are eroded 2 px (the first meter counted the ink hull's
anti-aliased silhouette pixels as "scar" and a background ring as "skin": +7..+20 height levels of pure artefact; QA's ring may carry it too).

| item | where it was lost | fix | before -> after |
|---|---|---|---|
| 1 edge highlight | P's painted edge mask smooth(0.28, 0.55, kappa) fires on hands/feet but hardly on the body's own ridges (body-skin edge weight p95 0.10-0.17); per-vertex paint over 22-35 mm triangles; QA's whole-subject hi-5 % is dominated by garments/metal/hands | skin-only CREST line: ridge RANK (p90..p98 of body-skin fine curvature) x the skin edge layer's gain, 1-ring smoothed, `aEdge` attribute, per-fragment `smoothstep(0.2, 0.6)` lift 0.4 toward white after the decals (`USE_WAVE_TEX_EDGE`); off with the skin edge layer | 3q final skin brightest-5 %: human 200.2 -> 208.6, ork 173.4 -> 176.8, elf 228.2 -> 228.5, dwarf 189.9 -> 196.3; convex-region mean 180.8 -> 188.2 / 153.3 -> 156.3 / 204.7 -> 205.8 / 168.4 -> 172.7; QA W1 albedo hi-5 % 183.4/165.7/216.6/176.0 -> 187.8/167.7/218.1/179.2 |
| 2 AO | the ao channel only carried AO_SHARE 0.12 of the painted cavity (min 0.91-0.96) | geometric occlusion `MeshOcclusion.meshOcclusion` (voxelised skin, 16 cosine rays, 25 cm, cached per mesh): ao = (1 - 0.12 cavity)(1 - 0.45 smoothstep(0.06, 0.6, occ)); open/convex skin keeps 1 | ao view 3q p5/p50 human 252/255 -> 216/254, elf 251/255 -> 213/254, ork 252 -> 247, dwarf 252 -> 247; share < 240: 0.0-0.4 % -> 2.4-12.7 %; darkest-10 % px lit luma -0.5..-0.8 -> -1.6..-8.7 levels; QA W2 3q share < 230 4.3/1.0/1.9/0.9 % -> 12.3/3.1/10.5/2.2 % |
| 3 scar relief | relief shoulder spread over max(W, blur, px): a 0.44 mm ridge 4 mm wide tilted 0.09-0.17 rad | plateau with steep shoulders a = max(min(0.35 W, 1.5 mm), blur, px/2) (TX91: 0.165 -> 0.471 slope at 1.24 mm/px = the 0.3 rad bound) | relief on/off normal-view RGB distance inside the scar mask: 7.7-21.2 -> 9.8-26.5 (elf forearm = flat ordinary scar 1.1 -> 1.2); final-view mean abs dL 3.5-16.9 -> 5.6-20.0. Mean-inside-vs-ring normal dE stays 1.6-11 (a symmetric ridge's normals average out: this meter cannot see relief) |
| 4 mature scar | C's laceration rolled hypertrophic (+0.44 mm, M's law correct, QD Z-115); scar colour composed over the body's MEAN skin read darker than the lighter forearm | capture pins hypertrophic:false; `scarStageOf` (raised scars never 'mature'), UI words, HUD prints 'hypertrophic' / 'hypertrophic regressed' / 'keloid'; `marksToDecals({ skinAlbedo })` composes a scar over the painted skin around it; edge crest after the decals | QA W4 laceration dL* -1.5..-3.1 -> +3.5..+4.3, dHeight +6..+11 -> -2 (ork +5 = hide plates in the height view); own meter (`--lac`, albedo view, same ordinary laceration on both trees, 7-px skin ring) scar - ring L* +2.5/+1.0/+2.7/+2.9 -> +6.7/+3.6/+4.0/+11.5 (human/ork/elf/dwarf); TX97 vs local vertex skin dL* +4.0..+9.1, dC* -13.7..-29.8 |
| budget | the off-neutral lit path called celShade then looked the key's shadow up again (9 more PCF taps) | one shadow lookup (celShadeMat re-states celShade's terms once); wave-X grain noise compiled out under P's details | arena 2 rigs, defaults: HEAD 3.4-3.5 ms; pre-F 4.4 (mean 4.54); after 3.8-4.0 (+0.4..+0.5 ms; means +0.3..+0.6); preview +0.2..+0.3 |

Also fixed: QC REN-9 (stitched decals drew the line (n-1)/2 x spacing beside the stitches: n = 1 for kind 1, TX92), QC CAP-5 (capture
MARKED_SET face anchors moved to M's validating ones: validateMarks 0 issues on 4 races), QD Z-121 (stage words take the resolved
keloid/hypertrophic flags). Identity: TEX_DEFAULTS off vs `git archive HEAD`, 24 renders, 0 changed px. Tests: `tests/wave_tex_closing_test.ts` (SPEC TX90-97).

Known limits (honest): AO is baked on the BIND pose (arms out), so a pose that closes the arm on the ribs is not re-occluded; ork and
dwarf Warriors get little AO (bulky A-pose, forearms under bracers). The crest is still a per-vertex field: vision reads the shin
highlight as "angular facets" BEFORE and AFTER (control crop), a mesh-resolution limit, and on the whole-subject meter it moves the
brightest 5 % by only +1.5..+4 levels. The 400-day laceration is flat and paler but faint (QA's marks-view mask misses it on human/elf).
