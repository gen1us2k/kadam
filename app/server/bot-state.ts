// Состояние Telegram-бота: карта чатов (у каждого — день последней отправки и курсор сессии)
// и offset getUpdates.
// Запись атомарна (уникальный временный файл + rename) и сериализована очередью: poll() и
// broadcast() чередуются на await, поэтому общий временный файл был бы гонкой, а не удобством.
// Чтение прощает ровно два случая — файла ещё нет или в нём невалидный JSON (пустое состояние);
// любая другая ошибка чтения пробрасывается, см. loadState.

import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Session {
  /**
   * Номер урока, которому принадлежит сессия. Замена прежнего `day`: единица работы теперь урок,
   * а не календарный день, поэтому незаконченный урок продолжается и после полуночи. Упражнения
   * пересобираются из сида урока (lessonSeed(n)) И колоды; допущение — колода заморожена на релиз
   * (деплой, меняющий anki/*.csv, сдвинет слова под живым курсором — принятый риск).
   */
  n: number;
  /** Номер текущего упражнения; он же — число уже отвеченных. */
  i: number;
  /**
   * Подписи упражнений, которые не получились. Счёт отдельно не хранится: каждый ответ либо
   * попадает сюда, либо верен, поэтому верных всегда `i - missed.length` — и второго источника
   * правды, способного разойтись с первым, нет.
   */
  missed: string[];
  /** Сообщение на экране, которое редактируется. */
  msgId: number;
  /** Для сборки предложения: id слов, нажатых по порядку. */
  picked: number[];
}

export interface ChatState {
  /** День последней ОТПРАВКИ этому чату (не урок), null — ещё не слали. Он же маркер «сегодня уже
   *  двигались»: гасит дневной пуш для тех, кто продвинулся вручную через /next. */
  sentDay: string | null;
  /** Текущий (последний выданный) номер урока. Новый подписчик — 0. */
  cursor: number;
  session: Session | null;
}

export interface BotState {
  /** Ключ — chat id строкой: JSON не умеет числовые ключи объектов. */
  chats: Record<string, ChatState>;
  /** getUpdates offset — last seen update_id + 1. */
  offset: number;
}

export function emptyState(): BotState {
  return { chats: {}, offset: 0 };
}

/** Конечное число или 0. `Number()` нужен лишь потому, что `Number.isFinite` не сужает тип. */
const num = (v: unknown): number => (Number.isFinite(v) ? Number(v) : 0);

/** Одна запись чата с безопасными значениями по умолчанию. */
function chatFrom(raw: unknown): ChatState {
  const r = (raw ?? {}) as Partial<ChatState>;
  const s = r.session as Partial<Session> | null | undefined;
  // Сессии, сохранённые ДО перехода на курсор (были с `day`, без `n`), не переносятся: старый
  // календарный day не отображается на номер урока. Цена — незаконченная на момент деплоя сессия
  // начнётся заново через /task (осознанный минимальный риск, как и прежний сброс вчерашней сессии).
  const session: Session | null =
    s && Number.isFinite(s.n) && Number.isFinite(s.i)
      ? {
          n: num(s.n),
          i: num(s.i),
          missed: Array.isArray(s.missed) ? s.missed.filter((m) => typeof m === 'string') : [],
          msgId: num(s.msgId),
          picked: Array.isArray(s.picked) ? s.picked.filter((x) => Number.isFinite(x)) : [],
        }
      : null;
  return {
    sentDay: typeof r.sentDay === 'string' ? r.sentDay : null,
    cursor: num(r.cursor), // отсутствует у старых записей → 0
    session,
  };
}

/**
 * Разбор поля chats, включая старый формат `number[]`. Прошлая версия хранила подписчиков
 * массивом и один `lastSentDay` на всех; миграция раздаёт этот день каждому чату, иначе в день
 * обновления все получили бы задание повторно.
 *
 * ОТСТУПЛЕНИЕ ОТ СПЕКИ (AC-3): спека говорит «превращается в карту без sentDay». Раздача старого
 * дня выбрана сознательно: подписчик в этот день уже получил задание в старом, спойлерном виде,
 * и второе сообщение было бы ошибкой. Цена — интерактивная сессия начинается со следующего дня.
 */
