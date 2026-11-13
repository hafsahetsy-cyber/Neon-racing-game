/**
 * Original, fully generated soundtrack — no samples, nothing to license.
 * Synthwave drums/bass/pads with a plucked lead in a South-Asian flavoured scale
 * (Phrygian dominant, close to raga Basant Mukhari) for Karachi. Each city can supply its own scale.
 */
export interface MusicStyle {
  bpm: number;
  /** Root note in Hz (octave 2). */
  root: number;
  /** Scale as semitone offsets. */
  scale: number[];
  /** Chord roots as scale degrees, one per two bars. */
  progression: number[];
}

export const KARACHI_STYLE: MusicStyle = {
  bpm: 104,
  root: 73.42, // D2
  scale: [0, 1, 4, 5, 7, 8, 10],
  progression: [0, 0, 1, 6],
};

export class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private padGain!: GainNode;
  private delay!: DelayNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private seed = 20991;
  private phrase: number[] = [];
  private _volume = 0.5;
  /** 0..1 — opens the filter and adds layers as the player goes faster. */
  intensity = 0;

  constructor(private style: MusicStyle = KARACHI_STYLE) {}

  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.1);
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._volume * 0.55;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    const comp = ctx.createDynamicsCompressor();
    this.filter.connect(comp).connect(this.master).connect(ctx.destination);
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.16;
    this.padGain.connect(this.filter);
    // dotted-eighth echo for the lead
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / this.style.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(this.filter);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  private rnd() {
    return (this.seed = (this.seed * 16807) % 2147483647) / 2147483647;
  }

  private hz(degree: number, octave: number) {
    const s = this.style.scale;
    const n = s.length;
    const d = ((degree % n) + n) % n;
    const oct = octave + Math.floor(degree / n);
    return this.style.root * Math.pow(2, oct + s[d] / 12);
  }

  private schedule() {
    const ctx = this.ctx!;
    const sixteenth = 60 / this.style.bpm / 4;
    this.filter.frequency.setTargetAtTime(700 + 5200 * this.intensity, ctx.currentTime, 0.4);
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.step++;
      this.nextTime += sixteenth;
    }
  }

  private playStep(step: number, t: number, six: number) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = this.style.progression[Math.floor(bar / 2) % this.style.progression.length];
    const section = Math.floor(bar / 8) % 4; // arrangement: build, full, break, full

    // drums
    const drums = section !== 2 || bar % 8 >= 6;
    if (drums && s16 % 4 === 0) this.kick(t);
    if (drums && (s16 === 4 || s16 === 12)) this.snare(t);
    if (section !== 0 || bar % 8 >= 4) if (s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.05 : 0.025);
    if (this.intensity > 0.55 && s16 % 2 === 1) this.hat(t, 0.015);

    // bass: driving octave sixteenths
    const bassOn = section !== 2;
    if (bassOn && s16 % 2 === 0) this.bass(this.hz(chord, s16 % 8 === 6 ? 1 : 0), t, six * 1.7);

    // pad: new chord every bar
    if (s16 === 0) this.pad([chord, chord + 2, chord + 4], t, six * 16);

    // lead: a seeded phrase that repeats and mutates every eight bars
    if (s16 === 0 && bar % 8 === 0) {
      this.phrase = [];
      let deg = chord + 4;
      for (let i = 0; i < 16; i++) {
        deg += Math.round((this.rnd() - 0.5) * 4);
        deg = Math.max(-1, Math.min(9, deg));
        this.phrase.push(this.rnd() < 0.58 ? deg : -99);
      }
    }
    if (section >= 1 && s16 % 2 === 0) {
      const n = this.phrase[(s16 / 2 + (bar % 2) * 8) % 16];
      if (n !== undefined && n > -50) this.lead(this.hz(n, 2), t, six * 2.2);
    }
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
    // side-chain pump on the pads
    this.padGain.gain.setValueAtTime(0.05, t);
    this.padGain.gain.linearRampToValueAtTime(0.16, t + 0.22);
  }

  private noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  private snare(t: number) {
    this.noiseHit(t, 0.18, 0.32, 'bandpass', 1900);
  }

  private hat(t: number, gain: number) {
    this.noiseHit(t, 0.04, gain, 'highpass', 8000);
  }

  private bass(freq: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private pad(degrees: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    for (const d of degrees) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.hz(d, 1);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.22, t + dur * 0.3);
        g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
        o.connect(g).connect(this.padGain);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  private lead(freq: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    // a small slide into the note, like a sitar meend
    o.frequency.setValueAtTime(freq * 0.944, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(freq * 5, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g);
    g.connect(this.filter);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
