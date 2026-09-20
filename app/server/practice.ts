// Чистые правила персональной тренировки: добавление с дедупом и лимитом, выбор пачки на сессию,
// детерминированный сид и выпуск (graduate) верно отвеченных карточек. Вынесено из bot.ts ради
// теста — как progression.ts. Ни сети, ни диска, ни колоды.

import { cardId } from '../src/lib/vocab-parse.ts';

/**
 * cardId словарного упражнения: у word-упражнения label=kg, answer=ru, поэтому карточка выводится
 * из самого упражнения без поиска по колоде. null — упражнение не словарное (в набор не кладём).
 * Общий для «➕ в тренировку» (handleAdd) и работы над ошибками (auto-add на промахе в уроке).
 */
export function wordCardId(ex: { kind: string; label: string; answer: string }): string | null {
  return ex.kind === 'word' ? cardId({ kg: ex.label, ru: ex.answer }) : null;
}

/** Максимум карточек в наборе; переполнение вытесняет самые старые (голова массива). */
export const PRACTICE_CAP = 500;
/** Сколько карточек берём в одну сессию тренировки. */
export const PRACTICE_SESSION_SIZE = 12;

/** Добавить cardId: без дублей (позиция не меняется), с лимитом (старое вытесняется). */
export function addToPractice(set: string[], id: string, cap = PRACTICE_CAP): string[] {
  if (set.includes(id)) return set;
  const next = [...set, id];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Пачка на сессию: старейшие first, не больше limit. */
export function selectPractice(set: string[], limit = PRACTICE_SESSION_SIZE): string[] {
  return set.slice(0, limit);
}

/**
 * Детерминированный сид из содержимого пачки: одинаковые карточки → одинаковый порядок вариантов
 * на каждом пересборе и после рестарта. Чистая функция строк (без Date/random). FNV-1a.
 */
export function practiceSeed(cards: string[]): number {
  let h = 2166136261;
  for (const ch of cards.join(' ')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0; // беззнаковое 32-бит
}

/**
 * Выпуск карточек: из набора убираем те карточки СЕССИИ, что отвечены верно. cardId = `kg|ru`,
 * а промах записан как `kg: ru` (label упражнения: ответ; см. session.ts advance()). Значит
 * карточка сессии выпущена, если её `kg: ru` НЕ в missed. Карточки не из этой сессии остаются.
 */
export function graduatePractice(set: string[], sessionCards: string[], missed: string[]): string[] {
  const missedSet = new Set(missed);
  const graduated = new Set(
    sessionCards.filter((id) => {
      const bar = id.indexOf('|');
      const kg = id.slice(0, bar);
      const ru = id.slice(bar + 1);
      return !missedSet.has(`${kg}: ${ru}`);
    }),
  );
  return set.filter((id) => !graduated.has(id));
}
