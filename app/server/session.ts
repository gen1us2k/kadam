// Машина сессии: что показать на текущем шаге и что делать с нажатием. Чистая — ни сети, ни
// диска, поэтому порядок шагов, подсчёт и обработка устаревших нажатий проверяются тестом.

import { checkAssembled, type Exercise } from './exercise.ts';
import type { Session } from './bot-state.ts';
import { escapeHtml, type Keyboard } from './telegram.ts';

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

/** Разложить кнопки по рядам заданной ширины. */
function rows<T>(items: T[], width: number): T[][] {
  const out: T[][] = [];
  for (let n = 0; n < items.length; n += width) out.push(items.slice(n, n + width));
  return out;
}

/** Заголовок с прогрессом плюс необязательная строка отклика на прошлый ответ. */
function header(session: Session, total: number, feedback?: string): string {
  const progress = `🇰🇬 <b>Задание на ${escapeHtml(session.day)}</b> · ${session.i + 1}/${total}`;
  return feedback ? `${progress}\n${feedback}\n` : `${progress}\n`;
}

/** Экран текущего упражнения. */
export function render(session: Session, exercises: Exercise[], feedback?: string): View {
  const ex = exercises[session.i];
  if (!ex) return summary(session, exercises.length);
  const e = escapeHtml;
  const head = header(session, exercises.length, feedback);

  if (ex.kind === 'sentence') {
    const byId = (id: number) => ex.bank.find((c) => c.id === id)?.w ?? '';
    const left = ex.bank.filter((c) => !session.picked.includes(c.id));
    const built = session.picked.map(byId).join(' ');
    const text = `${head}\n📝 ${e(ex.prompt)}\n\n<b>${e(built) || '…'}</b>${'  _'.repeat(left.length)}`;
    const keyboard = rows(
      left.map((c) => ({ text: c.w, callback_data: encode('w', session.day, session.i, c.id) })),
      3,
    );
    if (session.picked.length > 0) {
      keyboard.push([{ text: '↺ сброс', callback_data: encode('reset', session.day, session.i) }]);
    }
    return { text, keyboard };
  }

  const icon = ex.kind === 'drill' ? '⚙️' : '📖';
  return {
    text: `${head}\n${icon} ${e(ex.prompt)}`,
    keyboard: rows(
      ex.options.map((opt, k) => ({ text: opt, callback_data: encode('a', session.day, session.i, k) })),
      2,
    ),
  };
}

/** Итоговый экран: счёт и разбор того, что не получилось. */
export function summary(session: Session, total: number): View {
  const lines = [
    `🇰🇬 <b>Задание на ${escapeHtml(session.day)}</b> — готово`,
    // Верных — всё отвеченное минус промахи; отдельного счётчика нет намеренно (см. Session).
    `<b>${session.i - session.missed.length} из ${total}</b>`,
  ];
  if (session.missed.length > 0) {
    lines.push('', 'Не получилось:', ...session.missed.map((m) => `• ${escapeHtml(m)}`));
  }
  lines.push('', 'Завтра пришлю новое. Повторить сегодняшнее — /task');
  return { text: lines.join('\n'), keyboard: [] };
}

/**
 * Сессия доиграна, когда курсор вышел за упражнения. Число упражнений берётся из самого списка,
 * а не из константы: оно складывается в другом месте (предложение + дриллы + WORD_COUNT), и
 * вторая запись того же числа здесь разошлась бы с первой при любой правке состава.
 */
export const isFinished = (session: Session, total: number): boolean => session.i >= total;

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

/** Текст для тоста, когда нажатие относится к тому, чего уже нет. */
export const STALE = 'Это уже неактуально — откройте /task';

/**
 * Применить нажатие к сессии. Нажатие принимается, только если день и номер упражнения совпадают
 * с текущим шагом: так гасятся тапы по вчерашнему сообщению, повторные тапы по уже отвеченному
 * упражнению и подделанные клиентом строки.
 */
export function applyTap(session: Session, exercises: Exercise[], tap: Tap): TapResult {
  const ex = exercises[session.i];
  // `!ex` покрывает и доигранную сессию: за последним упражнением элемента нет.
  if (tap.day !== session.day || tap.i !== session.i || !ex) return { view: null, toast: STALE };

  if (tap.op === 'reset') {
    if (ex.kind !== 'sentence') return { view: null, toast: 'Здесь нечего сбрасывать' };
    // Без этой проверки повторный тап по «сброс» дал бы побайтово тот же экран, Telegram ответил
    // бы 400 «message is not modified», а вызывающий код не смог бы отличить это от сбоя.
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
  return { view: advance(session, exercises, ex.options[tap.arg] === ex.answer) };
}

/** Записать результат шага, сдвинуть курсор и отрисовать следующий экран. */
function advance(session: Session, exercises: Exercise[], ok: boolean): View {
  const ex = exercises[session.i];
  if (!ok) session.missed.push(`${ex.label}: ${ex.answer}`);
  const feedback = ok ? `✅ ${escapeHtml(ex.answer)}` : `❌ Верно: ${escapeHtml(ex.answer)}`;
  session.i++;
  session.picked = [];
  return render(session, exercises, feedback);
}
