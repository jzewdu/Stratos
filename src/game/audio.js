import { clamp } from '../core/utils.js';

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.running = false;
    this.muted = false;
    this.spec = null;
    this.time = 0;
  }

  _makeNoiseBuffer(seconds = 4) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 5;
    this.master.connect(this.compressor).connect(ctx.destination);

    const noiseBuffer = this._makeNoiseBuffer();
    const makeNoise = (filterType, frequency, q) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return { src, filter, gain };
    };

    // Prop engine.
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;
    this.propFilter = ctx.createBiquadFilter();
    this.propFilter.type = 'lowpass';
    this.propFilter.frequency.value = 650;
    this.propFilter.Q.value = 2.2;
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscA.frequency.value = 55;
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    oscB.frequency.value = 110;
    const mixB = ctx.createGain();
    mixB.gain.value = 0.35;
    oscA.connect(this.propFilter);
    oscB.connect(mixB).connect(this.propFilter);
    this.propFilter.connect(this.propGain).connect(this.master);
    oscA.start();
    oscB.start();
    this.propOscA = oscA;
    this.propOscB = oscB;
    this.propLfo = ctx.createOscillator();
    this.propLfo.type = 'sine';
    this.propLfo.frequency.value = 24;
    this.propLfoGain = ctx.createGain();
    this.propLfoGain.gain.value = 0;
    this.propLfo.connect(this.propLfoGain).connect(this.propGain.gain);
    this.propLfo.start();

    // Jet.
    this.jet = makeNoise('lowpass', 500, 0.8);
    this.jetWhine = ctx.createOscillator();
    this.jetWhine.type = 'sine';
    this.jetWhine.frequency.value = 1400;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.jetWhine.connect(this.whineGain).connect(this.master);
    this.jetWhine.start();
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'triangle';
    this.rumble.frequency.value = 38;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.connect(this.rumbleGain).connect(this.master);
    this.rumble.start();

    // Wind.
    this.wind = makeNoise('bandpass', 900, 0.7);
    this.windNoise = this.wind;

    // Stall horn.
    this.horn = ctx.createOscillator();
    this.horn.type = 'square';
    this.horn.frequency.value = 780;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.horn.connect(this.hornGain).connect(this.master);
    this.horn.start();

    // 20 mm cannon: filtered noise chopped by a 65 Hz square, which is close
    // enough to the M61 cadence to feel like a gun rather than a buzz.
    this.gun = makeNoise('bandpass', 1100, 0.65);
    this.gunLfo = ctx.createOscillator();
    this.gunLfo.type = 'square';
    this.gunLfo.frequency.value = 62;
    this.gunLfoGain = ctx.createGain();
    this.gunLfoGain.gain.value = 0.018;
    this.gunLfo.connect(this.gunLfoGain).connect(this.gun.gain);
    this.gunLfo.start();
  }

  setSpec(spec) {
    this.spec = spec;
  }

  start(spec) {
    this.ensure();
    if (!this.ctx) return;
    this.spec = spec;
    this.running = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.45, now, 0.35);
  }

  stop() {
    if (!this.ctx) return;
    this.running = false;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(0, now, 0.18);
    this._setGain(this.propGain, 0);
    this._setGain(this.jet.gain, 0);
    this._setGain(this.whineGain, 0);
    this._setGain(this.rumbleGain, 0);
    this._setGain(this.hornGain, 0);
    this._setGain(this.gun?.gain, 0);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.running ? 0.45 : 0,
        this.ctx.currentTime,
        0.08
      );
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _setGain(node, value, time = 0.12) {
    if (!node || !this.ctx) return;
    node.gain.setTargetAtTime(value, this.ctx.currentTime, time);
  }

  _setFreq(node, value, time = 0.15) {
    if (!node || !this.ctx) return;
    node.frequency.setTargetAtTime(value, this.ctx.currentTime, time);
  }

  update(dt, state) {
    if (!this.ctx || !this.running || !this.spec) return;
    this.time += dt;
    const spec = this.spec;
    const throttle = state?.throttle ?? 0.5;
    const speed = state?.speed ?? 0;
    const ab = state?.afterburner ?? 0;
    const altitude = state?.telemetry?.altitudeMSL ?? 1000;
    const airFactor = clamp(1 - altitude / 22000, 0.15, 1);
    const firing = !!state?.firing;

    if (spec.turbo) {
      this._setGain(this.propGain, 0);
      this._setGain(this.jet.gain, (0.035 + throttle * 0.075) * airFactor);
      this._setFreq(this.jet.filter, 280 + throttle * 900, 0.25);
      this._setFreq(this.jetWhine, 700 + throttle * 2300 + speed * 0.6, 0.3);
      this._setGain(this.whineGain, (0.005 + throttle * 0.018) * airFactor);
      this._setFreq(this.rumble, 26 + throttle * 24 + ab * 12, 0.3);
      this._setGain(this.rumbleGain, (0.008 + ab * 0.075) * airFactor);
    } else {
      const rpm = 0.25 + throttle * 0.75;
      const base = 38 + rpm * 62 + speed * 0.12;
      this._setFreq(this.propOscA, base, 0.2);
      this._setFreq(this.propOscB, base * 2.01, 0.2);
      this._setFreq(this.propLfo, base * 0.45, 0.2);
      this._setFreq(this.propFilter, 380 + rpm * 950, 0.2);
      this._setGain(this.propGain, 0.035 + throttle * 0.055);
      this._setGain(this.propLfoGain, throttle * 0.012);
      this._setGain(this.jet.gain, 0.01 + throttle * 0.012);
      this._setFreq(this.jet.filter, 900, 0.2);
      this._setGain(this.whineGain, 0);
      this._setGain(this.rumbleGain, 0);
    }

    this._setFreq(this.wind.filter, 500 + speed * 3.5, 0.3);
    this._setGain(this.wind.gain, clamp(speed / 300, 0, 1) * 0.055, 0.2);
    if (this.gun) {
      this._setFreq(this.gun.filter, 950 + throttle * 450, 0.12);
      this._setGain(this.gun.gain, firing ? 0.052 : 0, 0.015);
    }

    const hornOn = !!state?.stallWarning && !state?.onGround;
    this._setGain(this.hornGain, hornOn ? 0.018 * (0.5 + 0.5 * Math.sin(this.time * 22)) : 0, 0.02);
  }
}
