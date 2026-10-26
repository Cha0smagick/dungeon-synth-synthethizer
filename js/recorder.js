/* CRYPT FORGE DS-1 — Grabadora de la salida maestra a WAV.
 * AudioWorklet de captura (código embebido por Blob URL) con degradación
 * gracefully a ScriptProcessorNode si el worklet no carga (p. ej. file://).
 */
(function (root) {
  'use strict';

  var WORKLET_SRC = [
    'class CaptureProcessor extends AudioWorkletProcessor {',
    '  constructor() {',
    '    super();',
    '    this.recording = false;',
    '    this.buffers = [];',
    '    this.port.onmessage = (e) => {',
    "      var d = e.data || {};",
    "      if (d.type === 'rec') this.recording = true;",
    "      if (d.type === 'reset') this.buffers = [];",
    "      if (d.type === 'stop') { this.recording = false; this.flush(); }",
    '    };',
    '  }',
    '  process(inputs) {',
    '    var input = inputs[0];',
    '    if (input && input.length && this.recording) {',
    '      for (var c = 0; c < input.length; c++) {',
    '        var copy = new Float32Array(input[c]);',
    '        if (!this.buffers[c]) this.buffers[c] = [];',
    '        this.buffers[c].push(copy);',
    '      }',
    '    }',
    '    return true;',
    '  }',
    '  flush() {',
    '    var chans = [];',
    '    for (var c = 0; c < this.buffers.length; c++) {',
    '      var parts = this.buffers[c];',
    '      var len = 0;',
    '      for (var i = 0; i < parts.length; i++) len += parts[i].length;',
    '      var out = new Float32Array(len);',
    '      var o = 0;',
    '      for (var j = 0; j < parts.length; j++) { out.set(parts[j], o); o += parts[j].length; }',
    '      chans.push(out);',
    '    }',
    '    this.buffers = [];',
    '    var transfer = [];',
    '    for (var t = 0; t < chans.length; t++) transfer.push(chans[t].buffer);',
    '    this.port.postMessage({ type: "data", channels: chans }, transfer);',
    '  }',
    '}',
    "registerProcessor('capture-processor', CaptureProcessor);"
  ].join('\n');

  var node = null;
  var spn = null;
  var zeroGain = null;
  var recording = false;
  var spBuf = [];
  var startedAt = 0;
  var timerId = null;
  var pendingResolve = null;
  var onTimeCb = null;
  var warned300 = false;

  function ensure() {
    var c = root.Engine.getContext();
    if (!c) return Promise.reject(new Error('Audio no iniciado'));
    if (node || spn) return Promise.resolve();

    if (c.audioWorklet && c.audioWorklet.addModule) {
      var blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      return c.audioWorklet.addModule(url).then(function () {
        URL.revokeObjectURL(url);
        buildWorklet(c);
      }).catch(function () {
        URL.revokeObjectURL(url);
        buildLegacy(c); // file:// u origen sin módulos: degradación
      });
    }
    return Promise.resolve(buildLegacy(c));
  }

  function buildWorklet(c) {
    node = new AudioWorkletNode(c, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    node.channelCount = 2;
    node.channelCountMode = 'explicit';
    zeroGain = c.createGain();
    zeroGain.gain.value = 0;
    node.connect(zeroGain);
    zeroGain.connect(c.destination);
    root.Engine.recTap().connect(node);
    node.port.onmessage = function (e) {
      var d = e.data || {};
      if (d.type === 'data' && pendingResolve) {
        var res = pendingResolve;
        pendingResolve = null;
        res(d.channels || []);
      }
    };
  }

  function buildLegacy(c) {
    spn = c.createScriptProcessor(4096, 2, 2);
    zeroGain = c.createGain();
    zeroGain.gain.value = 0;
    spn.connect(zeroGain);
    zeroGain.connect(c.destination);
    root.Engine.recTap().connect(spn);
    spn.onaudioprocess = function (e) {
      if (!recording) return;
      var ib = e.inputBuffer;
      for (var ch = 0; ch < ib.numberOfChannels; ch++) {
        var data = ib.getChannelData(ch);
        var copy = new Float32Array(data);
        if (!spBuf[ch]) spBuf[ch] = [];
        spBuf[ch].push(copy);
      }
    };
  }

  function start() {
    return ensure().then(function () {
      if (recording) return 'already';
      if (node) {
        node.port.postMessage({ type: 'reset' });
        node.port.postMessage({ type: 'rec' });
      } else {
        spBuf = [];
      }
      recording = true;
      startedAt = Date.now();
      warned300 = false;
      timerId = setInterval(tickTime, 100);
      return 'started';
    });
  }

  function stop() {
    if (!recording) return Promise.resolve(null);
    recording = false;
    if (timerId) { clearInterval(timerId); timerId = null; }
    var ms = Date.now() - startedAt;
    if (node) {
      return new Promise(function (res) {
        pendingResolve = res;
        node.port.postMessage({ type: 'stop' });
      }).then(function (channels) {
        return { channels: channels, ms: ms };
      });
    }
    // legacy: concatenar en el hilo principal
    var chans = [];
    for (var ch = 0; ch < spBuf.length; ch++) {
      var parts = spBuf[ch] || [];
      var len = 0;
      for (var i = 0; i < parts.length; i++) len += parts[i].length;
      var out = new Float32Array(len);
      var o = 0;
      for (var j = 0; j < parts.length; j++) { out.set(parts[j], o); o += parts[j].length; }
      chans.push(out);
    }
    spBuf = [];
    return Promise.resolve({ channels: chans, ms: ms });
  }

  function tickTime() {
    if (!recording || !onTimeCb) return;
    var s = (Date.now() - startedAt) / 1000;
    onTimeCb(s);
    if (!warned300 && s > 300) { warned300 = true; onTimeCb(s, true); }
  }

  function exportWav(bitDepth, filename) {
    return stop().then(function (result) {
      if (!result || !result.channels || !result.channels.length) return null;
      var c = root.Engine.getContext();
      var buffer = root.Wav.encode(result.channels, c.sampleRate, bitDepth || 16);
      root.Wav.download(buffer, filename);
      return { bytes: buffer.byteLength, ms: result.ms, channels: result.channels.length };
    });
  }

  root.Recorder = {
    start: start,
    stop: stop,
    exportWav: exportWav,
    isRecording: function () { return recording; },
    hooks: { onTime: function (cb) { onTimeCb = cb; } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
