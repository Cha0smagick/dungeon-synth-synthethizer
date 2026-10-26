/* Test del codificador WAV — ejecutar: node test/wav.test.js */
'use strict';
global.window = global; // wav.js se engancha a window/Wav
require('../js/wav.js');

var assert = require('assert');
var Wav = global.Wav;

function readStr(view, off, len) {
  var s = '';
  for (var i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
  return s;
}

// --- Caso 1: mono 16-bit, 4 muestras -------------------------------------
var ch = [new Float32Array([0, 0.5, -0.5, 1])];
var buf = Wav.encode(ch, 44100, 16);
var v = new DataView(buf);

assert.strictEqual(buf.byteLength, 44 + 4 * 2, 'tamaño total mono 16-bit');
assert.strictEqual(readStr(v, 0, 4), 'RIFF');
assert.strictEqual(readStr(v, 8, 4), 'WAVE');
assert.strictEqual(readStr(v, 12, 4), 'fmt ');
assert.strictEqual(v.getUint32(16, true), 16, 'chunk fmt = 16');
assert.strictEqual(v.getUint16(20, true), 1, 'formato PCM');
assert.strictEqual(v.getUint16(22, true), 1, 'mono');
assert.strictEqual(v.getUint32(24, true), 44100, 'sample rate');
assert.strictEqual(v.getUint32(28, true), 44100 * 2, 'byte rate');
assert.strictEqual(v.getUint16(32, true), 2, 'block align');
assert.strictEqual(v.getUint16(34, true), 16, 'bit depth');
assert.strictEqual(readStr(v, 36, 4), 'data');
assert.strictEqual(v.getUint32(40, true), 8, 'data size');
assert.strictEqual(v.getUint32(4, true), 36 + 8, 'RIFF size');

assert.strictEqual(v.getInt16(44, true), 0);
assert.ok(Math.abs(v.getInt16(46, true) - 16383) <= 1, '0.5 ≈ 16383/16384');
assert.strictEqual(v.getInt16(48, true), -16384);
assert.strictEqual(v.getInt16(50, true), 32767, 'pico positivo');

// --- Caso 2: estéreo 24-bit ----------------------------------------------
var L = new Float32Array([0, 1, -1]);
var R = new Float32Array([0, -1, 1]);
var buf2 = Wav.encode([L, R], 48000, 24);
var v2 = new DataView(buf2);
assert.strictEqual(buf2.byteLength, 44 + 3 * 2 * 3, 'tamaño total stereo 24-bit');
assert.strictEqual(v2.getUint16(22, true), 2, 'estéreo');
assert.strictEqual(v2.getUint16(34, true), 24, '24 bits');
assert.strictEqual(v2.getUint16(32, true), 6, 'block align stereo 24-bit');
// frame = 2 canales x 3 bytes = 6. Muestra 1, canal L (1.0) → 0x7fffff LE en 44 + 1*6
assert.strictEqual(v2.getUint8(44 + 6), 0xff);
assert.strictEqual(v2.getUint8(44 + 7), 0xff);
assert.strictEqual(v2.getUint8(44 + 8), 0x7f);
// muestra 1, canal R (-1.0) → 0x800000 LE (00 00 80)
assert.strictEqual(v2.getUint8(44 + 9), 0x00);
assert.strictEqual(v2.getUint8(44 + 10), 0x00);
assert.strictEqual(v2.getUint8(44 + 11), 0x80);
// muestra 0, canal R (0.0) → silencio
assert.strictEqual(v2.getUint8(44 + 3), 0x00);

// --- Caso 3: robustez (NaN, clipping, bitDepth inválido) ------------------
var junk = [new Float32Array([NaN, 2, -2])];
var buf3 = Wav.encode(junk, 44100, 16);
var v3 = new DataView(buf3);
assert.strictEqual(v3.getInt16(44, true), 0, 'NaN → silencio');
assert.strictEqual(v3.getInt16(46, true), 32767, 'clip +2 → pico');
assert.strictEqual(v3.getInt16(48, true), -32768, 'clip -2 → valle');
var buf4 = Wav.encode(junk, 44100, 7); // profundidad inválida cae a 16
assert.strictEqual(buf4.byteLength, 44 + 3 * 2);

// --- Caso 4: error si no hay canales --------------------------------------
assert.throws(function () { Wav.encode([], 44100, 16); });

console.log('wav.test.js — 4/4 casos OK');
