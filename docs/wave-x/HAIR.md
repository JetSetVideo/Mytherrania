# Wave X — lane H: hair GROWN from follicles

Every number below is pasted from tool output (`tests/wave_x_hair_test.ts`, `tools/probe-wave-x-hair.ts` ->
`artifacts/qa-wave-x/hair/report.json`); this file was generated from those by a script, not typed.

## What changed

The cap shell + fall tubes + lobes + crest are gone. `FaceParts.buildFaceParts` now grows the hair:

| file | role |
|---|---|
| `src/graphics/body/HairFollicles.ts` (pure) | `HeadFrame` from FaceAnchors; follicles ON the skull ellipsoid inside a hairline (forehead line above the brow, temples, sides down to the brow in front of the ear, nape behind it), ear zones excluded (pointed ears get a larger zone up/back toward the tip); Poisson-disc-ish dart throwing, count = 900 x density x area/h²; male-pattern recession (temples then crown) from `Age.lifeFraction` |
| `src/graphics/body/HairGrowth.ts` (pure) | style plan from `node.hair.styles` (+ ponytail variant, braid chance for dwarf/wood elf/ork/nomad), length tier buzz/short/shoulder/long; farthest-point clumping into guide strands; growth: normal + comb flow (whorl / parting / gather / crest) -> hug the skull at a layer gap -> gravity (+ backward drift below the skull) -> curl helix; cuts: length, fringe above the brow, bob jaw plane; ear slide + face/ear/skull guards; ponytail/topknot gathered at a tie; braids = 3 bundles on a figure-eight (lateral A sin φ, depth B sin 2φ, φ = ωs + 2πk/3) ending in a tie + tuft |
| `src/graphics/body/HairShade.ts` (pure) | root->tip multiplier, per-clump tone (lightness 0.82..1.16 + warm/cool shift), grey: 0.8·g of clumps grey whole + sub-strand grey in the rest so the expected share is exactly g (`Age.greyFraction`), elves silver |
| `src/graphics/body/HairMesh.ts` | pure `buildHairData` (cards, underlayer snapped to the hairline, tie rings; every vertex guarded) + THREE `buildHairMeshes`; cel hair ShaderMaterial (CEL_LIGHT_GLSL): strand streak lanes + grooves, pointed alpha-tested tips, cel-quantised Kajiya-Kay highlight band, grey sub-strands |
| `src/graphics/body/HairQaPage.ts` | QA-only page (bundled by the probe; not in the game bundle) |
| `src/graphics/body/FaceParts.ts` | wiring; bald logic unchanged; `refs.hairParts` = static (underlayer, scalp parts, bun, root ties), `refs.secondary` = hanging locks per root sector / ponytail / braids (+ beard as before); `refs.hairStats` (QA); brows and beard grey with `greyFraction`; women default beardless unless the ancestry requires one |

Beard: kept as the previous cylinder (not grown) — only its colour now greys. Documented choice, not a gap I hid.

## Tests — `NO_COLOR=1 deno test -A tests/wave_x_hair_test.ts`

`ok | 16 passed | 0 failed` (SPEC X70–X85). Also run: `tests/hair_eyes_nails_test.ts tests/face_parts_test.ts tests/ancestry_look_test.ts
tests/body_skin_test.ts tests/facemorph_test.ts` together with it: `ok | 48 passed | 0 failed`. `deno task check`: 0 errors;
`deno lint` on lane files: `Checked 8 files`, 0 problems.

### Follicles per ancestry (SPEC X70)

```
follicles per ancestry (seed 17, young):
  human/-          density=0.60 follicles= 576/576 area=548.2cm² spacing=6.8mm maxRadialErr=0.000nm
  human/imperial   density=0.60 follicles= 576/576 area=548.2cm² spacing=6.8mm maxRadialErr=0.000nm
  human/nomad      density=0.55 follicles= 528/528 area=548.2cm² spacing=7.1mm maxRadialErr=0.000nm
  human/islander   density=0.65 follicles= 624/624 area=548.2cm² spacing=6.6mm maxRadialErr=0.000nm
  elf/-            density=0.50 follicles= 317/317 area=347.8cm² spacing=7.3mm maxRadialErr=0.000nm
  elf/high         density=0.50 follicles= 317/317 area=347.8cm² spacing=7.3mm maxRadialErr=0.000nm
  elf/wood         density=0.55 follicles= 349/349 area=347.8cm² spacing=7.0mm maxRadialErr=0.000nm
  elf/dark         density=0.50 follicles= 325/325 area=356.2cm² spacing=7.3mm maxRadialErr=0.000nm
  dwarf/-          density=0.85 follicles= 919/919 area=774.0cm² spacing=6.4mm maxRadialErr=0.000nm
  dwarf/mountain   density=0.85 follicles= 919/919 area=774.0cm² spacing=6.4mm maxRadialErr=0.000nm
  dwarf/forge      density=0.85 follicles= 919/919 area=774.0cm² spacing=6.4mm maxRadialErr=0.000nm
  dwarf/deep       density=0.80 follicles= 865/865 area=774.0cm² spacing=6.6mm maxRadialErr=0.000nm
  ork/-            density=0.50 follicles= 559/559 area=744.1cm² spacing=8.1mm maxRadialErr=0.000nm
  ork/greenhide    density=0.50 follicles= 559/559 area=744.1cm² spacing=8.1mm maxRadialErr=0.000nm
  ork/ironhide     density=0.55 follicles= 615/615 area=744.1cm² spacing=7.7mm maxRadialErr=0.000nm
  ork/bloodfang    density=0.45 follicles= 503/503 area=744.1cm² spacing=8.5mm maxRadialErr=0.000nm
```

