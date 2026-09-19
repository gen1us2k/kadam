// Машина сессии: что показать на текущем шаге и что делать с нажатием. Чистая — ни сети, ни
// диска, поэтому порядок шагов, подсчёт и обработка устаревших нажатий проверяются тестом.

import { escapeHtml } from './daily-task.ts';
import { checkAssembled, correctAnswerOf, type Exercise } from './exercise.ts';
import type { Session } from './bot-state.ts';
import type { Keyboard } from './telegram.ts';

/** Действия, которые может прислать кнопка. */
export type Tap =
  | { op: 'answer'; day: string; i: number; arg: number }
  | { op: 'word'; day: string; i: number; arg: number }
  | { op: 'reset'; day: string; i: number };

/**
 * Разбор callback_data. Значение приходит от клиента, а не от нас, поэтому ничему в нём верить
 * нельзя: неизвестная операция, нечисловые поля и мусор дают null, а границы индексов проверяет
 * уже applyTap по длине упражнений и банка.
 */
export function parseTap(data: string): Tap | null {
  const [op, day, rawI, rawArg] = data.split(':');
  const i = Number(rawI);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || !Number.isInteger(i) || i < 0) return null;
  if (op === 'reset') return { op: 'reset', day, i };
  const arg = Number(rawArg);
  if (!Number.isInteger(arg) || arg < 0) return null;
  if (op === 'a') return { op: 'answer', day, i, arg };
  if (op === 'w') return { op: 'word', day, i, arg };
  return null;
}

const encode = (op: string, day: string, i: number, arg?: number) =>
  arg === undefined ? `${op}:${day}:${i}` : `${op}:${day}:${i}:${arg}`;

export interface View {
  text: string;
  keyboard: Keyboard;
}

const TOTAL = 16;

/** Заголовок с прогрессом плюс необязательная строка отклика на прошлый ответ. */
function header(session: Session, feedback?: string): string {
  const progress = `🇰🇬 <b>Задание на ${escapeHtml(session.day)}</b> · ${session.i + 1}/${TOTAL}`;
  return feedback ? `${progress}\n${feedback}\n` : `${progress}\n`;
}

/** Экран текущего упражнения. */
export function render(session: Session, exercises: Exercise[], feedback?: string): View {
  const ex = exercises[session.i];
  if (!ex) return summary(session);
  const e = escapeHtml;

  if (ex.kind === 'sentence') {
    const byId = (id: number) => ex.bank.find((c) => c.id === id)?.w ?? '';
    const built = session.picked.map(byId).join(' ');
    const left = ex.bank.filter((c) => !session.picked.includes(c.id));
    const text =
      `${header(session, feedback)}\n📝 ${e(ex.prompt)}\n\n` +
      `<b>${e(built) || '…'}</b>${'  _'.repeat(left.length)}`;
    const keyboard: Keyboard = [];
    for (let n = 0; n < left.length; n += 3) {
      keyboard.push(
        left.slice(n, n + 3).map((c) => ({ text: c.w, callback_data: encode('w', session.day, session.i, c.id) })),
      );
    }
    if (session.picked.length > 0) {
      keyboard.push([{ text: '↺ сброс', callback_data: encode('reset', session.day, session.i) }]);
    }
    return { text, keyboard };
  }

  const icon = ex.kind === 'drill' ? '⚙️' : '📖';
  const text = `${header(session, feedback)}\n${icon} ${e(ex.prompt)}`;
  const keyboard: Keyboard = [];
  for (let n = 0; n < ex.options.length; n += 2) {
    keyboard.push(
      ex.options
        .slice(n, n + 2)
        .map((opt, k) => ({ text: opt, callback_data: encode('a', session.day, session.i, n + k) })),
    );
  }
  return { text, keyboard };
}

