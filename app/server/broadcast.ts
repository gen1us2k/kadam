// Рассылка задания дня. Живёт отдельно от точки входа, чтобы порядок операций — самое рискованное
// место бота — был покрыт тестом: сеть и диск приходят снаружи через deps.

import { setTimeout as sleep } from 'node:timers/promises';
import { removeChat, type BotState } from './bot-state.ts';
import type { sendMessage } from './telegram.ts';

export interface BroadcastDeps {
  send: (chatId: number, text: string) => ReturnType<typeof sendMessage>;
  save: () => Promise<void>;
  /** Pause between sends — cheap insurance against a 429 storm. */
  gapMs: number;
}

export interface BroadcastResult {
  sent: number;
  /** One human-readable line per subscriber Telegram reported as gone (already removed). */
  dropped: string[];
  /** One line per transient failure (subscriber kept). */
  failed: string[];
}

/**
 * Send `text` to every subscriber, dropping the ones Telegram reports as gone.
 *
 * lastSentDay is claimed and persisted BEFORE the first send, not after the loop: the scheduler
 * tick reads that very field, and a broadcast slower than one tick would otherwise re-enter and
 * send the task twice to everyone. It is not a hypothetical — the send gap caps throughput at
 * 20 chats/second, and a single 429 with a long retry_after outlasts the tick on its own.
 * The trade: an interrupted broadcast — a crash, or simply a deploy restarting the unit at the
 * send hour — skips the rest of that day rather than re-sending to everyone who already got it.
 * For a study reminder that is the cheaper failure.
 */
export async function broadcast(
  state: BotState,
  day: string,
  text: string,
  deps: BroadcastDeps,
): Promise<BroadcastResult> {
  state.lastSentDay = day;
  await deps.save();

  const result: BroadcastResult = { sent: 0, dropped: [], failed: [] };
  for (const chatId of [...state.chats]) {
    // The snapshot can go stale: a /stop that lands mid-broadcast is honoured.
    if (!state.chats.includes(chatId)) continue;
    const outcome = await deps.send(chatId, text);
    if (outcome.kind === 'ok') result.sent++;
    else if (outcome.kind === 'drop') {
      removeChat(state, chatId);
      result.dropped.push(`${chatId}: ${outcome.reason}`);
    } else {
      result.failed.push(`${chatId}: ${outcome.reason}`);
    }
    await sleep(deps.gapMs);
  }
  await deps.save();
  return result;
}