```
human follicles at density 0.3/0.6/0.9: 288 / 576 / 864
hair region area: young 548.2 cm² -> male elder (recession 0.68) 499.9 cm²
```

### Clearance, cuts, fringe, stand-off (SPEC X75, X76, X78, X85)

```
clearance: min over 178332 strand points 0.889 mm, over 73602 drawn vertices 0.222 mm (16 ancestries x 4 seeds)
strands stopped early by a guard (ear zone / face plane): 46 of 3580
cut-length error by style/tier (head heights):
  crop/short         strands=457 worst=0.0000h
  flowing/long       strands=150 worst=0.0000h
  wild/shoulder      strands=129 worst=0.0000h
  bob/shoulder       strands=8 worst=0.0000h
  wild/long          strands=31 worst=0.0000h
  wild/short         strands=283 worst=0.0000h
  mohawk/short       strands=489 worst=0.0000h
fringe strands: 742; lowest fringe point 0.030 h above the brow (line at +0.03 h)
largest stand-off at head level by style (h): topknot=0.150 crop=0.076 bob=0.103 flowing=0.106 wild=0.132 braided=0.102 mohawk=0.438 shaved=0.006
```

### Hair per ancestry, triangle budget (SPEC X80)

```
hair per ancestry (seeds 3,11,29,101; budget 1100):
  human/-          follicles=576,576,576,576 clumps=72,68,72,61 tris=1092,1080,1092,1100 styles=topknot/shoulder crop/short bob/shoulder
  human/imperial   follicles=576,576,576,576 clumps=72,81,70,71 tris=1092,1096,1070,1100 styles=topknot/shoulder crop/short bob/shoulder
  human/nomad      follicles=528,528,528,528 clumps=72,35,50,50 tris=1092,1088,1054,1054 styles=topknot/long flowing/long+1br bob/shoulder
  human/islander   follicles=624,624,624,624 clumps=37,62,55,55 tris=1074,1098,1050,1038 styles=wild/shoulder crop/short bob/shoulder
  elf/-            follicles=317,317,317,317 clumps=70,38,40,62 tris=1091,1079,1089,1099 styles=bob/shoulder flowing/long braided/long+3br braided/long+2br
  elf/high         follicles=317,317,317,317 clumps=61,38,40,38 tris=1093,1079,1089,1087 styles=braided/long+2br flowing/long braided/long+3br
  elf/wood         follicles=349,349,349,349 clumps=40,62,67,68 tris=1079,1097,1093,1091 styles=wild/long braided/long+2br bob/shoulder
  elf/dark         follicles=325,325,325,325 clumps=69,38,40,61 tris=1077,1095,1083,1095 styles=bob/shoulder flowing/long braided/long+3br braided/long+2br
  dwarf/-          follicles=919,919,919,919 clumps=66,76,52,68 tris=1090,1084,1094,1096 styles=wild/short crop/short braided/shoulder+3br braided/shoulder+2br
  dwarf/mountain   follicles=919,919,919,919 clumps=76,68,79,68 tris=1090,1090,1100,1094 styles=crop/short braided/shoulder+2br
  dwarf/forge      follicles=919,919,919,919 clumps=60,71,43,71 tris=1096,1096,1056,1098 styles=wild/short crop/short wild/shoulder+1br
  dwarf/deep       follicles=865,865,865,865 clumps=75,69,49,69 tris=1096,1092,1066,1100 styles=wild/short braided/shoulder+2br wild/shoulder+1br
  ork/-            follicles=559,559,559,559 clumps=46,73,0,0 tris=1086,1094,214,214 styles=wild/short mohawk/short shaved/buzz
  ork/greenhide    follicles=559,559,559,559 clumps=49,75,39,74 tris=1098,1100,1074,1092 styles=wild/short mohawk/short wild/shoulder+1br
  ork/ironhide     follicles=615,615,615,615 clumps=72,0,72,0 tris=1094,214,1096,214 styles=mohawk/short shaved/buzz
  ork/bloodfang    follicles=503,503,503,503 clumps=45,61,37,62 tris=1088,1092,1090,1094 styles=wild/short mohawk/short wild/shoulder+1br
```

