# Foreground-coordinated Phase 1 ownership
User renewed implementation/browser-test authorization. Parent owns shared coordination; agents do not execute the previously denied locked shell append.
Engine agent: main.ts,index.html,styles.css,src/engine,input,physics and their tests.
Graphics agent: src/graphics,src/audio and tests.
Balance agent: src/game,src/balance,tools/arena.ts and tests.
Parent: manifest,server/build,browser/audit,budget,final evidence. Agent communication is via separate artifacts/messages-{engine,graphics,balance}.md files. Parent reads/relays; no concurrent shared write.
Architecture contract is PHASE1_PLAN.md; each actual code/test step gets honest WHO WHAT WHERE WHEN WHY HOW. Parent and independent reviewer inspect source and reproduce checks before final claims. Denied commands are not retried or transformed; foreground approval-gated execution is user-authorized and uses normal approval prompts.

## Consolidated requirement index (v3, 2026-10-10)

The lane split above is historical. The single sources of truth are now:
- `docs/SPEC.md` — WHAT the game is, every requirement with an id, bound, equation, owning file
  and status (LIVE / TESTED / MODEL / OPEN). Version 3 adds: race appearance (§2.5), secondary
  stats (§2.6), stance transitions / palm grip / face morph / animation tensors (§4.2.1–4.2.4),
  win-condition variety as an explicit OPEN gap (§5.3), adaptive AI + telemetry + Elo (§6.2.1–
  6.2.3), sense-gated engagement + live minimap (§6.5), the full UI table (§8), and rig/camera/
  physical animation (§11).
- `DESIGN.md` — the visual contract; the v3 "Character contract" (items 9–17) adds the ancestry,
  spine, face, hair/beard geometry, weapon-follows-palm, camera-occlusion, balance and menu rules.
- `PHASE1_PLAN.md` — phase 1 gate list plus the Phase 2/3/4 summaries and the OPEN list.
- `artifacts/data-science.md` — the measured evidence log (passes 8–23).
- `docs/SPEC-tables.md` — numbers generated from the code by `tools/gen-spec-tables.ts`.

`tests/spec_test.ts` pins the cross-module bounds named `[SPEC Xn]` in SPEC.md, so the spec cannot
drift from the code without a test failing.
