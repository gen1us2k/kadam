// Браузерная точка входа в словарь: Vite подаёт сырой CSV через `?raw`, разбор живёт в
// vocab-parse.ts, чтобы тот же парсер мог использовать серверный бот (server/daily-task.ts).

import stepRaw from '../../../anki/kyrgyz-frequency.csv?raw';
import corpusRaw from '../../../anki/kyrgyz-corpus-b2.csv?raw';
import { mergeVocab } from './vocab-parse.ts';
import type { VocabRow } from './vocab-parse.ts';

export type { VocabRow };

/** Merge the curated step deck with the frequency corpus; dedupe by kg+ru (step deck wins). */
export function loadVocab(): VocabRow[] {
  return mergeVocab(stepRaw, corpusRaw);
}
