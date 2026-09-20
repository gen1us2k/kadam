// Telegram-бот Кадам: раз в сутки рассылает подписчикам задание дня и принимает /start и /stop.
// Отдельный процесс — падение бота не роняет сайт, и ~450 МБ ONNX-моделей ему не нужны.
//
// Запуск (из app/):  TELEGRAM_BOT_TOKEN=... npm run bot
// Время отправки — в локальной зоне процесса; на сервере её задаёт TZ в systemd-юните.

import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildLesson, loadDeck } from './daily-task.ts';
import { buildExercises, buildGrammarExercises, buildPracticeExercises, grammarTrack, GRAMMAR_TRACKS } from './exercise.ts';
import {
  addChat, chatsDue, isSendTime, loadState, removeChat, saveState, type Session,
} from './bot-state.ts';
import { advanceTarget, commitDelivery, lessonSession, shouldAdvanceFromButton } from './progression.ts';
import {
  addToPractice, graduatePractice, practiceSeed, selectPractice, wordCardId, PRACTICE_SESSION_SIZE,
} from './practice.ts';
import { broadcast } from './broadcast.ts';
import {
  answerCallback, editMessageText, getUpdates, isMessageGone, sendMessage, setMyCommands, type SendOutcome,
} from './telegram.ts';
import { BOT_COMMANDS, commandsHelp } from './commands.ts';
import { applyTap, isFinished, isLiveTap, parseTap, render, STALE } from './session.ts';
import { cardId } from '../src/lib/vocab-parse.ts';
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

// Зарегистрировать меню команд (кнопка «/» в клиенте). Fire-and-forget: старт не ждёт и не падает
// из-за косметики — опрос ниже начнётся независимо от исхода.
void setMyCommands(token, BOT_COMMANDS);

// Приветствие + список команд из единого источника (commands.ts): меню Telegram и этот текст не
// разойдутся. Отвечать на задания — кнопками; команды перечислены ниже.
const GREETING =
  'Салам! Раз в сутки я буду присылать урок по кыргызскому: собрать предложение, ' +
  'разобрать суффиксы и вспомнить слова. Отвечать — кнопками.\n\nКоманды:\n' + commandsHelp();

/** Идентичность сессии-тренировки: константа далеко выше любого номера урока, поэтому устаревший
 *  тап урока (маленький n) никогда не совпадёт с живой тренировкой по guard tap.n. */
const PRACTICE_N = 1_000_000_000;
/** Идентичность сессии-грамматики: свой сентинел, отличный от PRACTICE_N и любого номера урока. */
const GRAMMAR_N = 2_000_000_000;

/**
 * Упражнения урока N. Кэш по номеру урока (bounded): разные чаты — на разных уроках, поэтому кэш
 * на один элемент, как раньше на один день, промахивался бы постоянно. buildExercises чист, так
 * что промах безопасен — те же упражнения пересобираются одинаково из lessonSeed(n).
 */
const lessons = new Map<number, ReturnType<typeof buildExercises>>();
function lessonExercises(n: number): ReturnType<typeof buildExercises> {
  let ex = lessons.get(n);
  if (!ex) {
    ex = buildExercises(buildLesson(deck, n), deck);
    lessons.set(n, ex);
    // Грубый LRU-хвост: держим кэш ограниченным, вытесняя самый старый ключ.
    if (lessons.size > 64) lessons.delete(lessons.keys().next().value as number);
  }
  return ex;
}

/**
 * Выдать урок N в НОВОМ сообщении. Один путь для /start, /task, /next, «Дальше ▶» и рассылки —
 * различаются лишь тем, какой N передан: текущий курсор (/start, /task) или следующий (продвижение).
 *
 * Курсор и отметка дня двигаются ТОЛЬКО при успешной отправке. Упавшая отправка урок не
 * пропускает (получит его в следующий раз) и день не отмечает. Коммит курсора монотонный
 * (commitCursor): продвижение никогда не откатывает курсор назад, даже если ранняя отправка
 * разрешилась после более поздней. Отметка sentDay=сегодня заодно гасит дневной пуш этому чату:
 * тот, кто уже открыл урок сегодня (в т.ч. через /start или /next), второй раз в этот день не
 * получает — так /next и рассылка остаются связаны одним курсором.
 */
