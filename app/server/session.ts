// Машина сессии: что показать на текущем шаге и что делать с нажатием. Чистая — ни сети, ни
// диска, поэтому порядок шагов, подсчёт и обработка устаревших нажатий проверяются тестом.

import { checkAssembled, grammarTrack, type Exercise } from './exercise.ts';
import type { Session } from './bot-state.ts';
import { escapeHtml, type Keyboard } from './telegram.ts';

/** Действия, которые может прислать кнопка. `next` — «Дальше ▶», обрабатывается в bot.ts. */
export type Tap =
  | { op: 'answer'; n: number; i: number; arg: number }
  | { op: 'word'; n: number; i: number; arg: number }
  | { op: 'reset'; n: number; i: number }
  | { op: 'next'; n: number }
  | { op: 'add'; n: number; i: number }   // «➕ в тренировку» — обрабатывается в bot.ts
  | { op: 'practice' }                     // «🎯 Тренировка» / старт тренировки — в bot.ts
  | { op: 'grammar'; n: number };          // старт грамматического трека (n = индекс трека) — в bot.ts

/**
 * Разбор callback_data. Значение приходит от клиента, а не от нас, поэтому ничему в нём верить
 * нельзя: неизвестная операция, нечисловые поля и мусор дают null, а границы индексов проверяет
 * уже applyTap по длине упражнений и банка. Идентичность теперь несёт номер урока n, не день.
 */
export function parseTap(data: string): Tap | null {
  const [op, rawN, rawI, rawArg] = data.split(':');
  if (op === 'practice') return { op: 'practice' }; // старт тренировки — без числовых полей
  // Только цифры: Number('') === 0, и пустое поле иначе разобралось бы как индекс 0.
  const digits = /^\d+$/;
  if (!digits.test(rawN ?? '')) return null;
  const n = Number(rawN);
  if (op === 'gram') return { op: 'grammar', n }; // n здесь — индекс трека
  if (op === 'next') return { op: 'next', n };
  if (!digits.test(rawI ?? '')) return null;
  const i = Number(rawI);
  if (op === 'add') return { op: 'add', n, i };
  if (op === 'reset') return { op: 'reset', n, i };
  if (!digits.test(rawArg ?? '')) return null;
  const arg = Number(rawArg);
  if (op === 'a') return { op: 'answer', n, i, arg };
  if (op === 'w') return { op: 'word', n, i, arg };
  return null;
}

const encode = (op: string, n?: number, i?: number, arg?: number) =>
  n === undefined ? op
  : i === undefined ? `${op}:${n}`
  : arg === undefined ? `${op}:${n}:${i}`
  : `${op}:${n}:${i}:${arg}`;

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
/** Заголовок по режиму: урок несёт номер, тренировка — своё имя. */
const title = (s: Session): string =>
  s.mode === 'practice' ? '🎯 <b>Тренировка</b>'
  : s.mode === 'grammar' ? `📚 <b>${escapeHtml(grammarTrack(s.track ?? -1)?.title ?? 'Грамматика')}</b>`
  : `🇰🇬 <b>Урок ${s.n + 1}</b>`;

function header(session: Session, total: number, feedback?: string): string {
  const progress = `${title(session)} · ${session.i + 1}/${total}`;
  return feedback ? `${progress}\n${feedback}\n` : `${progress}\n`;
}

/** Экран текущего упражнения. */
export function render(session: Session, exercises: Exercise[], feedback?: string): View {
  const ex = exercises[session.i];
  if (!ex) return summary(session, exercises.length, feedback);
  const e = escapeHtml;
  const head = header(session, exercises.length, feedback);

  if (ex.kind === 'sentence') {
    const byId = (id: number) => ex.bank.find((c) => c.id === id)?.w ?? '';
    const left = ex.bank.filter((c) => !session.picked.includes(c.id));
    const built = session.picked.map(byId).join(' ');
    const text = `${head}\n📝 ${e(ex.prompt)}\n\n<b>${e(built) || '…'}</b>${'  _'.repeat(left.length)}`;
    const keyboard = rows(
      left.map((c) => ({ text: c.w, callback_data: encode('w', session.n, session.i, c.id) })),
      3,
    );
    if (session.picked.length > 0) {
      keyboard.push([{ text: '↺ сброс', callback_data: encode('reset', session.n, session.i) }]);
    }
    return { text, keyboard };
  }

  const icon = ex.kind === 'drill' ? '⚙️' : '📖';
  const keyboard = rows(
    ex.options.map((opt, k) => ({ text: opt, callback_data: encode('a', session.n, session.i, k) })),
    2,
  );
  // «➕ в тренировку» — только на словарном упражнении УРОКА (в тренировке слово уже в наборе).
  if (ex.kind === 'word' && session.mode === 'lesson') {
    keyboard.push([{ text: '➕ в тренировку', callback_data: encode('add', session.n, session.i) }]);
  }
  return { text: `${head}\n${icon} ${e(ex.prompt)}`, keyboard };
}

