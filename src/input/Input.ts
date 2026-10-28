export class Input {
  #active = new Set<string>();
  #pressed = new Set<string>();
  #mx = 0;
  #my = 0;

  press(code: string) {
    if (!this.#active.has(code)) this.#pressed.add(code);
    this.#active.add(code);
  }
  release(code: string) { this.#active.delete(code); }

  addMouse(dx: number, dy: number) { this.#mx += dx; this.#my += dy; }

  mouseDelta(): { x: number; y: number } {
    const r = { x: this.#mx, y: this.#my };
    this.#mx = 0; this.#my = 0;
    return r;
  }

  // Returns raw axis input: x = left/right, z = forward/back (z- = forward via KeyW),
  // suitable for rotation into opponent-relative space.
  movement(): { x: number; y: number; z: number } {
    return {
      x: (this.#active.has("KeyD") ? 1 : 0) + (this.#active.has("KeyA") || this.#active.has("KeyQ") ? -1 : 0) + (this.#active.has("ArrowRight") ? 1 : 0) + (this.#active.has("ArrowLeft") ? -1 : 0),
      y: 0,
      z: (this.#active.has("KeyS") ? 1 : 0) + (this.#active.has("KeyW") ? -1 : 0) + (this.#active.has("ArrowDown") ? 1 : 0) + (this.#active.has("ArrowUp") ? -1 : 0),
    };
  }

  consume(code: string): boolean {
    if (this.#pressed.has(code)) { this.#pressed.delete(code); return true; }
    return false;
  }
  clear() { this.#active.clear(); this.#pressed.clear(); this.#mx = 0; this.#my = 0; }
}