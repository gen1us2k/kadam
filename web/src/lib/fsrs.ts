// FSRS-6 scheduler (open-spaced-repetition). Formulas and default parameters verified
// against the official wiki, ts-fsrs and py-fsrs. Binary grading maps correct → Good(3),
// wrong → Again(1) — the community-standard convention for two-button apps.

const w = [
  0.212, 1.2931, 2.3065, 8.2956, // w0-w3: initial stability for Again/Hard/Good/Easy
  6.4133, 0.8334, // w4-w5: initial difficulty
  3.0194, 0.001, // w6-w7: difficulty update / mean reversion
  1.8722, 0.1666, 0.796, // w8-w10: recall stability
  1.4835, 0.0614, 0.2629, 1.6483, // w11-w14: post-lapse stability
  0.6014, 1.8729, // w15 hard penalty, w16 easy bonus (unused with binary grading)
  0.5425, 0.0912, 0.0658, // w17-w19: same-day (short-term) stability
  0.1542, // w20: decay
];

const DECAY = -w[20];
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // ensures R(S, S) = 0.9
const S_MIN = 0.001;
const S_MAX = 36500;
const REQUEST_RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 365;

export interface FsrsState {
  /** Stability, days. */
  s: number;
  /** Difficulty, 1..10. */
  d: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Initial difficulty for a grade; `raw` skips the clamp (needed as mean-reversion target). */
function d0(grade: number, raw = false): number {
  const v = w[4] - Math.exp(w[5] * (grade - 1)) + 1;
  return raw ? v : clamp(v, 1, 10);
}

function nextDifficulty(d: number, grade: number): number {
  const deltaD = -w[6] * (grade - 3);
  const damped = d + (deltaD * (10 - d)) / 9;
  return clamp(w[7] * d0(4, true) + (1 - w[7]) * damped, 1, 10);
}

/** Retrievability after `t` days at stability `s`. */
export function retrievability(t: number, s: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, t)) / s, DECAY);
}

/** First review of a card. */
export function fsrsInit(correct: boolean): FsrsState {
  const grade = correct ? 3 : 1;
  return { s: Math.max(w[grade - 1], 0.1), d: d0(grade) };
}

/** Subsequent review after `elapsedDays` since the last one. */
export function fsrsReview(prev: FsrsState, correct: boolean, elapsedDays: number): FsrsState {
  const grade = correct ? 3 : 1;
  const d = nextDifficulty(prev.d, grade);
  const sameDay = elapsedDays < 0.5;

  let s: number;
  if (sameDay) {
    let inc = Math.pow(prev.s, -w[19]) * Math.exp(w[17] * (grade - 3 + w[18]));
    if (grade >= 2) inc = Math.max(inc, 1);
    s = prev.s * inc;
  } else {
    const r = retrievability(elapsedDays, prev.s);
    if (correct) {
      s = prev.s * (1 + Math.exp(w[8]) * (11 - prev.d) * Math.pow(prev.s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1));
    } else {
      const sf = w[11] * Math.pow(prev.d, -w[12]) * (Math.pow(prev.s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
      s = Math.min(sf, prev.s / Math.exp(w[17] * w[18]));
    }
  }

  return { s: clamp(s, S_MIN, S_MAX), d };
}

/** Interval (whole days >= 1) that hits the requested retention. */
export function fsrsInterval(s: number, retention = REQUEST_RETENTION): number {
  const days = (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}
