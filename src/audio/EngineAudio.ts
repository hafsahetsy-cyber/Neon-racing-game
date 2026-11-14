import type { Vehicle } from '../vehicles/Vehicle';

/**
 * Fully synthesised vehicle audio (no samples): engine, wind, tyre squeal,
 * boost roar and horn. Each vehicle's `audio` config shapes the engine voice.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private sub!: OscillatorNode;
  private lfo!: OscillatorNode;
  private lfoDepth!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private boostGain!: GainNode;
  private boostFilter!: BiquadFilterNode;
  private hornGain!: GainNode;
  private rainGain!: GainNode;
  muted = false;
  /** 0..1 effects volume (settings menu). */
  volume = 0.7;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // --- engine: two detuned saws + sub, chopped by an LFO at firing rate (the two-stroke putter)
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2.5;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    shaper.curve = curve;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.sub = ctx.createOscillator();
    this.sub.type = 'triangle';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    const gs = ctx.createGain();
    gs.gain.value = 0.7;
    this.osc1.connect(am);
    this.osc2.connect(g2).connect(am);
    this.sub.connect(gs).connect(am);
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.4;
    this.lfo.connect(this.lfoDepth).connect(am.gain);
    am.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.master);

    // --- shared noise source
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);

    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 1900;
    skidFilter.Q.value = 5;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    noise.connect(skidFilter).connect(this.skidGain).connect(this.master);

    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = 'lowpass';
    this.boostFilter.frequency.value = 500;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    noise.connect(this.boostFilter).connect(this.boostGain).connect(this.master);

    // --- horn: cheeky two-tone
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(this.hornGain);
      o.start();
    }
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 2200;
    this.hornGain.connect(hornFilter).connect(this.master);

    // --- rain: hiss on the roof and road
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 2600;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    noise.connect(rainFilter).connect(this.rainGain).connect(this.master);

    for (const n of [this.osc1, this.osc2, this.sub, this.lfo, noise]) n.start();
  }

  /** Another player's horn, quieter with distance. */
  remoteHorn(distance: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const vol = 0.2 * this.volume * Math.max(0, 1 - distance / 160);
    if (vol <= 0.002) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime + 0.35, 0.05);
    g.connect(ctx.destination);
    for (const f of [370, 466]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(g);
      o.start();
      o.stop(ctx.currentTime + 0.6);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  update(v: Vehicle, horn: boolean, paused: boolean, rain = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const a = v.config.audio;
    const set = (p: AudioParam, val: number, tc = 0.05) => p.setTargetAtTime(val, t, tc);
    set(this.master.gain, this.muted || paused ? 0 : 0.7 * this.volume, 0.08);
    // each vehicle has its own engine voice
    const ch = a.character;
    const o1: OscillatorType = ch === 'electric' ? 'triangle' : 'sawtooth';
    const o2: OscillatorType = ch === 'electric' ? 'sine' : ch === 'v8' ? 'sawtooth' : 'square';
    if (this.osc1.type !== o1) this.osc1.type = o1;
    if (this.osc2.type !== o2) this.osc2.type = o2;
    const harm = ch === 'electric' ? 3.0 : ch === 'v8' ? 1.5 : ch === 'turbine' ? 4.02 : 2.01;

    const hz = a.idleHz + (a.maxHz - a.idleHz) * v.rpm * (v.boosting ? 1.12 : 1);
    set(this.osc1.frequency, hz);
    set(this.osc2.frequency, hz * harm);
    set(this.sub.frequency, hz * 0.5);
    // two-stroke: strong chop at low revs smoothing into a buzz at the top
    set(this.lfo.frequency, ch === 'twostroke' ? hz * 0.5 : ch === 'v8' ? hz * 0.25 : 6);
    set(this.lfoDepth.gain, ch === 'twostroke' ? 0.5 - 0.25 * v.rpm : ch === 'v8' ? 0.3 : 0.05);
    set(this.engineFilter.frequency, 350 + 2600 * v.rpm * (0.45 + 0.55 * v.throttle) + (v.boosting ? 1200 : 0));
    set(this.engineGain.gain, 0.16 + 0.2 * v.throttle + 0.08 * v.rpm);

    const s = Math.min(1.4, v.speed / v.config.engine.topSpeed);
    set(this.windGain.gain, 0.5 * s * s, 0.15);
    set(this.windFilter.frequency, 300 + 1500 * s, 0.15);

    let skid = 0;
    for (const w of v.wheels) if (w.grounded) skid = Math.max(skid, w.skid);
    skid = Math.max(skid, v.drifting ? v.driftAmount : 0) * Math.min(1, v.speed / 10);
    set(this.skidGain.gain, 0.22 * skid, 0.06);

    set(this.boostGain.gain, v.boosting ? 0.55 : 0, v.boosting ? 0.04 : 0.25);
    set(this.boostFilter.frequency, v.boosting ? 1400 : 300, 0.2);
    set(this.hornGain.gain, horn ? 0.12 : 0, 0.01);
    set(this.rainGain.gain, 0.16 * rain, 0.3);
  }
}
