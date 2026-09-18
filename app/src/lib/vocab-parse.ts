// Чистый разбор Anki-колод. Общий для браузерной сборки (vocab.ts подаёт сырой текст через
// Vite-импорт `?raw`) и для Telegram-бота (server/daily-task.ts читает те же файлы через fs).
// Модуль намеренно не имеет импортов, чтобы Node мог загрузить его напрямую.

export interface VocabRow {
  kg: string;
  ru: string;
  /** Optional Kyrgyz example sentence (corpus rows only). */
  example?: string;
  tags: string[];
}

/** Stable identity for a card. kg alone can collide (homographs), so pair it with ru. */
export function cardId(card: Pick<VocabRow, 'kg' | 'ru'>): string {
  return `${card.kg}|${card.ru}`;
}

// Rows are comma-separated. The step deck has 3 columns (kg, ru, tags); the B2 corpus has
// 4 (kg, ru, example, tags). Values are authored without commas; we still reconstruct the
// middle column defensively in case one slips in. tags are always the last field.
export function parseVocab(raw: string, withExample: boolean): VocabRow[] {
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

/** Merge the curated step deck with the frequency corpus; dedupe by kg+ru (step deck wins). */
export function mergeVocab(stepRaw: string, corpusRaw: string): VocabRow[] {
  const seen = new Set<string>();
  const merged: VocabRow[] = [];
  for (const row of [...parseVocab(stepRaw, false), ...parseVocab(corpusRaw, true)]) {
    const id = cardId(row);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }
  return merged;
}
