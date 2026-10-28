import { blendFace, clampFace, FACE_BY_STATE, FaceMorph, NEUTRAL_FACE, type FacePose, type FaceState } from "../src/game/FaceMorph.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok { if (!ok) throw new Error(message); }
function near(a: number, b: number, eps = 1e-3, m = ""): void { if (Math.abs(a - b) > eps) throw new Error(`${m} expected ~${b}, got ${a}`); }

Deno.test("every parent state has a distinct face", () => {
  const states = Object.keys(FACE_BY_STATE) as FaceState[];
  for (let i = 0; i < states.length; i++) {
    for (let j = i + 1; j < states.length; j++) {
      const a: FacePose = FACE_BY_STATE[states[i]], b: FacePose = FACE_BY_STATE[states[j]];
      const differ = a.browRaise !== b.browRaise || a.browFurrow !== b.browFurrow || a.eyeOpen !== b.eyeOpen || a.mouthOpen !== b.mouthOpen || a.mouthCurve !== b.mouthCurve;
      assert(differ, `${states[i]} and ${states[j]} must differ`);
    }
  }
});

Deno.test("a taken hit squints the eyes and grimaces; a landed hit opens them", () => {
  const hit = FACE_BY_STATE.hit;    // landed a hit: brows up, eyes wide, mouth open
  const block = FACE_BY_STATE.block; // taken a hit: squint, grimace
  assert(hit.eyeOpen > block.eyeOpen, "landing opens the eyes wider than taking");
  assert(hit.mouthOpen > block.mouthOpen, "landing opens the mouth more");
  assert(block.mouthCurve < 0, "taking a hit grimaces (negative curve)");
  assert(hit.mouthCurve > 0, "landing a hit snarls/shouts (positive curve)");
  assert(block.browFurrow > hit.browFurrow, "taking furrows the brow more");
});

Deno.test("a KO slackens every feature", () => {
  const ko = FACE_BY_STATE.ko;
  assert(ko.eyeOpen < NEUTRAL_FACE.eyeOpen, "KO eyes close");
  assert(ko.browRaise === 0 && ko.browFurrow === 0, "KO brow goes slack");
  assert(ko.mouthOpen > NEUTRAL_FACE.mouthOpen, "KO mouth hangs open");
});

Deno.test("clampFace keeps weights in range and blendFace interpolates", () => {
  const over = clampFace({ browRaise: 2, browFurrow: -1, eyeOpen: 1.5, mouthOpen: -0.5, mouthCurve: 3 });
  assert(over.browRaise === 1 && over.browFurrow === 0 && over.eyeOpen === 1 && over.mouthOpen === 0, "clamped to 0..1");
  assert(over.mouthCurve === 1, "mouthCurve clamped to -1..1");
  const mid = blendFace(NEUTRAL_FACE, FACE_BY_STATE.hit, 0.5);
  near(mid.eyeOpen, (NEUTRAL_FACE.eyeOpen + FACE_BY_STATE.hit.eyeOpen) / 2, 1e-3, "blends halfway");
  const atA = blendFace(NEUTRAL_FACE, FACE_BY_STATE.hit, 0);
  near(atA.eyeOpen, NEUTRAL_FACE.eyeOpen, 1e-3, "t=0 is the first face");
});

Deno.test("the morph eases toward the state's target and loops back", () => {
  const m = new FaceMorph();
  assert(m.state() === "idle", "starts idle");
  m.setState("hit");
  const before = m.face().mouthOpen;
  for (let i = 0; i < 60; i++) m.update(1 / 60);
  assert(m.face().mouthOpen > before, "mouth opens as the hit face takes over");
  near(m.face().mouthOpen, FACE_BY_STATE.hit.mouthOpen, 0.05, "converges on the hit face");
  // Back to idle: it loops home.
  m.setState("idle");
  for (let i = 0; i < 90; i++) m.update(1 / 60);
  near(m.face().mouthOpen, FACE_BY_STATE.idle.mouthOpen, 0.05, "loops back to idle");
});
