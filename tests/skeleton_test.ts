import { defaultHumanoid } from "../src/game/Skeleton.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("every joint has finite min/max bounds with min <= max", () => {
  const s = defaultHumanoid();
  for (const name of ["spine", "head", "shoulderL", "shoulderR", "elbowL", "elbowR", "hipL", "hipR", "kneeL", "kneeR"] as const) {
    const j = s.joint(name);
    assert(j.min <= j.max, `${name} min <= max`);
    assert(Number.isFinite(j.min) && Number.isFinite(j.max), `${name} bounds finite`);
  }
});

Deno.test("setPose is a trigger that aims joints at per-state targets", () => {
  const s = defaultHumanoid();
  s.setPose("attack");
  const shoulder = s.joint("shoulderR");
  assert(shoulder.target < -1.0, "attack swings the weapon arm");
  assert(s.pose === "attack", "pose tracked");
});

Deno.test("update eases toward targets and never leaves the joint limits", () => {
  const s = defaultHumanoid();
  s.setPose("ko");
  const spine = s.joint("spine");
  for (let i = 0; i < 60; i++) {
    s.update(1 / 60);
    assert(spine.angle >= spine.min - 1e-9 && spine.angle <= spine.max + 1e-9, "angle stays within limits");
  }
  assert(spine.angle < -0.5, "ko pose collapses the spine over time");
});

Deno.test("ko pose expands the spine limit beyond idle", () => {
  const s = defaultHumanoid();
  const idleMin = s.joint("spine").min;
  s.setPose("ko");
  const koMin = s.joint("spine").min;
  assert(koMin < idleMin, "state-dependent limit override applies");
});
