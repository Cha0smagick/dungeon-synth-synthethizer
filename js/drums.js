/* CRYPT FORGE DS-1 — Caja de ritmos sintetizada.
 * kick, snare, tom, hat, crash. Todo generado con osciladores y ruido:
 * cero samples, cero carga externa. Salida a master seco + envío de reverb.
 */
(function (root) {
  'use strict';

  var ROWS = ['kick', 'snare', 'tom', 'hat', 'crash'];

  function ctx() { return root.Engine.getContext(); }

  function noiseSrc(c) {
    var src = c.createBufferSource();
    src.buffer = root.Engine.sharedNoise();
    src.loop = true;
    return src;
  }

  function env(g, t, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  }

  function play(type, t, vel) {
    var c = ctx();
    if (!c) return;
    var sends = root.Engine.sends();
    vel = Math.max(0.1, Math.min(1, vel == null ? 1 : vel));
    var out = c.createGain();
    out.connect(sends.dry);
    out.connect(sends.reverb);

    function stopAll(nodes, end) {
      nodes.forEach(function (n) { try { n.stop(end); } catch (e) { /* ya parado */ } });
      setTimeout(function () {
        try { out.disconnect(); } catch (e) { /* ya desconectado */ }
      }, Math.max(0, (end - c.currentTime) * 1000) + 100);
    }

    var nodes = [];

    if (type === 'kick') {
      var o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
      var g = c.createGain();
      env(g, t, vel, 0.3);
      o.connect(g); g.connect(out);
      o.start(t); nodes.push(o);
      // click de ataque
      var n = noiseSrc(c);
      var hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1200;
      var ng = c.createGain();
      env(ng, t, vel * 0.22, 0.02);
      n.connect(hp); hp.connect(ng); ng.connect(out);
      n.start(t); nodes.push(n);
      stopAll(nodes, t + 0.35);

    } else if (type === 'snare') {
      var n2 = noiseSrc(c);
      var bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.8;
      var g2 = c.createGain();
      env(g2, t, vel * 0.9, 0.18);
      n2.connect(bp); bp.connect(g2); g2.connect(out);
      n2.start(t); nodes.push(n2);
      var body = c.createOscillator();
      body.type = 'triangle'; body.frequency.value = 190;
      var gb = c.createGain();
      env(gb, t, vel * 0.5, 0.09);
      body.connect(gb); gb.connect(out);
      body.start(t); nodes.push(body);
      stopAll(nodes, t + 0.25);

    } else if (type === 'tom') {
      var to = c.createOscillator();
      to.type = 'sine';
      to.frequency.setValueAtTime(220, t);
      to.frequency.exponentialRampToValueAtTime(95, t + 0.18);
      var gt = c.createGain();
      env(gt, t, vel * 0.9, 0.25);
      to.connect(gt); gt.connect(out);
      to.start(t); nodes.push(to);
      stopAll(nodes, t + 0.3);

    } else if (type === 'hat') {
      var nh = noiseSrc(c);
      var hh = c.createBiquadFilter();
      hh.type = 'highpass'; hh.frequency.value = 8200;
      var gh = c.createGain();
      env(gh, t, vel * 0.5, 0.055);
      nh.connect(hh); hh.connect(gh); gh.connect(out);
      nh.start(t); nodes.push(nh);
      stopAll(nodes, t + 0.1);

    } else if (type === 'crash') {
      var nc = noiseSrc(c);
      var hpc = c.createBiquadFilter();
      hpc.type = 'highpass'; hpc.frequency.value = 4200;
      var lpc = c.createBiquadFilter();
      lpc.type = 'lowpass'; lpc.frequency.value = 9500;
      var gc = c.createGain();
      env(gc, t, vel * 0.55, 1.3);
      nc.connect(hpc); hpc.connect(lpc); lpc.connect(gc); gc.connect(out);
      nc.start(t); nodes.push(nc);
      stopAll(nodes, t + 1.45);
    }
  }

  root.Drums = {
    play: play,
    ROWS: ROWS
  };
})(typeof window !== 'undefined' ? window : globalThis);
