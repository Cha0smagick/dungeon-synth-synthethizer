/* CRYPT FORGE DS-1 — Secuenciador.
 * Transporte con lookahead scheduling (reloj de Web Audio, inmune a tirones),
 * 8 patrones x 16 semicorcheas (melodía + 5 filas de batería), swing,
 * modo canción (cadena) y cambio de patrón en vivo.
 */
(function (root) {
  'use strict';

  var LOOKAHEAD = 0.12;   // s de antelación de programación
  var INTERVAL = 25;      // ms de consulta
  var STEPS = 16;
  var PATTERNS = 8;
  var CHAIN = 16;

  var timer = null;
  var nextStepTime = 0;
  var step = 0;
  var playing = false;
  var clipboard = null;

  var onStepCb = null;
  var onStopCb = null;
  var onPatternCb = null;
  var onSongCb = null;

  function zeros() { var a = []; for (var i = 0; i < STEPS; i++) a.push(0); return a; }

  function makePattern() {
    return {
      melody: new Array(STEPS).fill(null),   // null o {midi, accent}
      drums: {
        kick: zeros(), snare: zeros(), hat: zeros(), tom: zeros(), crash: zeros()
      },
      mute: { kick: false, snare: false, hat: false, tom: false, crash: false },
      gate: 0.5
    };
  }

  var state = {
    bpm: 90,
    swing: 0,
    patterns: [],
    current: 0,
    queued: null,
    song: false,
    chain: new Array(CHAIN).fill(null),
    chainPos: 0
  };
  for (var i = 0; i < PATTERNS; i++) state.patterns.push(makePattern());

  /* ---------- Contenido demo ---------- */
  function fillDemo() {
    var p0 = state.patterns[0];
    p0.melody[0] = { midi: 45, accent: true };   // A2
    p0.melody[3] = { midi: 48, accent: false };  // C3
    p0.melody[6] = { midi: 52, accent: false };  // E3
    p0.melody[8] = { midi: 50, accent: true };   // D3
    p0.melody[11] = { midi: 48, accent: false };
    p0.melody[14] = { midi: 45, accent: false };
    p0.drums.kick[0] = 2; p0.drums.kick[8] = 2;
    p0.drums.snare[4] = 1; p0.drums.snare[12] = 1;
    p0.drums.hat[1] = p0.drums.hat[3] = p0.drums.hat[5] = 1;
    p0.drums.hat[7] = p0.drums.hat[9] = p0.drums.hat[11] = 1;
    p0.drums.hat[13] = p0.drums.hat[15] = 1;
    p0.drums.crash[0] = 2;
    p0.gate = 0.5;

    var p1 = state.patterns[1];
    p1.melody[0] = { midi: 52, accent: true };   // E3
    p1.melody[5] = { midi: 55, accent: false };  // G3
    p1.melody[8] = { midi: 57, accent: true };   // A3
    p1.melody[10] = { midi: 55, accent: false };
    p1.melody[13] = { midi: 52, accent: false };
    p1.melody[15] = { midi: 50, accent: false };
    p1.drums.kick[0] = 2; p1.drums.kick[3] = 1; p1.drums.kick[6] = 1;
    p1.drums.kick[8] = 2; p1.drums.kick[11] = 1; p1.drums.kick[14] = 1;
    p1.drums.snare[4] = 2; p1.drums.snare[12] = 2;
    p1.drums.hat[1] = p1.drums.hat[3] = p1.drums.hat[5] = 1;
    p1.drums.hat[7] = p1.drums.hat[9] = p1.drums.hat[11] = 1;
    p1.drums.hat[13] = p1.drums.hat[15] = 1;
    p1.drums.crash[0] = 2;
    p1.gate = 0.5;

    state.chain[0] = 0; state.chain[1] = 0; state.chain[2] = 1;
    state.chain[3] = 0; state.chain[4] = 1; state.chain[5] = 1;
    state.chain[6] = 0; state.chain[7] = 0;
  }
  fillDemo();

  /* ---------- Reloj ---------- */
  function stepDur() { return 60 / state.bpm / 4; }

  function tick() {
    var c = root.Engine.getContext();
    if (!c) return;
    // si la pestaña se suspendió, reiniciar el reloj en vez de escupir
    // una ráfaga de pasos atrasados al recuperar el foco
    if (nextStepTime < c.currentTime - 0.25) nextStepTime = c.currentTime + 0.03;
    var dur = stepDur();
    var guard = 0;
    while (nextStepTime < c.currentTime + LOOKAHEAD && guard < 64) {
      schedule(step, nextStepTime);
      if (onStepCb) {
        (function (s, t) {
          setTimeout(function () { onStepCb(s); }, Math.max(0, (t - c.currentTime) * 1000));
        })(step, nextStepTime);
      }
      step++;
      if (step >= STEPS) { step = 0; if (!barEnd()) return; }
      nextStepTime += dur;
      guard++;
    }
  }

  function schedule(i, t) {
    var pat = state.patterns[state.current];
    var dur = stepDur();
    var toff = t + (i % 2 ? dur * state.swing / 100 : 0);
    var m = pat.melody[i];
    if (m) {
      var vel = m.accent ? 1 : 0.72;
      var gate = Math.max(0.05, pat.gate) * dur * (m.accent ? 1 : 0.9);
      root.Synth.noteOn(m.midi, vel, toff);
      root.Synth.noteOff(m.midi, toff + gate);
    }
    var rows = ['kick', 'snare', 'hat', 'tom', 'crash'];
    for (var r = 0; r < rows.length; r++) {
      var type = rows[r];
      var v = pat.drums[type][i];
      if (v && !pat.mute[type]) {
        root.Drums.play(type, toff, v === 2 ? 1 : 0.7);
      }
    }
  }

  /* devuelve false si hay que parar el secuenciador */
  function barEnd() {
    if (state.queued != null) {
      state.current = state.queued;
      state.queued = null;
      if (onPatternCb) onPatternCb(state.current);
    }
    if (state.song) {
      var n = nextChainPos();
      if (n === -1) { stop(); if (onStopCb) onStopCb(); return false; }
      state.chainPos = n;
      state.current = state.chain[n];
      if (onPatternCb) onPatternCb(state.current);
    }
    return true;
  }

  function nextChainPos() {
    var n = CHAIN;
    for (var k = 1; k <= n; k++) {
      var idx = (state.chainPos + k) % n;
      if (state.chain[idx] != null) return idx;
    }
    return -1;
  }

  function firstChainPos() {
    for (var i = 0; i < CHAIN; i++) if (state.chain[i] != null) return i;
    return -1;
  }

  /* ---------- Transporte ---------- */
  function play() {
    var c = root.Engine.getContext();
    if (!c || playing) return false;
    root.Engine.resume();
    if (state.song) {
      var f = firstChainPos();
      if (f === -1) return false;
      state.chainPos = f;
      state.current = state.chain[f];
      if (onPatternCb) onPatternCb(state.current);
    }
    step = 0;
    nextStepTime = c.currentTime + 0.08;
    playing = true;
    timer = setInterval(tick, INTERVAL);
    return true;
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    playing = false;
    state.queued = null;
    root.Synth.allNotesOff();
  }

  function toggle() { if (playing) { stop(); if (onStopCb) onStopCb(); } else { play(); } }

  /* ---------- Parámetros ---------- */
  function setBpm(b) {
    state.bpm = Math.max(40, Math.min(200, b));
    root.Engine.setBpm(state.bpm);
  }
  function setSwing(s) { state.swing = Math.max(0, Math.min(60, s)); }

  function selectPattern(i) {
    if (playing) { state.queued = i; if (onPatternCb) onPatternCb(state.current); }
    else { state.current = i; if (onPatternCb) onPatternCb(i); }
  }

  function setSong(on) {
    state.song = on;
    if (on) { var f = firstChainPos(); if (f !== -1) state.chainPos = f; }
    if (onSongCb) onSongCb(on);
  }

  function setGate(g) { state.patterns[state.current].gate = g; }

  function copyPattern() { clipboard = JSON.parse(JSON.stringify(state.patterns[state.current])); }

  function pastePattern() {
    if (!clipboard) return false;
    state.patterns[state.current] = JSON.parse(JSON.stringify(clipboard));
    return true;
  }

  function clearPattern() {
    var p = state.patterns[state.current];
    p.melody = new Array(STEPS).fill(null);
    var rows = ['kick', 'snare', 'hat', 'tom', 'crash'];
    rows.forEach(function (r) { p.drums[r] = zeros(); });
  }

  root.Sequencer = {
    state: state,
    STEPS: STEPS,
    PATTERNS: PATTERNS,
    CHAIN: CHAIN,
    rows: ['kick', 'snare', 'hat', 'tom', 'crash'],
    play: play,
    stop: stop,
    toggle: toggle,
    isPlaying: function () { return playing; },
    currentStep: function () { return step; },
    setBpm: setBpm,
    setSwing: setSwing,
    selectPattern: selectPattern,
    setSong: setSong,
    setGate: setGate,
    copyPattern: copyPattern,
    pastePattern: pastePattern,
    clearPattern: clearPattern,
    fillDemo: fillDemo,
    hooks: {
      onStep: function (cb) { onStepCb = cb; },
      onStop: function (cb) { onStopCb = cb; },
      onPattern: function (cb) { onPatternCb = cb; },
      onSong: function (cb) { onSongCb = cb; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
