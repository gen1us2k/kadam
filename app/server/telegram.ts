// Минимальный клиент Telegram Bot API поверх встроенного fetch — двух методов достаточно,
// зависимость не нужна. Классификация ответа вынесена в чистые функции: именно они решают,
// удалять ли подписчика и стоит ли продолжать опрос, и именно они покрыты тестами без сети.

const API = 'https://api.telegram.org';

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

export type SendOutcome =
  | { kind: 'ok' }
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
  if (status === 200 && body.ok) return { kind: 'ok' };
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one HTML message. Retries once on 429, then reports the outcome to the caller.
 * The AbortSignal is not optional: a socket that never settles leaves broadcast() unsettled, its
 * .finally() never clears the `broadcasting` flag, and the scheduler is wedged for the lifetime of
 * the process — not merely for one cycle.
 */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<Exclude<SendOutcome, { kind: 'retry' }>> {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  const attempt = async (): Promise<SendOutcome> => {
    try {
      const { status, body } = await callApi(token, 'sendMessage', payload, AbortSignal.timeout(15_000));
      return classifyResponse(status, body);
    } catch (e) {
      return { kind: 'transient', reason: e instanceof Error ? e.message : 'network error' };
    }
  };
  const first = await attempt();
  if (first.kind !== 'retry') return first;
  await sleep(first.seconds * 1000);
  const second = await attempt();
  // `retry` never escapes: the return type makes the caller's outcome handling exhaustive.
  return second.kind === 'retry' ? { kind: 'transient', reason: 'rate limited twice' } : second;
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
      { offset, timeout: timeoutSec, allowed_updates: ['message'] },
      // The long poll holds the connection for timeoutSec; give it a margin, then give up.
      AbortSignal.timeout((timeoutSec + 10) * 1000),
    );
    return classifyPoll(status, body as ApiBody & { result?: TelegramUpdate[] });
  } catch (e) {
    return { kind: 'transient', reason: e instanceof Error ? e.message : 'network error' };
  }
}
