// Local assertion helper: the test suite carries no external dependencies.
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}
import { NavStack } from "../src/ui/NavStack.ts";

type S = "title" | "select" | "digest" | "sheet" | "victory";

Deno.test("navstack: starts at the root with depth 1 and no way back", () => {
  const nav = new NavStack<S>("title");
  assertEquals(nav.current, "title");
  assertEquals(nav.root, "title");
  assertEquals(nav.depth, 1);
  assertEquals(nav.canGoBack, false);
  assertEquals(nav.previous, null);
});

Deno.test("navstack: title -> select -> back returns to title", () => {
  const nav = new NavStack<S>("title");
  assertEquals(nav.push("select"), "select");
  assertEquals(nav.depth, 2);
  assertEquals(nav.previous, "title");
  assertEquals(nav.back(), "title");
  assertEquals(nav.depth, 1);
});

Deno.test("navstack: back never pops below the root", () => {
  const nav = new NavStack<S>("title");
  assertEquals(nav.back(), "title");
  assertEquals(nav.back(), "title");
  assertEquals(nav.depth, 1);
  nav.push("digest");
  nav.back();
  nav.back();
  nav.back();
  assertEquals(nav.current, "title");
  assertEquals(nav.depth, 1);
});

Deno.test("navstack: victory -> sheet -> back returns to victory", () => {
  const nav = new NavStack<S>("title");
  nav.push("select");
  nav.push("victory");
  nav.push("sheet");
  assertEquals(nav.trail(), ["title", "select", "victory", "sheet"]);
  assertEquals(nav.back(), "victory");
  assertEquals(nav.back(), "select");
  assertEquals(nav.back(), "title");
});

Deno.test("navstack: pushing the current screen is a no-op (one Back click is enough)", () => {
  const nav = new NavStack<S>("title");
  nav.push("victory");
  nav.push("victory");
  assertEquals(nav.depth, 2);
  assertEquals(nav.back(), "title");
});

Deno.test("navstack: pushing the root resets the trail", () => {
  const nav = new NavStack<S>("title");
  nav.push("select");
  nav.push("victory");
  assertEquals(nav.push("title"), "title");
  assertEquals(nav.depth, 1);
  assertEquals(nav.trail(), ["title"]);
});

Deno.test("navstack: replace swaps the top without growing the trail", () => {
  const nav = new NavStack<S>("title");
  nav.push("digest");
  assertEquals(nav.replace("sheet"), "sheet");
  assertEquals(nav.trail(), ["title", "sheet"]);
  assertEquals(nav.back(), "title");
});

Deno.test("navstack: replace keeps the root at the bottom", () => {
  const nav = new NavStack<S>("title");
  // Replacing at depth 1 cannot overwrite the root: it pushes above it.
  assertEquals(nav.replace("digest"), "digest");
  assertEquals(nav.trail(), ["title", "digest"]);
  // Replacing with the root resets.
  assertEquals(nav.replace("title"), "title");
  assertEquals(nav.trail(), ["title"]);
});

Deno.test("navstack: replace onto the entry below collapses the duplicate", () => {
  const nav = new NavStack<S>("title");
  nav.push("victory");
  nav.push("sheet");
  assertEquals(nav.replace("victory"), "victory");
  assertEquals(nav.trail(), ["title", "victory"]);
});

Deno.test("navstack: reset returns the root; trail() is a copy", () => {
  const nav = new NavStack<S>("title");
  nav.push("select");
  const t = nav.trail();
  t.push("sheet");
  assertEquals(nav.depth, 2);
  assertEquals(nav.reset(), "title");
  assertEquals(nav.depth, 1);
});
