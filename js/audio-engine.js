/* CRYPT FORGE DS-1 — Motor de audio.
 * Contexto, cadena master (drive/limitador/medidor), buses de reverb y delay,
 * suelo de hiso analógico, generador de IR de catedral y curvas de saturación.
 * Singleton en window.Engine.
 */
(function (root) {
  'use strict';

  var ctx = null;
  var nodes = {};
  var currentFx = { delDiv: 0.5 };
  var bpm = 90;
  var levelBuf = null;
  var levelOk = true;

  function getContext() { return ctx; }
  function now() { return ctx ? ctx.currentTime : 0; }

  function init() {
    if (ctx) return Promise.resolve(ctx);
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return Promise.reject(new Error('Este navegador no soporta Web Audio'));
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      return Promise.reject(e);
    }
    buildGraph();
    return Promise.resolve(ctx);
  }

  function resume() {
    if (ctx && ctx.state === 'suspended' && ctx.resume) return ctx.resume();
    return Promise.resolve();
  }

  /* ---------- Construcción de la cadena ---------- */
  function buildGraph() {
    // master
    var master = ctx.createGain();
    master.gain.value = currentFx.master != null ? currentFx.master : 0.8;

    // drive de cinta
    var drive = ctx.createWaveShaper();
    drive.curve = makeDriveCurve(0.15);
    try { drive.oversample = '4x'; } catch (e) { /* navegador sin oversample */ }

    // limitador suave
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;

    // medidor
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    try { levelBuf = new Float32Array(analyser.fftSize); }
    catch (e) { levelOk = false; }

    master.connect(drive);
    drive.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);

    // --- reverb: predelay -> convolver -> wet ---
    var revPre = ctx.createDelay(0.25);
    revPre.delayTime.value = 0.03;
    var convolver = ctx.createConvolver();
    convolver.normalize = true;
    convolver.buffer = makeIR(4.2, 2.6);
    var revWet = ctx.createGain();
    revWet.gain.value = 0.5;
    revPre.connect(convolver);
    convolver.connect(revWet);
    revWet.connect(master);

    // --- delay con amortiguación en el lazo ---
    var delay = ctx.createDelay(3.5);
    delay.delayTime.value = 0.3;
    var fb = ctx.createGain();
    fb.gain.value = 0.4;
    var damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 3000;
    var delWet = ctx.createGain();
    delWet.gain.value = 0.2;
    delay.connect(fb);
    fb.connect(damp);
    damp.connect(delay);
    delay.connect(delWet);
    delWet.connect(master);

    // --- hiso analógico ---
    var hissSrc = ctx.createBufferSource();
    hissSrc.buffer = makeNoise(2);
    hissSrc.loop = true;
    var hissG = ctx.createGain();
    hissG.gain.value = dbToGain(-60);
    hissSrc.connect(hissG);
    hissG.connect(master);
    hissSrc.start();

    nodes = {
      master: master, drive: drive, limiter: limiter, analyser: analyser,
      revPre: revPre, convolver: convolver, revWet: revWet,
      delay: delay, fb: fb, damp: damp, delWet: delWet,
      hiss: hissG
    };
  }

  /* ---------- Generadores ---------- */
  function makeNoise(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* IR estéreo oscura: ruido con decaimiento exponencial, filtro oscuro
     y algunas reflexiones tempranas discretas. */
  function makeIR(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(seconds * rate));
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var data = buf.getChannelData(c);
      var lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / rate;
        lp += ((Math.random() * 2 - 1) - lp) * 0.1;
        var env = Math.exp(-t * decay);
        var tap = 0;
        // reflexiones tempranas decorreladas por canal
        var taps = [[0.011, 0.6], [0.023, -0.45], [0.037, 0.35], [0.058, -0.25]];
        for (var k = 0; k < taps.length; k++) {
          var idx = Math.floor(taps[k][0] * rate) + (c === 1 ? 37 : 0);
          if (i === idx) tap += taps[k][1];
        }
        data[i] = (lp * 0.7 + tap) * env;
      }
      // fundido final para evitar clic
      var fade = Math.floor(rate * 0.05);
      for (var j = len - fade; j < len; j++) {
        if (j >= 0) data[j] *= (len - j) / fade;
      }
    }
    return buf;
  }

  function makeDriveCurve(amount) {
    var n = 1024;
    var curve = new Float32Array(n);
    var k = 1 + amount * 30;
    var norm = Math.tanh(k);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / norm;
    }
    return curve;
  }

  function dbToGain(db) { return Math.pow(10, db / 20); }

  /* ---------- Aplicación de parámetros ---------- */
  function sends() {
    return { dry: nodes.master, reverb: nodes.revPre, delay: nodes.delay };
  }

  function recTap() { return nodes.analyser; }

  function applyFx(fx) {
    currentFx = fx;
    if (!ctx) return;
    var t = ctx.currentTime;
    nodes.drive.curve = makeDriveCurve(fx.drive);
    nodes.revWet.gain.setTargetAtTime(fx.revSend, t, 0.02);
    nodes.revPre.delayTime.setTargetAtTime(Math.max(0, fx.revPre) / 1000, t, 0.02);
    nodes.delWet.gain.setTargetAtTime(fx.delSend, t, 0.02);
    nodes.fb.gain.setTargetAtTime(fx.delFb, t, 0.02);
    nodes.hiss.gain.setTargetAtTime(dbToGain(fx.hiss), t, 0.05);
    nodes.master.gain.setTargetAtTime(fx.master, t, 0.02);
    setDelayTime();
  }

  function setBpm(b) {
    bpm = b;
    if (ctx) setDelayTime();
  }

  function setDelayTime() {
    var beat = 60 / bpm;                 // negra
    var t = beat * currentFx.delDiv;     // la división ya es fracción de negra
    t = Math.max(0.02, Math.min(3.4, t));
    nodes.delay.delayTime.setTargetAtTime(t, ctx.currentTime, 0.05);
  }

  /* ---------- Medidor ---------- */
  function level() {
    if (!nodes.analyser || !levelOk) return { peak: 0, rms: 0 };
    try {
      nodes.analyser.getFloatTimeDomainData(levelBuf);
    } catch (e) {
      levelOk = false;
      return { peak: 0, rms: 0 };
    }
    var peak = 0, sum = 0;
    for (var i = 0; i < levelBuf.length; i++) {
      var a = Math.abs(levelBuf[i]);
      if (a > peak) peak = a;
      sum += levelBuf[i] * levelBuf[i];
    }
    return { peak: peak, rms: Math.sqrt(sum / levelBuf.length) };
  }

  function noiseBuffer() { return nodes.noiseCache; }

  root.Engine = {
    init: init,
    getContext: getContext,
    now: now,
    resume: resume,
    sends: sends,
    recTap: recTap,
    applyFx: applyFx,
    setBpm: setBpm,
    level: level,
    isReady: function () { return !!ctx; },
    /* buffer de ruido compartido (batería) */
    sharedNoise: function () {
      if (!nodes.noiseCache) nodes.noiseCache = makeNoise(1);
      return nodes.noiseCache;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
