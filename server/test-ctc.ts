// Regression guard for the CTC math (ctc.ts): locked to the reference fixture exported from the
// original validated Python pipeline. Run: `npm test` (Node >=23 runs .ts directly).

import { readFileSync } from 'node:fs';
import { softmaxRows, greedyDecode, forcedAlignGop } from './ctc.ts';

const fx = JSON.parse(readFileSync(new URL('../web/scripts/ctc-fixture.json', import.meta.url), 'utf8'));
const { frames, vocab, logits, vocabMap, blank, delimiter, targetIds, expectedGreedy, expectedGop, expectedPercent } = fx;

let fail = 0;
const check = (name: string, cond: boolean, got?: unknown, want?: unknown) => {
  if (!cond) {
    fail++;
    console.log('FAIL:', name, '| got', got, '| want', want);
  }
};

const idToToken = new Map<number, string>();
for (const [tok, id] of Object.entries(vocabMap as Record<string, number>)) idToToken.set(id as number, tok);

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

check('empty target -> []', forcedAlignGop(probs, frames, vocab, [], blank).length === 0);
check('zero frames -> []', forcedAlignGop(probs, 0, vocab, targetIds as number[], blank).length === 0);
check('single-token target aligns', forcedAlignGop(probs, frames, vocab, [targetIds[0]], blank).length === 1);

console.log(`parity: greedy=${JSON.stringify(greedy)} percent=${percent} maxGopDiff=${maxDiff.toExponential(2)}`);
console.log(fail === 0 ? 'ALL TESTS PASSED' : `${fail} TEST(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
