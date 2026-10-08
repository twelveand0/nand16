// ============================================================================
//  Score: a live soundtrack played by the machine.
//  A composed harmonic frame (D dorian, i–VI–III–VII) supplies the chords;
//  the machine supplies the rest: arpeggio notes are read from the ALU output
//  bits, the arrangement follows which program the CPU is running, game events
//  ring out, and deep zoom lets you hear the gates switching.
//  Everything is synthesized with Web Audio — no samples, no files.
// ============================================================================
class Score {
  constructor() {
    this.enabled = true;
    this.volume = 0.6;
    this.ctx = null;
    this.running = false;
    this.ctxMode = 'boot';
    this.paused = false;
    this.slowGate = false;
    this.slowClock = false;
    this.depth = 0;
    this.activity = 0;
    this.tempo = 96;
    this.step = 0;
    this.nextT = 0;
    this.lastPad = -1;
    this.sample = () => 0;       // returns live machine bits (ALU result)
    this.sampleRand = () => 0;
    this.gateSkip = 0;
  }
  // ---------- scale and harmony ----------
  static mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  static get CHORDS() {
    return [
      { root: 38, notes: [50, 53, 57, 60, 64], name: 'Dm9' },
      { root: 34, notes: [46, 50, 53, 57, 62], name: 'Bbmaj7' },
      { root: 41, notes: [53, 57, 60, 64, 67], name: 'Fmaj9' },
      { root: 36, notes: [48, 55, 57, 62, 64], name: 'C6/9' },
    ];
  }
  static get DORIAN() { return [0, 2, 3, 5, 7, 9, 10]; }   // D E F G A B C

