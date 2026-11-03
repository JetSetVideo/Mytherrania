## Verdicts and board ids

| lane | round | READY | partner review | Q verdict |
|---|---|---|---|---|
| V | r1 | Z-9 | T FAIL Z-13 (socket gap 0 px at 320) | **FAIL** Z-12 (844x390: sticky .screen-nav over 5/6 gizmo ends, 5/6 snaps dead) |
| T | r1 | Z-10 | V PASS Z-11 | PASS Z-17 |
| T | r2 | Z-14 (nav not sticky on landscape phones) | V PASS Z-18 | PASS Z-20 |
| V | r2 | Z-15/Z-16 (gizmo below covers, >= 6 px socket clearance) | T PASS Z-19 | PASS Z-20 |

Runs `dry-live`, `T-r1b`, `r2-820` are partial re-runs (pre-READY dry run; relation-semantics tightening; 820 zoom-out scroll check).

Open notes: Z-21 (non-blocking) 844x390 scroll-box clips the top ~5 px of the gizmo when the viewer is centred.
Not covered by Q: the saved hero card on the Fighters tab (T's probe covers it); the gizmo's `-X/-Y/-Z` end colours (only +ends classified; negative ends overlap at the home view).

## Method limits (stated, not hidden)
- Zoom-to-cursor pixel meter: fixed point searched on a 2-css-px grid in a 61x61-sample window around the cursor; parallax makes it approximate; each row reports the error at the cursor beside the error of the centre-zoom hypothesis (report.json `fixedPoint`).
- Projection meter uses V's `debugPick` for the 3D point under the cursor, projected with Q's OWN camera rebuilt from `debugView` (agreement checked as its own row).
- Relation is read from `[data-relation]` on the plate's chips and compared with `Theme.relation` from the same tree.
- Full `deno lint` reports 37 problems in the committed `artifacts/wave-gen/verify-visual/_page/capture-entry.ts` (identical on HEAD); `deno lint src tests tools main.ts` is clean.
