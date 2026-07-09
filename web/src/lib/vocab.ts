import weekRaw from '../../../anki/kyrgyz-frequency.csv?raw';
import corpusRaw from '../../../anki/kyrgyz-corpus-b2.csv?raw';

export interface VocabRow {
  kg: string;
  ru: string;
  /** Optional Kyrgyz example sentence (corpus rows only). */
  example?: string;
  tags: string[];
}

// Rows are comma-separated. The week deck has 3 columns (kg, ru, tags); the B2 corpus has
// 4 (kg, ru, example, tags). Values are authored without commas; we still reconstruct the
// middle column defensively in case one slips in. tags are always the last field.
function parse(raw: string, withExample: boolean): VocabRow[] {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(',');
      const kg = (parts[0] ?? '').trim();
      const tags = (parts[parts.length - 1] ?? '').trim().split(/\s+/).filter(Boolean);
      if (withExample) {
        const ru = (parts[1] ?? '').trim();
        const example = parts.slice(2, -1).join(',').trim();
        return { kg, ru, example: example || undefined, tags };
      }
      return { kg, ru: parts.slice(1, -1).join(',').trim(), tags };
    })
    .filter((r) => r.kg && r.ru);
}

// Merge the curated week deck with the frequency corpus; dedupe by kg+ru (week deck wins).
export function loadVocab(): VocabRow[] {
  const seen = new Set<string>();
  const merged: VocabRow[] = [];
  for (const row of [...parse(weekRaw, false), ...parse(corpusRaw, true)]) {
    const id = `${row.kg}|${row.ru}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  return merged;
}
