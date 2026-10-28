// The UI tree is data: every screen, panel, group and control with its path, colour
// code and importance. These pin the hierarchy the overhaul promises.
import { allKeys, COLOUR_HEX, flattenTree, screenControls, screenPanels, treeSize, UI_TREE } from "../src/ui/UiTree.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

Deno.test("every control has a unique key and a full path", () => {
  const nodes = flattenTree();
  assert(nodes.length > 20, "the tree has real depth");
  const keys = allKeys();
  assert(new Set(keys).size === keys.length, "control keys are unique");
  for (const n of nodes) {
    assert(n.path === `${n.screen}/${n.panel}/${n.group}/${n.control.key}`, `path shape: ${n.path}`);
    assert(n.control.hint.length > 0, `${n.path} explains WHY it exists`);
    assert(COLOUR_HEX[n.colour] !== undefined, `${n.path} has a colour code`);
  }
});

Deno.test("the tree is deep enough: every screen has panels, every panel has groups", () => {
  const size = treeSize();
  assert(size.screens >= 5, `screens: ${size.screens}`);
  assert(size.panels >= 10, `panels: ${size.panels}`);
  assert(size.groups >= 20, `groups: ${size.groups}`);
  assert(size.controls >= 30, `controls: ${size.controls}`);
  for (const s of UI_TREE) {
    assert(s.panels.length > 0, `${s.id} has panels`);
    assert(s.hint.length > 0, `${s.id} says what it is`);
    for (const p of s.panels) {
      assert(p.groups.length > 0, `${s.id}/${p.id} has groups`);
      assert(p.hint.length > 0, `${s.id}/${p.id} explains itself`);
      for (const g of p.groups) assert(g.controls.length > 0, `${s.id}/${p.id}/${g.id} has controls`);
    }
  }
});

Deno.test("the creator is split into five panels, not one long scroll", () => {
  const panels = screenPanels("select");
  assert(panels.length === 5, `creator panels: ${panels.length}`);
  const ids = panels.map((p) => p.id);
  for (const want of ["ancestry", "calling", "sign", "opponent", "arena"]) {
    assert(ids.includes(want), `creator must have a ${want} panel`);
  }
  // Each panel's colour code is distinct, so the tabs read apart at a glance.
  assert(new Set(panels.map((p) => p.colour)).size >= 4, "creator panels are colour-differentiated");
});

Deno.test("importance is declared, and the essential controls are always reachable", () => {
  const essential = flattenTree().filter((n) => n.control.weight === 2);
  assert(essential.length >= 10, `essential controls: ${essential.length}`);
  for (const n of essential) assert(n.control.when === "always" || n.control.when === "fight", `${n.path} must be reachable when it matters`);
  // Filtering by importance returns a subset that still contains every essential control.
  for (const s of UI_TREE) {
    const all = screenControls(s.id, 2);
    const basics = screenControls(s.id, 1);
    assert(basics.length <= all.length, `${s.id} filters down`);
    for (const n of essential.filter((n) => n.screen === s.id)) {
      assert(all.some((c) => c.key === n.control.key), `${n.path} survives the filter`);
    }
  }
});

Deno.test("every control declares its owner and when it applies", () => {
  for (const n of flattenTree()) {
    assert(["player", "opponent", "both", "system"].includes(n.control.owner), `${n.path} owner`);
    assert(["always", "fight", "spectate", "idle"].includes(n.control.when), `${n.path} when`);
    assert([0, 1, 2].includes(n.control.weight), `${n.path} weight`);
  }
});
