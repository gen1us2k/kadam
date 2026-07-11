// Regression guard for the browser audio utilities (audio.ts): silence trim + WAV encoding.
// Run: `npm test` (needs Node >=23 for direct .ts execution).
// CTC math parity moved server-side with the model: server/test-ctc.ts locks server/ctc.ts to
// the same reference fixture (scripts/ctc-fixture.json).

import { trimSilence, encodeWav, vadDecision } from '../src/lib/audio.ts';

let fail = 0;
const check = (name: string, cond: boolean, got?: unknown, want?: unknown) => {
  if (!cond) {
    fail++;
    console.log('FAIL:', name, '| got', got, '| want', want);
  }
};

const rate = 16000;

// --- trimSilence ---
const sil = new Float32Array(rate);
const loud = new Float32Array(rate);
for (let i = 0; i < loud.length; i++) loud[i] = Math.sin(i * 0.1) * 0.5;
const trimmed = trimSilence(new Float32Array([...sil, ...loud, ...sil]), rate);
check('trim removes silence', trimmed.length < 3 * rate && trimmed.length >= rate, trimmed.length);
check('all-silence unchanged', trimSilence(sil, rate).length === sil.length);

// Regression: a loud click transient (button/mic pop) must NOT raise the gate above speech level.
// With a max-relative gate this trimmed a 2 s utterance down to the click alone (94% -> 33% bug).
const quiet = new Float32Array(2 * rate);
for (let i = 0; i < quiet.length; i++) quiet[i] = Math.sin(i * 0.1) * 0.05;
const click = new Float32Array(Math.round(0.03 * rate)).fill(0.9);
const clicky = trimSilence(new Float32Array([...click, ...sil, ...quiet, ...sil]), rate);
check('click does not eat speech', clicky.length >= quiet.length, clicky.length, quiet.length);

// --- encodeWav: header fields + sample roundtrip ---
const wave = Float32Array.from([0, 0.5, -0.5, 1, -1]);
const buf = encodeWav(wave, rate);
const v = new DataView(buf);
const str = (off: number, len: number) => String.fromCharCode(...new Uint8Array(buf, off, len));
check('RIFF magic', str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE');
check('total size', buf.byteLength === 44 + wave.length * 2, buf.byteLength);
check('PCM mono', v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1);
check('sample rate', v.getUint32(24, true) === rate);
check('16-bit', v.getUint16(34, true) === 16);
check('data size', v.getUint32(40, true) === wave.length * 2);
const s = (i: number) => v.getInt16(44 + i * 2, true);
check('zero sample', s(0) === 0);
check('half sample ~16383', Math.abs(s(1) - Math.round(0.5 * 0x7fff)) <= 1, s(1));
check('clip +1 -> 32767', s(3) === 0x7fff, s(3));
check('clip -1 -> -32768', s(4) === -0x8000, s(4));

// --- vadDecision (auto-stop state machine) ---
const V = (elapsedMs: number, sinceVoiceMs: number, speechStarted: boolean) =>
  vadDecision({ elapsedMs, sinceVoiceMs, speechStarted });
check('early, no speech -> keep', V(500, 500, false) === null);
check('no speech past 3s -> nospeech', V(3200, 3200, false) === 'nospeech');
check('speaking, short pause -> keep', V(2000, 400, true) === null);
check('speech then 0.9s+ silence -> endpoint', V(2000, 1000, true) === 'silence');
check('speaking continuously -> keep', V(2000, 0, true) === null);
check('max length with speech -> maxlen', V(11000, 200, true) === 'maxlen');
check('max length no speech -> nospeech', V(11000, 11000, false) === 'nospeech');

console.log(fail === 0 ? 'ALL TESTS PASSED' : `\n${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
