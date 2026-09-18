// Telegram-бот Кадам: раз в сутки рассылает подписчикам задание дня и принимает /start и /stop.
// Отдельный процесс — падение бота не роняет сайт, и ~450 МБ ONNX-моделей ему не нужны.
//
// Запуск (из app/):  TELEGRAM_BOT_TOKEN=... npm run bot
// Время отправки — в локальной зоне процесса; на сервере её задаёт TZ в systemd-юните.

import { fileURLToPath } from 'node:url';
import { buildDailyTask, loadDeck, renderTask } from './daily-task.ts';
import { addChat, loadState, removeChat, saveState, shouldSend } from './bot-state.ts';
import { getUpdates, sendMessage } from './telegram.ts';

// Optional app/.env for the token / send time / state path (see .env.example). Real env vars win.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env — defaults / real env vars apply */
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SEND_AT = process.env.TELEGRAM_SEND_AT ?? '09:00';
const STATE_FILE =
  process.env.TELEGRAM_STATE_FILE ?? fileURLToPath(new URL('../data/bot-state.json', import.meta.url));
const TICK_MS = 60_000;
/** Small gap between sends — cheap insurance against a 429 storm. */
const SEND_GAP_MS = 50;

/**
 * "Misconfigured — do not restart me", the code RestartPreventExitStatus keys on (deploy/setup.sh).
 * Deliberately NOT 1: Node exits 1 on any uncaught exception, so reusing it would tell systemd to
 * stay down after an ordinary crash too — one transient ENOSPC in saveState would park the unit
 * forever. 78 is sysexits' EX_CONFIG and Node never produces it on its own.
 */
const EX_CONFIG = 78;

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set — nothing to do. See app/.env.example.');
  process.exit(EX_CONFIG);
}
if (!/^\d{2}:\d{2}$/.test(SEND_AT)) {
  console.error(`TELEGRAM_SEND_AT must be HH:MM, got ${JSON.stringify(SEND_AT)}`);
  process.exit(EX_CONFIG);
}
// Load-bearing, not decoration: TypeScript narrows TOKEN to `string` at module scope after the
// guard above, but that narrowing does not reach into the hoisted function declarations below
// (handleCommand, broadcast) — without this binding they see `string | undefined`.
const token: string = TOKEN;

