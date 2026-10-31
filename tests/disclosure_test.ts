// The disclosure model is DATA about which option groups are open. These tests pin the two
// promises the wave makes: every group is a CLOSED tree except exactly one, and the stored
// open/closed state survives a round-trip without ever throwing on a corrupt payload.
//
// The renderer lane owns the markup; this file proves the MODEL (a policy-blocked panel is
// invisible to unit tests, so the renderer's obligations are asserted where they can be).
import {
  decodeDisclosure,
  DISCLOSURE_STORAGE_KEY,
  encodeDisclosure,
  groupKey,
  initialDisclosure,
  isOpen,
  openGroup,
  openKeys,
  toggleGroup,
} from "../src/ui/Disclosure.ts";
import { defaultOpenGroups, flattenTree, treeSize, UI_TREE, type UiScreen } from "../src/ui/UiTree.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(String(message));
}

function assertEquals<T>(actual: T, expected: T, message = "not equal"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: got ${a}, want ${e}`);
}

/** Every group key in the real tree, in tree order. */
function everyGroupKey(): string[] {
  const keys: string[] = [];
  for (const s of UI_TREE) {
    for (const p of s.panels) {
      for (const g of p.groups) keys.push(groupKey(s.id, p.id, g.id));
    }
  }
  return keys;
}

Deno.test("the storage key is the frozen localStorage key", () => {
  assertEquals(DISCLOSURE_STORAGE_KEY, "mytherrania-ui-open");
});

Deno.test("groupKey is the screen/panel/group path", () => {
  assertEquals(groupKey("select", "ancestry", "race"), "select/ancestry/race");
  assertEquals(groupKey("title", "start", "modes"), "title/start/modes");
});

Deno.test("the ENTRY groups are default-open, and none of them is empty", () => {
  const open = defaultOpenGroups();
  // Wave L pinned ONE open group (the title's modes: entry paths must never be hidden). Wave O added a
  // second entry path — the saved fighters, which opens the Profiles panel — because a closed tree hid
  // the way into your own profiles. The count moved from 1 to 2 ON PURPOSE; this pin records the two
  // and the reason, rather than being deleted.
  assertEquals(open.length, 2, "default-open groups");
  // Order follows the tree (the profiles group is declared before the modes group on the title screen).
  assertEquals([...open].sort(), ["title/start/modes", "title/start/profiles"]);
  // A default-open group must still contain controls — an empty tree has nothing to show.
  for (const key of open) {
    const [s, p, g] = key.split("/");
    const group = UI_TREE.find((x) => x.id === s)?.panels.find((x) => x.id === p)?.groups.find((x) => x.id === g);
    assert(group !== undefined, `${key} resolves to a real group`);
    assert(group.controls.length > 0, `${key} is not an empty tree`);
  }
});

Deno.test("every other group is closed in the initial state", () => {
  const state = initialDisclosure();
  const groupCount = treeSize().groups;
  assertEquals(Object.keys(state).length, groupCount, "one entry per group");
  for (const key of everyGroupKey()) {
    // The two title entry groups are open; every other group in every screen starts closed (Wave O).
    const shouldBeOpen = key === "title/start/modes" || key === "title/start/profiles";
    assertEquals(isOpen(state, key), shouldBeOpen, `initial open state of ${key}`);
  }
  // Only the marked groups are open.
  assertEquals([...openKeys(state)].sort(), ["title/start/modes", "title/start/profiles"]);
});

Deno.test("initialDisclosure follows an injected tree's defaultOpen marks", () => {
  const tree: UiScreen[] = [{
    id: "select",
    label: "Create",
    hint: "test",
    colour: "coral",
    panels: [{
      id: "p",
      label: "P",
      hint: "test",
      colour: "grass",
      groups: [
        { id: "a", label: "A", hint: "h", controls: [], defaultOpen: true },
        { id: "b", label: "B", hint: "h", controls: [] },
      ],
    }],
  }];
  const state = initialDisclosure(tree);
  assertEquals(isOpen(state, "select/p/a"), true);
  assertEquals(isOpen(state, "select/p/b"), false);
  assertEquals(openKeys(state), ["select/p/a"]);
});

Deno.test("toggle / openGroup flip one group and leave the rest alone", () => {
  const start = initialDisclosure();
  const opened = toggleGroup(start, "select/ancestry/race");
  assert(isOpen(opened, "select/ancestry/race"), "toggle opens a closed group");
  assertEquals(isOpen(start, "select/ancestry/race"), false, "the input state is not mutated");
  const closed = toggleGroup(opened, "select/ancestry/race");
  assertEquals(isOpen(closed, "select/ancestry/race"), false, "toggle closes it again");
  // The default-open group is untouched by a toggle elsewhere.
  assertEquals(isOpen(closed, "title/start/modes"), true);
  // toggle never changes the number of keys.
  assertEquals(Object.keys(closed).length, Object.keys(start).length);

  assertEquals(isOpen(openGroup(start, "select/arena/walls"), "select/arena/walls"), true);
  assertEquals(isOpen(openGroup(start, "title/start/modes", false), "title/start/modes"), false);
});

Deno.test("a fresh (unknown) key toggles to open", () => {
  const state = initialDisclosure();
  const next = toggleGroup(state, "select/new/group");
  assertEquals(isOpen(next, "select/new/group"), true);
});

Deno.test("encode/decode round-trips, including the default-open group", () => {
  const state = openGroup(initialDisclosure(), "select/arena/walls");
  const raw = encodeDisclosure(state);
  const back = decodeDisclosure(raw);
  assertEquals(back, state, "round-trip is lossless");
  assert(isOpen(back, "select/arena/walls"));
  assertEquals(isOpen(back, "title/start/modes"), true);
});

Deno.test("encodeDisclosure is stable: equal states encode identically", () => {
  const a = openGroup(initialDisclosure(), "select/arena/walls");
  const b = openGroup(initialDisclosure(), "select/arena/walls");
  assertEquals(encodeDisclosure(a), encodeDisclosure(b));
});

Deno.test("a corrupt, absent or wrong-shaped payload yields the initial state and never throws", () => {
  const initial = initialDisclosure();
  const bad: (string | null)[] = [
    null,
    "",
    "{",
    "not json",
    "[]",             // array, not an object
    "42",             // scalar
    "\"open\"",       // scalar
    "null",
    "{\"select/ancestry/race\":\"yes\"}", // string, not boolean
  ];
  for (const raw of bad) {
    const got = decodeDisclosure(raw); // must not throw
    assertEquals(got, initial, `payload ${JSON.stringify(raw)} falls back to initial`);
  }
});

Deno.test("decode keeps only real booleans and only keys the current tree knows", () => {
  // A stray older key is dropped; a boolean for a current key is honoured.
  const raw = JSON.stringify({ "select/ancestry/race": true, "select/gone/old": true });
  const state = decodeDisclosure(raw);
  assertEquals(isOpen(state, "select/ancestry/race"), true, "real key honoured");
  assertEquals("select/gone/old" in state, false, "stale key dropped");
  // Every current key still has an entry.
  for (const key of everyGroupKey()) assert(key in state, `${key} present`);
});

Deno.test("the model covers the tree: one entry per real group, closed by default", () => {
  const state = initialDisclosure();
  const keys = Object.keys(state).sort();
  assertEquals(keys, everyGroupKey().sort(), "state keys match the tree's groups");
  assertEquals(keys.length, treeSize().groups, "one entry per group");
  assert(flattenTree().length > 0, "the tree has controls behind its groups");
  // Sanity: only the title's entry groups are open at the start (Wave O: modes + saved fighters).
  assertEquals(openKeys(state).length, 2);
});