/** Итоговый экран: счёт и разбор того, что не получилось. */
export function summary(session: Session): View {
  const lines = [
    `🇰🇬 <b>Задание на ${escapeHtml(session.day)}</b> — готово`,
    `<b>${session.correct} из ${TOTAL}</b>`,
  ];
  if (session.missed.length > 0) {
    lines.push('', 'Не получилось:', ...session.missed.map((m) => `• ${escapeHtml(m)}`));
  }
  lines.push('', 'Завтра пришлю новое. Повторить сегодняшнее — /task');
  return { text: lines.join('\n'), keyboard: [] };
}

export const isFinished = (session: Session): boolean => session.i >= TOTAL;

/**
 * Относится ли нажатие к живой сессии: то самое сообщение и тот самый день.
 *
 * Вынесено сюда, а не оставлено условием внутри `bot.ts`, именно потому что это самая
 * ответственная строка изменения: без проверки дня брошенная вчерашняя сессия принимала бы тап
 * и зачитывала ответ против сегодняшнего упражнения при вчерашнем вопросе на экране.
 * В точке входа такую строку нечем покрыть, здесь — можно.
 */
export const isLiveTap = (session: Session, messageId: number, today: string): boolean =>
  session.msgId === messageId && session.day === today;

export interface TapResult {
  /** Что показать после нажатия; null — состояние не изменилось, показывать нечего. */
  view: View | null;
  /** Короткий текст для answerCallbackQuery. */
  toast?: string;
}

const STALE = 'Это уже неактуально — откройте /task';

/**
 * Применить нажатие к сессии. Нажатие принимается, только если день и номер упражнения совпадают
 * с текущим шагом: так гасятся тапы по вчерашнему сообщению, повторные тапы по уже отвеченному
 * упражнению и подделанные клиентом строки.
 */
export function applyTap(session: Session, exercises: Exercise[], tap: Tap): TapResult {
  if (tap.day !== session.day || tap.i !== session.i || isFinished(session)) {
    return { view: null, toast: STALE };
  }
  const ex = exercises[session.i];
  if (!ex) return { view: null, toast: STALE };

  if (tap.op === 'reset') {
    if (ex.kind !== 'sentence') return { view: null, toast: 'Здесь нечего сбрасывать' };
    // Без этой проверки повторный тап по «сброс» дал бы побайтово тот же экран, Telegram ответил
    // бы 400 «message is not modified», а вызывающий код принял бы это за недоступное сообщение
    // и продублировал сессию новым сообщением.
    if (session.picked.length === 0) return { view: null, toast: 'Уже пусто' };
    session.picked = [];
    return { view: render(session, exercises), toast: 'Сброшено' };
  }

  if (tap.op === 'word') {
    if (ex.kind !== 'sentence') return { view: null, toast: STALE };
    // Граница по банку: id приходит от клиента.
    if (!ex.bank.some((c) => c.id === tap.arg) || session.picked.includes(tap.arg)) {
      return { view: null, toast: 'Это слово уже занято' };
    }
    session.picked.push(tap.arg);
    if (session.picked.length < ex.bank.length) return { view: render(session, exercises) };
    return { view: advance(session, exercises, checkAssembled(ex, session.picked)) };
  }

  // tap.op === 'answer'
  if (ex.kind === 'sentence') return { view: null, toast: STALE };
  if (tap.arg >= ex.options.length) return { view: null, toast: 'Такого варианта нет' };
  return { view: advance(session, exercises, tap.arg === ex.answer) };
}

/** Записать результат шага, сдвинуть курсор и отрисовать следующий экран. */
function advance(session: Session, exercises: Exercise[], ok: boolean): View {
  const ex = exercises[session.i];
  const answer = correctAnswerOf(ex);
  if (ok) session.correct++;
  else session.missed.push(`${ex.label}: ${answer}`);
  const feedback = ok ? `✅ ${escapeHtml(answer)}` : `❌ Верно: ${escapeHtml(answer)}`;
  session.i++;
  session.picked = [];
  return isFinished(session) ? summary(session) : render(session, exercises, feedback);
}
