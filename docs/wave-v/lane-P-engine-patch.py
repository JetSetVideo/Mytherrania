#!/usr/bin/env python3
"""Wave V lane P -> Engine.ts integration (idle facing hold: heels flat while the rival sways).

Three exact-once text edits. Dry run (default) checks every anchor occurs exactly once and prints
the plan; `--apply` writes src/engine/Engine.ts. Run from the repo root:

    python3 docs/wave-v/lane-P-engine-patch.py           # dry run
    python3 docs/wave-v/lane-P-engine-patch.py --apply   # apply

Without this patch the Animator behaves exactly as before (AnimatorInput.honoursYawOffset absent
-> AnimatorOutput.yawOffset stays 0), i.e. the heels keep lifting while an idle fighter turns to
follow a swaying rival. Breathing, the breath rise, the idle weight shift and the settle step need
NO engine change (they ride on angles / rootOffsetY / rootOffsetLateral the engine already applies).
"""
import sys

PATH = "src/engine/Engine.ts"
EDITS = [
    (
        "E1 animator input: the engine honours the facing hold",
        "        externalRoll: Math.abs(bal) > 1e-4 ? bal * 0.6 : 0, // the balance tilt the rig loop adds\n      });",
        "        externalRoll: Math.abs(bal) > 1e-4 ? bal * 0.6 : 0, // the balance tilt the rig loop adds\n"
        "        honoursYawOffset: true, // wave V lane P: the rig adds out.yawOffset (idle facing hold, heels flat)\n      });",
    ),
    (
        "E2 the lateral-offset direction uses the held yaw",
        "        const yawNow = Math.atan2((f === p ? o : p).body.x - f.body.x, (f === p ? o : p).body.z - f.body.z) + (drv ? drv.yaw() : 0);",
        "        const yawNow = Math.atan2((f === p ? o : p).body.x - f.body.x, (f === p ? o : p).body.z - f.body.z) + (drv ? drv.yaw() : 0) + ao.yawOffset;",
    ),
    (
        "E3 the rig's yaw adds the animator's yawOffset (0 unless the idle hold holds)",
        "      rig.group.rotation.y = Math.atan2(other.body.x - f.body.x, other.body.z - f.body.z) + (drv ? drv.yaw() : 0);",
        "      rig.group.rotation.y = Math.atan2(other.body.x - f.body.x, other.body.z - f.body.z) + (drv ? drv.yaw() : 0) +\n"
        "        (ao && f.skeleton.isDriven() ? ao.yawOffset : 0); // wave V lane P: idle facing hold",
    ),
]


def main() -> int:
    apply = "--apply" in sys.argv
    src = open(PATH, encoding="utf-8").read()
    ok = True
    for name, old, new in EDITS:
        n = src.count(old)
        already = src.count(new)
        print(f"{name}: anchor x{n}, already applied x{already}")
        if already == 1 and n == 0:
            continue
        if n != 1:
            ok = False
            continue
        src = src.replace(old, new)
    if not ok:
        print("ABORT: an anchor does not occur exactly once; nothing written")
        return 1
    if apply:
        open(PATH, "w", encoding="utf-8").write(src)
        print(f"wrote {PATH}")
    else:
        print("dry run OK (use --apply to write)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