/** Итоговый экран: счёт и разбор того, что не получилось. */
export function summary(session: Session, total: number, feedback?: string): View {
  const lines = [
    `${title(session)} — готово`,
    // Отклик на последний ответ: без него последнее упражнение осталось бы без ✅/❌.
    ...(feedback ? [feedback] : []),
    // Верных — всё отвеченное минус промахи; отдельного счётчика нет намеренно (см. Session).
    `<b>${session.i - session.missed.length} из ${total}</b>`,
  ];
  if (session.missed.length > 0) {
    lines.push('', 'Не получилось:', ...session.missed.map((m) => `• ${escapeHtml(m)}`));
  }
  if (session.mode === 'grammar') {
    lines.push('', 'Ещё раз — кнопкой ниже или /grammar.');
    // `?? -1` — тот же сентинел отсутствующего трека, что и в title(): битая сессия даёт inert-кнопку
    // (gram:-1 не парсится), а не молча перезапускает трек 0. На практике startGrammar всегда ставит track.
    return { text: lines.join('\n'), keyboard: [[{ text: '🔁 Ещё', callback_data: encode('gram', session.track ?? -1) }]] };
  }
  if (session.mode === 'practice') {
    lines.push('', 'Верные ушли из набора, ошибки остались. Ещё раз — /practice.');
    return { text: lines.join('\n'), keyboard: [[{ text: '🎯 Ещё', callback_data: encode('practice') }]] };
  }
  lines.push('', 'Дальше — кнопкой ниже или /next. Тренировка ошибок и слов — /practice.');
  // «Дальше ▶» несёт текущий номер урока (bot.ts двигает курсор только если он всё ещё n);
  // «🎯 Тренировка» стартует прогон персонального набора.
  return {
    text: lines.join('\n'),
    keyboard: [[
      { text: 'Дальше ▶', callback_data: encode('next', session.n) },
      { text: '🎯 Тренировка', callback_data: encode('practice') },
    ]],
  };
}

/**
 * Сессия доиграна, когда курсор вышел за упражнения. Число упражнений берётся из самого списка,
 * а не из константы: оно складывается в другом месте (предложение + дриллы + WORD_COUNT), и
 * вторая запись того же числа здесь разошлась бы с первой при любой правке состава.
 */
export const isFinished = (session: Session, total: number): boolean => session.i >= total;

/**
 * Относится ли нажатие к живой сессии: то самое сообщение. День больше ни при чём — единица
 * работы теперь урок, а продвижение (/next, «Дальше ▶», дневной пуш) заменяет chat.session новым
 * сообщением, поэтому нажатие по прежнему экрану гасится по msgId. Номер урока в самом тапе —
 * второй рубеж (см. applyTap): тап с чужим n не пройдёт, даже если msgId совпал.
 */
export const isLiveTap = (session: Session, messageId: number): boolean => session.msgId === messageId;

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
  // next/add/practice — не ходы внутри сессии; их маршрутизирует bot.ts до applyTap. Защитно гасим
  // и заодно сужаем тип tap до answer/word/reset (у которых есть n/i) для строк ниже.
  if (tap.op === 'next' || tap.op === 'add' || tap.op === 'practice' || tap.op === 'grammar') return { view: null, toast: STALE };
  const ex = exercises[session.i];
  // `!ex` покрывает и доигранную сессию: за последним упражнением элемента нет.
  if (tap.n !== session.n || tap.i !== session.i || !ex) return { view: null, toast: STALE };

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