### Grey and shading (SPEC X81, X82)

```
greyFraction examples (years = share of grey strands):
  human  24y=0.00  48y=0.17  64y=0.64  80y=0.92
  elf    210y=0.00  420y=0.00  560y=0.16  700y=0.60
  dwarf  90y=0.00  180y=0.17  240y=0.64  300y=0.92
  ork    17y=0.00  33y=0.17  44y=0.64  55y=0.92
human seed 11: mean vertex luminance young(25y) 0.009 -> elder(80y) 0.413; grey clumps 0 -> 42/68
rootTip: root x0.58 -> tip x1.12; clump tone range 0.82..1.16
```

### FaceParts wiring (SPEC X83)

```
FaceParts with grown hair:
  human/-          bob/shoulder hairTris=1084 faceTris=2172 secondary=6
  human/imperial   topknot/shoulder hairTris=1092 faceTris=2180 secondary=1
  human/nomad      ponytail/long hairTris=1090 faceTris=2178 secondary=2
  human/islander   crop/short hairTris=1094 faceTris=2182 secondary=6
  elf/-            bob/shoulder hairTris=1091 faceTris=2127 secondary=5
  elf/high         braided/long hairTris=1079 faceTris=2115 secondary=2
  elf/wood         bob/shoulder hairTris=1061 faceTris=2097 secondary=5
  elf/dark         braided/long hairTris=1073 faceTris=2109 secondary=2
  dwarf/-          braided/shoulder hairTris=1096 faceTris=2184 secondary=4
  dwarf/mountain   braided/shoulder hairTris=1086 faceTris=2174 secondary=3
  dwarf/forge      crop/short hairTris=1096 faceTris=2184 secondary=6
  dwarf/deep       wild/shoulder hairTris=1086 faceTris=2174 secondary=7
  ork/-            mohawk/short hairTris=1096 faceTris=2156 secondary=5
  ork/greenhide    wild/short hairTris=1072 faceTris=2132 secondary=5
  ork/ironhide     mohawk/short hairTris=1098 faceTris=2158 secondary=5
  ork/bloodfang    wild/short hairTris=1054 faceTris=2114 secondary=5
```

## Whole-rig budget

`tests/ancestry_look_test.ts` ("the live skinned rig stays under the 12 000-triangle budget"), worst ancestry human/islander:
**11 888 before (cap + fall hair) -> 11 822 after** (grown hair), all 16 ancestries < 12 000.

## Real Chrome — `deno run -A tools/probe-wave-x-hair.ts`

Builds `BUILD_OUT=dist-hair deno task build` + a QA bundle, serves dist-hair on :8817 with the game CSP, renders heads
through the game's own `buildPreviewRig` path (front/back/side, + a close-up for male elders), then opens the real game.
Shots: **93** PNGs in `artifacts/qa-wave-x/hair/`; page errors: **0**; console errors:
1 (`Failed to load resource: the server responded with a status of 404 (Not Found)` — a missing favicon on the QA page/game, not the hair);
max hair triangles **1098**, max whole-rig triangles **11234** (< 12 000).

