// Чистые решения прогрессии: куда двигать курсор, двигались ли сегодня, как коммитить продвижение
// и какую сессию открыть для урока. Вынесено из bot.ts именно ради теста — bot.ts тянет за собой
// сеть и таймеры, а эти правила (продвижение, монотонный коммит, пропуск-если-уже-двигались,
// продолжение незаконченного урока) обязаны проверяться в изоляции.

import type { ChatState, Session } from './bot-state.ts';
import { isFinished } from './session.ts';

/** Урок, который выдаст продвижение вперёд (/next, «Дальше ▶», дневной пуш): следующий за текущим. */
export const advanceTarget = (chat: ChatState): number => chat.cursor + 1;

/** Уже двигались сегодня — тогда дневной пуш этот чат пропускает (тот же маркер, что и sentDay). */
export const advancedToday = (chat: ChatState, day: string): boolean => chat.sentDay === day;

/**
 * Монотонный коммит курсора. Продвижение НИКОГДА не откатывает курсор назад: без Math.max
 * отправка более раннего урока, разрешившаяся позже параллельной (out-of-order на await),
 * увела бы учащегося обратно на уже пройденный урок и заставила бы повторять пройденное.
 */
export const commitCursor = (current: number, delivered: number): number => Math.max(current, delivered);

/**
 * Сессия для урока n: продолжаем ту же незаконченную (тот же n, курсор внутри) или начинаем
 * заново. Продолжение сбрасывает набранное в сборке предложения (picked) — как и прежний
 * startSession: экран пересобирается с чистого текущего шага.
 */
export function lessonSession(prev: Session | null, n: number, total: number): Session {
  const resumable = prev !== null && prev.n === n && !isFinished(prev, total);
  return resumable ? { ...prev, picked: [] } : { n, mode: 'lesson', i: 0, missed: [], msgId: 0, picked: [] };
}

/**
 * Кнопка «Дальше ▶» инертна, если она не с текущего урока: повторный или устаревший тап по старому
 * итогу (n !== cursor) ничего не двигает. Отдельный предикат — чтобы правило проверялось тестом.
 */
export const shouldAdvanceFromButton = (chat: ChatState, n: number): boolean => n === chat.cursor;

/**
 * Применить УСПЕШНУЮ доставку урока n к чату: поставить сессию, монотонно сдвинуть курсор и
 * отметить день. Вызывается только при outcome.kind === 'ok'; при неуспехе состояние не трогаем —
 * урок не теряется (получит в следующий раз), день не отмечается. Чистая — тестируется без сети.
 */
export function commitDelivery(chat: ChatState, session: Session, n: number, day: string): void {
  chat.session = session;
  chat.cursor = commitCursor(chat.cursor, n);
  chat.sentDay = day;
}
