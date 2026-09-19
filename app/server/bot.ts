// Telegram-бот Кадам: раз в сутки рассылает подписчикам задание дня и принимает /start и /stop.
// Отдельный процесс — падение бота не роняет сайт, и ~450 МБ ONNX-моделей ему не нужны.
//
// Запуск (из app/):  TELEGRAM_BOT_TOKEN=... npm run bot
// Время отправки — в локальной зоне процесса; на сервере её задаёт TZ в systemd-юните.

import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildDailyTask, loadDeck } from './daily-task.ts';
import { buildExercises } from './exercise.ts';
import {
  addChat, chatsDue, isSendTime, loadState, removeChat, saveState, type Session,
} from './bot-state.ts';
import { broadcast } from './broadcast.ts';
import {
  answerCallback, editMessageText, getUpdates, isMessageGone, sendMessage, type SendOutcome,
} from './telegram.ts';
import { applyTap, isFinished, isLiveTap, parseTap, render, STALE } from './session.ts';
import { todayStr } from '../src/lib/daily.ts';

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
// Диапазон, а не только форма: isSendTime сравнивает строки "HH:MM", поэтому принятое "25:61"
// никогда не сравнилось бы истинно, и бот молча не слал бы вовсе.
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(SEND_AT)) {
  console.error(`TELEGRAM_SEND_AT must be HH:MM (00:00–23:59), got ${JSON.stringify(SEND_AT)}`);
  process.exit(EX_CONFIG);
}
// Load-bearing, not decoration: TypeScript narrows TOKEN to `string` at module scope after the
// guard above, but that narrowing does not reach into the hoisted function declarations below
// (handleCommand, sendDailyTask) — without this binding they see `string | undefined`.
const token: string = TOKEN;

const state = await loadState(STATE_FILE);
const deck = await loadDeck();
console.log(
  `[bot] up — ${Object.keys(state.chats).length} subscriber(s), daily task at ${SEND_AT} ` +
    `(${Intl.DateTimeFormat().resolvedOptions().timeZone}), deck ${deck.length} words, state ${STATE_FILE}`,
);

const GREETING =
  'Салам! Раз в сутки я буду присылать задание по кыргызскому: собрать предложение, ' +
  'разобрать суффиксы и вспомнить слова дня. Отвечать — кнопками. ' +
  'Вернуться к заданию — /task, отписаться — /stop.';

/**
 * Сегодняшние упражнения, пересобираемые при смене суток.
 *
 * Дня в аргументах намеренно НЕТ. `buildDailyTask` умеет строить любой день — у него есть
 * параметр `now`, — но кэш здесь хранит ровно один, и всё, что относится к прошлым дням,
 * отсекается на входе (`isLiveTap` в handleTap). Аргумент добавил бы измерение кэша, которое
 * никому не нужно, и открыл бы путь к тому самому дефекту, который отсекается выше.
 */
let today = { day: '', exercises: [] as ReturnType<typeof buildExercises> };
function todayExercises() {
  const day = todayStr();
  if (today.day !== day) today = { day, exercises: buildExercises(buildDailyTask(deck), deck) };
  return today.exercises;
}

/**
 * Начать или перерисовать сессию в НОВОМ сообщении. Используется и при подписке, и рассылкой,
 * и командой /task: во всех трёх случаях нужно свежее сообщение, которое дальше редактируется.
 *
 * Успешная отправка отмечает чату сегодняшний день — для всех трёх путей одинаково. Для /task это
 * значит, что задание, открытое до часа рассылки, рассылку в этот день отменяет. Так и задумано:
 * иначе пуш в 09:00 начал бы заново то же задание, которое человек, возможно, уже прошёл.
 * (Рассылка ставит отметку ещё и ДО вызова — это её страховка от повторного входа и обрыва.)
 */
