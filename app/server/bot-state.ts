// Состояние Telegram-бота: подписчики, offset getUpdates и день последней рассылки.
// Запись атомарна (уникальный временный файл + rename) и сериализована очередью: poll() и
// broadcast() чередуются на await, поэтому общий временный файл был бы гонкой, а не удобством.
// Чтения прощающие: битый или отсутствующий файл даёт пустое состояние — как и клиентский
// storage.ts, это вспомогательный слой, а не БД.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
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

/** Read state; any missing/corrupt/ill-shaped file yields an empty state. */
export async function loadState(path: string): Promise<BotState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<BotState>;
    return {
      chats: Array.isArray(parsed.chats) ? parsed.chats.filter((c) => Number.isFinite(c)) : [],
      offset: Number.isFinite(parsed.offset) ? Number(parsed.offset) : 0,
      lastSentDay: typeof parsed.lastSentDay === 'string' ? parsed.lastSentDay : null,
    };
  } catch {
    return emptyState();
  }
}

/** Serialises writes; poll() and broadcast() both call saveState and interleave across awaits. */
let writes: Promise<unknown> = Promise.resolve();
let seq = 0;

async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Unique per write: a shared tmp name lets a second writer's rename hit ENOENT once the first
  // one has already moved the file away.
  const tmp = `${path}.${process.pid}.${++seq}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
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
