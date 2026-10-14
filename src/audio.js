// All sounds are synthesised with WebAudio — no audio files needed.

const KEY = 'readerbee-muted';

export class Sound {
  constructor() {
    this.ctx = null;
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch { this.muted = false; }
    this.t = 0;
    this.birdT = 1;
    this.env = { coast: 0, river: 0, meadow: 1, wind: 0.5 };
  }

  /** Must be called from a user gesture (the Play button). */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    // be quiet in a background tab, and wake up again after iOS interruptions (lock screen, other apps, calls)
    document.addEventListener('visibilitychange', () => (document.hidden ? c.suspend() : c.resume())?.catch?.(() => {}));
    const wake = () => { if (c.state !== 'running' && !document.hidden) c.resume()?.catch?.(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, wake, { passive: true });
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    // noise buffers
    const len = c.sampleRate * 2;
    const white = c.createBuffer(1, len, c.sampleRate), brown = c.createBuffer(1, len, c.sampleRate);
    const w = white.getChannelData(0), b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    this.white = white;
    this.brown = brown;
    const bed = (buf, type, freq, q) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = Math.random();
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start(0, Math.random() * 1.5);
      return g;
    };
    this.beds = {
      wind: bed(white, 'lowpass', 420, 0.4),
      sea: bed(brown, 'lowpass', 650, 0.5),
      river: bed(white, 'bandpass', 1300, 0.6),
    };
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** env: coast & river closeness (0..1), meadow (birds), height above ground etc. */
  update(dt, env) {
    if (!this.ok) return;
    this.t += dt;
    const c = this.ctx, now = c.currentTime;
    const swell = 0.55 + 0.45 * Math.sin(this.t * 0.55) ** 2;
    this.beds.wind.gain.setTargetAtTime(0.025 + 0.02 * Math.sin(this.t * 0.23) ** 2 + Math.min(env.height, 25) * 0.0008, now, 0.4);
    this.beds.sea.gain.setTargetAtTime(0.15 * env.coast * swell, now, 0.3);
    this.beds.river.gain.setTargetAtTime(0.07 * env.river, now, 0.3);
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 0.6 + Math.random() * 2.6;
      if (Math.random() < env.meadow * (env.day ?? 1)) this.bird();
    }
    // crickets at night
    this.cricketT = (this.cricketT ?? 1) - dt;
    if (this.cricketT <= 0) {
      this.cricketT = 0.25 + Math.random() * 0.9;
      if (Math.random() < (env.night ?? 0) * env.meadow) this.cricket();
    }
  }

  cricket() {
    const t0 = this.ctx.currentTime + 0.01, f = 2700 + Math.random() * 500, pan = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3 + ((Math.random() * 3) | 0); i++) this._osc('sine', f, f * 0.98, t0 + i * 0.06, 0.035, 0.007, { pan });
  }

  _env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  _osc(type, f0, f1, t0, dur, peak, { filter, q = 1, pan = 0, attack = 0.01 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    let node = o;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = filter; f.Q.value = q;
      node = node.connect(f);
    }
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    node.connect(g);
    (p ? g.connect(p) : g).connect(this.master);
    this._env(g, t0, attack, peak, dur);
    o.start(t0);
    o.stop(t0 + dur + attack + 0.05);
    return o;
  }
  _noise(t0, dur, peak, type, freq, q = 1, buf = this.white) {
    const c = this.ctx;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f).connect(g).connect(this.master);
    this._env(g, t0, 0.005, peak, dur);
    s.start(t0, Math.random() * 1.5, dur + 0.05);
  }
  /** Only make sounds while the audio is actually running (a paused context would queue them all up). */
  get ok() { return !!this.ctx && !this.muted && this.ctx.state === 'running'; }

  bird() {
    const t0 = this.ctx.currentTime + 0.02, notes = 2 + ((Math.random() * 4) | 0), pan = Math.random() * 1.6 - 0.8;
    const base = 2400 + Math.random() * 2200;
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const f0 = base * (0.85 + Math.random() * 0.3), d = 0.05 + Math.random() * 0.08;
      this._osc('sine', f0, f0 * (0.7 + Math.random() * 0.7), t, d, 0.025, { pan });
      t += d + 0.04 + Math.random() * 0.08;
    }
  }

  step(surface, run) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, k = run ? 1.35 : 1;
    switch (surface) {
      case 'path': this._noise(t, 0.07, 0.11 * k, 'bandpass', 2600, 0.8); this._noise(t + 0.03, 0.05, 0.06 * k, 'bandpass', 3800, 1); break;
      case 'road': this._noise(t, 0.045, 0.07 * k, 'highpass', 1600, 0.7); break;
      case 'wood': this._osc('sine', 150, 90, t, 0.09, 0.14 * k); this._noise(t, 0.05, 0.05 * k, 'lowpass', 900); break;
      case 'sand': this._noise(t, 0.12, 0.07 * k, 'lowpass', 700, 0.5); break;
      case 'water': this._noise(t, 0.2, 0.11 * k, 'bandpass', 1000, 0.9); break;
      case 'snow': this._noise(t, 0.1, 0.08 * k, 'bandpass', 1900, 1.4); break;
      default: this._noise(t, 0.09, 0.06 * k, 'lowpass', 1000, 0.6);
    }
  }
  jump() { if (this.ok) this._osc('sine', 330, 620, this.ctx.currentTime, 0.14, 0.06); }
  land(power) { if (this.ok) this._noise(this.ctx.currentTime, 0.12, 0.08 + power * 0.1, 'lowpass', 500, 0.7); }
  splash(power = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.45, 0.16 * power, 'bandpass', 1200, 0.5);
    this._noise(t + 0.05, 0.3, 0.08 * power, 'highpass', 2500, 0.7);
  }
  swim() { if (this.ok) this._noise(this.ctx.currentTime, 0.25, 0.06, 'bandpass', 800, 0.8); }
  pop() { if (this.ok) this._osc('sine', 500, 900, this.ctx.currentTime, 0.08, 0.06); }
  chime() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._osc('triangle', f, f, t + i * 0.09, 0.6, 0.13));
  }
  fanfare() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.5], [1046.5, 0.62]].forEach(([f, d]) => {
      this._osc('triangle', f, f, t + d, 0.45, 0.12);
      this._osc('sine', f * 2, f * 2, t + d, 0.3, 0.03);
    });
  }
  buzz() { if (this.ok) this._osc('sawtooth', 210, 240, this.ctx.currentTime, 0.4, 0.025, { filter: 700, q: 2 }); }
  boing() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 180, 520, t, 0.18, 0.12);
    this._osc('triangle', 520, 300, t + 0.16, 0.2, 0.05);
  }
  pickup() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [784, 988, 1175, 1568, 1976].forEach((f, i) => this._osc('triangle', f, f, t + i * 0.06, 0.35, 0.09));
  }
  twinkle() { if (this.ok) this._osc('sine', 1900 + Math.random() * 600, 2700, this.ctx.currentTime, 0.18, 0.05); }
  kick() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 150, 70, t, 0.09, 0.15);
    this._noise(t, 0.03, 0.05, 'highpass', 2000);
  }
  whoosh() {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.white;
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 2.5);
    s.connect(f).connect(g).connect(this.master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + 5);
    s.start(t, 0, 5);
    s.loop = true;
    s.stop(t + 5.1);
  }
  burner(v = 1) { if (this.ok && v > 0.02) this._noise(this.ctx.currentTime, 0.7, 0.12 * v, 'lowpass', 380, 0.7, this.brown); }
  umbrella() { if (this.ok) this._noise(this.ctx.currentTime, 0.12, 0.08, 'bandpass', 900, 1.5); }

  animal(kind) {
    if (!this.ok) return;
    const c = this.ctx, t = c.currentTime;
    if (kind === 'moo') {
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(125, t);
      o.frequency.linearRampToValueAtTime(110, t + 0.5);
      o.frequency.linearRampToValueAtTime(90, t + 1.2);
      f.type = 'lowpass'; f.Q.value = 7;
      f.frequency.setValueAtTime(300, t);
      f.frequency.linearRampToValueAtTime(950, t + 0.35);
      f.frequency.linearRampToValueAtTime(380, t + 1.2);
      o.connect(f).connect(g).connect(this.master);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.12);
      g.gain.setValueAtTime(0.12, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
      o.start(t); o.stop(t + 1.4);
    } else if (kind === 'neigh') {
      const o = this._osc('sawtooth', 560, 330, t, 1.0, 0.06, { filter: 1100, q: 2 });
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 13; lg.gain.value = 70;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t); lfo.stop(t + 1.05);
    } else if (kind === 'cluck') {
      for (let i = 0; i < 3; i++) this._osc('triangle', 700, 480, t + i * 0.13, 0.05, 0.08);
    } else if (kind === 'quack') {
      for (let i = 0; i < 2; i++) this._osc('square', 540, 380, t + i * 0.2, 0.13, 0.05, { filter: 1300, q: 4 });
    } else if (kind === 'arf') {
      for (let i = 0; i < 2; i++) {
        this._osc('sawtooth', 340, 240, t + i * 0.28, 0.13, 0.08, { filter: 900, q: 1.5 });
        this._noise(t + i * 0.28, 0.1, 0.05, 'bandpass', 1500, 1);
      }
    } else if (kind === 'buzz') {
      this._osc('sawtooth', 220, 250, t, 0.9, 0.03, { filter: 650, q: 2 });
    } else if (kind === 'roar') {
      this._osc('sawtooth', 200, 120, t, 0.8, 0.07, { filter: 600, q: 1.2 });
      this._noise(t, 0.6, 0.04, 'lowpass', 500, 0.7);
    } else if (kind === 'whale') {
      this._osc('sine', 300, 180, t, 1.1, 0.06);
      this._osc('sine', 180, 280, t + 1.1, 1.0, 0.05);
    } else if (kind === 'chomp') {
      for (let i = 0; i < 3; i++) this._noise(t + i * 0.16, 0.06, 0.09, 'bandpass', 2200, 2);
    } else if (kind === 'hoot') {
      this._osc('sine', 410, 380, t, 0.28, 0.08);
      this._osc('sine', 420, 360, t + 0.42, 0.45, 0.08);
    } else if (kind === 'hi') {
      this._osc('triangle', 440, 660, t, 0.12, 0.05);
      this._osc('triangle', 660, 520, t + 0.13, 0.14, 0.05);
    }
  }
}