const state = await loadState(STATE_FILE);
const deck = await loadDeck();
console.log(
  `[bot] up — ${state.chats.length} subscriber(s), daily task at ${SEND_AT} ` +
    `(${Intl.DateTimeFormat().resolvedOptions().timeZone}), deck ${deck.length} words, state ${STATE_FILE}`,
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GREETING =
  'Салам! Раз в сутки я буду присылать задание по кыргызскому: предложение на сборку, ' +
  'дриллы на суффиксы и слова дня. Отписаться — /stop.';

async function handleCommand(chatId: number, text: string): Promise<void> {
  const cmd = text.trim().split(/\s+/)[0].split('@')[0];
  if (cmd === '/start') {
    const added = addChat(state, chatId);
    await saveState(STATE_FILE, state);
    await sendMessage(token, chatId, added ? GREETING : 'Вы уже подписаны. Отписаться — /stop.');
    console.log(`[bot] /start ${chatId} (${added ? 'new' : 'already subscribed'})`);
  } else if (cmd === '/stop') {
    const removed = removeChat(state, chatId);
    await saveState(STATE_FILE, state);
    await sendMessage(token, chatId, removed ? 'Отписал. Вернуться — /start.' : 'Вы и не были подписаны.');
    console.log(`[bot] /stop ${chatId} (${removed ? 'removed' : 'was not subscribed'})`);
  }
  // Anything else is ignored on purpose: the bot never echoes user input.
}

/**
 * Broadcast the day's task, dropping subscribers Telegram reports as gone.
 *
 * lastSentDay is claimed BEFORE the first send, not after the loop: the scheduler tick reads that
 * very field, and a broadcast slower than one tick would otherwise re-enter and send the task
 * twice to everyone. It is not a hypothetical — SEND_GAP_MS caps throughput at 20 chats/second,
 * and a single 429 with retry_after: 30 outlasts the tick on its own.
 * The trade: a crash mid-broadcast skips the rest of that day rather than re-sending to everyone
 * who already got it. For a study reminder that is the cheaper failure.
 */
async function broadcast(): Promise<void> {
  // One clock read: the claimed day, the date inside the message and the log line cannot disagree.
  const task = buildDailyTask(deck);
  state.lastSentDay = task.day;
  await saveState(STATE_FILE, state);

  const text = renderTask(task);
  let sent = 0;
  let dropped = 0;
  for (const chatId of [...state.chats]) {
    const outcome = await sendMessage(token, chatId, text);
    if (outcome.kind === 'ok') sent++;
    else if (outcome.kind === 'drop') {
      removeChat(state, chatId);
      dropped++;
      console.log(`[bot] dropped ${chatId}: ${outcome.reason}`);
    } else {
      console.error(`[bot] send to ${chatId} failed: ${outcome.reason}`);
    }
    await sleep(SEND_GAP_MS);
  }
  await saveState(STATE_FILE, state);
  console.log(`[bot] daily task ${task.day}: ${sent} sent, ${dropped} dropped`);
}

/**
 * Scheduler: a 60-second tick guarded by a persisted lastSentDay. Cheaper to reason about than a
 * setTimeout to the next 09:00, survives restarts, and catches up after downtime — if the box was
 * down at 09:00 and comes back at 11:00, the task goes out at 11:00 rather than being skipped.
 * The in-flight flag is belt-and-braces next to the early lastSentDay claim above.
 */
let broadcasting = false;
setInterval(() => {
  if (broadcasting || !shouldSend(state, SEND_AT)) return;
  broadcasting = true;
  void broadcast()
    .catch((e: unknown) => console.error(`[bot] broadcast failed: ${e instanceof Error ? e.message : e}`))
    .finally(() => {
      broadcasting = false;
    });
}, TICK_MS).unref();

// A deploy restarts this unit mid-poll. Persist the offset first, or Telegram replays the pending
// updates and every subscriber gets a second greeting.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot] ${signal} — persisting state and exiting`);
    void saveState(STATE_FILE, state).finally(() => process.exit(0));
  });
}

/** Back-off ladder for a failing poll; the last rung repeats. */
const POLL_BACKOFF_MS = [1_000, 5_000, 15_000, 60_000];
let failures = 0;

// The long poll is what paces this loop, so every failure has to be paced by hand instead —
// otherwise a DNS outage or a 401 becomes an unthrottled spin on a 1-vCPU box.
while (!stopping) {
  const result = await getUpdates(token, state.offset);
  if (result.kind === 'fatal') {
    console.error(`[bot] getUpdates rejected the token: ${result.reason} — check TELEGRAM_BOT_TOKEN`);
    process.exit(EX_CONFIG);
  }
  if (result.kind === 'transient') {
    const wait = POLL_BACKOFF_MS[Math.min(failures, POLL_BACKOFF_MS.length - 1)];
    failures++;
    console.error(`[bot] getUpdates failed (${failures}): ${result.reason} — retrying in ${wait / 1000}s`);
    await sleep(wait);
    continue;
  }
  if (failures > 0) {
    console.log(`[bot] getUpdates recovered after ${failures} failure(s)`);
    failures = 0;
  }
  if (result.updates.length === 0) continue;
  for (const u of result.updates) {
    state.offset = Math.max(state.offset, u.update_id + 1);
    const chatId = u.message?.chat?.id;
    const text = u.message?.text;
    if (chatId !== undefined && text) await handleCommand(chatId, text);
  }
  await saveState(STATE_FILE, state);
}
