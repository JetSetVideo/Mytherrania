# Graphics / audio lane

ACK 2026-10-09T21:07:39+02:00. Parent-assigned scope: src/graphics/shaders/CelShader.ts, src/audio/AudioManager.ts, tests/graphics*, tests/audio*, this file and graphics-log.md. No central-channel or git writes.

Contract: createCelMesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Group; returns surface and inverted-hull outline meshes sharing caller geometry, each owning a distinct ShaderMaterial. Caller must dispose shared geometry once and both materials. Static meshes only (no skinned/instanced support promised).

AudioManager is lazy: construction/play/setVolume do not create an AudioContext. Call unlock() synchronously from trusted pointer/keyboard activation; resolves boolean. setVolume clamps finite values to [0,1], NaN silences. playStep()/playImpact() no-op while locked, muted or disposed. dispose() is terminal, stops/disconnects voices, closes context. Synthesized voices bounded; parent Chrome verification must exercise real AudioContext and actual GPU shader compilation.

Checklist: [active] graphics RED/GREEN; [pending] audio RED/GREEN; [pending] full lane checks and Engine review. Browser/GPU/audio hardware results not yet observed by this lane.

## Update 2026-10-10 — graphics lane closed out
The lane split is historical: `src/graphics/` is now owned directly by the parent alongside
`src/game/` and `src/engine/`. CelShader/AudioManager contracts above still hold.
New in the graphics lane this pass: the race/sub-species appearance model feeding
`buildHumanoid` (hair fall, beard, ork tusks, elf ears), the 33-vertebra spine-curve torso,
the facial morph loop, and the model-capture probe (`tools/probe-models.ts`) with its `clean`
mode and character-relative orbit angles. Evidence: `artifacts/qa-models/`, `artifacts/data-science.md`
Pass 23.