async function deliverLesson(chatId: number, n: number): Promise<Exclude<SendOutcome, { kind: 'retry' }>> {
  const chat = state.chats[String(chatId)];
  if (!chat) return { kind: 'drop', reason: 'not subscribed' };
  const exercises = lessonExercises(n);
  const fresh = lessonSession(chat.session, n, exercises.length);
  const view = render(fresh, exercises);
  const outcome = await sendMessage(token, chatId, view.text, view.keyboard);
  if (outcome.kind === 'ok') {
    fresh.msgId = outcome.messageId;
    commitDelivery(chat, fresh, n, todayStr());
    await saveState(STATE_FILE, state);
  }
  return outcome;
}

/** Упражнения текущей сессии по её режиму: урок — из номера, тренировка — из замороженного снимка. */
function sessionExercises(session: Session): ReturnType<typeof buildExercises> {
  if (session.mode === 'practice') return buildPracticeExercises(deck, session.cards ?? [], session.seed ?? 0);
  if (session.mode === 'grammar') {
    const track = grammarTrack(session.track ?? -1);
    return track ? buildGrammarExercises(track.tasks, session.seed ?? 0) : [];
  }
  return lessonExercises(session.n);
}

/**
 * Старт тренировки: прогон персонального набора словарными упражнениями. Упражнения строим ПЕРВЫМИ
 * и в session.cards кладём ТОЛЬКО те карточки, что дали упражнение (остальные выпали из колоды),
 * чтобы выпуск (graduatePractice) не выпустил непройденную карточку. Пустой набор — сообщение, без
 * сессии. Тренировка НЕ трогает курс/sentDay: это отдельный режим поверх прогрессии уроков.
 */
async function startPractice(chatId: number): Promise<void> {
  const chat = state.chats[String(chatId)];
  if (!chat) { await sendMessage(token, chatId, 'Сначала подпишитесь — /start.'); return; }
  const selected = selectPractice(chat.practice, PRACTICE_SESSION_SIZE);
  const seed = practiceSeed(selected);
  const exercises = buildPracticeExercises(deck, selected, seed);
  if (exercises.length === 0) {
    await sendMessage(token, chatId,
      'Тренировка пуста. Добавляй слова кнопкой «➕ в тренировку» на словарных упражнениях — ' +
      'и ошибки из уроков тоже попадут сюда.');
    return;
  }
  const cards = exercises.map((ex) => cardId({ kg: ex.label, ru: (ex as { answer: string }).answer }));
  const fresh: Session = { n: PRACTICE_N, mode: 'practice', cards, seed, i: 0, missed: [], msgId: 0, picked: [] };
  const view = render(fresh, exercises);
  const outcome = await sendMessage(token, chatId, view.text, view.keyboard);
  if (outcome.kind === 'ok') {
    fresh.msgId = outcome.messageId;
    chat.session = fresh;
    await saveState(STATE_FILE, state);
  }
  console.log(`[bot] /practice ${chatId} — ${cards.length} card(s)`);
}

/**
 * «➕ в тренировку»: добавить слово текущего словарного упражнения в персональный набор. cardId
 * берём прямо из упражнения (label=kg, answer=ru) — без поиска по колоде. Отвечаем ровно один раз.
 */
async function handleAdd(chatId: number, callbackId: string, n: number, i: number): Promise<void> {
  const chat = state.chats[String(chatId)];
  const ex = chat ? lessonExercises(n)[i] : undefined;
  const id = ex ? wordCardId(ex) : null;
  if (!chat || !id) { await answerCallback(token, callbackId, STALE); return; }
  const before = chat.practice.length;
  chat.practice = addToPractice(chat.practice, id);
  // Отвечаем сразу (как handleTap): состояние сохранит цикл опроса после пакета — не держим спиннер
  // в заложниках у записи на диск.
  await answerCallback(token, callbackId, before === chat.practice.length ? 'Уже в тренировке' : 'Добавил в тренировку ➕');
}

/** Меню /grammar: по кнопке на каждый трек (callback gram:<idx>). Чистое — легко проверить. */
function grammarMenu(): { text: string; keyboard: { text: string; callback_data: string }[][] } {
  return {
    text: '📚 Грамматика — выбери программу:',
    keyboard: GRAMMAR_TRACKS.map((t, idx) => [{ text: t.title, callback_data: `gram:${idx}` }]),
  };
}