  start() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) this._init();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.running) {
        this.running = true;
        this.nextT = this.ctx.currentTime + 0.1;
        this.lastPad = -1;
        this.timer = setInterval(() => this._tick(), 25);
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(this.volume * 0.9, this.ctx.currentTime, 0.8);
      }
    } catch (e) { console.warn('audio unavailable', e); this.enabled = false; }
  }
  stop() {
    if (!this.ctx || !this.running) return;
    this.running = false;
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => { if (!this.running && this.ctx) this.ctx.suspend(); }, 900);
  }
  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.running) this.master.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.1);
  }

  _init(given) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = given || new AC({ latencyHint: 'playback' });
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 3; this.comp.attack.value = 0.01; this.comp.release.value = 0.25;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 16000; this.tone.Q.value = 0.5;
    this.bus = ctx.createGain();
    this.bus.connect(this.tone); this.tone.connect(this.comp); this.comp.connect(this.master); this.master.connect(ctx.destination);
    // reverb from a synthetic impulse: decaying stereo noise
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.rev = ctx.createConvolver(); this.rev.buffer = ir;
    this.revIn = ctx.createGain(); this.revIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.55;
    this.revIn.connect(this.rev); this.rev.connect(revOut); revOut.connect(this.bus);
    // dotted-eighth echo with a darkening feedback path
    this.dly = ctx.createDelay(2);
    this.dlyIn = ctx.createGain();
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const fbf = ctx.createBiquadFilter(); fbf.type = 'lowpass'; fbf.frequency.value = 2400;
    const dOut = ctx.createGain(); dOut.gain.value = 0.42;
    this.dlyIn.connect(this.dly); this.dly.connect(fbf); fbf.connect(fb); fb.connect(this.dly);
    this.dly.connect(dOut); dOut.connect(this.bus); dOut.connect(this.revIn);
    // instrument groups
    const grp = (v) => { const g = ctx.createGain(); g.gain.value = v; g.connect(this.bus); return g; };
    this.g = { pad: grp(0.9), arp: grp(0.8), bass: grp(0.8), drum: grp(0.7), fx: grp(1), micro: grp(0) };
    // a second of white noise for percussion and crackle
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
  }

  // ---------- per-frame state from the app ----------
  update(s) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    this.paused = s.paused; this.slowGate = s.slowGate; this.slowClock = s.slowClock;
    this.depth = s.depth; this.activity = s.activity;
    if (s.tempo) this.tempo = s.tempo;
    if (s.mode !== this.ctxMode) { this._modeChange(this.ctxMode, s.mode); this.ctxMode = s.mode; }
    // zoom: diving into silicon narrows the band and brings up the gate crackle
    const d = this.depth;
    this.tone.frequency.setTargetAtTime(16000 * Math.pow(0.16, d), t, 0.3);
    const quietSeq = this.paused || this.slowGate || this.slowClock;
    const m = this.ctxMode;
    const L = {
      boot: { pad: 0.7, arp: 0.55, bass: 0.6, drum: 0.0 },
      shell: { pad: 0.9, arp: 0.7, bass: 0.7, drum: 0.35 },
      snake: { pad: 0.65, arp: 0.85, bass: 0.9, drum: 0.8 },
      gpu: { pad: 0.75, arp: 0.9, bass: 0.8, drum: 0.55 },
      over: { pad: 1.0, arp: 0.0, bass: 0.4, drum: 0.0 },
      calm: { pad: 0.9, arp: 0.5, bass: 0.6, drum: 0.25 },
    }[m] || { pad: 0.9, arp: 0.6, bass: 0.6, drum: 0.3 };
    const seq = quietSeq ? 0 : 1;
    this.g.pad.gain.setTargetAtTime(L.pad * (1 - d * 0.35), t, 0.5);
    this.g.arp.gain.setTargetAtTime(L.arp * seq * (1 - d * 0.5), t, 0.3);
    this.g.bass.gain.setTargetAtTime(L.bass * seq * (1 - d * 0.6), t, 0.3);
    this.g.drum.gain.setTargetAtTime(L.drum * seq * (1 - d * 0.8), t, 0.3);
    this.g.micro.gain.setTargetAtTime(Math.min(1, d * 1.3), t, 0.3);
  }

  _modeChange(from, to) {
    const t = this.ctx.currentTime + 0.02;
    if (to === 'over' && from === 'snake') {
      [69, 65, 62, 57].forEach((n, i) => this._pluck(n, t + i * 0.16, 0.9, 0, 0.9, 'triangle'));
      this._bass(38 - 12, t + 0.64, 2.4, 0.9);
    }
    if (to === 'snake' && from !== 'snake') [62, 69, 74].forEach((n, i) => this._pluck(n, t + i * 0.08, 0.7, 0.2 * (i - 1), 0.4));
  }

  // ---------- events ----------
  eat(score) {
    if (!this.running) return;
    const deg = Score.DORIAN;
    const k = (score - 1) % 14;
    const n = 74 + Math.floor(k / 7) * 12 + deg[k % 7];
    const t = this.ctx.currentTime + 0.01;
    this._bell(n, t, 0.5); this._bell(n + 7, t + 0.09, 0.28);
  }
  key(k) {
    if (!this.running) return;
    const t = this.ctx.currentTime + 0.005;
    this._blip(k >= 4 ? 1320 : 990, t, 0.05, k === 2 ? -0.5 : k === 3 ? 0.5 : 0, 0.03, 'triangle', this.g.fx);
  }
  powerOn() {
    if (!this.running) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(5200, t + 2.2);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(f); f.connect(g); g.connect(this.g.fx); g.connect(this.revIn);
    src.start(t); src.stop(t + 3);
    this._bass(26, t, 3, 0.8);
  }
  // one unit of gate delay in slow motion: the more gates flip, the higher the note
  gateStep(flips, rate) {
    if (!this.running) return;
    if (rate > 40 && (++this.gateSkip % Math.ceil(rate / 40))) return;
    if (!flips) return;
    const deg = Score.DORIAN;
    const k = Math.min(20, Math.round(Math.log2(flips + 1) * 2.4));
    const n = 62 + Math.floor(k / 7) * 12 + deg[k % 7];
    this._blip(Score.mtof(n), this.ctx.currentTime + 0.005, 0.11, (Math.random() - 0.5) * 0.6, 0.09, 'sine', this.g.fx, true);
  }
  // one machine clock cycle when the clock is slowed down to a crawl
  clockTick(pc) {
    if (!this.running) return;
    const t = this.ctx.currentTime + 0.005;
    this._hat(t, 0.9);
    const deg = Score.DORIAN;
    const n = 50 + deg[pc % 7] + (pc >> 3 & 1) * 12;
    this._pluck(n, t, 0.5, 0, 0.5, 'triangle');
  }

  // ---------- the sequencer ----------
  _tick() {
    if (!this.running) return;
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.14;
    const sixteenth = 60 / this.tempo / 4;
    this.dly.delayTime.setTargetAtTime(sixteenth * 3, ctx.currentTime, 0.2);
    while (this.nextT < ahead) {
      this._stepAt(this.step, this.nextT, sixteenth);
      this.nextT += sixteenth;
      this.step++;
    }
    // gate crackle while you are deep inside: rate follows local switching activity
    if (this.depth > 0.05 && !this.slowGate) {
      const lambda = this.activity * 3.2 * this.depth;
      let n = 0; let p = Math.random();
      while (p > Math.exp(-lambda) && n < 5) { n++; p *= Math.random(); }
      for (let i = 0; i < n; i++) {
        const f = 2200 + Math.random() * 5200;
        this._blip(f, ctx.currentTime + 0.02 + Math.random() * 0.02, 0.018 + Math.random() * 0.02, Math.random() * 1.6 - 0.8, 0.012, 'sine', this.g.micro);
      }
    }
  }
  _stepAt(i, t, sx) {
    const s = i % 16, bar = Math.floor(i / 16);
    const chordIdx = Math.floor(bar / 2) % 4;
    const ch = Score.CHORDS[chordIdx];
    const m = this.ctxMode;
    // pads change every two bars, always, even when the machine is paused
    if (s === 0 && bar % 2 === 0 && this.lastPad !== bar) { this.lastPad = bar; this._pad(ch, t, sx * 32); }
    const seqOn = !(this.paused || this.slowGate || this.slowClock);
    if (!seqOn || m === 'over') return;
    // ---- bass ----
    if (m === 'snake' || m === 'gpu') {
      if (s % 2 === 0) this._bass(ch.root + ((s % 8 === 6) ? 12 : 0), t, sx * 1.6, s % 4 === 0 ? 0.9 : 0.6);
    } else if (s === 0) this._bass(ch.root, t, sx * 15, 0.7);
    else if (m === 'shell' && s === 10) this._bass(ch.root + 7, t, sx * 5, 0.45);
    // ---- arpeggio: notes read from the ALU output at this moment ----
    const bits = this.sample() >>> 0;
    const pool = ch.notes.concat(ch.notes.map(n => n + 12));
    let play = false, vel = 0.5;
    if (m === 'snake') { play = true; vel = s % 4 === 0 ? 0.85 : 0.5; }
    else if (m === 'gpu') { play = (bits >> (s & 15)) & 1 || s % 4 === 0; vel = s % 4 === 0 ? 0.8 : 0.45; }
    else if (m === 'shell' || m === 'boot') { play = s % 2 === 0; vel = s % 4 === 0 ? 0.7 : 0.45; }
    else { play = s % 4 === 0 || (bits & 1 && s % 2 === 0); vel = 0.5; }
    if (m === 'boot') {
      // power-on self test: the random generator picks the notes
      const r = this.sampleRand();
      if (s % 2 === 0) this._pluck(74 + Score.DORIAN[r % 7] + ((r >> 3) & 1) * 12, t, 0.35, ((r >> 4) & 7) / 7 - 0.5, 0.25, 'square');
      if (s !== 0) return;
    }
    if (play) {
      const idx = (bits ^ (bits >> 5) ^ (s * 3)) % pool.length;
      const pan = ((bits >> 2) & 7) / 7 * 1.2 - 0.6;
      this._pluck(pool[idx] + (s === 0 ? 0 : 12), t, vel, pan, sx * 3.5, 'sawtooth');
    }
    // ---- drums ----
    if (m === 'snake') {
      if (s === 0 || s === 8 || (s === 14 && bar % 2)) this._kick(t, s === 0 ? 1 : 0.8);
      if (s === 4 || s === 12) this._snare(t);
      if (s % 2 === 0) this._hat(t, s % 4 === 2 ? 0.7 : 0.4);
      else if (bits & 4) this._hat(t, 0.2);
    } else if (m === 'gpu') {
      if (s === 0 || s === 10) this._kick(t, s === 0 ? 0.9 : 0.6);
      if (s === 8) this._snare(t);
      if (s % 2 === 1) this._hat(t, (bits >> s) & 1 ? 0.6 : 0.25);
    } else if (m === 'shell' || m === 'calm') {
      if (s % 4 === 0) this._hat(t, 0.35);      // the clock, quietly
      if (s === 0 && bar % 4 === 0) this._kick(t, 0.45);
    }
  }

  // ---------- instruments ----------
  _pad(ch, t, dur) {
    const ctx = this.ctx;
    const end = t + dur + 2.5;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(420, t);
    f.frequency.linearRampToValueAtTime(1500, t + dur * 0.45);
    f.frequency.linearRampToValueAtTime(600, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 1.8);
    g.gain.setValueAtTime(0.055, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, end);
    f.connect(g); g.connect(this.g.pad);
    const send = ctx.createGain(); send.gain.value = 0.7; g.connect(send); send.connect(this.revIn);
    ch.notes.forEach((n, k) => {
      for (const det of [-9, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = Score.mtof(n); o.detune.value = det + (k % 2 ? 3 : -3);
        const p = ctx.createStereoPanner(); p.pan.value = det < 0 ? -0.45 : 0.45;
        o.connect(p); p.connect(f);
        o.start(t); o.stop(end + 0.05);
      }
    });
    // a soft sine an octave up for air
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = Score.mtof(ch.notes[2] + 12);
    const og = ctx.createGain(); og.gain.value = 0.25; o.connect(og); og.connect(f);
    o.start(t); o.stop(end + 0.05);
  }
  _pluck(n, t, vel, pan, len, type) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type || 'sawtooth'; o.frequency.value = Score.mtof(n);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 5;
    f.frequency.setValueAtTime(3800 * (0.6 + vel * 0.6), t);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, len));
    const p = ctx.createStereoPanner(); p.pan.value = pan || 0;
    o.connect(f); f.connect(g); g.connect(p); p.connect(this.g.arp);
    const ds = ctx.createGain(); ds.gain.value = 0.32; p.connect(ds); ds.connect(this.dlyIn);
    const rs = ctx.createGain(); rs.gain.value = 0.22; p.connect(rs); rs.connect(this.revIn);
    o.start(t); o.stop(t + Math.max(0.12, len) + 0.05);
  }
  _bass(n, t, dur, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = Score.mtof(n);
    const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = Score.mtof(n);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(180, t + Math.min(0.5, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, t + 0.01);
    g.gain.setValueAtTime(0.2 * vel, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const sg = ctx.createGain(); sg.gain.value = 0.9;
    o.connect(f); s.connect(sg); sg.connect(f); f.connect(g); g.connect(this.g.bass);
    o.start(t); s.start(t); o.stop(t + dur + 0.05); s.stop(t + dur + 0.05);
  }
  _kick(t, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.75 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g); g.connect(this.g.drum);
    o.start(t); o.stop(t + 0.42);
  }
  _snare(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(f); f.connect(g); g.connect(this.g.drum);
    const rs = ctx.createGain(); rs.gain.value = 0.3; g.connect(rs); rs.connect(this.revIn);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.22);
  }
  _hat(t, vel) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    const p = ctx.createStereoPanner(); p.pan.value = 0.25;
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.g.drum);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.06);
  }
  _bell(n, t, vel) {
    const ctx = this.ctx;
    const fc = Score.mtof(n);
    const c = ctx.createOscillator(); c.type = 'sine'; c.frequency.value = fc;
    const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = fc * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(fc * 2.2, t); mg.gain.exponentialRampToValueAtTime(fc * 0.05, t + 1.6);
    m.connect(mg); mg.connect(c.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    c.connect(g); g.connect(this.g.fx);
    const rs = ctx.createGain(); rs.gain.value = 0.6; g.connect(rs); rs.connect(this.revIn);
    c.start(t); m.start(t); c.stop(t + 2.7); m.stop(t + 2.7);
  }
  _blip(freq, t, vol, pan, len, type, dest, wet) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const p = ctx.createStereoPanner(); p.pan.value = pan || 0;
    o.connect(g); g.connect(p); p.connect(dest || this.g.fx);
    if (wet) { const d = ctx.createGain(); d.gain.value = 0.35; p.connect(d); d.connect(this.dlyIn); }
    o.start(t); o.stop(t + len + 0.02);
  }
}

if (typeof module !== 'undefined') module.exports = { Score };
