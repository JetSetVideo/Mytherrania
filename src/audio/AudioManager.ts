import type { Element } from "../game/Skills.ts";

export class AudioManager {
  #ctx: AudioContext | null = null;
  #gain: GainNode | null = null;
  #disposed = false;
  #volume = 0.75;

  async unlock(): Promise<boolean> {
    if (this.#disposed) return false;
    if (this.#ctx) return true;
    if (!globalThis.navigator?.userActivation?.isActive) return false;
    try {
      this.#ctx = new AudioContext();
      await this.#ctx.resume();
      this.#gain = this.#ctx.createGain();
      this.#gain.gain.value = this.#volume;
      this.#gain.connect(this.#ctx.destination);
      return this.#ctx.state === "running";
    } catch {
      this.#ctx = null;
      return false;
    }
  }

  setVolume(value: number) {
    this.#volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (this.#gain) this.#gain.gain.setValueAtTime(this.#volume, this.#ctx!.currentTime);
  }

  playStep(material: string = "stone") { this.#surfaceTone(material); }
  playImpact() { this.#tone(80, 0.14, "sawtooth"); }

  /** Signature sound per element: a short sweep that reads as the skill leaving the weapon. */
  playSkill(element: Element) {
    switch (element) {
      case "fire": this.#sweep(520, 140, 0.26, "sawtooth"); break;
      case "fury": this.#sweep(300, 90, 0.3, "square"); break;
      case "poison": this.#sweep(700, 260, 0.22, "triangle"); break;
      case "shadow": this.#sweep(900, 200, 0.24, "sine"); break;
      case "arcane": this.#sweep(440, 880, 0.3, "sine"); break;
      case "necrotic": this.#sweep(200, 70, 0.34, "sawtooth"); break;
      case "wind": this.#sweep(1200, 500, 0.2, "sine"); break;
      case "holy": this.#sweep(660, 990, 0.28, "triangle"); break;
    }
  }

  /** Pitch sweep: the oscillator glides from f0 to f1 as the envelope decays. */
  #sweep(f0: number, f1: number, duration: number, type: OscillatorType) {
    if (!this.#ctx || !this.#gain || this.#volume <= 0 || this.#disposed) return;
    const now = this.#ctx.currentTime;
    const osc = this.#ctx.createOscillator();
    const env = this.#ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + duration);
    env.gain.value = 0.16;
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(env).connect(this.#gain);
    osc.start();
    osc.stop(now + duration + 0.01);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  // Material-specific footstep: stone clacks, wood thuds, sand scuffs, ice slithers.
  #surfaceTone(material: string) {
    switch (material) {
      case "stone": this.#tone(360, 0.05, "square"); break;
      case "wood": this.#tone(180, 0.07, "triangle"); break;
      case "sand": this.#tone(120, 0.09, "sawtooth"); break;
      case "ice": this.#tone(520, 0.06, "sine"); break;
      default: this.#tone(220, 0.08, "square");
    }
  }

  #tone(freq: number, duration: number, type: OscillatorType) {
    if (!this.#ctx || !this.#gain || this.#volume <= 0 || this.#disposed) return;
    const osc = this.#ctx.createOscillator();
    const env = this.#ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.value = 0.18;
    env.gain.exponentialRampToValueAtTime(0.001, this.#ctx.currentTime + duration);
    osc.connect(env).connect(this.#gain);
    osc.start();
    osc.stop(this.#ctx.currentTime + duration + 0.01);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  dispose() {
    this.#disposed = true;
    if (this.#gain) { this.#gain.disconnect(); this.#gain = null; }
    if (this.#ctx) { this.#ctx.close().catch(() => {}); this.#ctx = null; }
  }
}