/**
 * Старт грамматического трека idx: дрилл-сессия только этой темы. Снимок {track, seed} заморожен на
 * сессии (пересбор детерминирован и переживает рестарт); сид варьируется при КАЖДОМ старте, чтобы
 * «🔁 Ещё» давал другой набор. n = GRAMMAR_N (идентичность). Курс/sentDay/набор НЕ трогаем.
 */
async function startGrammar(chatId: number, idx: number): Promise<void> {
  const chat = state.chats[String(chatId)];
  const track = grammarTrack(idx);
  if (!chat || !track) { await sendMessage(token, chatId, 'Нет такой программы. Открой список — /grammar.'); return; }
  // Свежий сид на каждый старт (в т.ч. «Ещё») ради разнообразия; замораживается на сессии ниже,
  // поэтому пересбор на нажатиях и после рестарта стабилен. Date.now() — рантайм bot.ts (не тест).
  const seed = (Date.now() ^ ((idx + 1) * 2654435761)) >>> 0;
  const exercises = buildGrammarExercises(track.tasks, seed);
  if (exercises.length === 0) { await sendMessage(token, chatId, 'В этой программе пока нет упражнений.'); return; }
  const fresh: Session = { n: GRAMMAR_N, mode: 'grammar', track: idx, seed, i: 0, missed: [], msgId: 0, picked: [] };
  const view = render(fresh, exercises);
  const outcome = await sendMessage(token, chatId, view.text, view.keyboard);
  if (outcome.kind === 'ok') { fresh.msgId = outcome.messageId; chat.session = fresh; await saveState(STATE_FILE, state); }
  console.log(`[bot] /grammar ${chatId} -> track ${idx} (${track.title})`);
}

/** «Выбор трека» с меню/итога. Отвечаем ровно один раз, затем стартуем трек. */
async function handleGrammar(chatId: number, callbackId: string, idx: number): Promise<void> {
  await answerCallback(token, callbackId, grammarTrack(idx) ? '📚' : STALE);
  await startGrammar(chatId, idx);
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
  // Нажатие по прежнему экрану отсекается здесь по msgId: продвижение заменяет chat.session новым
  // сообщением, поэтому старое перестаёт быть живым. Номер урока в тапе — второй рубеж в applyTap.
  if (!session || !tap || tap.op === 'next' || tap.op === 'add' || tap.op === 'practice' || tap.op === 'grammar' || !isLiveTap(session, messageId)) {
    // next/add/practice/grammar сюда не доходят (маршрутизируются до handleTap); проверка защитная
    // и заодно сужает тип tap до ходов внутри сессии (answer/word/reset) для строк ниже.
    await answerCallback(token, callbackId, STALE);
    return;
  }

  const exercises = sessionExercises(session);
  const answeredIdx = session.i;              // индекс до применения тапа
  const missedBefore = session.missed.length;
  const result = applyTap(session, exercises, tap);
  await answerCallback(token, callbackId, result.toast);
  if (!result.view) return;

  // Работа над ошибками: словарный промах в УРОКЕ кладёт слово в персональный набор. cardId прямо
  // из упражнения (label=kg, answer=ru) — без поиска по колоде.
  if (session.mode === 'lesson' && chat && session.missed.length > missedBefore) {
    const id = exercises[answeredIdx] ? wordCardId(exercises[answeredIdx]) : null;
    if (id) chat.practice = addToPractice(chat.practice, id);
  }
  // Тренировка доиграна: верные карточки уходят из набора, ошибочные остаются.
  if (session.mode === 'practice' && chat && isFinished(session, exercises.length)) {
    chat.practice = graduatePractice(chat.practice, session.cards ?? [], session.missed);
  }

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
    // /start всегда показывает приветствие со списком команд (и новым, и вернувшимся) — как просили.
    await sendMessage(token, chatId, GREETING);
    // Подписка сразу даёт текущий урок (для нового — урок 0): ждать до утра незачем. Без продвижения.
    // Читаем чат заново под null-check: /stop мог прийти, пока шли await выше.
    const chat = state.chats[String(chatId)];
    if (chat) await deliverLesson(chatId, chat.cursor);
    console.log(`[bot] /start ${chatId} (${added ? 'new' : 'already subscribed'})`);
  } else if (cmd === '/stop') {
    const removed = removeChat(state, chatId);
    await saveState(STATE_FILE, state);
    await sendMessage(token, chatId, removed ? 'Отписал. Вернуться — /start.' : 'Вы и не были подписаны.');
    console.log(`[bot] /stop ${chatId} (${removed ? 'removed' : 'was not subscribed'})`);
  } else if (cmd === '/task') {
    const chat = state.chats[String(chatId)];
    if (!chat) {
      await sendMessage(token, chatId, 'Сначала подпишитесь — /start.');
      return;
    }
    // Текущий урок заново/с продолжения — курсор не двигаем.
    await deliverLesson(chatId, chat.cursor);
    console.log(`[bot] /task ${chatId} (lesson ${chat.cursor})`);
  } else if (cmd === '/next') {
    const chat = state.chats[String(chatId)];
    if (!chat) {
      await sendMessage(token, chatId, 'Сначала подпишитесь — /start.');
      return;
    }
    // Следующий урок сразу, без ограничения на число раз в день (запойное прохождение разрешено).
    await deliverLesson(chatId, advanceTarget(chat));
    console.log(`[bot] /next ${chatId} -> lesson ${chat.cursor}`);
  } else if (cmd === '/practice') {
    await startPractice(chatId);
  } else if (cmd === '/grammar') {
    if (!state.chats[String(chatId)]) { await sendMessage(token, chatId, 'Сначала подпишитесь — /start.'); return; }
    const menu = grammarMenu();
    await sendMessage(token, chatId, menu.text, menu.keyboard);
    console.log(`[bot] /grammar ${chatId} (menu)`);
  } else if (cmd === '/help') {
    // Список команд для всех (подписка не нужна) — из того же источника, что и меню Telegram.
    await sendMessage(token, chatId, 'Команды:\n' + commandsHelp());
  }
  // Anything else is ignored on purpose: the bot never echoes user input.
}