async function startSession(chatId: number): Promise<Exclude<SendOutcome, { kind: 'retry' }>> {
  const day = todayStr();
  const chat = state.chats[String(chatId)];
  if (!chat) return { kind: 'drop', reason: 'not subscribed' };
  const exercises = todayExercises();
  // Незаконченная сегодняшняя сессия продолжается с того же места; всё остальное — вчерашняя,
  // законченная или отсутствующая — начинается заново. Доигранная сессия начинается сначала
  // осознанно: /task после «16 из 16» — это просьба потренироваться ещё, а не показать итог,
  // который и так остался в чате.
  const prev = chat.session;
  const resumable = prev !== null && prev.day === day && !isFinished(prev, exercises.length);
  const fresh: Session = resumable
    ? { ...prev, picked: [] }
    : { day, i: 0, missed: [], msgId: 0, picked: [] };
  const view = render(fresh, exercises);
  const outcome = await sendMessage(token, chatId, view.text, view.keyboard);
  if (outcome.kind === 'ok') {
    fresh.msgId = outcome.messageId;
    chat.session = fresh;
    chat.sentDay = day;
    await saveState(STATE_FILE, state);
  }
  return outcome;
}

/**
 * Нажатие на кнопку. `answerCallbackQuery` вызывается РОВНО ОДИН РАЗ на каждом пути, включая
 * отказы: Telegram принимает только первый ответ на `callback_query_id`, а без ответа вовсе
 * клиент крутит спиннер около тридцати секунд, и бот выглядит зависшим.
 */
async function handleTap(
  chatId: number,
  callbackId: string,
  messageId: number,
  data: string,
): Promise<void> {
  const chat = state.chats[String(chatId)];
  const tap = parseTap(data);
  const session = chat?.session;
  // Вчерашняя сессия отсекается здесь, а не в applyTap: applyTap сверяет тап с сессией, но
  // упражнения строятся только на сегодня, и принятый вчерашний тап зачёлся бы против
  // сегодняшнего упражнения при вчерашнем вопросе на экране. Сам предикат живёт в session.ts,
  // где его есть чем покрыть тестом.
  if (!session || !tap || !isLiveTap(session, messageId, todayStr())) {
    await answerCallback(token, callbackId, STALE);
    return;
  }

  const exercises = todayExercises();
  const result = applyTap(session, exercises, tap);
  await answerCallback(token, callbackId, result.toast);
  if (!result.view) return;

  const edited = await editMessageText(token, chatId, messageId, result.view.text, result.view.keyboard);
  if (edited.kind === 'drop') {
    removeChat(state, chatId);
  } else if (edited.kind === 'transient') {
    // ОТСТУПЛЕНИЕ ОТ СПЕКИ (DC-1 / AC-17): спека говорит «если правка вернула ошибку, бот шлёт
    // новое сообщение» — на любую ошибку. Здесь это сужено до «сообщения больше нет».
    // Сообщение недоступно — удалено или старше 48 часов: продолжаем в новом. Сетевой сбой
    // трогать НЕЛЬЗЯ, иначе каждый обрыв плодил бы дубль сессии и уводил msgId с живого
    // сообщения. Цена: экран замирает на предыдущем вопросе, а курсор уже сдвинулся, поэтому
    // следующее нажатие по нему будет отклонено как неактуальное — выйти можно через /task.
    if (isMessageGone(edited.reason)) {
      const resent = await sendMessage(token, chatId, result.view.text, result.view.keyboard);
      if (resent.kind === 'ok') session.msgId = resent.messageId;
      else if (resent.kind === 'drop') removeChat(state, chatId);
    } else {
      console.error(`[bot] edit for ${chatId} failed: ${edited.reason} — the screen stays put until /task`);
    }
  }
  // Состояние сохранит цикл опроса сразу после этого пакета обновлений — второй записи того же
  // файла на каждое нажатие здесь не нужно.
  console.log(
    `[bot] tap ${chatId} item ${tap.i} -> ${session.i}/${exercises.length}, ` +
      `correct ${session.i - session.missed.length}`,
  );
}

