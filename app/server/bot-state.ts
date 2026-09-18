// Состояние Telegram-бота: подписчики, offset getUpdates и день последней рассылки.
// Запись атомарна (уникальный временный файл + rename) и сериализована очередью: poll() и
// broadcast() чередуются на await, поэтому общий временный файл был бы гонкой, а не удобством.
// Чтение прощает ровно два случая — файла ещё нет или в нём невалидный JSON (пустое состояние);
// любая другая ошибка чтения пробрасывается, см. loadState.

import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
// The day string must be byte-identical to the site's, so the format has exactly one definition.
import { todayStr } from '../src/lib/daily.ts';

export interface BotState {
  /** Subscribed chat ids. */
  chats: number[];
  /** getUpdates offset — last seen update_id + 1. */
  offset: number;
  /** Local date "YYYY-MM-DD" of the last daily broadcast, null before the first one. */
  lastSentDay: string | null;
}

export function emptyState(): BotState {
  return { chats: [], offset: 0, lastSentDay: null };
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
  let parsed: Partial<BotState>;
  try {
    // `?? {}`: a literal `null` is valid JSON but has no fields to read.
    parsed = (JSON.parse(raw) ?? {}) as Partial<BotState>;
  } catch {
    console.error(`[bot] state file ${path} is not valid JSON — starting with an empty state`);
    return emptyState();
  }
  return {
    chats: Array.isArray(parsed.chats) ? parsed.chats.filter((c) => Number.isFinite(c)) : [],
    offset: Number.isFinite(parsed.offset) ? Number(parsed.offset) : 0,
    lastSentDay: typeof parsed.lastSentDay === 'string' ? parsed.lastSentDay : null,
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
  if (state.chats.includes(chatId)) return false;
  state.chats.push(chatId);
  return true;
}

/** Unsubscribe a chat. Returns true when the chat was actually subscribed. */
export function removeChat(state: BotState, chatId: number): boolean {
  const i = state.chats.indexOf(chatId);
  if (i === -1) return false;
  state.chats.splice(i, 1);
  return true;
}

/**
 * Should the daily broadcast run now? True once per local day, at or after `sendAt` ("HH:MM").
 * Persisting lastSentDay is what makes a restart safe: the same day never fires twice.
 */
export function shouldSend(state: BotState, sendAt: string, now = new Date()): boolean {
  if (state.lastSentDay === todayStr(now)) return false;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hhmm >= sendAt;
}
