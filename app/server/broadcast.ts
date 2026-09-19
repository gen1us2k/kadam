// Рассылка задания дня. Живёт отдельно от точки входа, чтобы порядок операций — самое рискованное
// место бота — был покрыт тестом: сеть и диск приходят снаружи через deps.

import { setTimeout as sleep } from 'node:timers/promises';
import { chatsDue, removeChat, type BotState } from './bot-state.ts';
import type { SendOutcome } from './telegram.ts';

export interface BroadcastDeps {
  /** Начать сессию для одного чата. Возвращает исход отправки первого упражнения. */
  start: (chatId: number) => Promise<Exclude<SendOutcome, { kind: 'retry' }>>;
  /** Получает то самое состояние, которое broadcast мутирует, — чтобы они не разошлись. */
  save: (state: BotState) => Promise<void>;
  /** Вызывается в момент события, а не в конце: падение финального save не должно съесть журнал. */
  log: (line: string) => void;
  /** Пауза между отправками — дешёвая страховка от шторма 429. */
  gapMs: number;
}

export interface BroadcastResult {
  sent: number;
  dropped: number;
  failed: number;
}

/**
 * Разослать задание тем, кому сегодня ещё не слали.
 *
 * День отмечается ПЕРЕД отправкой и отдельно по каждому чату. Отдельно — потому что глобальная
 * отметка стоила бы всего дня всем оставшимся, если рассылка прервалась посередине; перед
 * отправкой — потому что тик идёт раз в минуту, а рассылка может идти дольше, и без отметки
 * следующий тик разослал бы то же самое второй раз.
 * Цена: чат, чья отправка упала, получит задание только завтра. Он остаётся в журнале.
 */
export async function broadcast(state: BotState, day: string, deps: BroadcastDeps): Promise<BroadcastResult> {
  const result: BroadcastResult = { sent: 0, dropped: 0, failed: 0 };
  for (const chatId of chatsDue(state, day)) {
    const chat = state.chats[String(chatId)];
    if (!chat) continue; // отписался, пока шла рассылка
    chat.sentDay = day;
    await deps.save(state);

    const outcome = await deps.start(chatId);
    if (outcome.kind === 'ok') result.sent++;
    else if (outcome.kind === 'drop') {
      removeChat(state, chatId);
      result.dropped++;
      deps.log(`dropped ${chatId}: ${outcome.reason}`);
    } else {
      result.failed++;
      deps.log(`send to ${chatId} failed: ${outcome.reason}`);
    }
    await sleep(deps.gapMs);
  }
  await deps.save(state);
  return result;
}