async function handleCommand(chatId: number, text: string): Promise<void> {
  const cmd = text.trim().split(/\s+/)[0].split('@')[0];
  if (cmd === '/start') {
    const added = addChat(state, chatId);
    await saveState(STATE_FILE, state);
    if (added) await sendMessage(token, chatId, GREETING);
    // Подписка сразу даёт задание: ждать до завтрашнего утра незачем.
    await startSession(chatId);
    console.log(`[bot] /start ${chatId} (${added ? 'new' : 'already subscribed'})`);
  } else if (cmd === '/stop') {
    const removed = removeChat(state, chatId);
    await saveState(STATE_FILE, state);
    await sendMessage(token, chatId, removed ? 'Отписал. Вернуться — /start.' : 'Вы и не были подписаны.');
    console.log(`[bot] /stop ${chatId} (${removed ? 'removed' : 'was not subscribed'})`);
  } else if (cmd === '/task') {
    if (!state.chats[String(chatId)]) {
      await sendMessage(token, chatId, 'Сначала подпишитесь — /start.');
      return;
    }
    await startSession(chatId);
    console.log(`[bot] /task ${chatId}`);
  }
  // Anything else is ignored on purpose: the bot never echoes user input.
}

/**
 * Планировщик: тик раз в минуту. Слать пора, когда наступило время суток И остались чаты без
 * сегодняшней отметки — их выбирает chatsDue. Отметка теперь стоит на каждом чате отдельно, и
 * ставится до его отправки, поэтому оборванная рассылка досылается следующим тиком, а не
 * пропадает на весь день. Флаг in-flight не даёт второму тику войти в идущую рассылку.
 */
let broadcasting = false;

// async on purpose: building and rendering the task happen INSIDE the promise, so even a
// synchronous throw there becomes a rejection the tick's .catch/.finally below still cover —
// thrown straight from the timer callback it would crash the process with the flag stuck.
async function sendDailyTask(): Promise<void> {
  const day = todayStr();
  const r = await broadcast(state, day, {
    start: startSession,
    save: (s) => saveState(STATE_FILE, s),
    log: (line) => console.log(`[bot] ${line}`),
    gapMs: SEND_GAP_MS,
  });
  console.log(`[bot] daily task ${day}: ${r.sent} sent, ${r.dropped} dropped, ${r.failed} failed`);
}

setInterval(() => {
  if (broadcasting || !isSendTime(SEND_AT) || chatsDue(state, todayStr()).length === 0) return;
  broadcasting = true;
  void sendDailyTask()
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
    // Сохраняется всё, включая курсоры незаконченных сессий: после рестарта они продолжатся с
    // того же упражнения. Оборванная рассылка ничего не теряет — день отмечен по каждому чату
    // отдельно, и недополучившие попадут в следующий тик.
    const cut = broadcasting ? ' mid-broadcast (the remaining chats go out on the next tick)' : '';
    console.log(`[bot] ${signal}${cut} — persisting state and exiting`);
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
    // Граница ошибок на одно обновление: сбой в обработке одного сообщения не должен ронять
    // процесс и терять offset всего пакета — Telegram переиграл бы его, и /start поздоровался бы
    // дважды. Рассылка защищена так же через .catch у тика. Запись состояния ниже НЕ обёрнута
    // намеренно: если диск не пишет, честнее упасть с кодом 1 и дать systemd перезапустить.
    try {
      const chatId = u.message?.chat?.id;
      const text = u.message?.text;
      if (chatId !== undefined && text) await handleCommand(chatId, text);
      const cb = u.callback_query;
      if (cb?.data && cb.message) await handleTap(cb.message.chat.id, cb.id, cb.message.message_id, cb.data);
      // Нажатие без data наши кнопки прислать не могут, но обещание «ровно один ответ на каждом
      // пути» должно держаться буквально: иначе у клиента остался бы крутящийся спиннер.
      else if (cb) await answerCallback(token, cb.id, STALE);
    } catch (e) {
      console.error(`[bot] update ${u.update_id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  await saveState(STATE_FILE, state);
}
