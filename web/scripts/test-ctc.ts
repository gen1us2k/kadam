// Regression guard for the pure CTC math (ctc.ts) and silence trim (audio.ts).
// Run: `npm test` (needs Node >=23 for direct .ts execution).
//
// ctc-fixture.json holds real wav2vec2 logits for a synthesized Kyrgyz utterance plus the
// reference greedy transcript + per-letter GOP computed by the Python onnxruntime pipeline
// (scratchpad dump). The TS implementation must reproduce them to <1e-4.

import { readFileSync } from 'node:fs';
import { softmaxRows, greedyDecode, forcedAlignGop } from '../src/lib/ctc.ts';
import { trimSilence } from '../src/lib/audio.ts';

const fx = JSON.parse(readFileSync(new URL('./ctc-fixture.json', import.meta.url), 'utf8'));
const { frames, vocab, logits, vocabMap, blank, delimiter, targetIds, expectedGreedy, expectedGop, expectedPercent } = fx;

let fail = 0;
const check = (name: string, cond: boolean, got?: unknown, want?: unknown) => {
  if (!cond) {
    fail++;
    console.log('FAIL:', name, '| got', got, '| want', want);
  }
};

// --- CTC parity vs Python reference ---
const idToToken = new Map<number, string>();
for (const [tok, id] of Object.entries(vocabMap as Record<string, number>)) idToToken.set(id, tok);

const probs = softmaxRows(logits as number[], frames, vocab);
const greedy = greedyDecode(probs, frames, vocab, idToToken, blank, delimiter);
const gop = forcedAlignGop(probs, frames, vocab, targetIds as number[], blank);
const percent = Math.round((gop.reduce((a, b) => a + b, 0) / gop.length) * 100);

check('greedy transcript parity', greedy === expectedGreedy, greedy, expectedGreedy);
check('gop length parity', gop.length === (expectedGop as number[]).length);
let maxDiff = 0;
for (let i = 0; i < gop.length; i++) maxDiff = Math.max(maxDiff, Math.abs(gop[i] - (expectedGop as number[])[i]));
check('per-letter gop parity <1e-4', maxDiff < 1e-4, maxDiff);
check('percent parity', percent === expectedPercent, percent, expectedPercent);

// --- CTC edge cases (no crash, sane output) ---
check('empty target -> []', forcedAlignGop(probs, frames, vocab, [], blank).length === 0);
check('zero frames -> []', forcedAlignGop(probs, 0, vocab, targetIds as number[], blank).length === 0);
check('single-token target aligns', forcedAlignGop(probs, frames, vocab, [targetIds[0]], blank).length === 1);

// --- trimSilence ---
const rate = 16000;
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

console.log(`parity: greedy=${JSON.stringify(greedy)} percent=${percent} maxGopDiff=${maxDiff.toExponential(2)}`);
console.log(fail === 0 ? '\nALL TESTS PASSED' : `\n${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
