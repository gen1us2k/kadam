// Шестнадцать упражнений дня: одно на сборку предложения, три на суффиксы, двенадцать на слова.
// Модуль чистый — ни сети, ни состояния: порядок вариантов выводится из сида дня, поэтому
// упражнения пересобираются одинаково при каждом нажатии и переживают рестарт без хранения.

import { drillOptions } from '../src/lib/morphology.ts';
import { makeBank, rng, shuffle, type Chip } from '../src/lib/study-utils.ts';
import type { VocabRow } from '../src/lib/vocab-parse.ts';
import type { DailyTask } from './daily-task.ts';

/** Сколько вариантов у упражнения с выбором. */
const CHOICES = 4;

export interface ChoiceExercise {
  kind: 'drill' | 'word';
  /** Текст вопроса без разметки — экранируется при рендере. */
  prompt: string;
  options: string[];
  /** Верный вариант — текстом, как и у сборки: так у обоих видов упражнения одно поле ответа. */
  answer: string;
  /** Короткая подпись для итогового разбора. */
  label: string;
}

export interface AssembleExercise {
  kind: 'sentence';
  prompt: string;
  /** Перемешанный банк слов; верный ответ — слова в исходном порядке. */
  bank: Chip[];
  /** Верная сборка целиком. */
  answer: string;
  label: string;
}

export type Exercise = ChoiceExercise | AssembleExercise;

/** Сид упражнения: сид дня плюс номер, чтобы варианты не переставлялись между пересборами. */
const exerciseSeed = (daySeed: number, index: number) => daySeed + index * 97 + 1;

/**
 * Три неверных перевода из колоды. Дедупликация идёт по тексту перевода, а не по слову: в колоде
 * 58 значений делят перевод с другим словом, и синоним в роли «неверного» был бы ловушкой.
 */
function wordOptions(deck: VocabRow[], row: VocabRow, seed: number): string[] {
  const next = rng(seed);
  const taken = new Set([row.ru]);
  const wrong: string[] = [];
  // Ограниченное число попыток: колода в 1933 различных перевода набирает три за считаные шаги.
  for (let attempt = 0; attempt < 200 && wrong.length < CHOICES - 1; attempt++) {
    const candidate = deck[next() % deck.length].ru;
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    wrong.push(candidate);
  }
  return shuffle([row.ru, ...wrong], (n) => next() % n);
}

/** Шестнадцать упражнений дня в порядке показа: предложение, суффиксы, слова. */
export function buildExercises(task: DailyTask, deck: VocabRow[]): Exercise[] {
  const out: Exercise[] = [];

  out.push({
    kind: 'sentence',
    prompt: `Собери предложение (порядок SOV): «${task.sentence.ru}»`,
    bank: makeBank(task.sentence.words, exerciseSeed(task.seed, 0)),
    answer: task.sentence.words.join(' '),
    label: `«${task.sentence.ru}»`,
  });

  for (const drill of task.drills) {
    const prompt = `${drill.word} → ${drill.task}`;
    out.push({
      kind: 'drill',
      prompt,
      options: drillOptions(drill, exerciseSeed(task.seed, out.length)),
      answer: drill.answer,
      label: prompt,
    });
  }

  for (const row of task.words) {
    out.push({
      kind: 'word',
      prompt: `Что значит «${row.kg}»?`,
      options: wordOptions(deck, row, exerciseSeed(task.seed, out.length)),
      answer: row.ru,
      label: row.kg,
    });
  }

  return out;
}

/** Верна ли сборка предложения. Сравнение по тексту, поэтому повтор слова не даёт ложной ошибки. */
export function checkAssembled(ex: AssembleExercise, picked: number[]): boolean {
  return picked.map((id) => ex.bank.find((c) => c.id === id)?.w ?? '').join(' ') === ex.answer;
}
