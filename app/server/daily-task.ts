// Собирает ежедневное задание из того же контента, что показывает сайт. Дневной сид берётся из
// src/lib/daily.ts, поэтому бот и сайт согласны в том, что такое «сегодня»: одно предложение на
// сборку, три дрилла на суффиксы и срез объединённой колоды.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { daySeed, todayStr } from '../src/lib/daily.ts';
import { pickSentences, type Sentence } from '../src/lib/sentences.ts';
import { buildDrills, type Drill } from '../src/lib/morphology.ts';
import { mergeVocab, type VocabRow } from '../src/lib/vocab-parse.ts';
import { pickDeterministic } from '../src/lib/study-utils.ts';

// Колоды лежат в корне репозитория — единственный источник правды и для сайта, и для бота.
const ANKI_DIR = fileURLToPath(new URL('../../anki/', import.meta.url));

const WORD_COUNT = 12;
/** Read and merge both Anki decks from the repo root. */
export async function loadDeck(): Promise<VocabRow[]> {
  const [stepRaw, corpusRaw] = await Promise.all([
    readFile(`${ANKI_DIR}kyrgyz-frequency.csv`, 'utf8'),
    readFile(`${ANKI_DIR}kyrgyz-corpus-b2.csv`, 'utf8'),
  ]);
  return mergeVocab(stepRaw, corpusRaw);
}

export interface DailyTask {
  day: string;
  /** Сид дня — из него же выводятся порядок вариантов и банк слов (см. exercise.ts). */
  seed: number;
  sentence: Sentence;
  drills: Drill[];
  words: VocabRow[];
}

/** Today's task: same seed as the web app, so bot and site agree on the day's set. */
export function buildDailyTask(deck: VocabRow[], now = new Date()): DailyTask {
  const seed = daySeed(now);
  return {
    day: todayStr(now),
    seed,
    sentence: pickSentences(1, seed)[0],
    drills: buildDrills(3, seed),
    words: pickDeterministic(deck, WORD_COUNT, seed),
  };
}

/**
 * Сид урока по его номеру. Прогрессия бота, в отличие от сайта, идёт не по календарю, а по
 * курсору N: урок N собирается детерминированно из этого сида. Разнесено с daySeed по диапазону
 * (сайт: YYYYMMDD ~ 2·10^7), чтобы урок 0 не совпал случайно с каким-то календарным днём.
 */
export function lessonSeed(n: number): number {
  return 100_000_000 + n * 2_654_435_761; // Knuth multiplicative; спреды соседние n, вне диапазона daySeed
}

/**
 * Урок N: тот же генератор, что и задание дня, но сид берётся из номера урока, а не из даты.
 * Поле `day` несёт номер урока строкой лишь для совместимости формы DailyTask; бот его для
 * идентичности сессии не использует (см. Session.n). buildExercises читает только task.seed.
 */
export function buildLesson(deck: VocabRow[], n: number): DailyTask {
  const seed = lessonSeed(n);
  return {
    day: `lesson-${n}`,
    seed,
    sentence: pickSentences(1, seed)[0],
    drills: buildDrills(3, seed),
    words: pickDeterministic(deck, WORD_COUNT, seed),
  };
}

