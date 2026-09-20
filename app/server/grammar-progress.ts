// Чистые правила прогресса грамматики: освоение по счётчику, выбор непройденных пар, исчерпание
// темы. Вынесено ради теста (как progression.ts / practice.ts). Ни сети, ни диска, ни колоды —
// пул пар подаётся снаружи (morphology.grammarPairs).

import { rng, shuffle } from '../src/lib/study-utils.ts';

/** Сколько верных ответов осваивают пару (тема|слово). Достигнута — пара исключается. */
export const MASTERY = 2;

/** Ключ прогресса: тема и слово. */
export const grammarKey = (task: string, word: string): string => `${task}|${word}`;

/** Освоена ли пара (>= MASTERY верных). */
export const isMastered = (seen: Record<string, number>, key: string): boolean => (seen[key] ?? 0) >= MASTERY;

/**
 * Новый счётчик после ответа: верно → +1 (не выше MASTERY), неверно → сброс в 0. Возвращает НОВУЮ
 * карту (вход не мутируется). Освоенную пару в сессию не берут, поэтому сброс задевает только
 * пары «в процессе».
 */
export function recordGrammarAnswer(seen: Record<string, number>, key: string, correct: boolean): Record<string, number> {
  const next = { ...seen };
  next[key] = correct ? Math.min((next[key] ?? 0) + 1, MASTERY) : 0;
  return next;
}

/** Непройденные ключи трека, перемешанные по сиду, не больше limit. Замораживается на сессии. */
export function selectGrammarPairs(
  allPairs: { task: string; word: string }[],
  seen: Record<string, number>,
  seed: number,
  limit: number,
): string[] {
  const fresh = allPairs.map((p) => grammarKey(p.task, p.word)).filter((k) => !isMastered(seen, k));
  const next = rng(seed);
  return shuffle(fresh, (n) => next() % n).slice(0, limit);
}

/** Тема пройдена: непройденных пар не осталось. */
export function trackExhausted(allPairs: { task: string; word: string }[], seen: Record<string, number>): boolean {
  return allPairs.every((p) => isMastered(seen, grammarKey(p.task, p.word)));
}
