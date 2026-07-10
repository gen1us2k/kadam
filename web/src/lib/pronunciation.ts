// Pronunciation scoring for the PoC: compare the ASR transcript against the target phrase.
// This is the v0 approach — transcript-vs-target alignment, not phoneme-level GOP. It answers
// "did the recognizer hear what you meant to say?", which is enough to gauge intelligibility.

export type WordStatus = 'ok' | 'wrong' | 'missing';

export interface WordResult {
  target: string;
  heard: string | null; // what aligned to this target word (null if not recognized)
  status: WordStatus;
}

export interface Score {
  percent: number; // 0..100 overall similarity
  words: WordResult[]; // per-target-word verdicts
  extra: string[]; // recognized words with no target counterpart
  normTarget: string;
  normHeard: string;
}

/** Lowercase, fold ё→е, drop punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance between two sequences (characters or words). */
function editDistance<T>(a: T[], b: T[]): number {
  const m = a.length;
  const n = b.length;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

type Op = { type: 'match' | 'sub' | 'del' | 'ins'; a?: string; b?: string };

/** Word-level alignment via Levenshtein backtrace. del = missing target, ins = extra heard. */
function alignWords(target: string[], heard: string[]): Op[] {
  const m = target.length;
  const n = heard.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = target[i - 1] === heard[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (target[i - 1] === heard[j - 1] ? 0 : 1)) {
      ops.push({ type: target[i - 1] === heard[j - 1] ? 'match' : 'sub', a: target[i - 1], b: heard[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ type: 'del', a: target[i - 1] });
      i--;
    } else {
      ops.push({ type: 'ins', b: heard[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

/** Score a recognized transcript against the target phrase. */
export function scorePronunciation(target: string, heard: string): Score {
  const normTarget = normalize(target);
  const normHeard = normalize(heard);

  // Overall: character-level similarity (smooth, captures partial-word accuracy).
  const tChars = [...normTarget.replace(/ /g, '')];
  const hChars = [...normHeard.replace(/ /g, '')];
  const dist = editDistance(tChars, hChars);
  const percent = tChars.length === 0 ? 0 : Math.max(0, Math.round((1 - dist / Math.max(tChars.length, hChars.length)) * 100));

  // Per-word verdicts from word-level alignment.
  const targetWords = normTarget ? normTarget.split(' ') : [];
  const heardWords = normHeard ? normHeard.split(' ') : [];
  const ops = alignWords(targetWords, heardWords);
  const words: WordResult[] = [];
  const extra: string[] = [];
  for (const op of ops) {
    if (op.type === 'match') words.push({ target: op.a!, heard: op.b!, status: 'ok' });
    else if (op.type === 'sub') words.push({ target: op.a!, heard: op.b!, status: 'wrong' });
    else if (op.type === 'del') words.push({ target: op.a!, heard: null, status: 'missing' });
    else extra.push(op.b!);
  }

  return { percent, words, extra, normTarget, normHeard };
}