/**
 * «Дальше ▶» с итогового экрана. Двигаем курсор, только если кнопка с текущего урока (n === cursor):
 * повторный или устаревший тап по старому итогу ничего не делает. answerCallbackQuery — ровно раз
 * на каждом пути, как и у handleTap: иначе у клиента крутился бы спиннер.
 */
async function handleNext(chatId: number, callbackId: string, n: number): Promise<void> {
  const chat = state.chats[String(chatId)];
  await answerCallback(token, callbackId, chat ? 'Дальше ▶' : STALE);
  if (chat && shouldAdvanceFromButton(chat, n)) await deliverLesson(chatId, advanceTarget(chat));
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
    // Дневной пуш двигает тот же курсор, что и /next: следующий урок. Связь заданий — этот общий
    // курсор. commitDelivery внутри deliverLesson делает продвижение монотонным и идемпотентным.
    // Чат читаем под null-check: /stop мог удалить его в окне await этой же рассылки (broadcast
    // уже прошёл свою проверку !chat), тогда просто роняем в drop, а не в TypeError на .cursor.
    start: (id) => {
      const c = state.chats[String(id)];
      return c ? deliverLesson(id, advanceTarget(c)) : Promise.resolve({ kind: 'drop', reason: 'not subscribed' });
    },
    save: (s) => saveState(STATE_FILE, s),
    log: (line) => console.log(`[bot] ${line}`),
    gapMs: SEND_GAP_MS,
  });
  console.log(`[bot] daily ${day}: ${r.sent} sent, ${r.dropped} dropped, ${r.failed} failed`);
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
      if (cb?.data && cb.message) {
        // next/add/practice — не ходы внутри сессии: маршрутизируем отдельно до handleTap, который
        // отсёк бы их как неживой тап.
        const tap = parseTap(cb.data);
        if (tap?.op === 'next') await handleNext(cb.message.chat.id, cb.id, tap.n);
        else if (tap?.op === 'add') await handleAdd(cb.message.chat.id, cb.id, tap.n, tap.i);
        else if (tap?.op === 'practice') { await answerCallback(token, cb.id, '🎯'); await startPractice(cb.message.chat.id); }
        else if (tap?.op === 'grammar') await handleGrammar(cb.message.chat.id, cb.id, tap.n);
        else await handleTap(cb.message.chat.id, cb.id, cb.message.message_id, cb.data);
      }
      // Нажатие без data наши кнопки прислать не могут, но обещание «ровно один ответ на каждом
      // пути» должно держаться буквально: иначе у клиента остался бы крутящийся спиннер.
      else if (cb) await answerCallback(token, cb.id, STALE);
    } catch (e) {
      console.error(`[bot] update ${u.update_id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  await saveState(STATE_FILE, state);
}
