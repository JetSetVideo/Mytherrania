# Mytherrania QA Report v2 — Visual Quality Audit

**Date:** 2026-10-10  
**Screenshots analyzed:** 8 views (title, creator, fight 3rd-person, close camera, 1st-person, victory, sheet, digest)  
**Method:** Pixel-level screenshot capture + vision model analysis per frame  

---

## Summary

The game renders a functional low-poly arena combat prototype with a consistent dark UI theme and a serviceable menu system. However, **several marquee features claimed in the build are not visually present**: the blue sky shader dome, cloud layer, ground auras, and improved face anatomy are either absent or rendering as flat/blocked geometry. What renders is a minimally viable 3D scene with readable HUD, but the visual gap between intended features and observed output is large.

---

## P0 — Critical / Blocking

### P0-1: Blue sky shader dome not visible
**Screenshots:** 01-title, 04-fight-third, 05-fight-close  
**Observation:** All backgrounds are flat dark navy/charcoal (`≈#1a1f26`). No sky gradient, no dome geometry, no atmospheric color. The first-person view (08) shows a dark starfield — not a daytime blue sky.  
**Impact:** The orange title and warm character tones are designed to contrast against blue sky; instead they sit on near-black, flattening the intended visual identity.  
**Expected:** A visible blue sky dome behind the arena with gradient from horizon to zenith.

### P0-2: Cloud layer not visible
**Screenshots:** 04-fight-third, 05-fight-close, 08-fight-first  
**Observation:** Zero cloud geometry, billboards, or atmospheric layers in any view.  
**Expected:** Cloud layer between arena and sky dome.

### P0-3: Ground aura rings (color-coded) not visible
**Screenshots:** 04-fight-third, 05-fight-close, 06-fight-iso, 07-fight-birds  
**Observation:** No rings, halos, or ground effects beneath either character. Floor is flat orange/tan geometry with a teal center strip.  
**Expected:** Color-coded aura rings under each character reflecting their state/class.

### P0-4: Face anatomy completely absent — block heads only
**Screenshots:** 05-fight-close, 04-fight-third  
**Observation:** Both characters have solid black rectangular blocks for heads. No eyes (iris/pupil), no nose (nostrils), no lips, no cheekbones, no jawline, no ears. Hair is a black block.  
**Impact:** The claim of "improved face anatomy (eyes with iris, nose, nostrils, upper/lower lips, cheekbones, jaw, ears, hair)" is **not realized in the render**.  
**Expected:** At minimum, sculpted/procedural facial features or painted-on details visible at close camera distance.

### P0-5: Spine recoil on hit not observable
**Screenshots:** 04-fight-third (static scene)  
**Observation:** No combat animation was captured despite repeated attack inputs. Characters appear in idle/reference pose.  
**Impact:** Cannot verify spine bend feature. Combined with the game loop appearing frozen in headless browser, this feature is **unverifiable** in automated QA.  
**Expected:** Visible torso/spine recoil on hit impact.

---

## P1 — High Priority

### P1-1: Character models are extremely basic (low-poly blocks)
**Screenshots:** All fight views  
**Observation:** Cylindrical bodies, flat shading, no textures, no facial features, weapons are thin gray/white lines or simple extrusions. Characters are distinguishable only by body color (red vs yellow).  
**Expected for low-poly style:** While low-poly is the aesthetic, even low-poly needs silhouette variety, weapon differentiation, and minimal detail (crossguards, blade edges, body segmentation).

### P1-2: Title screen lacks blue sky backdrop
**Screenshot:** 01-title  
**Observation:** The 3D backdrop shows a barely-visible humanoid silhouette on dark charcoal. No sky, no environmental interest, no key art.  
**Impact:** First impression is "placeholder" rather than "stylized." 85-90% of pixels are in a narrow dark value range.  
**Recommendation:** Point camera at skybox, light the scene, add a visible sky gradient behind the title.

### P1-3: Victory screen shows fight state, not victory
**Screenshot:** 09-victory-screen  
**Observation:** Screenshot shows "Fight!" text and HP values (6 and 18), not "Victory" or "You Win." Character is visible in top-down view.  
**Impact:** The victory screen endpoint may not render correctly, or the fight never progressed to conclusion.  
**Recommendation:** Verify victory screen logic triggers on opponent HP ≤ 0.

### P1-4: HP percentage display is inconsistent
**Screenshot:** 09-victory-screen  
**Observation:** "You (Warrior) HP 6 · 19%" (implies max HP ~31) and "Warrior HP 18 · 10%" (implies max HP ~180). These max HP values contradict each other.  
**Recommendation:** Audit HP percentage calculation — ensure denominator is consistent.

### P1-5: Digest page is empty — no match history data
**Screenshot:** 08-digest-page  
**Observation:** "0 fights — avg 0s | first-strike win rate: 0%." Blank By Race and By Class tables. Large empty space.  
**Impact:** The page looks broken rather than deliberately empty. No empty-state messaging explains why there's no data.  
**Recommendation:** Add "No matches played yet — fight to see stats" message. Seed with sample data for QA.

