/* CRYPT FORGE DS-1 — Codificador WAV PCM (16/24 bits, 1..N canales).
 * Función pura: recibe Float32Array por canal, devuelve ArrayBuffer.
 * Exposición en window.Wav para el navegador; en Node, test/wav.test.js
 * inyecta global.window = global antes de requerir este archivo.
 */
(function (root) {
  'use strict';

  function writeStr(view, offset, str) {
    for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  /* channels: array de Float32Array (todos del mismo largo) */
  function encode(channels, sampleRate, bitDepth) {
    if (!channels || !channels.length) throw new Error('Wav.encode: sin canales');
    bitDepth = bitDepth === 24 ? 24 : 16;
    var numCh = channels.length;
    var len = channels[0].length;
    for (var c = 1; c < numCh; c++) {
      if (channels[c].length !== len) throw new Error('Wav.encode: canales de distinto largo');
    }
    var bytesPer = bitDepth / 8;
    var blockAlign = numCh * bytesPer;
    var dataSize = len * blockAlign;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    writeStr(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, 'WAVE');
    writeStr(view, 12, 'fmt ');
    view.setUint32(16, 16, true);            // tamaño del chunk fmt
    view.setUint16(20, 1, true);             // PCM sin comprimir
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeStr(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    var offset = 44;
    for (var i = 0; i < len; i++) {
      for (var ch = 0; ch < numCh; ch++) {
        var s = channels[ch][i];
        if (!isFinite(s)) s = 0;             // NaN/Inf → silencio, nunca basura
        s = s > 1 ? 1 : (s < -1 ? -1 : s);
        if (bitDepth === 16) {
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          offset += 2;
        } else {
          var v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
          view.setUint8(offset, v & 0xff);
          view.setUint8(offset + 1, (v >> 8) & 0xff);
          view.setUint8(offset + 2, (v >> 16) & 0xff);
          offset += 3;
        }
      }
    }
    return buffer;
  }

  function download(buffer, filename) {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return null;
    var blob = new Blob([buffer], { type: 'audio/wav' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    return a;
  }

  root.Wav = { encode: encode, download: download };
})(typeof window !== 'undefined' ? window : globalThis);
