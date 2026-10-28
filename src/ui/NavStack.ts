/**
 * NavStack — the menu's navigation history (pure: no DOM, no THREE).
 *
 * Vocabulary:
 * - **screen**: an id naming one menu page (e.g. `"title"`, `"select"`).
 * - **root**: the bottom entry of the stack; the screen the player lands on when there is
 *   nothing left to go back to. It is never popped.
 * - **current**: the top entry, i.e. the screen on display.
 * - **depth**: the number of entries, root included (a fresh stack has depth 1).
 *
 * Rules: `push` of the screen already on top is a no-op (re-showing a page must not make the
 * Back button need two clicks); `push` of the root resets the stack to `[root]` (the root is a
 * hub, so reaching it by any route forgets the trail); `back` pops one entry but never the root.
 */
export class NavStack<S extends string> {
  readonly #root: S;
  readonly #entries: S[];

  /** Create a stack holding only `root`. */
  constructor(root: S) {
    this.#root = root;
    this.#entries = [root];
  }

  /** The bottom screen, never popped. */
  get root(): S { return this.#root; }

  /** The screen on display (top of the stack). */
  get current(): S { return this.#entries[this.#entries.length - 1]; }

  /** Number of entries, root included (>= 1). */
  get depth(): number { return this.#entries.length; }

  /** True when `back()` would leave the current screen (depth > 1). */
  get canGoBack(): boolean { return this.#entries.length > 1; }

  /** The screen `back()` would return to, or null at the root. */
  get previous(): S | null {
    return this.#entries.length > 1 ? this.#entries[this.#entries.length - 2] : null;
  }

  /** A copy of the trail, root first. */
  trail(): S[] { return [...this.#entries]; }

  /**
   * Navigate forward to `screen` and return the new current screen.
   * Pushing the current screen does nothing; pushing the root resets to `[root]`.
   */
  push(screen: S): S {
    if (screen === this.#root) return this.reset();
    if (screen !== this.current) this.#entries.push(screen);
    return this.current;
  }

  /**
   * Go back one step and return the screen now on display. At the root nothing is popped and
   * the root is returned — check `canGoBack` first when the caller needs to know.
   */
  back(): S {
    if (this.#entries.length > 1) this.#entries.pop();
    return this.current;
  }

  /**
   * Swap the current screen for `screen` without growing the trail (a redirect). Replacing the
   * root entry, or replacing with the root, resets to `[root]` so the root stays at the bottom.
   */
  replace(screen: S): S {
    if (screen === this.#root || this.#entries.length === 1) {
      this.reset();
      return screen === this.#root ? this.current : this.push(screen);
    }
    this.#entries[this.#entries.length - 1] = screen;
    // A redirect onto the entry below would leave a duplicate pair; collapse it.
    const n = this.#entries.length;
    if (n >= 2 && this.#entries[n - 2] === screen) this.#entries.pop();
    return this.current;
  }

  /** Drop everything above the root and return the root. */
  reset(): S {
    this.#entries.length = 1;
    return this.#root;
  }
}
