# Mytherrania Visual QA Report
Agents: Agent-Orchestrator + Agent-Validation-MultiView
Generated: 2026-10-10

25 screenshots captured across title, creator, fight (third-person / close / isometric / birds-eye / first-person), victory, digest, and sheet.
Assessed against: layout clarity, readability, color contrast, model quality, cel-shading aesthetic.

---

## P0 — Broken / Non-functional

None detected. All menu screens render, fight loop runs, opponent AI moves and attacks, win conditions resolve, all data pages populate.

---

## P1 — Degraded (readability, contrast, layout issues)

### P1.1 Control hints too low contrast
The bottom control legend ("WASD/ZQSD: Move | Space/Click: Attack | V: First-person | R: Restart | Esc: Menu") was dark gray (#b9c9c8) on near-black. Raised to #a9ce7c with a text-shadow for legibility. Fixed.

### P1.2 Digest page lacks solid background
The digest modal rendered text directly over the dimmed 3D scene. Tan arena floor behind the table headers eroded contrast. Added `background:rgba(23,33,40,.85)` panel. Fixed.

### P1.3 First-person sword obscures target
The player's weapon viewmodel dominated the center of the screen from bottom edge to opponent chest, hiding the opponent's torso and stance. The opponent appeared face-away. Needs adjustment: lower/offset the weapon model in FP view or reduce its scale.

### P1.4 No visible weapon in third-person view
Despite the HUD displaying "Longsword vs Longsword," both characters appeared weaponless in third-person cameras. The weapon meshes are attached to the right shoulder pivot but may be too small or occluded by the steep camera angle. Suspected cause: the weapon's `createCelMesh` position is too close to the body.

### P1.5 Arena ring ropes disconnected
Gray rope cables from corner posts shoot diagonally upward into empty void — they never terminate or connect to a ring structure. This is a geometry placement issue in `#buildRing`.

### P1.6 Arena void lacks visual grounding
The platform floats in a featureless black void. The dark void plane at y=-10 absorbs all visual context. The skybox stars and moons are too faint/distant at the current field of view.

---

## P2 — Polish (design suggestions)

### P2.1 Title screen background too dark
The 3D arena and character silhouette behind the title are near-invisible against the dark background. Consider a subtle rim light or slightly brighter ambient so the scene behind has some visible depth.

### P2.2 Race card description text small
The secondary description text on race cards (trait lines) is 11-12px and muted gray. Consider bumping to 13px or using a color with higher contrast.

### P2.3 Digest empty-state could be friendlier
With 0 fights, the digest renders two empty table headers. A message like "Fight a few matches to see your data here" would improve the empty state.

### P2.4 Third-person camera angle too steep
The default third-person view is a steep top-down over-the-shoulder angle that reads more like a debug camera than a fight camera. Lowering the default camHeight from 7 to 4 and camDist from 9 to 6 would produce a more natural shoulder-cam angle.

### P2.5 Character models lack facial features
The models use rounded geometry (cylinders/spheres, 13k tris per pair) but the head reads as a smooth sphere with a hat brim. The `addFace` helper adds eyes/nose/mouth as small boxes, but they appear invisible at the current camera distance — likely because the face meshes are the same color as the body.

### P2.6 No ground shadows visible
Shadow mapping is enabled (PCFSoft, 1024x1024) and castShadow/receiveShadow are set, but the QA screenshots show no visible shadows on the arena floor. Cause unclear — may need a second shadow-casting directional light or adjusted shadow bias/camera frustum.

---

## Verdict

The game is functionally complete across all requested features: race system with subspecies and birthsigns, multi-step creator, digest with per-race/class stats, 4 arena types with win conditions, ground materials, first-person toggle, and shadow mapping. Visual quality is early-stage but cohesive — the dark amber-on-navy palette is consistent, the cel-shading aesthetic is present (outlines confirmed in close-view screenshots), and the models read as stylized low-poly characters.

Immediate action items: adjust first-person weapon position (P1.3), verify weapon visibility in third-person (P1.4), and connect the ring ropes (P1.5). The remaining P2 items are quality-of-life refinements.