### P1-6: Game loop appears frozen in headless Chrome
**Observation:** All canvas captures were identical (same MD5 hash). requestAnimationFrame did not fire. Attacks dispatched via keyboard events did not advance game state.  
**Impact:** Automated QA cannot verify dynamic features (spine bend, hit effects, animation).  
**Recommendation:** Investigate rAF behavior in headless Chrome. Consider `--disable-gpu` flag or non-headless verification for combat features.

---

## P2 — Medium Priority

### P2-1: Race card description text is small and low-contrast
**Screenshot:** 02-race-selection  
**Observation:** Card descriptions ("Adaptable — humans gain +1 to all stats") are small gray text on dark cards — the most important comparative info is the hardest to read.  
**Fix:** Increase font size or lighten text color to at least WCAG AA.

### P2-2: Class dropdown is unstyled native `<select>`
**Screenshot:** 02-race-selection  
**Observation:** White browser-default dropdown breaks the dark theme. All other UI elements share a consistent dark aesthetic.  
**Fix:** Style the select or use a custom dropdown component.

### P2-3: Palette swatches have no selection indicator
**Screenshot:** 02-race-selection  
**Observation:** Five colored circles with no labels or active state. Unclear which (if any) is selected.  
**Fix:** Add selection ring, label, or highlight.

### P2-4: Control hint text nearly illegible (all screens)
**Screenshots:** All  
**Observation:** "WASD/ZQSD: Move | Space/Click: Attack…" renders as extremely faint dark-gray on dark background. Would fail WCAG (contrast < 2:1).  
**Fix:** Brighten to at least 4.5:1 contrast ratio.

### P2-5: Settings gear icon nearly invisible
**Screenshots:** All  
**Observation:** Top-right gear icon is extremely low contrast. Users will not discover it.  
**Fix:** Increase opacity/brightness.

### P2-6: Title screen has large dead zone in lower third
**Screenshot:** 01-title  
**Observation:** Strictly centered layout with empty dark space below the buttons. Composition feels top-heavy.  
**Fix:** Either move elements down or fill space with environmental art/particles.

### P2-7: Input prompt inconsistency
**Screenshot:** 01-title  
**Observation:** "Fight" button shows gamepad "X" glyph, but all hint text lists only keyboard/mouse bindings.  
**Fix:** Match the input glyph to the actual control scheme or add gamepad hint text.

### P2-8: "Dmg" and "Dur" column labels ambiguous
**Screenshot:** 07-sheet-page  
**Observation:** "Dmg" shows values like "60/100" — unclear whether this is dealt/received or HP remaining. "Dur" is abbreviated.  
**Fix:** Use clearer labels: "Damage (D/R)" and "Duration" or add tooltips.

### P2-9: Match History title over-promises vs. delivered content
**Screenshot:** 08-digest-page  
**Observation:** Title says "Match History" but shows only aggregate stats, no actual match list.  
**Fix:** Either add a chronological match list or rename to "Fight Digest / Win Rates."

### P2-10: Arena lacks environment beyond basic geometry
**Screenshots:** All fight views  
**Observation:** Four red corner posts, flat floor panels, dark void beyond. No terrain detail, no props, no arena variation.  
**Fix:** Add arena-specific props (weapon racks, banners), varied floor materials, and distant environmental silhouettes.

---

## What Looks Good

- **Consistent dark theme:** Navy/charcoal base with cream text and gold/amber accents is cohesive across all views.
- **Title typography:** "MYTHERRANIA" in heavy display font with orange gradient looks distinctive and readable.
- **Button hierarchy:** Filled amber for primary actions, outlined for secondary — clear and consistent.
- **Race card layout:** Four equal-width cards in a horizontal row with clear selected state (orange border).
- **Creator flow:** Logical progression: Name → Race → Details → Class → Palette → Action.
- **Sheet page layout:** Clean two-column character info + stats, full-width duel history table below. Good visual hierarchy.
- **Duel history table:** Seven columns with clear headers, readable dates, and consistent row formatting.
- **HUD readability:** Status text is high-contrast and legible during combat.
- **First-person weapon visibility:** Longsword blade rendered prominently in foreground.
- **Zero console errors:** No JavaScript errors in the browser console during QA session.

---

## Verification Notes

- **Canvas rendering confirmed:** WebGL context active on 2400×1896 canvas.
- **Server:** Deno HTTP server responding 200 at 127.0.0.1:8788.
- **Build:** dist/app.js at 547KB (560,532 bytes).
- **Browser:** Headless Chrome via Playwright/CDP.
- **Game loop issue:** requestAnimationFrame stalls in headless mode. Dynamic features (combat, animation, spine bend, hit effects) could not be verified via automated capture. Manual verification recommended.

---

*Report generated by automated QA harness. Screenshots archived in artifacts/qa/.*