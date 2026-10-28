import { Input, MOVE_KEYS } from "../src/input/Input.ts";
import {
  keyLabel, LayoutDetector, layoutFromKeypress, layoutFromLanguage, layoutFromMap, movementLabel,
} from "../src/input/KeyboardLayout.ts";

function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }

Deno.test("physical keyboard codes move identically across keyboard layouts", () => {
  const input = new Input();
  input.press("KeyW");
  assert(input.axes().forward === 1, "physical KeyW (Z on AZERTY) must move FORWARD (+1)");
  input.release("KeyW");
  input.press("KeyZ");
  assert(input.axes().forward === 0, "code KeyZ (W on AZERTY) is not the forward position");
  input.release("KeyZ");
  input.press("KeyS");
  assert(input.axes().forward === -1, "KeyS moves back");
  input.release("KeyS");
  input.press("ArrowRight");
  assert(input.axes().strafe === 1, "arrow keys are supported; right is +1");
  input.clear();
  assert(input.axes().strafe === 0 && input.axes().forward === 0, "blur must release held input");
});

Deno.test("KeyQ is NOT a movement key (it is the AZERTY 'A' key, bound to a skill)", () => {
  const input = new Input();
  input.press("KeyQ");
  assert(input.axes().strafe === 0, "KeyQ must not strafe left");
  const all = Object.values(MOVE_KEYS).flat() as string[];
  assert(!all.includes("KeyQ"), "KeyQ is absent from the movement bindings");
  input.press("KeyA");
  assert(input.axes().strafe === -1, "KeyA (Q on AZERTY) strafes left");
});

Deno.test("opposite keys cancel instead of one winning", () => {
  const input = new Input();
  input.press("KeyW"); input.press("KeyS");
  assert(input.axes().forward === 0, "W+S cancel");
});

Deno.test("a key press identifies AZERTY, QWERTZ and QWERTY only when it can", () => {
  assert(layoutFromKeypress("KeyW", "z") === "azerty", "code KeyW typing z is AZERTY");
  assert(layoutFromKeypress("KeyQ", "a") === "azerty", "code KeyQ typing a is AZERTY");
  assert(layoutFromKeypress("KeyY", "z") === "qwertz", "code KeyY typing z is QWERTZ");
  assert(layoutFromKeypress("KeyW", "w") === null, "w on KeyW is QWERTY or QWERTZ: ambiguous");
  assert(layoutFromKeypress("KeyZ", "z") === "qwerty", "z on KeyZ is only QWERTY");
  assert(layoutFromKeypress("KeyD", "d") === null, "D is the same everywhere");
  assert(layoutFromKeypress("KeyW", "Shift") === null, "named keys prove nothing");
  assert(layoutFromKeypress("KeyW", "Z") === "azerty", "case-insensitive (Shift held)");
});

Deno.test("the keyboard map and the language give the same answers", () => {
  const azertyMap = new Map([["KeyQ", "a"], ["KeyW", "z"]]);
  assert(layoutFromMap(azertyMap) === "azerty", "AZERTY map");
  assert(layoutFromMap(new Map([["KeyY", "z"]])) === "qwertz", "QWERTZ map");
  assert(layoutFromMap(new Map()) === null, "empty map is inconclusive");
  assert(layoutFromLanguage("fr-FR") === "azerty", "fr-FR guesses AZERTY");
  assert(layoutFromLanguage("fr-CA") === "qwerty", "Canadian French types QWERTY");
  assert(layoutFromLanguage("de-DE") === "qwertz", "German guesses QWERTZ");
  assert(layoutFromLanguage("en-US") === "qwerty", "English guesses QWERTY");
  assert(layoutFromLanguage(undefined) === "qwerty", "unknown defaults to QWERTY");
});

Deno.test("weaker evidence never overrides stronger evidence", () => {
  const d = new LayoutDetector();
  const seen: string[] = [];
  d.onChange((l) => seen.push(l));
  d.offer("azerty", "language");
  d.observe("KeyY", "y"); // proves nothing new (Y is Y on QWERTY and AZERTY)
  assert(d.layout === "azerty", "language guess stands");
  d.observe("KeyW", "w"); // ambiguous -> ignored
  d.observe("KeyZ", "z"); // proves QWERTY by keypress
  assert(d.layout === "qwerty" && d.evidence === "keypress", "a key press overrides the guess");
  d.offer("azerty", "layoutMap");
  assert(d.layout === "qwerty", "the OS map cannot override a typed key");
  assert(seen.join(",") === "azerty,qwerty", `onChange fires once per change, got ${seen}`);
});

Deno.test("labels follow the layout: ZQSD on AZERTY, WASD on QWERTY and QWERTZ", () => {
  assert(movementLabel("azerty") === "ZQSD", movementLabel("azerty"));
  assert(movementLabel("qwerty") === "WASD", movementLabel("qwerty"));
  assert(movementLabel("qwertz") === "WASD", movementLabel("qwertz"));
  assert(keyLabel("KeyQ", "azerty") === "A", "skill key on AZERTY reads A");
  assert(keyLabel("KeyQ", "qwerty") === "Q", "skill key on QWERTY reads Q");
  assert(keyLabel("Digit1", "azerty") === "1", "digits read as digits");
  assert(keyLabel("Escape", "qwerty") === "Esc", "named keys");
});