| who | years | style/tier | braids | follicles | clumps | grey | recession | min clearance mm | hair tris | rig tris |
|---|---|---|---|---|---|---|---|---|---|---|
| human male young | 18 | bob/shoulder | 0 | 576 | 60 | 0.00 | 0.00 | 0.45 | 1090 | 10654 |
| human male elder | 84 | bob/shoulder | 0 | 539 | 60 | 0.92 | 0.49 | 0.45 | 1096 | 10660 |
| human female young | 18 | crop/short | 0 | 576 | 68 | 0.00 | 0.00 | 0.45 | 1090 | 10658 |
| human female elder | 84 | crop/short | 0 | 576 | 68 | 0.92 | 0.00 | 0.45 | 1090 | 10658 |
| elf male young | 142 | bob/shoulder | 0 | 317 | 71 | 0.00 | 0.00 | 0.44 | 1079 | 11195 |
| elf male elder | 732 | bob/shoulder | 0 | 317 | 71 | 0.60 | 0.00 | 0.44 | 1079 | 11195 |
| elf female young | 142 | braided/long | 1 | 317 | 78 | 0.00 | 0.00 | 0.22 | 1097 | 11093 |
| elf female elder | 732 | braided/long | 1 | 317 | 78 | 0.60 | 0.00 | 0.22 | 1097 | 11093 |
| dwarf male young | 62 | wild/short | 0 | 919 | 64 | 0.00 | 0.00 | 0.51 | 1090 | 11234 |
| dwarf male elder | 314 | wild/short | 0 | 772 | 63 | 0.92 | 0.91 | 0.51 | 1055 | 11199 |
| dwarf female young | 62 | wild/shoulder | 1 | 919 | 44 | 0.00 | 0.00 | 0.25 | 1078 | 11154 |
| dwarf female elder | 314 | wild/shoulder | 1 | 919 | 44 | 0.92 | 0.00 | 0.25 | 1078 | 11154 |
| ork male young | 13 | mohawk/short | 0 | 559 | 72 | 0.00 | 0.00 | 0.49 | 1092 | 11156 |
| ork male elder | 58 | mohawk/short | 0 | 436 | 73 | 0.92 | 1.00 | 0.49 | 1068 | 11132 |
| ork female young | 13 | shaved/buzz | 0 | 559 | 0 | 0.00 | 0.00 | 1.42 | 214 | 10246 |
| ork female elder | 58 | shaved/buzz | 0 | 559 | 0 | 0.92 | 0.00 | 1.42 | 214 | 10246 |
| human/nomad male young | 18 | topknot/long | 0 | 528 | 72 | 0.00 | 0.00 | 0.45 | 1090 | 10654 |
| human/nomad male elder | 84 | topknot/long | 0 | 475 | 74 | 0.92 | 0.76 | 0.45 | 1098 | 10662 |
| human/nomad female young | 18 | ponytail/long | 0 | 528 | 45 | 0.00 | 0.00 | 0.23 | 1098 | 10678 |
| human/nomad female elder | 84 | ponytail/long | 0 | 528 | 45 | 0.92 | 0.00 | 0.23 | 1098 | 10678 |
| elf/wood male young | 142 | bob/shoulder | 0 | 349 | 68 | 0.00 | 0.00 | 0.44 | 1087 | 11211 |
| elf/wood male elder | 732 | bob/shoulder | 0 | 349 | 68 | 0.60 | 0.00 | 0.44 | 1087 | 11211 |
| elf/wood female young | 142 | braided/long | 3 | 349 | 39 | 0.00 | 0.00 | 0.22 | 1087 | 11107 |
| elf/wood female elder | 732 | braided/long | 3 | 349 | 39 | 0.60 | 0.00 | 0.22 | 1087 | 11107 |
| dwarf/mountain male young | 62 | braided/shoulder | 2 | 919 | 68 | 0.00 | 0.00 | 0.25 | 1088 | 11188 |
| dwarf/mountain male elder | 314 | braided/shoulder | 2 | 801 | 73 | 0.92 | 0.85 | 0.25 | 1096 | 11196 |
| dwarf/mountain female young | 62 | braided/shoulder | 3 | 919 | 51 | 0.00 | 0.00 | 0.25 | 1086 | 11194 |
| dwarf/mountain female elder | 314 | braided/shoulder | 3 | 919 | 51 | 0.92 | 0.00 | 0.25 | 1086 | 11194 |

## Honest gaps

- **Budget-bound detail.** The whole rig is pinned < 12 000 triangles and the rest of the rig measured 9564–10144 in the probe, so the hair
  has 1 100 triangles: 35–81 guide clumps, not hundreds. Strand detail is shader work (streak lanes, tapered tips,
  highlight band). Raise `HAIR_TRI_BUDGET` if the rig budget is raised; the clump count refits automatically.
- **Clearance is against the skull ELLIPSOID**, the same measure as the old `skullClearance` pin, not the real SDF skin
  (the SDF's flattened temples sit up to ~1 cm inside the ellipsoid, so side hair can stand slightly off the skin there).
- **No body collision.** Long hair drifts backward below the skull (0.22 z per unit drop) instead of colliding with the
  neck/shoulders/back; a long fall can clip the upper back in some poses.
- **Ear zones are ellipses from the anchors**, not the real pinna mesh; the elf zone is enlarged toward the tip by a
  stated rule. A few strands are stopped by a guard before their length (`blocked`, counted above).
- **Secondary motion translates whole hanging groups** (one per root sector / tail / braid): a large offset opens a gap
  at the split between the static scalp part and the hanging part, as the old fall tubes did.
- **Visual judgement is from screenshots read through an image-description model**: it confirmed braids, ponytail band,
  grey elders with receded temples, the mohawk crest, eyes uncovered; it also called the scalp “faceted/blocky” (flat
  cards + cel bands at this budget). I did not get a human eyeball on it.
- The Creator preview does not rebuild on an age/sex-only change (`previewKey`, lane B) — see `artifacts/messages-wave-x-H.md`.
- The probe's game step lands on the Fighters screen (the Creator's race cards were not reachable by that click path);
  the live bundle ran with 0 page errors there, but the per-race heads come from the QA page.
