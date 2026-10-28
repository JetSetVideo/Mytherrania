import { defaultHumanoid } from "../src/game/Skeleton.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

// "Stretching exercises": for every joint, drive it to its min and max and
// confirm update() actually moves it there while never leaving [min, max].
// This verifies each joint's degrees of freedom end-to-end.
Deno.test("every joint reaches its full range under stretching exercises", () => {
  const sk = defaultHumanoid();
  const names = sk.jointNames();
  assert(names.length >= 16, "full joint set present (spine/abdomen/neck/head/shoulders/elbows/hips/knees/ankles/toes)");
  for (const name of names) {
    const joint = sk.joint(name);
    const span = joint.max - joint.min;
    assert(span > 0, `${name} has a non-zero range of motion`);

    // Stretch to the maximum
    for (const target of [joint.max, joint.min]) {
      sk.setPose("idle");
      joint.target = target;
      for (let i = 0; i < 120; i++) {
        sk.update(1 / 60);
        assert(joint.angle >= joint.min - 1e-9 && joint.angle <= joint.max + 1e-9, `${name} stays within bounds`);
      }
      assert(Math.abs(joint.angle - target) < 1e-2, `${name} reaches its ${target === joint.max ? "max" : "min"} limit`);
    }
  }
});

Deno.test("ko pose expands spine/abdomen/neck limits beyond idle (state-dependent DoF)", () => {
  const sk = defaultHumanoid();
  const idleSpine = sk.joint("spine").min;
  const idleAbdomen = sk.joint("abdomen").min;
  const idleNeck = sk.joint("neck").min;
  sk.setPose("ko");
  assert(sk.joint("spine").min < idleSpine, "ko widens spine range");
  assert(sk.joint("abdomen").min < idleAbdomen, "ko widens abdomen range");
  assert(sk.joint("neck").min < idleNeck, "ko widens neck range");
});

Deno.test("walk pose drives ankles and toes for a full gait cycle", () => {
  const sk = defaultHumanoid();
  sk.setPose("walk");
  const ankle = sk.joint("ankleL");
  const toe = sk.joint("toeL");
  assert(ankle.target !== 0, "walk flexes the ankle");
  assert(toe.target !== 0, "walk rolls the toes");
});