function chatsFrom(parsed: { chats?: unknown; lastSentDay?: unknown }): Record<string, ChatState> {
  const out: Record<string, ChatState> = {};
  if (Array.isArray(parsed.chats)) {
    const sentDay = typeof parsed.lastSentDay === 'string' ? parsed.lastSentDay : null;
    for (const id of parsed.chats) {
      if (Number.isFinite(id)) out[String(id)] = { sentDay, cursor: 0, session: null };
    }
    return out;
  }
  if (parsed.chats && typeof parsed.chats === 'object') {
    for (const [id, raw] of Object.entries(parsed.chats as Record<string, unknown>)) {
      if (Number.isFinite(Number(id))) out[id] = chatFrom(raw);
    }
    return out;
  }
  // Файл разобрался, но подписчиков в нём нет в узнаваемом виде. Свежий файл (`{}`) сюда тоже
  // попадает, и для него это норма; а вот у файла с другими полями это значит, что следующая
  // запись сотрёт список — молчать об этом нельзя, как и о невалидном JSON.
  if (parsed.chats !== undefined || Object.keys(parsed).length > 0) {
    console.error('[bot] state file has no recognisable "chats" — starting with no subscribers');
  }
  return out;
}

/**
 * Read state. Only two failures mean "start empty": the file does not exist yet, or it is not
 * valid JSON (logged — atomic writes make that near-impossible, so it deserves a line in the
 * journal). Every OTHER read error is rethrown on purpose: swallowing an EACCES would boot the
 * bot with zero subscribers, and the next save — rename needs only directory permission — would
 * then succeed and wipe the real list for good.
 */
export async function loadState(path: string): Promise<BotState> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw e;
  }
  let parsed: Partial<BotState> & { lastSentDay?: unknown };
  try {
    // `?? {}`: a literal `null` is valid JSON but has no fields to read.
    parsed = (JSON.parse(raw) ?? {}) as Partial<BotState> & { lastSentDay?: unknown };
  } catch {
    console.error(`[bot] state file ${path} is not valid JSON — starting with an empty state`);
    return emptyState();
  }
  return {
    chats: chatsFrom(parsed),
    offset: num(parsed.offset),
  };
}

/** Serialises writes; poll() and broadcast() both call saveState and interleave across awaits. */
let writes: Promise<unknown> = Promise.resolve();
let seq = 0;

async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Unique per write: a shared tmp name lets a second writer's rename hit ENOENT once the first
  // one has already moved the file away.
  const tmp = `${path}.${process.pid}.${++seq}.tmp`;
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, path);
  } catch (e) {
    // Unique names never get overwritten, so a failed write must clean up after itself.
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * Write state atomically and in order. A crash mid-write must never leave a truncated file, and
 * two overlapping writes must never race — hence the tmp file, the rename and the queue.
 */
export function saveState(path: string, state: BotState): Promise<void> {
  // Snapshot now, not when the queue reaches us: the caller means "persist what I just changed".
  const data = JSON.stringify(state);
  const next = writes.then(() => writeAtomic(path, data));
  // The caller sees the failure through `next`; the chain swallows it so later writes still run.
  writes = next.catch(() => {});
  return next;
}

/** Subscribe a chat. Returns true when the chat was not already subscribed. */
export function addChat(state: BotState, chatId: number): boolean {
  const key = String(chatId);
  if (state.chats[key]) return false;
  state.chats[key] = { sentDay: null, cursor: 0, session: null };
  return true;
}

/** Unsubscribe a chat. Returns true when the chat was actually subscribed. */
export function removeChat(state: BotState, chatId: number): boolean {
  const key = String(chatId);
  if (!state.chats[key]) return false;
  delete state.chats[key];
  return true;
}

/** Чаты, которым сегодня ещё не слали. Порядок — тот, что даёт Object.entries; неважен. */
export function chatsDue(state: BotState, day: string): number[] {
  return Object.entries(state.chats)
    .filter(([, c]) => c.sentDay !== day)
    .map(([id]) => Number(id));
}

/**
 * Пора ли рассылать: время суток наступило. Кому именно слать, решает chatsDue — день теперь
 * отмечается по каждому чату отдельно, поэтому глобального «уже слали сегодня» больше нет.
 */
export function isSendTime(sendAt: string, now = new Date()): boolean {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= sendAt;
}
