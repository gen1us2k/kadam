// Shared study helpers: Kyrgyz-specific input letters, answer normalization, a client-side
// shuffle for study queues, and the deterministic xorshift32 PRNG behind the daily-stable
// drill/sentence sets. Kept dependency-free so both lib and component code can import it.

/** Kyrgyz letters absent from a Russian keyboard — surfaced as tap-to-insert buttons. */
export const KG_LETTERS = ['ң', 'ө', 'ү'];

/** Normalize a typed answer for comparison: lowercased, trimmed, internal whitespace collapsed. */
export const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Fisher–Yates shuffle. `randInt(n)` yields an integer in [0, n); the default draws from
 * Math.random (client-side study queues), a seeded source makes the order reproducible.
 */
export function shuffle<T>(arr: T[], randInt = (n: number) => Math.floor(Math.random() * n)): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Слово банка для сборки предложения: id — позиция в исходном порядке. */
export interface Chip {
  w: string;
  id: number;
}

/** Shuffle the words into a bank; avoid handing back the already-correct order. */
export function makeBank(words: string[], seed: number): Chip[] {
  let chips = words.map((w, id) => ({ w, id }));
  if (chips.length < 2) return chips;
  const next = rng(seed);
  for (let attempt = 0; attempt < 6; attempt++) {
    // Each attempt reshuffles the PREVIOUS attempt's order with the same generator — that is
    // what the component did before this moved here, and the bank must not shift for anyone.
    chips = shuffle(chips, (n) => next() % n);
    if (chips.some((c, i) => c.id !== i)) break; // not the original order
  }
  return chips;
}

/** Deterministic pick of `count` items from `pool` for a seed — the daily-stable selection. */
export function pickDeterministic<T>(pool: T[], count: number, seed: number): T[] {
  if (pool.length <= count) return [...pool]; // a copy, like shuffle() — never the caller's array
  const next = rng(seed);
  return shuffle(pool, (n) => next() % n).slice(0, count);
}

/** xorshift32 — deterministic per seed (matches the drills' daily-stable behaviour). */
export function rng(seed: number): () => number {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return Math.abs(x);
  };
}
