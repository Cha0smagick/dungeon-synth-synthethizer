/* CRYPT FORGE DS-1 — Interfaz.
 * Componente Knob (arrastre/rueda/teclado/reset), paneles de síntesis y FX,
 * teclado en pantalla + QWERTY + MIDI, secuenciador visual, presets,
 * persistencia localStorage, medidor y grabadora. Sin frameworks.
 */
(function (root) {
  'use strict';

  var Engine = root.Engine, Synth = root.Synth, Seq = root.Sequencer,
      Drums = root.Drums, Rec = root.Recorder, Wav = root.Wav;

  var $ = function (id) { return document.getElementById(id); };
  var NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var SCALES = {
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
    none: null
  };
  var STORE_KEY = 'cryptforge.state.v1';
  var PRESET_KEY = 'cryptforge.presets.v1';

  var state = {
    synth: Synth.defaults(),
    fx: fxDefaults(),
    ui: { root: 9, mode: 'aeolian', lock: true, paintNote: 9, paintOct: 3, bitDepth: 16 }
  };

  function fxDefaults() {
    return {
      drive: 0.15, revSend: 0.5, revPre: 30, delSend: 0.2, delDiv: 0.5,
      delFb: 0.4, hiss: -60, master: 0.8
    };
  }

  /* ---------- utilidades de ruta ---------- */
  function getPath(obj, path) {
    var ps = path.split('.'), o = obj;
    for (var i = 0; i < ps.length - 1; i++) { if (o == null) return undefined; o = o[ps[i]]; }
    return o == null ? undefined : o[ps[ps.length - 1]];
  }
  function setPath(obj, path, v) {
    var ps = path.split('.'), o = obj;
    for (var i = 0; i < ps.length - 1; i++) o = o[ps[i]];
    o[ps[ps.length - 1]] = v;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) { return Synth.merge(base, over); }
  function midiName(m) { return NOTES[m % 12] + (Math.floor(m / 12) - 1); }
  function inScale(m) {
    var sc = SCALES[state.ui.mode];
    if (!sc) return true;
    var d = ((m - state.ui.root) % 12 + 12) % 12;
    return sc.indexOf(d) >= 0;
  }

  /* ---------- persistencia ---------- */
  var saveTimer = null;
  function markDirty() {
    if (saveTimer) return;
    saveTimer = setTimeout(doSave, 500);
  }
  function doSave() {
    saveTimer = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1, synth: state.synth, fx: state.fx,
        bpm: Seq.state.bpm, swing: Seq.state.swing,
        patterns: Seq.state.patterns, chain: Seq.state.chain,
        song: Seq.state.song, current: Seq.state.current, ui: state.ui
      }));
    } catch (e) { /* almacenamiento no disponible: la app sigue */ }
  }
  function loadState() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { data = null; }
    if (!data || data.v !== 1) return false;
    if (data.synth && typeof data.synth === 'object') state.synth = merge(Synth.defaults(), data.synth);
    if (data.fx && typeof data.fx === 'object') state.fx = merge(fxDefaults(), data.fx);
    if (typeof data.bpm === 'number') Seq.setBpm(data.bpm);
    if (typeof data.swing === 'number') Seq.setSwing(data.swing);
    if (Array.isArray(data.patterns) && data.patterns.length === 8) {
      var ok = true;
      for (var i = 0; i < 8; i++) {
        var p = data.patterns[i];
        if (!p || !Array.isArray(p.melody) || p.melody.length !== 16 || !p.drums) { ok = false; break; }
      }
      if (ok) Seq.state.patterns = data.patterns;
    }
    if (Array.isArray(data.chain) && data.chain.length === 16) Seq.state.chain = data.chain;
    if (typeof data.song === 'boolean') Seq.state.song = data.song;
    if (typeof data.current === 'number' && data.current >= 0 && data.current < 8) Seq.state.current = data.current;
    if (data.ui && typeof data.ui === 'object') {
      for (var k in data.ui) if (Object.prototype.hasOwnProperty.call(data.ui, k)) state.ui[k] = data.ui[k];
    }
    return true;
  }

  /* ================= KNOB ================= */
  var knobs = {};

  function polar(cx, cy, r, deg) {
    var rad = deg * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }
  function arcPath(cx, cy, r, a0, a1) {
    var p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    var large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    return 'M ' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) +
      ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  function svgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    return el;
  }
  function fmtVal(v, unit) {
    var body;
    if (unit === 'Hz') body = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
    else if (unit === 'dB' || unit === 'ms') body = String(Math.round(v));
    else if (unit === 'c') body = (v > 0 ? '+' : '') + Math.round(v);
    else if (unit === 's') body = v.toFixed(2);
    else if (unit === '%') body = Math.round(v) + '%';
    else body = v >= 100 ? String(Math.round(v)) : v.toFixed(2);
    if (unit && unit !== 'c' && unit !== '%' && unit !== 'dB') return body + ' ' + unit;
    return body;
  }

  function Knob(slot, id, cb) {
    var min = parseFloat(slot.dataset.min);
    var max = parseFloat(slot.dataset.max);
    var def = parseFloat(slot.dataset.def);
    var step = slot.dataset.step ? parseFloat(slot.dataset.step) : 0;
    var curve = slot.dataset.curve || 'lin';
    var unit = slot.dataset.unit || '';
    var label = slot.dataset.label || '';
    var title = slot.title || '';
    var value = def;

    slot.classList.add('knob');
    slot.setAttribute('role', 'slider');
    slot.setAttribute('aria-label', label + (title ? ' — ' + title : ''));
    slot.setAttribute('aria-valuemin', min);
    slot.setAttribute('aria-valuemax', max);
    if (title) slot.title = title;

    var svg = svgEl('svg', { viewBox: '0 0 48 48', width: 44, height: 44 });
    var track = svgEl('path', { 'class': 'k-track', d: arcPath(24, 24, 17, 135, 405) });
    var val = svgEl('path', { 'class': 'k-val' });
    var dot = svgEl('line', { 'class': 'k-dot', x1: 24, y1: 24, x2: 24, y2: 8 });
    svg.appendChild(track); svg.appendChild(val); svg.appendChild(dot);
    var lab = document.createElement('span'); lab.className = 'k-label'; lab.textContent = label;
    var valEl = document.createElement('span'); valEl.className = 'k-value';
    slot.appendChild(svg); slot.appendChild(lab); slot.appendChild(valEl);

    function posToVal(p) {
      p = Math.max(0, Math.min(1, p));
      if (curve === 'log') {
        var lo = Math.log(Math.max(1e-6, min)), hi = Math.log(Math.max(1e-6, max));
        return Math.exp(lo + (hi - lo) * p);
      }
      return min + (max - min) * p;
    }
    function valToPos(v) {
      if (curve === 'log') {
        var lo = Math.log(Math.max(1e-6, min)), hi = Math.log(Math.max(1e-6, max));
        return (Math.log(Math.max(1e-6, v)) - lo) / (hi - lo);
      }
      return (v - min) / (max - min);
    }
    function render() {
      var p = valToPos(value);
      var a = 135 + 270 * p;
      if (p < 0.002) val.setAttribute('d', '');
      else val.setAttribute('d', arcPath(24, 24, 17, 135, a));
      var dp = polar(24, 24, 9.5, a);
      var dp2 = polar(24, 24, 17, a);
      dot.setAttribute('x1', dp[0].toFixed(2)); dot.setAttribute('y1', dp[1].toFixed(2));
      dot.setAttribute('x2', dp2[0].toFixed(2)); dot.setAttribute('y2', dp2[1].toFixed(2));
      valEl.textContent = fmtVal(value, unit);
      slot.setAttribute('aria-valuenow', value);
      slot.setAttribute('aria-valuetext', fmtVal(value, unit));
    }
    function set(v, silent) {
      if (step) v = Math.round(v / step) * step;
      v = Math.max(min, Math.min(max, v));
      value = v;
      render();
      if (!silent && cb) cb(v);
      return v;
    }

    // arrastre vertical
    var startY = 0, startPos = 0, dragging = false;
    slot.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startPos = valToPos(value);
      try { slot.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
    });
    slot.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dy = startY - e.clientY;
      if (e.shiftKey) dy *= 0.25;
      set(posToVal(startPos + dy / 220));
    });
    function endDrag() { dragging = false; }
    slot.addEventListener('pointerup', endDrag);
    slot.addEventListener('pointercancel', endDrag);
    slot.addEventListener('lostpointercapture', endDrag);

    // rueda
    slot.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dir = e.deltaY < 0 ? 1 : -1;
      set(posToVal(valToPos(value) + dir * (e.shiftKey ? 0.008 : 0.03)));
    }, { passive: false });

    // doble clic: reset
    slot.addEventListener('dblclick', function () { set(def); });

    // teclado
    slot.addEventListener('keydown', function (e) {
      var k = e.key, handled = true;
      if (k === 'ArrowUp' || k === 'ArrowRight') set(value + range() * (e.shiftKey ? 0.05 : 0.01));
      else if (k === 'ArrowDown' || k === 'ArrowLeft') set(value - range() * (e.shiftKey ? 0.05 : 0.01));
      else if (k === 'PageUp') set(value + range() * 0.1);
      else if (k === 'PageDown') set(value - range() * 0.1);
      else if (k === 'Home') set(min);
      else if (k === 'End') set(max);
      else handled = false;
      if (handled) e.preventDefault();
    });
    function range() { return max - min; }

    render();

    return {
      el: slot, set: set,
      value: function () { return value; },
      refresh: function (v) { set(v, true); }
    };
  }

  /* ---------- ruta de cambios ---------- */
  function currentValue(path) {
    if (path === 'swing') return Seq.state.swing;
    if (path.indexOf('fx.') === 0) return getPath(state.fx, path.slice(3));
    return getPath(state.synth, path);
  }
  function onKnobChange(path, v) {
    if (path === 'swing') { Seq.setSwing(v); markDirty(); return; }
    if (path.indexOf('fx.') === 0) {
      setPath(state.fx, path.slice(3), v);
      Engine.applyFx(state.fx);
      markDirty();
      return;
    }
    setPath(state.synth, path, v);
    markDirty();
  }

  function buildKnobs() {
    var slots = document.querySelectorAll('[data-knob]');
    Array.prototype.forEach.call(slots, function (slot) {
      var id = slot.dataset.knob;
      knobs[id] = new Knob(slot, id, function (v) { onKnobChange(id, v); });
    });
  }

  function buildSelects() {
    var sels = document.querySelectorAll('[data-select]');
    Array.prototype.forEach.call(sels, function (sel) {
      var path = sel.dataset.select;
      function cur() {
        if (path.indexOf('fx.') === 0) return String(getPath(state.fx, path.slice(3)));
        return String(getPath(state.synth, path));
      }
      function apply() {
        var v = sel.value;
        if (path === 'fx.delDiv') {
          setPath(state.fx, 'delDiv', parseFloat(v));
          Engine.applyFx(state.fx);
        } else {
          setPath(state.synth, path, v);
        }
        markDirty();
      }
      sel.addEventListener('change', apply);
      sel._refresh = cur;
    });
  }

  function refreshKnobs() {
    for (var id in knobs) if (Object.prototype.hasOwnProperty.call(knobs, id)) {
      knobs[id].refresh(currentValue(id));
    }
    var sels = document.querySelectorAll('[data-select]');
    Array.prototype.forEach.call(sels, function (sel) {
      if (sel._refresh) sel.value = sel._refresh();
    });
  }

  /* ================= TECLADO ================= */
  var KEYMAP = {
    'z': 48, 's': 49, 'x': 50, 'd': 51, 'c': 52, 'v': 53, 'g': 54, 'b': 55,
    'h': 56, 'n': 57, 'j': 58, 'm': 59, ',': 60,
    'q': 60, '2': 61, 'w': 62, '3': 63, 'e': 64, 'r': 65, '5': 66, 't': 67,
    'y': 68, '6': 69, 'u': 70, '7': 71, 'i': 72
  };
  var REVERSE = {};
  for (var km in KEYMAP) if (Object.prototype.hasOwnProperty.call(KEYMAP, km)) {
    var m2 = KEYMAP[km];
    // la fila Q tiene prioridad de etiqueta sobre la coma
    if (REVERSE[m2] == null || REVERSE[m2] === ',') REVERSE[m2] = km.toUpperCase();
  }
  var keyEls = {};
  var pressed = {};

  function buildKeyboard() {
    var kb = $('keyboard');
    kb.innerHTML = '';
    keyEls = {};
    var whiteIdx = 0;
    for (var m = 48; m <= 72; m++) {
      var pc = m % 12;
      var black = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
      var el = document.createElement('div');
      el.className = 'key ' + (black ? 'black' : 'white');
      el.dataset.midi = m;
      el.title = midiName(m);
      var lab = document.createElement('span');
      lab.className = 'klab';
      lab.textContent = REVERSE[m] || '';
      el.appendChild(lab);
      if (black) {
        el.style.left = (whiteIdx * 39 - 12) + 'px';
      } else {
        whiteIdx++;
      }
      kb.appendChild(el);
      keyEls[m] = el;
      (function (el2, m2) {
        el2.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          noteOnVisual(m2);
        });
        var off = function () { noteOffVisual(m2); };
        el2.addEventListener('pointerup', off);
        el2.addEventListener('pointerleave', off);
        el2.addEventListener('pointercancel', off);
      })(el, m);
    }
    refreshKeyScale();
  }

  function refreshKeyScale() {
    for (var m = 48; m <= 72; m++) {
      var el = keyEls[m];
      if (!el) continue;
      if (state.ui.lock && inScale(m)) el.classList.add('inscale');
      else el.classList.remove('inscale');
    }
    refreshPaletteScale();
  }

  function noteOnVisual(m) {
    if (pressed[m]) return;
    pressed[m] = true;
    Synth.noteOn(m, 0.8);
    var el = keyEls[m];
    if (el) el.classList.add('pressed');
  }
  function noteOffVisual(m) {
    if (!pressed[m]) return;
    pressed[m] = false;
    Synth.noteOff(m);
    var el = keyEls[m];
    if (el) el.classList.remove('pressed');
  }

  function wireQwerty() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        toggleTransport();
        return;
      }
      if (Object.prototype.hasOwnProperty.call(KEYMAP, k)) {
        e.preventDefault();
        noteOnVisual(KEYMAP[k]);
      }
    });
    document.addEventListener('keyup', function (e) {
      var k = e.key.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(KEYMAP, k)) noteOffVisual(KEYMAP[k]);
    });
  }

  function initMIDI() {
    if (!navigator.requestMIDIAccess) { $('audioState').textContent = 'audio: ' + (Engine.getContext() ? Engine.getContext().state : '—') + ' · MIDI no soportado'; return; }
    navigator.requestMIDIAccess().then(function (access) {
      var n = 0;
      access.inputs.forEach(function (input) {
        input.onmidimessage = function (e) {
          var d = e.data;
          if (!d || d.length < 2) return;
          var cmd = d[0] & 0xf0;
          if (cmd === 0x90 && d[2] > 0) Synth.noteOn(d[1], d[2] / 127);
          else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) Synth.noteOff(d[1]);
        };
        n++;
      });
      $('audioState').textContent = 'audio: ' + Engine.getContext().state + ' · MIDI (' + n + ')';
    }).catch(function () {
      $('audioState').textContent = 'audio: ' + Engine.getContext().state + ' · MIDI denegado';
    });
  }

  /* ================= PRESETS ================= */
  function customPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveCustomPresets(o) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(o)); } catch (e) { /* sin almacenamiento */ }
  }
  function allPresets() {
    var out = Synth.presets().map(function (p, i) {
      return { name: p.name, synth: p.synth, fx: p.fx, factory: true, index: i };
    });
    var cust = customPresets();
    for (var name in cust) if (Object.prototype.hasOwnProperty.call(cust, name)) {
      out.push({ name: name, synth: cust[name].synth, fx: cust[name].fx, factory: false });
    }
    return out;
  }
  function refreshPresetSelect(selectName) {
    var sel = $('presetSelect');
    var list = allPresets();
    sel.innerHTML = '';
    list.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    if (selectName) sel.value = selectName;
  }
  function loadPreset(name) {
    var list = allPresets();
    var p = null;
    for (var i = 0; i < list.length; i++) if (list[i].name === name) p = list[i];
    if (!p) return;
    state.synth = merge(Synth.defaults(), p.synth);
    state.fx = merge(fxDefaults(), p.fx);
    Engine.applyFx(state.fx);
    Synth.setParams(state.synth);
    refreshKnobs();
    markDirty();
  }

  /* ================= ESCALA ================= */
  function buildScale() {
    var root = $('rootSelect');
    root.innerHTML = '';
    NOTES.forEach(function (n, i) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = n;
      root.appendChild(o);
    });
    root.value = String(state.ui.root);
    root.addEventListener('change', function () {
      state.ui.root = parseInt(root.value, 10);
      refreshKeyScale(); markDirty();
    });
    var mode = $('modeSelect');
    mode.value = state.ui.mode;
    mode.addEventListener('change', function () {
      state.ui.mode = mode.value;
      refreshKeyScale(); markDirty();
    });
    var lock = $('scaleLock');
    lock.checked = !!state.ui.lock;
    lock.addEventListener('change', function () {
      state.ui.lock = lock.checked;
      refreshKeyScale(); markDirty();
    });
  }

  /* ================= PALETA DE NOTAS ================= */
  function paintMidi() { return (state.ui.paintOct + 1) * 12 + state.ui.paintNote; }

  function buildPalette() {
    var pal = $('palNotes');
    pal.innerHTML = '';
    NOTES.forEach(function (n, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = n;
      b.dataset.pc = String(i);
      b.title = 'Pintar ' + n;
      b.addEventListener('click', function () {
        state.ui.paintNote = i;
        refreshPaletteScale(); markDirty();
      });
      pal.appendChild(b);
    });
    $('palOct').textContent = String(state.ui.paintOct);
    Array.prototype.forEach.call(document.querySelectorAll('.pal-oct .oct'), function (b) {
      b.addEventListener('click', function () {
        state.ui.paintOct = Math.max(0, Math.min(7, state.ui.paintOct + parseInt(b.dataset.oct, 10)));
        $('palOct').textContent = String(state.ui.paintOct);
        markDirty();
      });
    });
    refreshPaletteScale();
  }
  function refreshPaletteScale() {
    var btns = $('palNotes').children;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      b.classList.toggle('active', parseInt(b.dataset.pc, 10) === state.ui.paintNote);
      var m = (state.ui.paintOct + 1) * 12 + parseInt(b.dataset.pc, 10);
      b.classList.toggle('offkey', state.ui.lock && !inScale(m));
    }
  }

  /* ================= SECUENCIADOR VISUAL ================= */
  var melodyCells = [];
  var drumCells = {};
  var chainSlot = null;
  var paintDown = false;

  function buildSequencer() {
    // LEDs de paso
    var leds = $('stepLeds');
    leds.innerHTML = '';
    for (var i = 0; i < 16; i++) {
      var l = document.createElement('div');
      l.className = 'led' + (i % 4 === 0 ? ' beat' : '');
      leds.appendChild(l);
    }
    // botones de patrón
    var pb = $('patButtons');
    pb.innerHTML = '';
    for (var p = 0; p < 8; p++) {
      (function (idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(idx + 1);
        b.title = 'Patrón ' + (idx + 1) + (chainSlot != null ? ' — asignar a la ranura de canción' : ' — clic: seleccionar / encolar');
        b.addEventListener('click', function () { pressPattern(idx); });
        pb.appendChild(b);
      })(p);
    }
    // fila de melodía
    var mr = $('melodyRow');
    mr.innerHTML = '';
    melodyCells = [];
    var spacer = document.createElement('div');
    mr.appendChild(spacer);
    for (var s = 0; s < 16; s++) {
      (function (i) {
        var c = document.createElement('div');
        c.className = 'cell' + (i % 4 === 0 ? ' beat' : '');
        c.dataset.i = String(i);
        c.title = 'Paso ' + (i + 1) + ' — clic: pintar ' + ' · Mayús+clic: acento · clic derecho: borrar';
        c.addEventListener('pointerdown', function (e) {
          if (e.button === 2) return;
          paintDown = true;
          paintMelodyCell(c, e);
        });
        c.addEventListener('pointerenter', function (e) {
          if (paintDown) paintMelodyCell(c, e);
        });
        c.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          var pat = Seq.state.patterns[Seq.state.current];
          pat.melody[i] = null;
          renderMelody(); markDirty();
        });
        mr.appendChild(c);
        melodyCells.push(c);
      })(s);
    }
    window.addEventListener('pointerup', function () { paintDown = false; });

    // cabecera de batería
    $('drumHead').innerHTML = '<span class="tb-label">BATERÍA <em>clic: silenciar fila</em></span>' +
      '<span class="tb-label" style="margin-left:auto">pasos: on · Mayús: acento · clic der: borrar</span>';

    // rejilla de batería
    var dg = $('drumGrid');
    dg.innerHTML = '';
    drumCells = {};
    Seq.rows.forEach(function (type) {
      var row = document.createElement('div');
      row.className = 'drow';
      var lab = document.createElement('div');
      lab.className = 'dlabel';
      lab.textContent = type.toUpperCase();
      lab.title = type + ' — clic para silenciar/activar la fila';
      lab.addEventListener('click', function () {
        var pat = Seq.state.patterns[Seq.state.current];
        pat.mute[type] = !pat.mute[type];
        renderDrums(); markDirty();
      });
      row.appendChild(lab);
      drumCells[type] = [];
      for (var i = 0; i < 16; i++) {
        (function (t, idx) {
          var c = document.createElement('div');
          c.className = 'cell' + (idx % 4 === 0 ? ' beat' : '');
          c.addEventListener('pointerdown', function (e) {
            if (e.button === 2) return;
            paintDrumCell(t, idx, e.shiftKey);
          });
          c.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            Seq.state.patterns[Seq.state.current].drums[t][idx] = 0;
            renderDrums(); markDirty();
          });
          row.appendChild(c);
          drumCells[t].push(c);
        })(type, i);
      }
      dg.appendChild(row);
    });

    // cadena de canción
    var cr = $('chainRow');
    cr.innerHTML = '';
    for (var j = 0; j < 16; j++) {
      (function (i) {
        var c = document.createElement('div');
        c.className = 'cell';
        c.title = 'Ranura ' + (i + 1) + ' — clic: armar · clic derecho: vaciar';
        c.addEventListener('click', function () {
          chainSlot = (chainSlot === i) ? null : i;
          renderChain(); renderPatternButtons();
        });
        c.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          Seq.state.chain[i] = null;
          renderChain(); markDirty();
        });
        cr.appendChild(c);
      })(j);
    }

    // toolbar
    $('btnPatCopy').addEventListener('click', function () { Seq.copyPattern(); });
    $('btnPatPaste').addEventListener('click', function () { Seq.pastePattern(); renderAll(); markDirty(); });
    $('btnPatClear').addEventListener('click', function () { Seq.clearPattern(); renderAll(); markDirty(); });
    $('btnSong').addEventListener('click', function () {
      Seq.setSong(!Seq.state.song);
      renderPatternButtons(); markDirty();
    });
    $('gateSelect').addEventListener('change', function () {
      Seq.setGate(parseFloat($('gateSelect').value));
      markDirty();
    });
  }

  function pressPattern(idx) {
    if (chainSlot != null) {
      Seq.state.chain[chainSlot] = idx;
      chainSlot = (chainSlot + 1) % 16;
      renderChain(); renderPatternButtons(); markDirty();
      return;
    }
    Seq.selectPattern(idx);
    renderPatternButtons();
  }

  function paintMelodyCell(c, e) {
    var i = parseInt(c.dataset.i, 10);
    var pat = Seq.state.patterns[Seq.state.current];
    var midi = paintMidi();
    var cur = pat.melody[i];
    if (e.shiftKey) {
      if (cur) pat.melody[i] = { midi: cur.midi, accent: !cur.accent };
      else pat.melody[i] = { midi: midi, accent: true };
    } else if (cur && cur.midi === midi && !cur.accent) {
      pat.melody[i] = null;
    } else {
      pat.melody[i] = { midi: midi, accent: !!(cur && cur.accent) };
    }
    renderMelody();
    markDirty();
  }

  function paintDrumCell(type, i, accent) {
    var pat = Seq.state.patterns[Seq.state.current];
    pat.drums[type][i] = accent ? 2 : (pat.drums[type][i] ? 0 : 1);
    renderDrums();
    markDirty();
  }

  function renderMelody() {
    var pat = Seq.state.patterns[Seq.state.current];
    $('melodyInfo').textContent = 'pintar: ' + midiName(paintMidi());
    for (var i = 0; i < 16; i++) {
      var c = melodyCells[i];
      var m = pat.melody[i];
      c.textContent = m ? midiName(m.midi) : '·';
      c.classList.toggle('on', !!m);
      c.classList.toggle('accent', !!(m && m.accent));
      c.classList.toggle('inscale', !!m && state.ui.lock && inScale(m.midi));
    }
    $('gateSelect').value = String(pat.gate);
  }

  function renderDrums() {
    var pat = Seq.state.patterns[Seq.state.current];
    Seq.rows.forEach(function (type) {
      var labels = $('drumGrid').querySelectorAll('.dlabel');
      var rowIdx = Seq.rows.indexOf(type);
      if (labels[rowIdx]) {
        labels[rowIdx].classList.toggle('muted', !!pat.mute[type]);
        var tag = labels[rowIdx].querySelector('.mtag');
        if (!tag && pat.mute[type]) {
          tag = document.createElement('span');
          tag.className = 'mtag';
          tag.textContent = 'MUTE';
          labels[rowIdx].appendChild(tag);
        } else if (tag && !pat.mute[type]) {
          tag.remove();
        }
      }
      for (var i = 0; i < 16; i++) {
        var c = drumCells[type][i];
        var v = pat.drums[type][i];
        c.classList.toggle('on', v === 1);
        c.classList.toggle('accent', v === 2);
      }
    });
  }

  function renderChain() {
    var cr = $('chainRow');
    for (var i = 0; i < 16; i++) {
      var c = cr.children[i];
      var v = Seq.state.chain[i];
      c.textContent = v == null ? '–' : String(v + 1);
      c.classList.toggle('set', v != null);
      c.classList.toggle('sel', chainSlot === i);
      c.classList.toggle('current', Seq.state.song && Seq.state.chainPos === i);
    }
  }

  function renderPatternButtons() {
    var pb = $('patButtons').children;
    for (var i = 0; i < 8; i++) {
      pb[i].classList.toggle('active', Seq.state.current === i);
      pb[i].classList.toggle('queued', Seq.state.queued === i);
    }
    $('btnSong').classList.toggle('active', Seq.state.song);
  }

  function renderAll() {
    renderMelody(); renderDrums(); renderChain(); renderPatternButtons();
  }

  /* ---------- transporte y cabecera ---------- */
  function toggleTransport() {
    Seq.toggle();
    $('btnPlay').classList.toggle('playing', Seq.isPlaying());
    renderPatternButtons();
  }

  function wireTransport() {
    $('btnPlay').addEventListener('click', toggleTransport);
    var bpm = $('bpm');
    bpm.value = String(Seq.state.bpm);
    bpm.addEventListener('change', function () {
      var v = parseInt(bpm.value, 10);
      if (isNaN(v)) v = 90;
      Seq.setBpm(v);
      bpm.value = String(Seq.state.bpm);
      markDirty();
    });
    Seq.hooks.onStop(function () {
      $('btnPlay').classList.remove('playing');
      setStep(-1);
      renderPatternButtons();
    });
    Seq.hooks.onPattern(function () { renderPatternButtons(); renderChain(); });
    Seq.hooks.onSong(function () { renderChain(); });
    Seq.hooks.onStep(function (step) { setStep(step); });
  }

  function setStep(step) {
    var leds = $('stepLeds').children;
    for (var i = 0; i < 16; i++) leds[i].classList.toggle('on', i === step);
    for (var j = 0; j < 16; j++) {
      melodyCells[j].classList.toggle('playhead', j === step);
      Seq.rows.forEach(function (t) { drumCells[t][j].classList.toggle('playhead', j === step); });
    }
  }

  /* ---------- grabadora ---------- */
  function wireRecorder() {
    $('btnRec').addEventListener('click', function () {
      if (Rec.isRecording()) {
        Rec.stop().then(function () {
          $('btnRec').classList.remove('recording');
          $('btnExport').disabled = false;
          $('recTime').textContent = 'listo';
        });
      } else {
        Rec.start().then(function () {
          $('btnRec').classList.add('recording');
          $('btnExport').disabled = true;
          $('recTime').textContent = '● 00:00.0';
        }).catch(function (err) {
          $('recTime').textContent = 'error: ' + (err && err.message ? err.message : 'no audio');
        });
      }
    });
    $('btnExport').addEventListener('click', function () {
      var d = new Date();
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      var name = 'cryptforge_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
        '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.wav';
      $('btnExport').disabled = true;
      Rec.exportWav(parseInt($('bitDepth').value, 10), name).then(function (res) {
        $('recTime').textContent = res ? ('WAV ' + (res.bytes / 1048576).toFixed(1) + ' MB') : 'sin datos';
      });
    });
    $('bitDepth').addEventListener('change', function () {
      state.ui.bitDepth = parseInt($('bitDepth').value, 10);
      markDirty();
    });
    Rec.hooks.onTime(function (s, warn) {
      if (!Rec.isRecording()) return;
      var mm = Math.floor(s / 60), ss = (s % 60).toFixed(1);
      $('recTime').textContent = '● ' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss + (warn ? ' ⚠' : '');
    });
  }

  /* ---------- medidor ---------- */
  function startMeter() {
    var cv = $('meter');
    var c2d = cv.getContext('2d');
    var peak = 0, peakHold = 0;
    function frame() {
      var lv = Engine.level();
      var w = cv.width, h = cv.height;
      c2d.clearRect(0, 0, w, h);
      // rms
      c2d.fillStyle = '#262a31';
      c2d.fillRect(0, 0, w, h);
      c2d.fillStyle = '#8a6526';
      c2d.fillRect(0, h * 0.55, w * Math.min(1, lv.rms * 1.4), h * 0.35);
      // pico
      c2d.fillStyle = lv.peak > 0.95 ? '#c0392b' : '#d9a044';
      c2d.fillRect(0, h * 0.1, w * Math.min(1, lv.peak), h * 0.35);
      peak = Math.max(lv.peak, peak * 0.94);
      c2d.fillStyle = 'rgba(217,160,68,.5)';
      c2d.fillRect(w * Math.min(1, peak) - 1, h * 0.1, 2, h * 0.35);
      peakHold = peak;
      // voces
      $('voiceInfo').textContent = 'voces: ' + Synth.activeCount();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ================= ARRANQUE ================= */
  function buildUI() {
    buildKnobs();
    buildSelects();
    buildScale();
    buildPalette();
    buildKeyboard();
    buildSequencer();
    wireQwerty();
    wireTransport();
    wireRecorder();
    refreshPresetSelect();
    $('presetSelect').addEventListener('change', function () { loadPreset($('presetSelect').value); });
    $('btnPresetSave').addEventListener('click', function () {
      var name = prompt('Nombre del preset:', 'Mi sonido ' + (Object.keys(customPresets()).length + 1));
      if (!name) return;
      var cust = customPresets();
      cust[name] = { synth: clone(state.synth), fx: clone(state.fx) };
      saveCustomPresets(cust);
      refreshPresetSelect(name);
    });
    $('btnPresetDel').addEventListener('click', function () {
      var name = $('presetSelect').value;
      var cust = customPresets();
      if (!cust[name]) return;
      delete cust[name];
      saveCustomPresets(cust);
      refreshPresetSelect();
      loadPreset($('presetSelect').value || Synth.presets()[0].name);
    });
  }

  function enterConsole() {
    $('audio-gate').hidden = true;   // + regla [hidden] !important en CSS
    $('app').hidden = false;
  }

  function boot() {
    $('btnGate').textContent = 'ABRIENDO…';
    Engine.init().then(function () {
      enterConsole();
      var c = Engine.getContext();
      $('audioState').textContent = 'audio: ' + c.state;
      initMIDI();
      startMeter();
      var cv = $('meter');
      cv.width = (cv.clientWidth || 220) * 2;
      cv.height = 34 * 2;
    }).catch(function (err) {
      // incluso si el audio falla, la consola se muestra: el error va al pie
      console.error('[CryptForge] audio init fallo', err);
      enterConsole();
      $('audioState').textContent = 'audio: ERROR — ' + (err && err.message ? err.message : 'no disponible');
    });
  }

  /* El listener se engancha PRIMERO: si la construcción de la UI fallara,
     el botón sigue vivo y el error queda en consola en vez de un velo mudo. */
  $('btnGate').addEventListener('click', boot);

  try {
    /* estado inicial + UI (la puerta del audio se abre con gesto humano) */
    var hadState = loadState();
    Synth.setParams(state.synth);
    Engine.applyFx(state.fx);
    Engine.setBpm(Seq.state.bpm);
    buildUI();
    refreshKnobs();
    renderAll();
    if (!hadState) loadPreset(Synth.presets()[0].name);
  } catch (e) {
    console.error('[CryptForge] init fallo', e);
    $('btnGate').textContent = 'ERROR DE INICIO (revisa consola F12)';
  }

  root.CryptUI = { state: state, refreshAll: refreshKnobs };
})(typeof window !== 'undefined' ? window : globalThis);
