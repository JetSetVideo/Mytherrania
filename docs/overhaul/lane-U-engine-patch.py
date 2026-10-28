"""Lane U Engine.ts integration patch: (anchor, replacement) pairs, each anchor must occur once.
Usage: python3 engine_patch.py <path/to/Engine.ts> [<path/to/MatchHistory.ts>]"""
import sys

ENGINE = [
# 1. imports
('''import { LIVE_ARENA_MAX, Menu } from "../ui/Menu.ts";''',
 '''import { clampLiveArenaSize, Menu } from "../ui/Menu.ts";
import {
  effectiveLayout, effectsDensityScale, fovFor, lookRates, pixelBudgetFor, SettingsPanel,
  type GameSettings, type LayoutChoice,
} from "../ui/SettingsPanel.ts";'''),
# 2. pixel budget becomes a parameter (Settings -> Display -> Quality)
('''function renderPixelRatio(cssW: number, cssH: number): number {
  const dpr = globalThis.devicePixelRatio || 1;
  return Math.max(1, Math.min(dpr, 2, Math.sqrt(PIXEL_BUDGET / Math.max(1, cssW * cssH))));
}''',
 '''function renderPixelRatio(cssW: number, cssH: number, budget = PIXEL_BUDGET): number {
  const dpr = globalThis.devicePixelRatio || 1;
  return Math.max(1, Math.min(dpr, 2, Math.sqrt(budget / Math.max(1, cssW * cssH))));
}

/** How a match ended: "ko" = the loser's HP reached 0; "forfeit" = the player gave up (W02). */
type MatchEndReason = "ko" | "forfeit";'''),
# 3. fields
('''  #frozen = false; // QA: pause the simulation while rendering continues''',
 '''  #frozen = false; // QA: pause the simulation while rendering continues
  /**
   * Player pause (W02): true while the settings dialog is open over a live fight. Like
   * #frozen it stops the simulation (dt = 0: fighters, AI, skills, cooldowns, timers, the
   * truce clock, the sky) while the frame keeps rendering.
   */
  #paused = false;
  /** How the current match ended (null while it runs). */
  #endReason: MatchEndReason | null = null;
  /** The settings gear + dialog (W02/W03). */
  #settings!: SettingsPanel;
  /** Settings -> Controls -> Keyboard layout: "auto" follows #layout, else forced labels. */
  #layoutChoice: LayoutChoice = "auto";
  /** Mouse-look rates, radians per pixel (pitch < 0 = inverted Y). */
  #look = { yaw: 0.003, pitch: 0.003 };
  /** Render pixel budget, device pixels (Settings -> Display -> Quality). */
  #pixelBudget = PIXEL_BUDGET;
  /** Multiplier on the effect density exponent (Settings -> Display -> Effects). */
  #fxScale = 1;'''),
# 4. menu: shared leave-to-title + title Settings button
('''      onMenu: () => { this.#phase = "menu"; this.#hud.style.display = "none"; this.#menu.show("title"); },''',
 '''      onMenu: () => this.#leaveToTitle(),
      onSettings: () => { this.#settings.setContext("menu"); this.#settings.open(); },'''),
# 5. resize uses the chosen budget
('''      this.#renderer.setPixelRatio(renderPixelRatio(w, h));''',
 '''      this.#renderer.setPixelRatio(renderPixelRatio(w, h, this.#pixelBudget));'''),
# 6. effects intensity scales the shared density exponent
('''    FX_DENSITY.value = fxDensityForLuminosity(luminosity(env.sun.elevation, env.sunOcclusion));''',
 '''    FX_DENSITY.value = fxDensityForLuminosity(luminosity(env.sun.elevation, env.sunOcclusion)) * this.#fxScale;'''),
# 7. arena clamp (W04)
('''    const chosenSize = this.#arenaOverride?.size ?? this.#menu?.arenaChoice().size;
    if (!chosenSize) cfg.size = Math.min(LIVE_ARENA_MAX, Math.max(8, cfg.size));''',
 '''    // Live arenas span [LIVE_ARENA_MIN, LIVE_ARENA_MAX] = [34, 120] m (W04; Menu.liveArenaMinimum
    // derives the minimum from spawn + dash + knockback slide + prop bypass + wall clearance).
    // Random sizes AND creator choices are clamped; only a QA override keeps its exact size.
    if (this.#arenaOverride?.size === undefined) cfg.size = clampLiveArenaSize(cfg.size);'''),
# 8. a new match: not paused, no end reason, the panel offers the fight actions
('''    this.#phase = "fight";
    this.#winner = null;
    this.#elapsed = 0;''',
 '''    this.#phase = "fight";
    this.#winner = null;
    this.#endReason = null;
    this.#paused = false;
    this.#settings.setContext(this.#spectate ? "spectate" : "fight");
    this.#elapsed = 0;'''),
# 9. keydown: while paused only Esc reaches the game; V and M persist through the settings
('''      if (isTyping(e.target)) return;
      this.#layout.observe(e.code, e.key);''',
 '''      if (isTyping(e.target)) return;
      this.#layout.observe(e.code, e.key);
      // Paused (settings open): only Esc gets through, as the resume key.
      if (this.#settings.isOpen && e.code !== "Escape") return;'''),
('''      else if (e.code === "KeyV" && !e.repeat) { e.preventDefault(); this.#firstPerson = !this.#firstPerson; }''',
 '''      else if (e.code === "KeyV" && !e.repeat) { e.preventDefault(); this.#settings.update({ firstPerson: !this.#firstPerson }); }'''),
('''      else if (e.key.toLowerCase() === "m" && !e.repeat) { e.preventDefault(); this.#minimap?.cycleMode(); }''',
 '''      else if (e.key.toLowerCase() === "m" && !e.repeat) {
        e.preventDefault();
        const mode = this.#minimap?.cycleMode();
        if (mode) this.#settings.update({ minimap: mode });
      }'''),
('''    el.addEventListener("click", () => { el.requestPointerLock(); });''',
 '''    el.addEventListener("click", () => { el.requestPointerLock(); });
    // Esc while the pointer is locked is spent by the browser on releasing the lock (the page
    // may never see the key), and alt-tab drops the lock too: losing it mid-fight = pause.
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement || this.#phase !== "fight" || this.#winner) return;
      if (this.#menu.visible || this.#settings.isOpen) return;
      this.#settings.open();
    });'''),
# 10. the old text gear goes away (SettingsPanel puts an icon gear in #hud)
('''    const openBtn = document.createElement("button");
    openBtn.id = "btn-settings";
    openBtn.textContent = "⚙";
    openBtn.addEventListener("click", () => {
      const dlg = document.getElementById("settings-dialog")!;
      dlg.classList.toggle("open");
    });
    document.body.appendChild(openBtn);
  }''',
 '''    // The minimap's own click cycles its view; persist it so the settings stay the truth.
    document.getElementById("hud-minimap")!.addEventListener("click", () => {
      if (this.#minimap) this.#settings?.update({ minimap: this.#minimap.mode });
    });
  }'''),
# 11. key labels follow the layout override
('''    const layout: Layout = this.#layout.layout;
    const letters = SKILL_LETTER_CODES.map((c) => keyLabel(c, layout)).join("/");
    hints.textContent = `${movementLabel(layout)}: Move | Space/Click: Attack | 1/2/3 or ${letters}: Dash / Power / Defend | V: First-person | R: Restart | Esc: Menu`;''',
 '''    const layout: Layout = this.#keyLayout();
    const letters = SKILL_LETTER_CODES.map((c) => keyLabel(c, layout)).join("/");
    hints.textContent = `${movementLabel(layout)}: Move | Space/Click: Attack | 1/2/3 or ${letters}: Dash / Power / Defend | V: First-person | M: Map | R: Restart | Esc: Pause`;'''),
('''    return `${i + 1} · ${keyLabel(SKILL_LETTER_CODES[i] ?? "", this.#layout.layout)}`;
  }''',
 '''    return `${i + 1} · ${keyLabel(SKILL_LETTER_CODES[i] ?? "", this.#keyLayout())}`;
  }

  /** The layout key labels use: the settings override, else the detected one. */
  #keyLayout(): Layout {
    return effectiveLayout(this.#layoutChoice, this.#layout.layout);
  }'''),
# 12. #buildSettings -> SettingsPanel
('''  #buildSettings() {
    const dlg = document.createElement("div");
    dlg.id = "settings-dialog";
    dlg.role = "dialog";
    dlg.innerHTML = `<h2>Settings</h2>
      <label>Volume <input id="rng-volume" type="range" min="0" max="1" step="0.05" value="0.75"></label>
      <label>Camera <select id="sel-camera"><option>close</option><option selected>third</option><option>isometric</option><option>birds-eye</option></select></label>
      <button id="btn-close-settings">Close</button>`;
    document.body.appendChild(dlg);
    dlg.querySelector("#rng-volume")!.addEventListener("input", (e) => {
      this.#volume = parseFloat((e.target as HTMLInputElement).value);
      this.#audio.setVolume(this.#volume);
    });
    dlg.querySelector("#sel-camera")!.addEventListener("change", (e) => {
      this.#activeCamera = (e.target as HTMLSelectElement).value as CameraMode;
    });
    dlg.querySelector("#btn-close-settings")!.addEventListener("click", () => dlg.classList.remove("open"));
  }''',
 '''  /**
   * The settings gear (in #hud, left of the minimap) and its modal dialog (W02/W03).
   * Opening it over a live fight pauses; closing resumes; Give up forfeits to the rival.
   * The saved settings are applied once here, then on every change.
   */
  #buildSettings() {
    this.#settings = new SettingsPanel(document.body, {
      onOpen: () => this.#setPaused(true),
      onResume: () => this.#setPaused(false),
      onGiveUp: () => { this.#setPaused(false); this.#forfeit(); },
      onRestart: () => {
        this.#setPaused(false);
        if (this.#phase === "fight") this.#startFight(this.#playerProfile, this.#opponentProfile);
      },
      onMainMenu: () => { this.#setPaused(false); this.#leaveToTitle(); },
      onChange: (s) => this.#applySettings(s),
    }, { gearContainer: this.#hud, detectedLayout: this.#layout.layout });
    this.#layout.onChange((layout) => this.#settings.setDetectedLayout(layout));
    this.#applySettings(this.#settings.settings);
  }

  /**
   * Pause or resume. Only a live fight (phase "fight", no winner) pauses; asking otherwise
   * just clears the flag. Pausing drops held keys and the pointer lock (the cursor must reach
   * the dialog).
   */
  #setPaused(on: boolean): void {
    const pause = on && this.#phase === "fight" && !this.#winner;
    if (pause === this.#paused) return;
    this.#paused = pause;
    this.#input.clear();
    if (pause && document.pointerLockElement) document.exitPointerLock();
  }

  /** Leave the fight (or a result screen) for the title. */
  #leaveToTitle(): void {
    this.#paused = false;
    this.#phase = "menu";
    this.#settings.setContext("menu");
    this.#hud.style.display = "none";
    this.#menu.show("title");
  }

  /**
   * Esc, in priority order: the settings dialog backs out one level (confirm -> panel ->
   * resume); a menu screen goes Back; a live fight pauses and opens the settings.
   */
  #onEscape(): void {
    if (this.#settings.handleEscape()) return;
    if (this.#menu.visible) { this.#menu.back(); return; }
    if (this.#phase === "fight" && !this.#winner) this.#settings.open();
  }

  /** Apply validated settings to the running engine (at start-up and on every change). */
  #applySettings(s: GameSettings): void {
    // Controls: labels follow the forced layout or the detector (bindings stay physical).
    this.#layoutChoice = s.layout;
    this.#renderHints();
    this.#look = lookRates(s);
    // Camera.
    this.#activeCamera = s.camera;
    this.#firstPerson = s.firstPerson;
    for (const mode of ["third", "close"] as const) {
      const cam = this.#cameras[mode] as THREE.PerspectiveCamera;
      cam.fov = fovFor(mode, s);
      cam.updateProjectionMatrix();
    }
    // Display.
    if (this.#minimap && this.#minimap.mode !== s.minimap) this.#minimap.setMode(s.minimap);
    this.#fxScale = effectsDensityScale(s.effects);
    document.getElementById("hints")?.classList.toggle("is-hidden", !s.showHints);
    this.#pixelBudget = pixelBudgetFor(s.quality);
    this.#renderer.setPixelRatio(renderPixelRatio(globalThis.innerWidth, globalThis.innerHeight, this.#pixelBudget));
    // Audio.
    this.#volume = s.volume;
    this.#audio.setVolume(this.#volume);
  }'''),
# 13. no attacks / skills while paused
('''  #playerSkill(index: number): void {
    if (this.#phase !== "fight" || this.#winner) return;''',
 '''  #playerSkill(index: number): void {
    if (this.#phase !== "fight" || this.#winner || this.#paused) return;'''),
('''  #playerAttack() {
    const f = this.#player;
    if (this.#phase !== "fight" || this.#winner) return;''',
 '''  #playerAttack() {
    const f = this.#player;
    if (this.#phase !== "fight" || this.#winner || this.#paused) return;'''),
# 14. HUD skill letters follow the override
('''        v.altKeyLabel = keyLabel(SKILL_LETTER_CODES[i] ?? "", this.#layout.layout); // A/E/F on AZERTY, Q/E/F on QWERTY''',
 '''        v.altKeyLabel = keyLabel(SKILL_LETTER_CODES[i] ?? "", this.#keyLayout()); // A/E/F on AZERTY, Q/E/F on QWERTY'''),
# 15. the KO path and the forfeit share one ending
('''    if (p.hp <= 0 || o.hp <= 0) {
      this.#winner = p.hp <= 0 && o.hp <= 0
        ? (p.hp > o.hp ? "player" : "opponent")
        : p.hp <= 0 ? "opponent" : "player";
    }

    if (this.#winner) {
      const loser = this.#winner === "player" ? o : p;''',
 '''    if (p.hp <= 0 || o.hp <= 0) {
      this.#endMatch(p.hp <= 0 && o.hp <= 0
        ? (p.hp > o.hp ? "player" : "opponent")
        : p.hp <= 0 ? "opponent" : "player", "ko");
    }
  }

  /** Settings -> Give up -> Yes: the rival wins by forfeit (never while spectating). */
  #forfeit(): void {
    if (this.#phase !== "fight" || this.#winner || this.#spectate) return;
    this.#endMatch("opponent", "forfeit");
  }

  /**
   * End the match once: `winner` takes it by `reason` ("ko" or "forfeit"). Folds the AI
   * careers, the ladder, the active profile and the history, logs the end and shows the
   * result screen. A forfeit does not feed AiBrain.adapt: the bot did not win by fighting.
   */
  #endMatch(winner: "player" | "opponent", reason: MatchEndReason): void {
    if (this.#winner) return;
    this.#winner = winner;
    this.#endReason = reason;
    this.#paused = false;
    this.#settings.setContext("menu");
    const p = this.#player, o = this.#opponent;
    {
      const loser = this.#winner === "player" ? o : p;'''),
('''        const brain = this.#brains.get(f);
        if (brain) brain.adapt(won, prof.winRate(), prof.telemetry.digest());''',
 '''        const brain = this.#brains.get(f);
        if (brain && reason === "ko") brain.adapt(won, prof.winRate(), prof.telemetry.digest());'''),
('''        x: loser.body.x, z: loser.body.z, reason: "ko",
      }, performance.now());
      document.exitPointerLock();
      const w = this.#winner === "player" ? p : o, l = this.#winner === "player" ? o : p;
      const title = this.#spectate ? `${w.name} wins` : this.#winner === "player" ? "Victory!" : "Defeat";
      this.#menu.show("victory", { winner: this.#winner, result: { title, detail: `${w.name} (${w.className}) beat ${l.name} (${l.className}) by knockout in ${this.#elapsed.toFixed(1)}s — ${this.#place.name}, ${this.#env.phase}` } });
    }
  }''',
 '''        x: loser.body.x, z: loser.body.z, reason,
      }, performance.now());
      document.exitPointerLock();
      const w = this.#winner === "player" ? p : o, l = this.#winner === "player" ? o : p;
      const title = this.#spectate ? `${w.name} wins` : this.#winner === "player" ? "Victory!" : "Defeat";
      const how = reason === "forfeit"
        ? `${l.name} gave up against ${w.name} (${w.className}) after ${this.#elapsed.toFixed(1)}s`
        : `${w.name} (${w.className}) beat ${l.name} (${l.className}) by knockout in ${this.#elapsed.toFixed(1)}s`;
      this.#menu.show("victory", { winner: this.#winner, result: { title, detail: `${how} — ${this.#place.name}, ${this.#env.phase}` } });
    }
  }'''),
# 16. the loop: paused = dt 0 + the simulation gates shut
('''    const dt = Math.min(this.#clock.getDelta(), 0.1);''',
 '''    // getDelta() runs every frame so resuming does not jump; paused, the world's dt is 0.
    const dt = this.#paused ? 0 : Math.min(this.#clock.getDelta(), 0.1);'''),
('''    if (this.#input.consume("Escape")) {
      // Esc = Back on a visible menu screen (the title is the floor); during a fight it opens
      // the title, as before.
      if (this.#menu.visible) this.#menu.back();
      else if (this.#phase === "fight") {
        this.#phase = "menu";
        this.#menu.show("title");
        this.#hud.style.display = "none";
      }
    }''',
 '''    // Esc: settings back-out, else menu Back, else pause the fight (#onEscape).
    if (this.#input.consume("Escape")) this.#onEscape();'''),
('''    if (this.#phase === "fight" && !this.#winner && !this.#frozen) {
      p.attackCooldown''',
 '''    if (this.#phase === "fight" && !this.#winner && !this.#frozen && !this.#paused) {
      p.attackCooldown'''),
('''      if (this.#frozen) { f.ringedOut = false; continue; }''',
 '''      if (this.#frozen) { f.ringedOut = false; continue; }
      if (this.#paused) continue;'''),
('''    if (this.#phase === "fight" && !this.#frozen) this.#checkElimination();
    if (this.#phase === "fight" && !this.#frozen && !this.#winner) this.#tickWorld(dt);''',
 '''    if (this.#phase === "fight" && !this.#frozen && !this.#paused) this.#checkElimination();
    if (this.#phase === "fight" && !this.#frozen && !this.#paused && !this.#winner) this.#tickWorld(dt);'''),
# 17. mouse look: sensitivity + invert Y
('''      this.#orbitYaw -= md.x * 0.003;
      this.#orbitPitch = Math.max(0.05, Math.min(1.2, this.#orbitPitch + md.y * 0.003));''',
 '''      this.#orbitYaw -= md.x * this.#look.yaw;
      this.#orbitPitch = Math.max(0.05, Math.min(1.2, this.#orbitPitch + md.y * this.#look.pitch));'''),
# 18. records and state() carry the end reason
('''      arena: this.#arenaType,
      reason: "ko",''',
 '''      arena: this.#arenaType,
      reason: this.#endReason ?? "ko",'''),
('''      endReason: this.#winner ? "ko" : null,''',
 '''      endReason: this.#winner ? (this.#endReason ?? "ko") : null,'''),
]

MATCH_HISTORY = [
('''export type WinReason = "ko" | "ring-out" | "timed" | "koth";''',
 '''export type WinReason = "ko" | "ring-out" | "timed" | "koth" | "forfeit";'''),
]


def apply(path, pairs):
    src = open(path).read()
    for i, (old, new) in enumerate(pairs):
        n = src.count(old)
        if n != 1:
            raise SystemExit(f"{path}: anchor #{i} found {n} times: {old[:90]!r}")
        src = src.replace(old, new)
    open(path, "w").write(src)
    print(f"{path}: {len(pairs)} replacements applied")


if __name__ == "__main__":
    apply(sys.argv[1], ENGINE)
    if len(sys.argv) > 2:
        apply(sys.argv[2], MATCH_HISTORY)
