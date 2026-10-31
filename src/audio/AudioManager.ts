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

  /**
   * Wave N: the VANISH cue. Deliberately unlike every other sound in the set — a long descending
   * sweep into a hollow fifth, so "he is gone" is recognisable with the screen ignored (the WoW-like
   * cue the user asked for). Duration 0.55 s.
   */
  playVanish() { this.#sweep(1200, 180, 0.55, "sine"); }

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

  /**
   * Thunder: `delayS` after now (the flash-to-bang gap, distance / 343 m/s), a low-passed noise burst
   * with a sharp crack (near strikes: high cutoff, short attack) and a long rumble (far strikes: low
   * cutoff, slow swell). `loudness` 0..1 ~ 1 / distance.
   */
  playThunder(delayS: number, loudness: number) {
    if (!this.#ctx || !this.#gain || this.#volume <= 0 || this.#disposed) return;
    const ctx = this.#ctx;
    const near = Math.max(0, Math.min(1, Number.isFinite(loudness) ? loudness : 0));
    if (near <= 0.01) return;
    const dur = 2.2 + 2.5 * (1 - near);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise (integrated white noise, leaky) with slow amplitude roll for the rumble.
    let b = 0;
    for (let k = 0; k < len; k++) {
      b = 0.985 * b + 0.15 * (Math.random() * 2 - 1);
      const t = k / ctx.sampleRate;
      data[k] = b * (0.65 + 0.35 * Math.sin(t * 5.3 + Math.sin(t * 1.7) * 2));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180 + 1400 * near * near;
    const env = ctx.createGain();
    const t0 = ctx.currentTime + Math.max(0, Math.min(45, Number.isFinite(delayS) ? delayS : 0));
    const peak = 0.05 + 0.45 * near;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.02 + 0.5 * (1 - near));
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(env).connect(this.#gain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    src.onended = () => { src.disconnect(); lp.disconnect(); env.disconnect(); };
  }

  dispose() {
    this.#disposed = true;
    if (this.#gain) { this.#gain.disconnect(); this.#gain = null; }
    if (this.#ctx) { this.#ctx.close().catch(() => {}); this.#ctx = null; }
  }
}