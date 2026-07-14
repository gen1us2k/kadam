// Shared study helpers: Kyrgyz-specific input letters, answer normalization, a client-side
// shuffle for study queues, and the deterministic xorshift32 PRNG behind the daily-stable
// drill/sentence sets. Kept dependency-free so both lib and component code can import it.

/** Kyrgyz letters absent from a Russian keyboard — surfaced as tap-to-insert buttons. */
export const KG_LETTERS = ['ң', 'ө', 'ү'];

/** Normalize a typed answer for comparison: lowercased, trimmed, internal whitespace collapsed. */
export const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ');

/** Fisher–Yates shuffle (client-side study queues; uses Math.random). */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
