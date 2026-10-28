import { Input } from "../src/input/Input.ts";
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message); }
Deno.test("physical keyboard codes move identically across keyboard layouts", () => {
  const input = new Input();
  input.press("KeyW");
  assert(input.movement().z === -1, "physical KeyW must move forward");
  input.release("KeyW");
  input.press("KeyZ");
  assert(input.movement().z === 0, "letter Z is not the physical forward position");
  input.press("ArrowRight");
  assert(input.movement().x === 1, "arrow keys are supported");
  input.clear();
  assert(input.movement().x === 0, "blur must release held input");
});
