// Минимальный клиент Telegram Bot API поверх встроенного fetch — четырёх методов достаточно,
// зависимость не нужна. Классификация ответа вынесена в чистые функции: именно они решают,
// удалять ли подписчика и стоит ли продолжать опрос, и именно они покрыты тестами без сети.

import { setTimeout as sleep } from 'node:timers/promises';

const API = 'https://api.telegram.org';

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

/** Ряды кнопок. Подпись — то, что видит пользователь; data вернётся в callback_query. */
export type Keyboard = { text: string; callback_data: string }[][];

export type SendOutcome =
  | { kind: 'ok'; messageId: number }
  /** 429 — wait this many seconds, then retry once. */
  | { kind: 'retry'; seconds: number }
  /** The chat is gone for good (blocked, kicked, deleted) — drop the subscriber. */
  | { kind: 'drop'; reason: string }
  /** Server-side or network hiccup — keep the subscriber, skip this cycle. */
  | { kind: 'transient'; reason: string };

export type PollResult =
  | { kind: 'ok'; updates: TelegramUpdate[] }
  /** 401/404 — the token is revoked or wrong. Polling again will never succeed. */
  | { kind: 'fatal'; reason: string }
  | { kind: 'transient'; reason: string };

export interface ApiBody {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

/** Map an HTTP status + parsed body onto the action the caller must take. Pure. */
export function classifyResponse(status: number, body: ApiBody): SendOutcome {
  if (status === 200 && body.ok) {
    // message_id нужен, чтобы дальше редактировать это же сообщение всю сессию.
    const id = (body as ApiBody & { result?: { message_id?: number } }).result?.message_id;
    return { kind: 'ok', messageId: Number.isFinite(id) ? Number(id) : 0 };
  }
  const reason = body.description ?? `http ${status}`;
  if (status === 429) return { kind: 'retry', seconds: body.parameters?.retry_after ?? 1 };
  if (status === 403) return { kind: 'drop', reason };
  // 400 covers both a deleted chat and a genuine request bug — only the former means "drop".
  if (status === 400 && /chat not found|chat_id is empty/i.test(reason)) {
    return { kind: 'drop', reason };
  }
  return { kind: 'transient', reason };
}

/** Map a getUpdates response onto the caller's next action. Pure — tested without a network. */
export function classifyPoll(status: number, body: ApiBody & { result?: TelegramUpdate[] }): PollResult {
  const reason = body.description ?? `http ${status}`;
  if (status === 401 || status === 404) return { kind: 'fatal', reason };
  if (status !== 200 || !body.ok || !Array.isArray(body.result)) return { kind: 'transient', reason };
  return { kind: 'ok', updates: body.result };
}

async function callApi(token: string, method: string, payload: unknown, signal?: AbortSignal) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as ApiBody;
  return { status: res.status, body };
}

/** Longest retry_after worth waiting out inline; beyond it the call is skipped for this cycle. */
const MAX_RETRY_AFTER_SEC = 60;

/** Escape the three characters Telegram's HTML parse mode treats as markup. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Whether a failed edit means the message itself is gone — deleted, or past the 48-hour edit
 * window — as opposed to a hiccup. Only then is it right to continue in a new message; resending
 * on a plain transient would duplicate the session and move msgId off the live message. Pure, so
 * the strings are pinned by tests instead of living as a regex at the call site.
 */
export function isMessageGone(reason: string): boolean {
  return /message (to edit )?not found|message can't be edited|MESSAGE_ID_INVALID/i.test(reason);
}

/**
 * One API call with the module's single 429 policy: wait out one bounded retry_after, retry
 * once, never let `retry` escape. The AbortSignal is not optional: a socket that never settles
 * leaves broadcast() unsettled, its .finally() never clears the `broadcasting` flag, and the
 * scheduler is wedged for the lifetime of the process — not merely for one cycle.
 */
async function request(
  token: string,
  method: string,
  payload: unknown,
): Promise<Exclude<SendOutcome, { kind: 'retry' }>> {
  const attempt = async (): Promise<SendOutcome> => {
    try {
      const { status, body } = await callApi(token, method, payload, AbortSignal.timeout(15_000));
      return classifyResponse(status, body);
    } catch (e) {
      return { kind: 'transient', reason: e instanceof Error ? e.message : 'network error' };
    }
  };
  const first = await attempt();
  if (first.kind !== 'retry') return first;
  // A flood-wait can ask for minutes. Sleeping it out would park the whole broadcast inside one
  // subscriber's send — the same stall every AbortSignal here exists to prevent.
  if (first.seconds > MAX_RETRY_AFTER_SEC) {
    return { kind: 'transient', reason: `rate limited, retry_after ${first.seconds}s is too long` };
  }
  await sleep(first.seconds * 1000);
  const second = await attempt();
  return second.kind === 'retry' ? { kind: 'transient', reason: 'rate limited twice' } : second;
}

const HTML = { parse_mode: 'HTML', disable_web_page_preview: true } as const;

/** Send one HTML message, optionally with an inline keyboard. */
export function sendMessage(token: string, chatId: number, text: string, keyboard?: Keyboard) {
  return request(token, 'sendMessage', {
    chat_id: chatId,
    text,
    ...HTML,
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

/**
 * Replace the text and buttons of a message already sent. The whole session lives in one
 * message, so this is how the next question appears. Shares the 429 policy with sendMessage:
 * a fast tapper can trip the per-chat rate limit, and a dropped edit freezes the screen.
 */
export function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  keyboard: Keyboard = [],
) {
  return request(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...HTML,
    reply_markup: { inline_keyboard: keyboard },
  });
}

/**
 * Long-poll for updates. The 25-second wait is also what paces the caller's loop, so a failure
 * MUST be reported rather than swallowed: returning an empty list on error would turn a revoked
 * token into a silent unthrottled spin that pegs the CPU and floods the API.
 */
export async function getUpdates(token: string, offset: number, timeoutSec = 25): Promise<PollResult> {
  try {
    const { status, body } = await callApi(
      token,
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
      // The long poll holds the connection for timeoutSec; give it a margin, then give up.
      AbortSignal.timeout((timeoutSec + 10) * 1000),
    );
    return classifyPoll(status, body as ApiBody & { result?: TelegramUpdate[] });
  } catch (e) {
    return { kind: 'transient', reason: e instanceof Error ? e.message : 'network error' };
  }
}

/**
 * Погасить спиннер на кнопке. Без этого вызова клиент крутит его около тридцати секунд, и
 * пользователь считает, что бот завис. Ответ намеренно игнорируется: это уведомление, а не шаг.
 */
export async function answerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  try {
    await callApi(
      token,
      'answerCallbackQuery',
      { callback_query_id: callbackId, ...(text ? { text } : {}) },
      AbortSignal.timeout(15_000),
    );
  } catch {
    /* уведомление, а не шаг сессии: сбой здесь не должен ничего ронять */
  }
}
