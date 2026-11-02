// Wave Y (lane A): the knees sit slightly OUTWARD of the hip-ankle line in the stance ("the symmetry
// should push them away from the vertical symmetry axis").
//
// The legs are pitch-only plus the hip/ankle roll channels (Skeleton.legRoll), and the feet are
// planted by the IK on exact ball spots, so a knee-out that moved the hip or the ankle would move a
// planted sole. The one rigid motion that moves the KNEE alone is a SWIVEL of the whole leg about its
// own hip->ankle line (anatomically: hip external rotation with the knee bent over a planted foot —
// the "knees out" of a stance): the hip joint and the ankle joint are on the axis, so neither moves,
// and the renderer turns the foot back by the same rotation so its world orientation (sole height,
// pitch, roll and the 9° toe-out) is exactly what the IK planted. The knee then travels on a circle of
// radius r = its distance from the hip-ankle line: laterally r·sin(s), backward r·(1 − cos s).
//
// The law: the wanted lateral offset is KNEE_OUT_SHARE of the leg (thigh + shin): ~3 cm on a human,
// ~2.3 cm on a dwarf, ~3.5 cm on an ork. s = asin(d / r), capped at KNEE_SWIVEL_MAX (a nearly
// straight leg cannot put its knee out without turning the kneecap far past the toes) and faded out
// for a straight leg (r below KNEE_STRAIGHT_FADE of the leg: a locked knee has nothing to swivel).
// It is a constant channel (like FootTurnout's toe-out): the Skeleton rests at it, the renderer
// (SkinnedHumanoid.update) applies it after the toe-out — render-only, no sole point moves.
//
// Pure module: no THREE, no DOM.

/** Knee lateral offset wanted, as a share of the leg length (hip->knee + knee->ankle). */
export const KNEE_OUT_SHARE = 0.035;
/** Largest swivel of the leg about its hip-ankle line, rad (23°). */
export const KNEE_SWIVEL_MAX = 0.4;
/** The swivel fades in as the knee leaves the hip-ankle line: [none, full] at r = this share of the leg. */
export const KNEE_STRAIGHT_FADE: readonly [number, number] = [0.02, 0.05];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The swivel angle (rad, >= 0: toward the leg's own side) for a knee `r` m from its hip-ankle line on
 * a leg `legLen` m long, wanting `share` of the leg outward. 0 for a straight leg or share <= 0.
 */
export function kneeSwivel(share: number, legLen: number, r: number): number {
  if (!(share > 0) || !(legLen > 0) || !(r > 1e-6)) return 0;
  const d = share * legLen;
  const fade = smooth(KNEE_STRAIGHT_FADE[0] * legLen, KNEE_STRAIGHT_FADE[1] * legLen, r);
  return fade * Math.asin(Math.min(Math.sin(KNEE_SWIVEL_MAX), d / r));
}

/** The lateral knee offset (m) a swivel `s` produces for a knee `r` m off the hip-ankle line. */
export function kneeOffsetOf(r: number, s: number): number {
  return r * Math.sin(s);
}
