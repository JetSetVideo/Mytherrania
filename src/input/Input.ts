// Physical-key input state for one player.
//
// Keys are tracked by KeyboardEvent.code, i.e. by POSITION on the keyboard, not by the
// letter printed on them. The four keys under the left hand (codes KeyW/KeyA/KeyS/KeyD)
// are "WASD" on QWERTY and "ZQSD" on AZERTY: same position, same movement. Labels for
// the HUD come from KeyboardLayout.ts; this module never looks at `key`.

/**
 * Movement intent for one frame, each axis in [-1, 1]:
 *   forward  +1 = away from the camera / toward the opponent, -1 = back
 *   strafe   +1 = to the player's right,                       -1 = left
 * Named axes instead of x/z so the sign convention cannot be misread (a misread z sign
 * once made the forward key walk the player backwards).
 */
export interface MoveAxes { forward: number; strafe: number }

/** Which physical codes drive each direction. Arrows mirror the letter cluster. */
export const MOVE_KEYS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
} as const;

export class Input {
  #active = new Set<string>();
  #pressed = new Set<string>();
  #mx = 0;
  #my = 0;

  /** A key went down. Repeats are ignored for the edge-triggered `consume`. */
  press(code: string) {
    if (!this.#active.has(code)) this.#pressed.add(code);
    this.#active.add(code);
  }
  release(code: string) { this.#active.delete(code); }

  /** Accumulate pointer-lock mouse motion (pixels) until the next `mouseDelta`. */
  addMouse(dx: number, dy: number) { this.#mx += dx; this.#my += dy; }

  /** Mouse motion since the last call, then reset. */
  mouseDelta(): { x: number; y: number } {
    const r = { x: this.#mx, y: this.#my };
    this.#mx = 0; this.#my = 0;
    return r;
  }

  #any(codes: readonly string[]): number {
    return codes.some((c) => this.#active.has(c)) ? 1 : 0;
  }

  /** Current movement intent from the held keys. Opposite keys cancel. */
  axes(): MoveAxes {
    return {
      forward: this.#any(MOVE_KEYS.forward) - this.#any(MOVE_KEYS.back),
      strafe: this.#any(MOVE_KEYS.right) - this.#any(MOVE_KEYS.left),
    };
  }

  /** True on the first frame after `code` went down (edge-triggered), once. */
  consume(code: string): boolean {
    if (this.#pressed.has(code)) { this.#pressed.delete(code); return true; }
    return false;
  }

  /** Release everything (window blur, tab hidden), so no key sticks down. */
  clear() { this.#active.clear(); this.#pressed.clear(); this.#mx = 0; this.#my = 0; }
}
