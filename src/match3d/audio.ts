export class MatchAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private enabled = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(on: boolean): boolean {
    this.enabled = on;
    if (on) {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0.32, this.ctx.currentTime, 0.08);
      }
    } else if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
    return this.enabled;
  }

  private ensureContext(): void {
    if (this.ctx || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? 0.32 : 0;
      this.masterGain.connect(this.ctx.destination);
      this.startCrowdAmbience();
    } catch {
      this.ctx = null;
    }
  }

  private startCrowdAmbience(): void {
    if (!this.ctx || !this.masterGain) return;
    const len = this.ctx.sampleRate * 3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2) * 0.16;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;

    const cg = this.ctx.createGain();
    cg.gain.value = 0.18;

    src.connect(filter);
    filter.connect(cg);
    cg.connect(this.masterGain);
    src.start();

    this.crowdSource = src;
    this.crowdGain = cg;
  }

  public playKick(power = 0.7): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125 + power * 45, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.09);

    gain.gain.setValueAtTime(0.38 * Math.min(1.2, power), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  public playWhistle(kind: 'short' | 'double' | 'long' = 'short'): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const blast = (offset: number, dur: number) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2860, now + offset);

      lfo.type = 'sine';
      lfo.frequency.value = 42;
      lfoGain.gain.value = 115;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(0.16, now + offset + 0.025);
      gain.gain.setValueAtTime(0.14, now + offset + dur - 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + offset);
      lfo.start(now + offset);
      osc.stop(now + offset + dur + 0.01);
      lfo.stop(now + offset + dur + 0.01);
    };

    if (kind === 'double') {
      blast(0, 0.16);
      blast(0.22, 0.28);
    } else if (kind === 'long') {
      blast(0, 0.55);
    } else {
      blast(0, 0.22);
    }
  }

  public playPostPing(): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    for (const freq of [720, 1140]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.48);
    }
  }

  public swellCrowd(intensity: 'chance' | 'goal'): void {
    if (!this.enabled || !this.ctx || !this.crowdGain) return;
    const now = this.ctx.currentTime;
    const peak = intensity === 'goal' ? 0.95 : 0.48;
    const hold = intensity === 'goal' ? 2.4 : 0.9;
    this.crowdGain.gain.cancelScheduledValues(now);
    this.crowdGain.gain.setValueAtTime(this.crowdGain.gain.value, now);
    this.crowdGain.gain.linearRampToValueAtTime(peak, now + 0.28);
    this.crowdGain.gain.linearRampToValueAtTime(0.18, now + hold + 1.1);
  }

  public dispose(): void {
    try {
      if (this.crowdSource) this.crowdSource.stop();
      if (this.ctx) this.ctx.close();
    } catch {
      // ignore audio cleanup failures
    }
    this.crowdSource = null;
    this.crowdGain = null;
    this.masterGain = null;
    this.ctx = null;
  }
}
