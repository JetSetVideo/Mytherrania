#!/usr/bin/env python3
"""Lane M: integrate MotionStyle into src/engine/Engine.ts (exact-once text replacements).

Run from the repo root:  python3 docs/overhaul/lane-M-engine-patch.py [--dry-run]

What it does (docs/overhaul/lane-M.md, section "Engine integration"):
  1. imports motionStyleFor / weaponMotionFromSpec / weaponMotionFromLegacy (MotionStyle.ts);
  2. a reusable per-engine live-state object (no per-frame allocation);
  3. after #armCombat in the spawn loop: build each fighter's style (race, subrace, the name seed,
     the leg geometry the Animator was built with, height / weight, the generated weapon or the
     classic one, the combat stats) and hand it to the Animator (which steps its live smoothing)
     and the SwingDriver;
  4. #armCombat re-attaches the existing style to a rebuilt SwingDriver (weapon swap);
  5. #updatePose feeds the live state (hp / stamina / mana / exhaustion / damage %) every frame
     right before animator.update(...) and passes the swing's leg drive (attackDrive);
  6. the attack state of a plain swing lasts the whole styled swing (hold + settle included).
Every anchor must occur exactly once, else nothing is written.
"""
import sys
from pathlib import Path

ENGINE = Path("src/engine/Engine.ts")

EDITS = [
    (
        'import { legGeometryFromBones, limitTableFrom } from "../game/anim/Rig.ts";\n',
        'import { legGeometryFromBones, limitTableFrom } from "../game/anim/Rig.ts";\n'
        'import { type LiveState, motionStyleFor, weaponMotionFromLegacy, weaponMotionFromSpec } from "../game/anim/MotionStyle.ts";\n',
    ),
    (
        "  #animators = new Map<Fighter, Animator>();\n",
        "  #animators = new Map<Fighter, Animator>();\n"
        "  /** Lane M: the live state handed to a fighter's motion style each frame (reused: no allocation). */\n"
        "  readonly #motionLive: LiveState = { hpFrac: 1, staminaFrac: 1, manaFrac: 1, exhausted: false, damagePercent: 0 };\n",
    ),
    (
        "      this.#armCombat(f, rig);\n",
        "      this.#armCombat(f, rig);\n"
        "      // Lane M: this fighter's motion style (race, subrace, seed, body, weapon, stats).\n"
        "      this.#applyMotionStyle(f, profiles[i].race, profiles[i].subrace ?? null, seed, app.height, app.weight);\n",
    ),
    (
        "    this.#swings.set(f, new SwingDriver(setup, limitTableFrom(f.skeleton.limits())));\n",
        "    this.#swings.set(f, new SwingDriver(setup, limitTableFrom(f.skeleton.limits())));\n"
        "    { const st = this.#animators.get(f)?.style; if (st) this.#swings.get(f)!.setStyle(st); } // lane M: keep the style on a rebuilt driver\n",
    ),
    (
        "  #armCombat(f: Fighter, rig: HumanoidRig & SkinnedExtras): void {\n",
        "  /**\n"
        "   * Lane M: build a fighter's MotionStyle and hand it to its Animator (which steps the live\n"
        "   * smoothing once per frame) and its SwingDriver (four-phase swings). Called once per spawn.\n"
        "   */\n"
        "  #applyMotionStyle(f: Fighter, race: string, subrace: string | null, seed: number, height: number, weight: number): void {\n"
        "    const an = this.#animators.get(f);\n"
        "    if (!an) return;\n"
        "    const drv = this.#swings.get(f);\n"
        "    const kind = drv ? drv.setup.kind : \"slash\";\n"
        "    const style = motionStyleFor({\n"
        "      race, subrace, seed,\n"
        "      body: { geometry: an.geometry, height, weight },\n"
        "      weapon: f.weaponSpec ? weaponMotionFromSpec(f.weaponSpec, kind) : weaponMotionFromLegacy(f.weapon, kind),\n"
        "      stats: f.stats,\n"
        "    });\n"
        "    style.setLiveImmediate(this.#liveOf(f));\n"
        "    an.setStyle(style);\n"
        "    drv?.setStyle(style);\n"
        "  }\n"
        "\n"
        "  /** Lane M: the fighter's live state for its motion style (writes the reused #motionLive). */\n"
        "  #liveOf(f: Fighter): LiveState {\n"
        "    const r = this.#resources.get(f), l = this.#motionLive;\n"
        "    l.hpFrac = f.hp / Math.max(1, f.stats.maxHealth);\n"
        "    l.staminaFrac = r ? r.stamina.current / Math.max(1e-6, r.stamina.max) : 1;\n"
        "    l.manaFrac = r ? r.mana.current / Math.max(1e-6, r.mana.max) : 1;\n"
        "    l.exhausted = !!r?.exhausted;\n"
        "    l.damagePercent = f.damagePercent;\n"
        "    return l;\n"
        "  }\n"
        "\n"
        "  #armCombat(f: Fighter, rig: HumanoidRig & SkinnedExtras): void {\n",
    ),
    (
        "      const out = animator.update(dt, {\n",
        "      animator.setLive(this.#liveOf(f)); // lane M: hp / stamina / mana / exhaustion modulate the style\n"
        "      const out = animator.update(dt, {\n",
    ),
    (
        "attackPose: drv ? drv.attackPose() : null,\n",
        "attackPose: drv ? drv.attackPose() : null,\n"
        "        attackDrive: drv ? drv.legDrive() : 0, // lane M: the legs lead the strike\n",
    ),
    (
        "    this.#anim.get(f)!.attack = t.windup + t.strike + t.recover;\n",
        "    this.#anim.get(f)!.attack = t.windup + t.strike + t.recover + (t.hold ?? 0) + (t.settle ?? 0); // lane M: styled holds\n",
    ),
]


def main() -> int:
    dry = "--dry-run" in sys.argv
    src = ENGINE.read_text()
    for old, _new in EDITS:
        n = src.count(old)
        if n != 1:
            print(f"anchor occurs {n} times (need exactly 1):\n{old}", file=sys.stderr)
            return 1
    out = src
    for old, new in EDITS:
        out = out.replace(old, new, 1)
    if dry:
        print(f"dry run: {len(EDITS)} anchors found exactly once; nothing written")
        return 0
    ENGINE.write_text(out)
    print(f"patched {ENGINE}: {len(EDITS)} edits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
