// Regression guard for the TTS frontend helpers (tts.ts): token parsing, MMS tokenization
// (add_blank interleave), and WAV encoding. Locked to the real tokens.txt shipped with the model.
// Run: `npm test` (Node >=23 runs .ts directly).

import { readFileSync } from 'node:fs';
import { parseTokens, tokenize, encodeWav } from './tts.ts';
import { createChecker } from './test-util.ts';

const { check, done } = createChecker();

// --- parseTokens on a synthetic table (space is the "  <id>" line) ---
const table = parseTokens('  0\nа 5\nс 7\nл 9\nм 11\n');
check('space token', table.get(' ') === 0);
check('char token', table.get('а') === 5 && table.get('с') === 7);
check('unknown -> undefined', table.get('z') === undefined);

// --- tokenize: [0, id, 0, id, 0, ...] add_blank interleave ---
const x = tokenize('сам', table); // с=7, а=5, м=11
check('tokenize length = 2n+1', x.length === 7, x.length);
check('blanks interleaved', [...x].join(',') === '0,7,0,5,0,11,0', [...x].join(','));
check('is BigInt64Array', x instanceof BigInt64Array);
check('empty text -> just blank', tokenize('', table).length === 1);
check('all-unknown -> just blank', tokenize('xyz', table).length === 1);
check('case-fold fallback', [...tokenize('А', table)].join(',') === '0,5,0'); // uppercase folds to а

// --- encodeWav header + sample roundtrip ---
const wave = Float32Array.from([0, 0.5, -0.5, 1, -1]);
const buf = encodeWav(wave, 16000);
check('RIFF/WAVE magic', buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE');
check('length = 44 + 2n', buf.length === 44 + wave.length * 2, buf.length);
check('PCM mono 16k 16-bit', buf.readUInt16LE(20) === 1 && buf.readUInt16LE(22) === 1 && buf.readUInt32LE(24) === 16000 && buf.readUInt16LE(34) === 16);
check('data chunk size', buf.readUInt32LE(40) === wave.length * 2);
check('zero sample', buf.readInt16LE(44) === 0);
check('clip +1 -> 32767', buf.readInt16LE(44 + 3 * 2) === 0x7fff);
check('clip -1 -> -32768', buf.readInt16LE(44 + 4 * 2) === -0x8000);

// --- sanity against the real tokens.txt (if present) ---
try {
  const real = parseTokens(readFileSync(new URL('../models/tts/tokens.txt', import.meta.url), 'utf8'));
  check('real tokens has space', real.get(' ') !== undefined);
  check('real tokens covers кыргыз', ['к', 'ы', 'р', 'г', 'з'].every((c) => real.get(c) !== undefined));
} catch {
  console.log('note: models/tts/tokens.txt not present — skipped real-table checks');
}

done('ALL TTS TESTS PASSED');
