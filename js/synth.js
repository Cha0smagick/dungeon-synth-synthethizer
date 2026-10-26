/* CRYPT FORGE DS-1 — Voz de síntesis y presets.
 * Arquitectura: OSC A + OSC B + SUB -> filtro LP con envolvente -> VCA con ADSR
 * -> paneo estéreo -> (master, reverb send, delay send). LFO sobre corte/diapasón/amp.
 * Polifonía 8 voces con robo de la más antigua; modo mono con portamento.
 */
(function (root) {
  'use strict';

  var MAX_VOICES = 8;

  var voices = [];
  var lastFreq = 0;
  var params = defaults();

  /* ---------- Modelo de parámetros ---------- */
  function defaults() {
    return {
      oscA: { wave: 'sawtooth', oct: 0, detune: 0, level: 0.8 },
      oscB: { wave: 'sawtooth', oct: 0, detune: 7, level: 0.7 },
      sub: { level: 0.4 },
      filter: { cutoff: 500, res: 1, envAmt: 0.3, a: 0.05, d: 0.6, s: 0.4, r: 1.2 },
      amp: { a: 0.8, d: 1.0, s: 0.8, r: 1.5 },
      lfo: { wave: 'sine', rate: 5, depth: 0.2, target: 'off' },
      mode: 'poly',
      glide: 0,
      spread: 0.6
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* merge profundo (2 niveles) de parciales sobre base */
  function merge(base, over) {
    var out = clone(base);
    if (!over) return out;
    for (var k in over) {
      if (Object.prototype.hasOwnProperty.call(over, k)) {
        var v = over[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
          out[k] = merge(out[k], v);
        } else {
          out[k] = v;
        }
      }
    }
    return out;
  }

  function freqOf(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  /* ---------- Voz ---------- */
  function Voice(midi, vel, p, when, glideFrom) {
    var ctx = root.Engine.getContext();
    var sends = root.Engine.sends();
    var f = freqOf(midi);

    this.midi = midi;
    this.p = p;
    this.ended = false;
    this.stopAt = when + p.amp.a + p.amp.d + 10;

    var mix = ctx.createGain();
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.filter.res;

    var amp = ctx.createGain();
    amp.gain.value = 0;

    var out = amp;
    if (ctx.createStereoPanner) {
      var pan = ctx.createStereoPanner();
      pan.pan.value = p.spread * (((midi - 21) / 87) * 2 - 1) * 0.9;
      amp.connect(pan);
      out = pan;
    }
    out.connect(sends.dry);
    out.connect(sends.reverb);
    out.connect(sends.delay);

    this.stopNodes = [];

    function addOsc(cfg, level, detune) {
      var o = ctx.createOscillator();
      o.type = cfg.wave;
      if (glideFrom && p.glide > 0) {
        o.frequency.setValueAtTime(glideFrom, when);
        o.frequency.exponentialRampToValueAtTime(f, when + p.glide / 1000);
      } else {
        o.frequency.setValueAtTime(f, when);
      }
      o.detune.value = detune;
      var g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(mix);
      o.start(when);
      this.stopNodes.push(o);
      return { osc: o, gain: g };
    }

    // addOsc usa this.stopNodes; enlazar a this mediante closure local
    var self = this;
    var oscA = addOsc.call(self, p.oscA, p.oscA.level, p.oscA.detune + p.oscA.oct * 1200);
    var oscB = addOsc.call(self, p.oscB, p.oscB.level, p.oscB.detune + p.oscB.oct * 1200);
    addOsc.call(self, { wave: 'sine' }, p.sub.level, -1200); // sub, una octava abajo
    this.oscA = oscA.osc; this.oscB = oscB.osc;

    mix.connect(filter);
    filter.connect(amp);

    // envolvente de filtro
    var peak = Math.min(8000, p.filter.cutoff * Math.pow(2, p.filter.envAmt * 4));
    var susF = Math.max(20, p.filter.cutoff + (peak - p.filter.cutoff) * p.filter.s);
    filter.frequency.setValueAtTime(p.filter.cutoff, when);
    filter.frequency.linearRampToValueAtTime(peak, when + p.filter.a);
    filter.frequency.linearRampToValueAtTime(susF, when + p.filter.a + p.filter.d);

    // envolvente de amp
    var vel2 = Math.max(0.05, Math.min(1, vel));
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(vel2, when + Math.max(0.002, p.amp.a));
    amp.gain.linearRampToValueAtTime(vel2 * p.amp.s, when + p.amp.a + p.amp.d);

    // LFO
    if (p.lfo.target !== 'off' && p.lfo.depth > 0) {
      var lfo = ctx.createOscillator();
      lfo.type = p.lfo.wave || 'sine';
      lfo.frequency.value = p.lfo.rate;
      var depth = ctx.createGain();
      if (p.lfo.target === 'filter') {
        depth.gain.value = Math.min(p.lfo.depth * 1500, p.filter.cutoff * 0.9);
        lfo.connect(depth);
        depth.connect(filter.frequency);
      } else if (p.lfo.target === 'pitch') {
        depth.gain.value = p.lfo.depth * 60;
        lfo.connect(depth);
        depth.connect(this.oscA.detune);
        depth.connect(this.oscB.detune);
      } else {
        depth.gain.value = p.lfo.depth * 0.35;
        lfo.connect(depth);
        depth.connect(amp.gain);
      }
      lfo.start(when);
      this.stopNodes.push(lfo);
    }

    this.amp = amp;
    this.filter = filter;
  }

  Voice.prototype.release = function (time) {
    if (this.ended) return;
    this.ended = true;
    var ctx = root.Engine.getContext();
    var r = Math.max(0.02, this.p.amp.r);
    var g = this.amp.gain;
    if (g.cancelAndHoldAtTime) {
      g.cancelAndHoldAtTime(time);
      g.linearRampToValueAtTime(0, time + r);
    } else {
      try {
        g.cancelScheduledValues(time);
        g.setValueAtTime(g.value, time);
      } catch (e) {
        try { g.setValueAtTime(0.0001, time); } catch (e2) { /* silencio */ }
      }
      g.linearRampToValueAtTime(0, time + r);
    }
    this.stopAt = time + r + 0.15;
    var self = this;
    for (var i = 0; i < this.stopNodes.length; i++) {
      try { this.stopNodes[i].stop(this.stopAt); } catch (e) { /* ya parado */ }
    }
    var delayMs = Math.max(0, (this.stopAt - ctx.currentTime) * 1000) + 80;
    setTimeout(function () {
      try { self.amp.disconnect(); self.filter.disconnect(); } catch (e) { /* ya desconectado */ }
      for (var j = 0; j < self.stopNodes.length; j++) {
        try { self.stopNodes[j].disconnect(); } catch (e) { /* ya desconectado */ }
      }
    }, delayMs);
  };

  function prune() {
    var t = root.Engine.now();
    for (var i = voices.length - 1; i >= 0; i--) {
      if (voices[i].ended && voices[i].stopAt <= t) voices.splice(i, 1);
    }
  }

  /* ---------- API pública ---------- */
  function noteOn(midi, vel, when) {
    var ctx = root.Engine.getContext();
    if (!ctx) return null;
    when = when || ctx.currentTime;
    vel = vel == null ? 0.8 : vel;
    prune();

    if (params.mode === 'mono') {
      for (var i = voices.length - 1; i >= 0; i--) voices[i].release(when);
      var v = new Voice(midi, vel, params, when, lastFreq);
      lastFreq = freqOf(midi);
      voices.push(v);
      return v;
    }
    if (voices.length >= MAX_VOICES) voices[0].release(when);
    var v2 = new Voice(midi, vel, params, when, 0);
    voices.push(v2);
    return v2;
  }

  function noteOff(midi, when) {
    var ctx = root.Engine.getContext();
    if (!ctx) return;
    when = when || ctx.currentTime;
    for (var i = voices.length - 1; i >= 0; i--) {
      if (!voices[i].ended && voices[i].midi === midi) {
        voices[i].release(when);
        return;
      }
    }
  }

  function allNotesOff() {
    var t = root.Engine.now();
    for (var i = voices.length - 1; i >= 0; i--) voices[i].release(t);
    lastFreq = 0;
  }

  function activeCount() {
    var n = 0;
    for (var i = 0; i < voices.length; i++) if (!voices[i].ended) n++;
    return n;
  }

  /* ---------- Presets ---------- */
  var PRESETS = [
    {
      name: 'Mazmorra de Piedra',
      synth: {
        oscA: { wave: 'sawtooth', oct: 0, detune: 0, level: 0.8 },
        oscB: { wave: 'sawtooth', oct: 0, detune: 7, level: 0.7 },
        sub: { level: 0.4 },
        filter: { cutoff: 500, res: 1, envAmt: 0.3, a: 0.05, d: 0.6, s: 0.4, r: 1.2 },
        amp: { a: 0.8, d: 1.0, s: 0.8, r: 1.5 },
        lfo: { wave: 'sine', rate: 5, depth: 0.2, target: 'off' },
        mode: 'poly', glide: 0, spread: 0.6
      },
      fx: { drive: 0.15, revSend: 0.65, revPre: 30, delSend: 0.15, delDiv: 0.5, delFb: 0.4, hiss: -55, master: 0.8 }
    },
    {
      name: 'Cuerno de Guerra',
      synth: {
        oscA: { wave: 'sawtooth', level: 0.85 },
        oscB: { wave: 'square', oct: 1, detune: 8, level: 0.5 },
        sub: { level: 0.3 },
        filter: { cutoff: 2400, res: 2, envAmt: 0.55, a: 0.02, d: 0.35, s: 0.2, r: 0.3 },
        amp: { a: 0.04, d: 0.3, s: 0.75, r: 0.25 },
        lfo: { wave: 'sine', rate: 5, depth: 0.15, target: 'pitch' },
        mode: 'mono', glide: 70, spread: 0.5
      },
      fx: { drive: 0.25, revSend: 0.35, delSend: 0.1, delDiv: 0.5, delFb: 0.3, hiss: -58, master: 0.8 }
    },
    {
      name: 'Flauta de Hueso',
      synth: {
        oscA: { wave: 'sine', level: 0.9 },
        oscB: { wave: 'triangle', detune: 5, level: 0.4 },
        sub: { level: 0 },
        filter: { cutoff: 3200, res: 1, envAmt: 0.15, a: 0.01, d: 0.2, s: 0.7, r: 0.3 },
        amp: { a: 0.03, d: 0.2, s: 0.8, r: 0.3 },
        lfo: { wave: 'sine', rate: 5.2, depth: 0.12, target: 'pitch' },
        mode: 'poly', glide: 0, spread: 0.4
      },
      fx: { drive: 0, revSend: 0.45, delSend: 0.2, delDiv: 0.75, delFb: 0.35, hiss: -48, master: 0.8 }
    },
    {
      name: 'Coro de Almas',
      synth: {
        oscA: { wave: 'sawtooth', detune: -9, level: 0.7 },
        oscB: { wave: 'triangle', detune: 11, level: 0.6 },
        sub: { level: 0.35 },
        filter: { cutoff: 1100, res: 1.5, envAmt: 0.25, a: 0.2, d: 1.0, s: 0.5, r: 2.0 },
        amp: { a: 1.1, d: 1.0, s: 0.85, r: 2.0 },
        lfo: { wave: 'sine', rate: 4.5, depth: 0.12, target: 'amp' },
        mode: 'poly', glide: 0, spread: 0.8
      },
      fx: { drive: 0.1, revSend: 0.7, delSend: 0.1, delDiv: 1, delFb: 0.3, hiss: -52, master: 0.8 }
    },
    {
      name: 'Bajo de Cripta',
      synth: {
        oscA: { wave: 'square', level: 0.9 },
        oscB: { wave: 'sine', oct: -1, level: 0.8 },
        sub: { level: 0.6 },
        filter: { cutoff: 160, res: 4, envAmt: 0.35, a: 0.002, d: 0.15, s: 0.1, r: 0.15 },
        amp: { a: 0.002, d: 0.2, s: 0.6, r: 0.12 },
        lfo: { wave: 'sine', rate: 5, depth: 0, target: 'off' },
        mode: 'mono', glide: 30, spread: 0
      },
      fx: { drive: 0.35, revSend: 0.12, delSend: 0, delDiv: 0.5, delFb: 0.3, hiss: -60, master: 0.85 }
    },
    {
      name: 'Campana Lejana',
      synth: {
        oscA: { wave: 'sine', level: 0.8 },
        oscB: { wave: 'triangle', oct: 1, detune: 3, level: 0.6 },
        sub: { level: 0.1 },
        filter: { cutoff: 4200, res: 2, envAmt: 0.4, a: 0.002, d: 1.8, s: 0, r: 2.5 },
        amp: { a: 0.002, d: 1.8, s: 0, r: 2.5 },
        lfo: { wave: 'sine', rate: 5, depth: 0, target: 'off' },
        mode: 'poly', glide: 0, spread: 0.7
      },
      fx: { drive: 0.05, revSend: 0.6, delSend: 0.25, delDiv: 0.75, delFb: 0.45, hiss: -58, master: 0.8 }
    },
    {
      name: 'Cinta Mordida',
      synth: {
        oscA: { wave: 'square', detune: 22, level: 0.8 },
        oscB: { wave: 'sawtooth', detune: -15, level: 0.5 },
        sub: { level: 0.2 },
        filter: { cutoff: 1300, res: 3, envAmt: 0.5, a: 0.01, d: 0.25, s: 0.6, r: 0.2 },
        amp: { a: 0.01, d: 0.25, s: 0.6, r: 0.2 },
        lfo: { wave: 'triangle', rate: 6, depth: 0.08, target: 'pitch' },
        mode: 'mono', glide: 100, spread: 0.3
      },
      fx: { drive: 0.55, revSend: 0.25, delSend: 0.3, delDiv: 0.75, delFb: 0.45, hiss: -40, master: 0.8 }
    },
    {
      name: 'Niebla Negra',
      synth: {
        oscA: { wave: 'sawtooth', level: 0.7 },
        oscB: { wave: 'sawtooth', oct: -1, detune: 5, level: 0.6 },
        sub: { level: 0.8 },
        filter: { cutoff: 260, res: 0.7, envAmt: 0.2, a: 0.4, d: 1.0, s: 0.6, r: 3.5 },
        amp: { a: 2.0, d: 1.0, s: 0.9, r: 3.5 },
        lfo: { wave: 'sine', rate: 0.2, depth: 0.4, target: 'filter' },
        mode: 'poly', glide: 0, spread: 1
      },
      fx: { drive: 0.1, revSend: 0.85, delSend: 0.05, delDiv: 1.5, delFb: 0.3, hiss: -50, master: 0.75 }
    },
    {
      name: 'Vigía de Piedra',
      synth: {
        oscA: { wave: 'sawtooth', level: 0.8 },
        oscB: { wave: 'square', detune: 4, level: 0.6 },
        sub: { level: 0.25 },
        filter: { cutoff: 900, res: 6, envAmt: 0.6, a: 0.005, d: 0.2, s: 0.3, r: 0.2 },
        amp: { a: 0.005, d: 0.2, s: 0.7, r: 0.25 },
        lfo: { wave: 'sine', rate: 0.5, depth: 0.6, target: 'filter' },
        mode: 'mono', glide: 60, spread: 0.2
      },
      fx: { drive: 0.2, revSend: 0.3, delSend: 0.4, delDiv: 0.75, delFb: 0.5, hiss: -55, master: 0.8 }
    },
    {
      name: 'Marcha Fúnebre',
      synth: {
        oscA: { wave: 'square', level: 0.8 },
        oscB: { wave: 'triangle', oct: -1, detune: 3, level: 0.5 },
        sub: { level: 0.35 },
        filter: { cutoff: 480, res: 2, envAmt: 0.3, a: 0.03, d: 0.4, s: 0.6, r: 0.5 },
        amp: { a: 0.03, d: 0.4, s: 0.6, r: 0.5 },
        lfo: { wave: 'sine', rate: 5, depth: 0.05, target: 'pitch' },
        mode: 'mono', glide: 50, spread: 0.3
      },
      fx: { drive: 0.2, revSend: 0.55, delSend: 0.15, delDiv: 0.5, delFb: 0.35, hiss: -54, master: 0.8 }
    }
  ];

  root.Synth = {
    defaults: defaults,
    clone: clone,
    merge: merge,
    freqOf: freqOf,
    presets: function () { return PRESETS; },
    noteOn: noteOn,
    noteOff: noteOff,
    allNotesOff: allNotesOff,
    activeCount: activeCount,
    getParams: function () { return params; },
    setParams: function (p) { params = p; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
