function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

class FakeParam {
  value = 1;
  events: [string, number, number][] = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push(["set", value, time]);
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push(["ramp", value, time]);
  }
}
class FakeGain {
  gain = new FakeParam();
  connected = false;
  connect(_target: unknown) { this.connected = true; }
  disconnect() { this.connected = false; }
}
class FakeOscillator {
  frequency = new FakeParam();
  type = "sine";
  connected = false;
  started = false;
  stops: number[] = [];
  onended: (() => void) | null = null;
  connect(_target: unknown) { this.connected = true; }
  disconnect() { this.connected = false; }
  start() { this.started = true; }
  stop(time = 0) { this.stops.push(time); }
  end() { this.onended?.(); }
}
class FakeContext {
  static instances: FakeContext[] = [];
  currentTime = 12;
  state = "suspended";
  destination = {};
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  resumes = 0;
  closes = 0;
  constructor() { FakeContext.instances.push(this); }
  resume() { this.resumes++; this.state = "running"; return Promise.resolve(); }
  close() { this.closes++; this.state = "closed"; return Promise.resolve(); }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
}

async function withAudio(run: (activation: { isActive: boolean }) => Promise<void>) {
  const contextDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  const activationDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, "userActivation");
  const activation = { isActive: false };
  FakeContext.instances = [];
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeContext });
  Object.defineProperty(globalThis.navigator, "userActivation", { configurable: true, value: activation });
  try { await run(activation); }
  finally {
    if (contextDescriptor) Object.defineProperty(globalThis, "AudioContext", contextDescriptor);
    else Reflect.deleteProperty(globalThis, "AudioContext");
    if (activationDescriptor) Object.defineProperty(globalThis.navigator, "userActivation", activationDescriptor);
    else Reflect.deleteProperty(globalThis.navigator, "userActivation");
  }
}

Deno.test("audio context is lazy and unlock requires transient user activation", async () => {
  await withAudio(async (activation) => {
    const modulePath = "../src/audio/AudioManager.ts";
    const { AudioManager } = await import(modulePath);
    const audio = new AudioManager();
    assert(FakeContext.instances.length === 0, "constructor must not start audio");
    assert(await audio.unlock() === false, "programmatic unlock rejected");
    assert(FakeContext.instances.length === 0, "no context outside gesture");
    activation.isActive = true;
    assert(await audio.unlock() === true, "gesture unlock succeeds");
    const context = FakeContext.instances[0];
    assert(context.state === "running" && context.resumes === 1, "context resumed");
    assert(context.gains.length === 1 && context.gains[0].connected, "master connected once");
    assert(await audio.unlock() === true, "repeat unlock succeeds");
    assert(context.resumes === 1, "already running, no duplicate resume");
    audio.dispose();
    audio.dispose();
    assert(context.closes === 1 && !context.gains[0].connected, "idempotent close and disconnect");
    assert(await audio.unlock() === false, "dispose is terminal");
  });
});
