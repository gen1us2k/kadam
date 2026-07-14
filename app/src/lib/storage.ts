// Small localStorage JSON helpers. Persistence in this study aid is best-effort: reads fall back
// to a default on missing/corrupt data, writes are swallowed on quota/private-mode failures, and
// both no-op during SSR (localStorage undefined). Modules with extra load logic (migration,
// merging into defaults) keep their own reader and use saveJson for the write.

/** Read and JSON-parse a key; return `fallback` if absent, unparsable, or during SSR. */
export function loadJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** JSON-stringify and write a value; silently no-op during SSR or on write failure. */
export function saveJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private-mode failure — non-fatal for a study aid.
  }
}
