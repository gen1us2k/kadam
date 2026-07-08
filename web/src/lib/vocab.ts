import raw from '../../../anki/kyrgyz-frequency.csv?raw';

export interface VocabRow {
  kg: string;
  ru: string;
  tags: string[];
}

// The CSV is comma-separated with three columns (kyrgyz, russian, space-separated tags).
// Values were authored without commas, so a plain split is safe; we still reconstruct the
// russian column defensively from the middle parts in case one slips in.
export function loadVocab(): VocabRow[] {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(',');
      const kg = (parts[0] ?? '').trim();
      const tags = (parts[parts.length - 1] ?? '').trim().split(/\s+/).filter(Boolean);
      const ru = parts.slice(1, -1).join(',').trim();
      return { kg, ru, tags };
    })
    .filter((r) => r.kg && r.ru);
}
