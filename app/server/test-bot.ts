// Регрессионные проверки Telegram-бота: детерминизм задания дня, состав и длина сообщения,
// круговорот состояния через диск, гонка одновременных записей и классификация ответов Telegram
// API. Сети здесь нет — сетевой слой сведён к чистым classifyResponse и classifyPoll ради этого.
// Запуск: `npm test` (Node >=23 исполняет .ts напрямую).

import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecker } from './test-util.ts';
import { buildDailyTask, buildLesson, lessonSeed, loadDeck } from './daily-task.ts';
import {
  addChat, chatsDue, emptyState, isSendTime, loadState, parseUser, rememberUser, removeChat, saveState,
  type BotState, type ChatState, type Session,
} from './bot-state.ts';
import {
  advanceTarget, advancedToday, commitCursor, commitDelivery, lessonSession, shouldAdvanceFromButton,
} from './progression.ts';
import {
  buildExercises, buildGrammarExercises, buildPracticeExercises, checkAssembled, grammarTrack,
  GRAMMAR_TRACKS, type AssembleExercise, type ChoiceExercise,
} from './exercise.ts';
import { addToPractice, graduatePractice, practiceSeed, selectPractice, wordCardId, PRACTICE_CAP } from './practice.ts';
import { BOT_COMMANDS, commandsHelp } from './commands.ts';
import { applyTap, isFinished, isLiveTap, parseTap, render, STALE, summary } from './session.ts';
import { buildDrills, drillOptions } from '../src/lib/morphology.ts';
import { makeBank } from '../src/lib/study-utils.ts';
import { broadcast } from './broadcast.ts';
import {
  classifyPoll, classifyResponse, editMessageText, escapeHtml, isMessageGone, sendMessage,
  type SendOutcome,
} from './telegram.ts';
import { parseVocab, mergeVocab, cardId } from '../src/lib/vocab-parse.ts';
import { pickSentences } from '../src/lib/sentences.ts';
import { pickDeterministic } from '../src/lib/study-utils.ts';
import { daySeed } from '../src/lib/daily.ts';

const { check, done } = createChecker();

// --- vocab-parse: оба формата колод ---
const STEP_CSV = '#separator:Comma\n#tags column:3\nсалам,привет,step01 phrases\nкыз,девочка,step01\n';
const CORPUS_CSV = '#separator:Comma\nмен,я,Мен китеп окуйм,a1 pronoun\nкыз,девочка,Кыз келди,a1\n';
const step = parseVocab(STEP_CSV, false);
const corpus = parseVocab(CORPUS_CSV, true);
check('step deck: comment lines skipped', step.length === 2, step.length);
check('step deck: tags from last field', step[0].tags.join(' ') === 'step01 phrases', step[0].tags);
check('step deck: no example column', step[0].example === undefined);
check('corpus: example parsed', corpus[0].example === 'Мен китеп окуйм', corpus[0].example);
check('cardId pairs kg with ru', cardId({ kg: 'кыз', ru: 'девочка' }) === 'кыз|девочка');
const merged = mergeVocab(STEP_CSV, CORPUS_CSV);
check('merge dedupes by kg|ru', merged.length === 3, merged.length);
check('step deck wins on collision', merged.find((r) => r.kg === 'кыз')?.example === undefined);

// --- pickSentences: рефакторинг не сдвинул дневные наборы ---
check(
  'daily set unchanged for seed 20260919',
  pickSentences(1, 20260919)[0].ru === 'Я купил хлеб.',
  pickSentences(1, 20260919)[0].ru,
);

// --- daily-task: состав, детерминизм, рендер ---
const deck = await loadDeck();
check('deck loaded from repo-root CSVs', deck.length > 1500, deck.length);
const day = new Date('2026-09-19T12:00:00');
const a = buildDailyTask(deck, day);
const b = buildDailyTask(deck, day);
const daySentences = pickSentences(1, daySeed(day));
check('exactly one sentence', daySentences.length === 1, daySentences.length);
check('task carries that sentence', a.sentence.ru === daySentences[0].ru, a.sentence.ru, daySentences[0].ru);
check('sentence has assemblable words', a.sentence.words.length >= 2, a.sentence.words);
check('exactly three drills', a.drills.length === 3, a.drills.length);
// Pinned at 12, not a 10..15 range: pickDeterministic returns exactly WORD_COUNT whenever the deck
// is bigger (1992 rows), so a range would silently absorb a truncated deck or an edited WORD_COUNT.
check('exactly twelve words', a.words.length === 12, a.words.length);
check('same day -> identical task', JSON.stringify(a) === JSON.stringify(b));
const other = buildDailyTask(deck, new Date('2026-09-20T12:00:00'));
check('different day -> different task', JSON.stringify(a) !== JSON.stringify(other));
check('escapes html metacharacters', escapeHtml('a & b <c> d') === 'a &amp; b &lt;c&gt; d', escapeHtml('a & b <c> d'));


// --- bot-state: подписки, круговорот через диск, атомарность ---
const st = emptyState();
check('add creates a chat entry', addChat(st, 1) === true && st.chats['1'].sentDay === null);
check('add is idempotent', addChat(st, 1) === false && Object.keys(st.chats).length === 1, st.chats);
check('remove deletes the entry', removeChat(st, 1) === true && st.chats['1'] === undefined);
check('remove is idempotent', removeChat(st, 1) === false);

const dir = await mkdtemp(join(tmpdir(), 'kadam-bot-'));
const file = join(dir, 'nested', 'bot-state.json');
addChat(st, 42);
st.offset = 777;
st.chats['42'] = {
  sentDay: '2026-09-19',
  cursor: 4,
  practice: ['көл|озеро'],
  session: { n: 4, mode: 'lesson', i: 3, missed: ['көл: озеро'], msgId: 55, picked: [1] },
};
await saveState(file, st);
const back = await loadState(file);
check('round-trip keeps chats', Object.keys(back.chats).join() === '42', back.chats);
check('round-trip keeps offset', back.offset === 777, back.offset);
check('round-trip keeps sentDay', back.chats['42'].sentDay === '2026-09-19', back.chats['42']);
check('round-trip keeps the cursor', back.chats['42'].cursor === 4, back.chats['42'].cursor);
check('round-trip keeps the session step + lesson', back.chats['42'].session?.i === 3 && back.chats['42'].session?.n === 4 && back.chats['42'].session?.msgId === 55, back.chats['42'].session);
check('round-trip keeps missed labels', back.chats['42'].session?.missed.join() === 'көл: озеро');

// --- migration: cursor default + pre-cursor session drop ---
const migFile = join(dir, 'mig.json');
await writeFile(migFile, JSON.stringify({
  offset: 5,
  chats: {
    // старая запись без cursor и с сессией по `day` (без `n`): курсор → 0, сессия → null
    '1': { sentDay: '2026-09-19', session: { day: '2026-09-19', i: 2, missed: [], msgId: 9, picked: [] } },
    // запись с уже новым форматом
    '2': { sentDay: null, cursor: 7, practice: [], session: null },
  },
}), 'utf8');
const mig = await loadState(migFile);
check('missing cursor migrates to 0', mig.chats['1'].cursor === 0, mig.chats['1']);
check('pre-cursor session (no n) is dropped', mig.chats['1'].session === null, mig.chats['1'].session);
check('existing cursor is preserved', mig.chats['2'].cursor === 7, mig.chats['2']);
check('addChat seeds cursor 0', (() => { const s = emptyState(); addChat(s, 9); return s.chats['9'].cursor === 0; })());
check('no .tmp left behind', (await readdir(join(dir, 'nested'))).join() === 'bot-state.json', await readdir(join(dir, 'nested')));

await writeFile(file, '{ this is not json', 'utf8');
const realError = console.error;
const logged: unknown[] = [];
console.error = (...args: unknown[]) => void logged.push(args);
// finally: if loadState ever rejects here, later check() failures must still be able to print.
const broken = await loadState(file).finally(() => {
  console.error = realError;
});
check('corrupt file yields empty state', Object.keys(broken.chats).length === 0 && broken.offset === 0);
check('corrupt file is reported, not silent', logged.length === 1, logged);
await writeFile(file, 'null', 'utf8');
check('literal null yields empty state', Object.keys((await loadState(file)).chats).length === 0);
check('missing file yields empty state', Object.keys((await loadState(join(dir, 'nope.json'))).chats).length === 0);
// Any OTHER read error must surface: booting empty on EACCES/EISDIR lets the next save wipe the
// real subscriber list. A directory stands in for "unreadable" on every platform and any uid.
const unreadable = await loadState(dir).then(() => 'resolved', (e: NodeJS.ErrnoException) => e.code);
check('unreadable state file rejects instead of booting empty', unreadable === 'EISDIR', unreadable);

// Overlapping writers must not race on a shared tmp name — the ENOENT that used to kill the
// process. poll() and broadcast() interleave exactly like this.
const raceFile = join(dir, 'race.json');
await Promise.all([
  saveState(raceFile, { ...emptyState(), offset: 1 }),
  saveState(raceFile, { ...emptyState(), offset: 2 }),
  saveState(raceFile, { ...emptyState(), offset: 3 }),
]);
check('concurrent writes settle, last queued wins', (await loadState(raceFile)).offset === 3, (await loadState(raceFile)).offset);
check('no .tmp survives concurrent writes', (await readdir(dir)).every((f) => !f.endsWith('.tmp')), await readdir(dir));
// A snapshot is taken at call time, not at write time.
const mutated = { ...emptyState(), offset: 10 };
const pending = saveState(raceFile, mutated);
mutated.offset = 999;
await pending;
check('write persists the state as it was at call time', (await loadState(raceFile)).offset === 10, (await loadState(raceFile)).offset);

// A failed write cleans up its unique tmp file, and the queue keeps working afterwards.
const blocked = join(dir, 'blocked.json');
await mkdir(join(blocked, 'child'), { recursive: true }); // rename onto a non-empty dir must fail
const failedWrite = await saveState(blocked, emptyState()).then(() => 'resolved', () => 'rejected');
check('failed write rejects to its caller', failedWrite === 'rejected', failedWrite);
check('failed write leaves no .tmp behind', (await readdir(dir)).every((f) => !f.endsWith('.tmp')), await readdir(dir));
await saveState(raceFile, { ...emptyState(), offset: 11 });
check('queue survives a rejected write', (await loadState(raceFile)).offset === 11);

// --- broadcast: день отмечается по каждому чату ДО его отправки ---
const bs: BotState = {
  offset: 0,
  chats: {
    '1': { sentDay: null, cursor: 0, practice: [], session: null },
    '2': { sentDay: '2026-09-20', cursor: 0, practice: [], session: null }, // сегодня уже получил
    '3': { sentDay: null, cursor: 0, practice: [], session: null },
    '4': { sentDay: null, cursor: 0, practice: [], session: null },
  },
};
const ev: string[] = [];
const started: Record<number, Exclude<SendOutcome, { kind: 'retry' }>> = {
  1: { kind: 'ok', messageId: 11 },
  3: { kind: 'drop', reason: 'blocked' },
  4: { kind: 'transient', reason: 'http 500' },
};
const br = await broadcast(bs, '2026-09-20', {
  start: async (chatId) => {
    ev.push(`start:${chatId}:claimed=${bs.chats[String(chatId)]?.sentDay}`);
    return started[chatId];
  },
  save: async (s2) => void ev.push(`save:same=${s2 === bs}`),
  log: (line) => void ev.push(`log:${line}`),
  gapMs: 0,
});
check('a chat already sent today is skipped', !ev.some((e) => e.startsWith('start:2')), ev);
check('the day is claimed before that chat is started', ev[0] === 'save:same=true' && ev[1] === 'start:1:claimed=2026-09-20', ev.slice(0, 2));
check('each chat is claimed separately', ev.filter((e) => e.startsWith('start:')).every((e) => e.includes('claimed=2026-09-20')), ev);
check('counts sent / dropped / failed', br.sent === 1 && br.dropped === 1 && br.failed === 1, br);
check('a blocked chat is removed', bs.chats['3'] === undefined);
check('a chat whose send failed is kept', bs.chats['4'] !== undefined);
check('a failed send still leaves the day claimed', bs.chats['4'].sentDay === '2026-09-20', bs.chats['4']);
check('drops and failures are logged live', ev.some((e) => e.startsWith('log:dropped 3')) && ev.some((e) => e.startsWith('log:send to 4')), ev);
// Отписка посреди рассылки уважается.
const mid: BotState = { offset: 0, chats: { '7': { sentDay: null, cursor: 0, practice: [], session: null }, '8': { sentDay: null, cursor: 0, practice: [], session: null } } };
const seen: number[] = [];
await broadcast(mid, '2026-09-20', {
  start: async (chatId) => {
    seen.push(chatId);
    if (chatId === 7) delete mid.chats['8']; // /stop пришёл, пока шла рассылка
    return { kind: 'ok', messageId: 1 };
  },
  save: async () => {},
  log: () => {},
  gapMs: 0,
});
check('a /stop mid-broadcast is honoured', seen.join() === '7', seen);

// PR-003: чат, помеченный сегодняшним днём ПОСРЕДИ рассылки (например /next пришёл во время неё),
// пропускается по перепроверке в цикле — не только по снимку chatsDue. Помечаем 8 из start(7).
const midAdv: BotState = { offset: 0, chats: { '7': { sentDay: null, cursor: 0, practice: [], session: null }, '8': { sentDay: null, cursor: 0, practice: [], session: null } } };
const startedAdv: number[] = [];
await broadcast(midAdv, '2026-09-20', {
  start: async (chatId) => {
    startedAdv.push(chatId);
    if (chatId === 7) midAdv.chats['8'].sentDay = '2026-09-20'; // /next продвинул 8, пока шла рассылка
    return { kind: 'ok', messageId: 1 };
  },
  save: async () => {},
  log: () => {},
  gapMs: 0,
});
check('a chat advanced mid-broadcast is skipped by the in-loop recheck', startedAdv.join() === '7', startedAdv);

// --- chatsDue / isSendTime ---
const due: BotState = { offset: 0, chats: { '1': { sentDay: '2026-09-20', cursor: 0, practice: [], session: null }, '2': { sentDay: null, cursor: 0, practice: [], session: null } } };
check('only chats not sent today are due', chatsDue(due, '2026-09-20').join() === '2', chatsDue(due, '2026-09-20'));
check('a new day makes everyone due', chatsDue(due, '2026-09-21').sort().join() === '1,2');
check('before the hour it is not time', isSendTime('09:00', new Date('2026-09-20T08:59:00')) === false);
check('at the hour it is time', isSendTime('09:00', new Date('2026-09-20T09:00:00')) === true);
check('after the hour it is still time (catch-up)', isSendTime('09:00', new Date('2026-09-20T23:30:00')) === true);

// --- telegram: классификация ответов, без сети ---
check('200 ok -> ok', classifyResponse(200, { ok: true }).kind === 'ok');
const rate = classifyResponse(429, { ok: false, parameters: { retry_after: 7 } });
check('429 -> retry with retry_after', rate.kind === 'retry' && rate.seconds === 7, rate);
check('429 without retry_after defaults to 1s', (classifyResponse(429, { ok: false }) as { seconds: number }).seconds === 1);
check('403 blocked -> drop', classifyResponse(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }).kind === 'drop');
check('400 chat not found -> drop', classifyResponse(400, { ok: false, description: 'Bad Request: chat not found' }).kind === 'drop');
check('400 other -> transient', classifyResponse(400, { ok: false, description: 'Bad Request: message is too long' }).kind === 'transient');
check('500 -> transient', classifyResponse(500, { ok: false }).kind === 'transient');

// --- polling: a failure must never look like "no updates" ---
const polled = classifyPoll(200, { ok: true, result: [{ update_id: 5 }] });
check('200 with result -> ok', polled.kind === 'ok' && polled.updates.length === 1, polled);
check('200 empty result -> ok, not transient', classifyPoll(200, { ok: true, result: [] }).kind === 'ok');
check('401 revoked token -> fatal', classifyPoll(401, { ok: false, description: 'Unauthorized' }).kind === 'fatal');
check('404 wrong token -> fatal', classifyPoll(404, { ok: false, description: 'Not Found' }).kind === 'fatal');
check('500 -> transient, not fatal', classifyPoll(500, { ok: false }).kind === 'transient');
check('malformed body -> transient', classifyPoll(200, { ok: true }).kind === 'transient');

// --- sendMessage: композиция повтора на 429. fetch подменён — сети по-прежнему нет. ---
const realFetch = globalThis.fetch;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let calls = 0;
const script = (responses: (() => Response)[]) => {
  calls = 0;
  globalThis.fetch = (async () => responses[calls++]()) as typeof fetch;
};
const rateLimited = (seconds: number) => () => reply(429, { ok: false, parameters: { retry_after: seconds } });
script([rateLimited(0), () => reply(200, { ok: true })]);
check('429 then 200 -> ok after one retry', (await sendMessage('t', 1, 'x')).kind === 'ok' && calls === 2, calls);
script([rateLimited(0), rateLimited(0)]);
check('429 twice -> transient, retry never escapes', (await sendMessage('t', 1, 'x')).kind === 'transient' && calls === 2, calls);
script([rateLimited(3600)]);
check('flood-wait is skipped, not slept out', (await sendMessage('t', 1, 'x')).kind === 'transient' && calls === 1, calls);
// Pins the upper side of the 60 s threshold. (The 60 s side would need a real minute-long sleep.)
script([rateLimited(61)]);
check('61 s is already too long', (await sendMessage('t', 1, 'x')).kind === 'transient' && calls === 1, calls);
script([() => { throw new Error('socket hang up'); }]);
check('network error -> transient', (await sendMessage('t', 1, 'x')).kind === 'transient');
// Правка сообщения делит политику 429 с отправкой: быстрые нажатия упираются в лимит чата, а
// потерянная правка замораживает экран до /task.
script([rateLimited(0), () => reply(200, { ok: true, result: { message_id: 9 } })]);
const edited = await editMessageText('t', 1, 9, 'x');
check('a rate-limited edit is retried once', edited.kind === 'ok' && calls === 2, calls);
globalThis.fetch = realFetch;

// --- isMessageGone: только «сообщения больше нет» даёт право продолжить в новом ---
check('deleted message is gone', isMessageGone('Bad Request: message to edit not found'));
check('too old to edit is gone', isMessageGone("Bad Request: message can't be edited"));
check('a no-op edit is NOT gone', !isMessageGone('Bad Request: message is not modified'));
check('a network hiccup is NOT gone', !isMessageGone('fetch failed'));
check('a server error is NOT gone', !isMessageGone('http 500'));

// --- pickDeterministic never hands out the caller's own array ---
const tiny = ['a', 'b'];
check('small pool is copied, not aliased', pickDeterministic(tiny, 5, 1) !== tiny && pickDeterministic(tiny, 5, 1).join() === 'a,b');

// --- состояние: миграция со старого формата ---
const legacy = join(dir, 'legacy.json');
await writeFile(legacy, JSON.stringify({ chats: [111, 222], offset: 9, lastSentDay: '2026-09-19' }), 'utf8');
const migrated = await loadState(legacy);
check('legacy subscribers survive', Object.keys(migrated.chats).sort().join() === '111,222', migrated.chats);
check('legacy offset survives', migrated.offset === 9);
check('the old global day becomes each chat sentDay', migrated.chats['111'].sentDay === '2026-09-19');
check('migrated chats start without a session', migrated.chats['111'].session === null);
check('legacy chats migrate with cursor 0', migrated.chats['111'].cursor === 0 && migrated.chats['222'].cursor === 0, migrated.chats);
const badSession = join(dir, 'bad-session.json');
await writeFile(badSession, JSON.stringify({ chats: { '5': { sentDay: null, session: { nonsense: true } } }, offset: 0 }), 'utf8');
check('an ill-shaped session becomes null', (await loadState(badSession)).chats['5'].session === null);
// Файл разобрался, но подписчиков в нём не узнать: молча стартовать пустым нельзя — следующая
// запись стёрла бы список. Пустой `{}` (свежий файл) при этом не шумит.
const noChats = join(dir, 'no-chats.json');
await writeFile(noChats, JSON.stringify({ offset: 5 }), 'utf8');
const warned: unknown[] = [];
console.error = (...args: unknown[]) => void warned.push(args);
const orphan = await loadState(noChats).finally(() => { console.error = realError; });
check('a state file without chats is reported', warned.length === 1 && orphan.offset === 5, warned);
await writeFile(noChats, '{}', 'utf8');
const quiet: unknown[] = [];
console.error = (...args: unknown[]) => void quiet.push(args);
await loadState(noChats).finally(() => { console.error = realError; });
check('an empty fresh file stays quiet', quiet.length === 0, quiet);

// --- morphology: декларативные формы не изменили ни одного ответа ---
const FORMS: [string, string, string][] = [
  ['Множественное число', 'кыз', 'кыздар'],
  ['Множественное число', 'гүл', 'гүлдөр'],
  ['Множественное число', 'дос', 'достор'],
  ['Множественное число', 'ай', 'айлар'],
  ['Где? (жатыш)', 'үй', 'үйдө'],
  ['Куда? (барыш)', 'үй', 'үйгө'],
  ['Куда? (барыш)', 'ат', 'атка'],
  ['Откуда? (чыгыш)', 'үй', 'үйдөн'],
  ['Настоящее (-ып жатат)', 'бар', 'барып жатат'],
  ['Прошедшее (-ды)', 'кел', 'келди'],
  ['Будущее (-ат)', 'бар', 'барат'],
  ['Отрицание (-байт)', 'кел', 'келбейт'],
  ['Отрицание (-байт)', 'айт', 'айтпайт'],
  // Новые формы (шаги 4/7/8) — сверены с курсом; вкл. основу на гласную и глухую согласную.
  ['Родительный (илик)', 'китеп', 'китептин'],
  ['Родительный (илик)', 'кыз', 'кыздын'],
  ['Родительный (илик)', 'тоо', 'тоонун'],
  ['Винительный (табыш)', 'кыз', 'кызды'],
  ['Винительный (табыш)', 'тоо', 'тоону'],
  ['Винительный (табыш)', 'китеп', 'китепти'],
  ['Причастие -ган', 'бар', 'барган'],
  ['Причастие -ган', 'кет', 'кеткен'],
  ['Причастие -ган', 'ич', 'ичкен'],
  ['Деепричастие -ып', 'бар', 'барып'],
  ['Деепричастие -ып', 'ал', 'алып'],
  ['Деепричастие -ып', 'ич', 'ичип'],
  ['Запрет -ба', 'бар', 'барба'],
  ['Запрет -ба', 'кет', 'кетпе'],
  ['Запрет -ба', 'жаз', 'жазба'],
];
const findDrill = (task: string, word: string) => {
  for (let sd = 1; sd <= 400; sd++) {
    const d = buildDrills(60, sd, [task]).find((x) => x.word === word);
    if (d) return d;
  }
  return null;
};
for (const [task, word, want] of FORMS) {
  const found = findDrill(task, word);
  check(`${task}: ${word} -> ${want}`, found?.answer === want, found?.answer, want);
}

// --- дистракторы дриллов ---
const drill = buildDrills(1, 20260920)[0];
const opts = drillOptions(drill, 1);
check('drill gives four options', opts.length === 4, opts);
check('drill options are distinct', new Set(opts).size === 4, opts);
check('the correct form is among them', opts.includes(drill.answer), opts);
check('options are deterministic for a seed', drillOptions(drill, 1).join() === opts.join());
check('distractors keep the stem', opts.every((o) => o.startsWith(drill.word)), opts);
// Одной проверки «четыре различных» НЕДОСТАТОЧНО: её проходил и прежний согласно-мажорный
// перебор, из-за которого половина типов не проверяла гармонию вовсе.
const CONSONANTAL = ['Множественное число', 'Где? (жатыш)', 'Куда? (барыш)', 'Откуда? (чыгыш)',
  'Прошедшее (-ды)', 'Отрицание (-байт)',
  'Родительный (илик)', 'Винительный (табыш)', 'Причастие -ган', 'Запрет -ба'];
const VOWEL_ONLY = ['Настоящее (-ып жатат)', 'Будущее (-ат)', 'Деепричастие -ып'];
let thin = 0;
let wrongAxis = 0;
// Подпись типа здесь — ключ: переименуй её в morphology.ts, и buildDrills вернёт пустой список,
// цикл не выполнится ни разу, а обе проверки ниже пройдут вхолостую. Поэтому считаем дриллы.
const swept: Record<string, number> = {};
for (const t of [...CONSONANTAL, ...VOWEL_ONLY]) {
  swept[t] = 0;
  for (let sd = 1; sd <= 40; sd++) {
    for (const d of buildDrills(20, sd, [t])) {
      swept[t]++;
      const o = drillOptions(d, sd);
      if (o.length !== 4 || new Set(o).size !== 4 || !o.includes(d.answer)) thin++;
      // Позиция сразу за основой. У суффикса с согласной там согласная, и отличаться в ней
      // должен ровно один дистрактор — ошибка ассимиляции. У `-ат` и `-ып жатат` согласной нет,
      // там стоит гласная, поэтому отличаются все три: это и есть гармонические ошибки.
      const at = d.word.length;
      const differ = o.filter((x) => x !== d.answer && x[at] !== d.answer[at]).length;
      if (differ !== (CONSONANTAL.includes(t) ? 1 : 3)) wrongAxis++;
    }
  }
}
check('the sweep actually reached all thirteen drill types', Object.values(swept).length === 13 && Object.values(swept).every((n) => n > 0), swept);
check('every drill type yields four distinct options', thin === 0, thin);
check('one assimilation error where the suffix has a consonant, three harmony errors where it has none', wrongAxis === 0, wrongAxis);
// Деепричастие -ып без согласной корректно только для основ на согласную (иначе оку → окууп).
// Пул DRILL_VERBS согласно-финальный — сторожим это через сами дриллы, не завися от экспорта пула.
const KG_VOWELS = 'аеёиоуыэюяөү';
let vowelStemVerb = 0;
let converbSeen = 0;
for (let sd = 1; sd <= 40; sd++) {
  for (const d of buildDrills(20, sd, ['Деепричастие -ып'])) {
    converbSeen++;
    if (KG_VOWELS.includes(d.word[d.word.length - 1])) vowelStemVerb++;
  }
}
// converbSeen>0 — иначе (переименовали метку) страж прошёл бы вхолостую.
check('converb pool stays consonant-final (guards -ып correctness)', converbSeen > 0 && vowelStemVerb === 0, { converbSeen, vowelStemVerb });

// --- makeBank: перенос не изменил банк ---
check('bank keeps every word', makeBank(['а', 'б', 'в'], 7).map((c) => c.w).sort().join() === 'а,б,в');
check('bank is deterministic', makeBank(['а', 'б', 'в'], 7).map((c) => c.id).join() === makeBank(['а', 'б', 'в'], 7).map((c) => c.id).join());
check('bank avoids the original order', makeBank(['а', 'б', 'в', 'г'], 7).some((c, i) => c.id !== i));
check('single word bank is returned as is', makeBank(['а'], 1).length === 1);

// --- exercise: состав и дистракторы ---
const task16 = buildDailyTask(deck, new Date('2026-09-20T12:00:00'));
const exercises = buildExercises(task16, deck);
check('sixteen exercises', exercises.length === 16, exercises.length);
check('first is the sentence', exercises[0].kind === 'sentence');
check('three drills follow', exercises.slice(1, 4).every((e) => e.kind === 'drill'));
check('twelve words close it', exercises.slice(4).every((e) => e.kind === 'word') && exercises.slice(4).length === 12);
const choices = exercises.slice(1) as ChoiceExercise[];
check('every choice has four options', choices.every((e) => e.options.length === 4));
check('every choice lists its answer exactly once', choices.every((e) => e.options.filter((o) => o === e.answer).length === 1));
check('no choice repeats an option', choices.every((e) => new Set(e.options).size === 4));
check('exercises are deterministic', JSON.stringify(buildExercises(task16, deck)) === JSON.stringify(exercises));
// Вопрос не должен подсказывать ответ. Единственное законное исключение — заимствования, где
// кыргызское и русское написание совпадают (музей, банк, автобус: 163 слова из 1992, 8.2%
// колоды). Прятать их незачем — это и есть верный ответ, — но и выдавать за утечку тоже нельзя,
// поэтому исключение названо явно, а для дриллов правило остаётся безусловным.
const drillsOnly = exercises.slice(1, 4) as ChoiceExercise[];
check('a drill prompt never contains its answer', drillsOnly.every((e) => !e.prompt.includes(e.answer)));
const wordsOnly = exercises.slice(4) as ChoiceExercise[];
check(
  'a word prompt contains its answer only when the two languages spell it the same',
  wordsOnly.every((e) => !e.prompt.includes(e.answer) || e.prompt === `Что значит «${e.answer}»?`),
);

// --- сборка предложения: повтор слова не даёт ложной ошибки ---
const dup = { kind: 'sentence', prompt: 'p', bank: makeBank(['мен', 'аны', 'мен'], 3), answer: 'мен аны мен', label: 'l' } as AssembleExercise;
check('duplicate words assemble correctly', checkAssembled(dup, [0, 1, 2]));

// --- parseTap: клиентские данные не доверенные (идентичность теперь номер урока n, не день) ---
const answerTap = parseTap('a:4:3:2');
check('valid answer tap', answerTap?.op === 'answer' && answerTap.n === 4 && answerTap.i === 3 && answerTap.arg === 2, answerTap);
check('valid word tap', parseTap('w:4:0:5')?.op === 'word');
check('valid reset', parseTap('reset:4:0')?.op === 'reset');
const nextTap = parseTap('next:4');
check('valid next tap', nextTap?.op === 'next' && nextTap.n === 4, nextTap);
check('unknown op rejected', parseTap('x:4:0:0') === null);
check('garbage rejected', parseTap('nonsense') === null);
// Прежний формат нёс дату в поле идентичности — теперь там только цифры номера урока.
check('old date-shaped id rejected', parseTap('a:2026-09-20:0:0') === null);
check('non-numeric lesson rejected', parseTap('a:x:0:0') === null);
check('negative index rejected', parseTap('a:4:-1:0') === null);
check('non-numeric arg rejected', parseTap('a:4:0:abc') === null);
// Number('') === 0: пустое поле не должно разбираться как индекс 0.
check('empty lesson rejected', parseTap('a::0:5') === null);
check('empty index rejected', parseTap('a:4::5') === null);
check('empty arg rejected', parseTap('a:4:3:') === null);
check('empty reset index rejected', parseTap('reset:4:') === null);
check('next without lesson rejected', parseTap('next:') === null);

// --- машина сессии (идентичность теперь номер урока n) ---
const LN = 4; // произвольный номер урока для фикстур; идентичность, не влияет на состав упражнений
const s0: Session = { n: LN, mode: 'lesson', i: 1, missed: [], msgId: 10, picked: [] };
const score = (x: Session) => x.i - x.missed.length;
const d1 = exercises[1] as ChoiceExercise;
const rightIdx = d1.options.indexOf(d1.answer);
const right = applyTap({ ...s0 }, exercises, { op: 'answer', n: LN, i: 1, arg: rightIdx });
check('a correct answer advances and shows feedback', right.view !== null && right.view.text.includes('✅'));
const sWrong: Session = { ...s0, missed: [] };
applyTap(sWrong, exercises, { op: 'answer', n: LN, i: 1, arg: (rightIdx + 1) % 4 });
check('a wrong answer is recorded', sWrong.missed.length === 1 && sWrong.missed[0].endsWith(d1.answer), sWrong.missed);
check('a wrong answer still advances', sWrong.i === 2, sWrong.i);
const sCount: Session = { ...s0, missed: [] };
applyTap(sCount, exercises, { op: 'answer', n: LN, i: 1, arg: rightIdx });
check('a correct answer advances without a miss', sCount.i === 2 && sCount.missed.length === 0);
const before = JSON.stringify(sCount);
const stale = applyTap(sCount, exercises, { op: 'answer', n: LN, i: 1, arg: rightIdx });
check('a repeat tap changes nothing', JSON.stringify(sCount) === before && stale.view === null && stale.toast === STALE, stale.toast);
// Тап по ДРУГОМУ уроку отсекается ровно как раньше вчерашний: номер урока в тапе не совпал с
// сессией. Без этого рубежа тап по прежнему уроку зачёлся бы против упражнения нового.
const cross = applyTap({ ...sCount }, exercises, { op: 'answer', n: LN + 1, i: 2, arg: 0 });
check('a tap for another lesson is refused', cross.view === null && cross.toast === STALE);
const oob = applyTap({ ...s0 }, exercises, { op: 'answer', n: LN, i: 1, arg: 99 });
check('out-of-range option is refused', oob.view === null, oob.toast);

// --- сборка предложения в сессии ---
const sSent: Session = { n: LN, mode: 'lesson', i: 0, missed: [], msgId: 1, picked: [] };
const bank = (exercises[0] as AssembleExercise).bank;
// Снимок экрана сборки ДО того, как цикл ниже сдвинет курсор: только здесь встречаются
// кодировки `w:` и `reset:`, длину которых проверяет AC-14.
const sentenceView = render({ ...sSent, picked: [bank[0].id] }, exercises);
applyTap(sSent, exercises, { op: 'word', n: LN, i: 0, arg: bank[0].id });
check('a tapped word is recorded', sSent.picked.length === 1 && sSent.i === 0);
const dupTap = applyTap(sSent, exercises, { op: 'word', n: LN, i: 0, arg: bank[0].id });
check('the same word cannot be tapped twice', sSent.picked.length === 1 && dupTap.view === null);
const oobWord = applyTap(sSent, exercises, { op: 'word', n: LN, i: 0, arg: 999 });
check('a word id outside the bank is refused', oobWord.view === null, oobWord.toast);
applyTap(sSent, exercises, { op: 'reset', n: LN, i: 0 });
check('reset clears the picks', sSent.picked.length === 0 && sSent.i === 0);
// Повторный сброс при пустом наборе НЕ перерисовывает: иначе Telegram ответил бы 400
// «message is not modified», а вызывающий код продублировал бы сессию.
const emptyReset = applyTap(sSent, exercises, { op: 'reset', n: LN, i: 0 });
check('resetting an empty pick is a no-op', emptyReset.view === null, emptyReset.toast);
for (const id of [...Array(bank.length).keys()]) {
  applyTap(sSent, exercises, { op: 'word', n: LN, i: 0, arg: id });
}
check('assembling in order scores and advances', sSent.i === 1 && score(sSent) === 1, sSent);

// --- итог ---
const done16: Session = { n: LN, mode: 'lesson', i: 16, missed: ['көл: озеро', 'үй → Куда? (барыш): үйгө'], msgId: 1, picked: [] };
check('finished session is detected', isFinished(done16, exercises.length) && !isFinished(s0, exercises.length));
const fin = summary(done16, exercises.length);
// Счёт выводится как «отвечено минус промахи»: 16 − 2.
check('summary derives the score from the misses', fin.text.includes('14 из 16'), fin.text);
check('render past the last exercise is the summary', render(done16, exercises).text === fin.text);
// Последний ответ тоже получает подтверждение — иначе шестнадцатое упражнение осталось бы без ✅/❌.
const last: Session = { n: LN, mode: 'lesson', i: 15, missed: [], msgId: 1, picked: [] };
const lastEx = exercises[15] as ChoiceExercise;
const lastView = applyTap(last, exercises, { op: 'answer', n: LN, i: 15, arg: lastEx.options.indexOf(lastEx.answer) });
check('the last answer is confirmed on the summary screen', lastView.view !== null && lastView.view.text.includes('✅') && lastView.view.text.includes('16 из 16'), lastView.view?.text);
check('summary lists the misses', fin.text.includes('көл: озеро'));
// Итог теперь предлагает «Дальше ▶» — одна кнопка с next-кодировкой текущего урока.
check('lesson summary offers Next + Practice buttons', fin.keyboard.length === 1 && fin.keyboard[0].length === 2, fin.keyboard);
check('the Next button carries the current lesson', fin.keyboard[0][0].callback_data === `next:${LN}`, fin.keyboard[0][0].callback_data);
check('the lesson summary offers a practice button', fin.keyboard[0][1].callback_data === 'practice', fin.keyboard[0][1].callback_data);

// --- callback_data влезает в лимит Telegram ---
const allData = [sentenceView, render({ ...s0, i: 1 }, exercises), fin]
  .flatMap((v) => v.keyboard.flat().map((b) => b.callback_data));
check('every kind of callback_data is measured',
  allData.some((d) => d.startsWith('w:')) && allData.some((d) => d.startsWith('reset:')) &&
  allData.some((d) => d.startsWith('a:')) && allData.some((d) => d.startsWith('next:')), allData);
check('every callback_data is under 64 bytes', allData.every((d) => Buffer.byteLength(d) < 64), Math.max(0, ...allData.map((d) => Buffer.byteLength(d))));

// --- isLiveTap: теперь только msgId (день ни при чём — единица работы урок, не сутки) ---
const liveS: Session = { n: LN, mode: 'lesson', i: 2, missed: [], msgId: 77, picked: [] };
check('the live message is accepted by msgId', isLiveTap(liveS, 77) === true);
check('a foreign message id is refused', isLiveTap(liveS, 78) === false);

// --- прогрессия: чистые правила курсора (PR-002 — проверяемы без bot.ts) ---
check('advanceTarget is the next lesson', advanceTarget({ sentDay: null, cursor: 3, practice: [], session: null }) === 4);
check('advancedToday matches the sent day', advancedToday({ sentDay: '2026-09-20', cursor: 0, practice: [], session: null }, '2026-09-20') === true);
check('advancedToday is false on a new day', advancedToday({ sentDay: '2026-09-19', cursor: 0, practice: [], session: null }, '2026-09-20') === false);
// Монотонный коммит: продвижение не откатывает курсор, даже если ранняя отправка разрешилась позже.
check('commitCursor never regresses', commitCursor(5, 6) === 6 && commitCursor(6, 5) === 6 && commitCursor(0, 0) === 0);
// Незаконченная сессия того же урока продолжается (picked сброшен); чужой урок / доигранная — заново.
const resume = lessonSession({ n: LN, mode: 'lesson', i: 3, missed: ['x'], msgId: 9, picked: [1, 2] }, LN, exercises.length);
check('lessonSession resumes the same unfinished lesson', resume.i === 3 && resume.missed.join() === 'x' && resume.picked.length === 0, resume);
const otherLesson = lessonSession({ n: LN, mode: 'lesson', i: 3, missed: ['x'], msgId: 9, picked: [] }, LN + 1, exercises.length);
check('lessonSession starts fresh for a different lesson', otherLesson.i === 0 && otherLesson.n === LN + 1 && otherLesson.missed.length === 0, otherLesson);
const finishedPrev = lessonSession({ n: LN, mode: 'lesson', i: exercises.length, missed: [], msgId: 9, picked: [] }, LN, exercises.length);
check('lessonSession starts fresh when the previous lesson was finished', finishedPrev.i === 0, finishedPrev);
const noPrev = lessonSession(null, 7, exercises.length);
check('lessonSession starts fresh with no prior session', noPrev.i === 0 && noPrev.n === 7, noPrev);
// «Дальше ▶» инертна, если кнопка не с текущего урока (повтор/устаревший тап по старому итогу).
check('button advances only from the current lesson', shouldAdvanceFromButton({ sentDay: null, cursor: 3, practice: [], session: null }, 3) === true);
check('button is inert on a stale/older lesson tap', shouldAdvanceFromButton({ sentDay: null, cursor: 3, practice: [], session: null }, 2) === false);
// commitDelivery ставит сессию, монотонно двигает курсор и отмечает день (вызывается только на ok).
const cd: ChatState = { sentDay: '2026-09-19', cursor: 5, practice: [], session: null };
const cdSession: Session = { n: 6, mode: 'lesson', i: 0, missed: [], msgId: 99, picked: [] };
commitDelivery(cd, cdSession, 6, '2026-09-20');
check('commitDelivery advances the cursor and marks the day', cd.cursor === 6 && cd.sentDay === '2026-09-20' && cd.session === cdSession, cd);
commitDelivery(cd, { n: 4, mode: 'lesson', i: 0, missed: [], msgId: 1, picked: [] }, 4, '2026-09-20');
check('commitDelivery never regresses the cursor', cd.cursor === 6, cd.cursor);

// --- buildLesson: детерминизм и несовпадение с соседями (прогрессия идёт по номеру, не по дате) ---
check('buildLesson is deterministic for a lesson number', JSON.stringify(buildLesson(deck, 5)) === JSON.stringify(buildLesson(deck, 5)));
check('consecutive lessons differ', JSON.stringify(buildLesson(deck, 5)) !== JSON.stringify(buildLesson(deck, 6)));
check('lessonSeed spreads consecutive lessons', lessonSeed(5) !== lessonSeed(6));
// Урок собирается тем же генератором: тот же состав (1 предложение, 3 дрилла, 12 слов).
const lesson5 = buildLesson(deck, 5);
check('a lesson has the same shape as a daily task', lesson5.drills.length === 3 && lesson5.words.length === 12);

// --- practice.ts: чистые правила набора ---
check('addToPractice adds a new id', addToPractice([], 'кол|озеро').join() === 'кол|озеро');
check('addToPractice dedups', addToPractice(['a|b'], 'a|b').length === 1);
const capped = addToPractice(Array.from({ length: PRACTICE_CAP }, (_, k) => `w${k}|r${k}`), 'new|card');
check('addToPractice caps and drops oldest', capped.length === PRACTICE_CAP && capped[capped.length - 1] === 'new|card' && capped[0] === 'w1|r1', capped.length);
check('selectPractice returns oldest-first, capped', selectPractice(['a|1', 'b|2', 'c|3'], 2).join() === 'a|1,b|2');
check('practiceSeed is deterministic', practiceSeed(['a|1', 'b|2']) === practiceSeed(['a|1', 'b|2']));
check('practiceSeed differs by content', practiceSeed(['a|1']) !== practiceSeed(['a|2']));
// graduate: верные (не в missed) уходят, ошибочные и чужие остаются.
const gset = ['кыз|девочка', 'көл|озеро', 'үй|дом'];
const gradResult = graduatePractice(gset, ['кыз|девочка', 'көл|озеро'], ['көл: озеро']);
check('graduatePractice removes correct session cards', !gradResult.includes('кыз|девочка'), gradResult);
check('graduatePractice keeps missed session cards', gradResult.includes('көл|озеро'), gradResult);
check('graduatePractice leaves non-session cards', gradResult.includes('үй|дом'), gradResult);

// --- buildPracticeExercises: словарные упражнения из набора ---
const realCards = [cardId(deck[0]), cardId(deck[1]), cardId(deck[2])];
const pex = buildPracticeExercises(deck, realCards, 12345);
check('practice builds one exercise per known card', pex.length === 3, pex.length);
check('practice exercises are word-choice', pex.every((e) => e.kind === 'word'), pex.map((e) => e.kind));
check('practice exercise answer/label come from the card', pex[0].answer === deck[0].ru && (pex[0] as ChoiceExercise).label === deck[0].kg);
check('unknown cardId is skipped', buildPracticeExercises(deck, ['zzz|zzz', cardId(deck[0])], 1).length === 1);
check('buildPracticeExercises is deterministic', JSON.stringify(buildPracticeExercises(deck, realCards, 7)) === JSON.stringify(buildPracticeExercises(deck, realCards, 7)));
// cardId прямо из словарного упражнения (label=kg, answer=ru) — общий helper auto-add/handleAdd.
check('wordCardId maps a word exercise to its cardId', wordCardId(pex[0] as ChoiceExercise) === realCards[0], wordCardId(pex[0] as ChoiceExercise));
check('wordCardId is null for a non-word exercise', wordCardId({ kind: 'drill', label: 'x', answer: 'y' }) === null);

// --- parseTap: новые операции ---
const addTap = parseTap('add:5:2');
check('parseTap add', addTap?.op === 'add' && addTap.n === 5 && addTap.i === 2, addTap);
check('parseTap practice', parseTap('practice')?.op === 'practice');
check('parseTap add without index rejected', parseTap('add:5') === null);

// --- stale-tap isolation: тренировка (PRACTICE_N) и урок взаимно неактуальны ---
const practiceSess: Session = { n: 1_000_000_000, mode: 'practice', cards: realCards, seed: 12345, i: 0, missed: [], msgId: 5, picked: [] };
const lessonTapOnPractice = applyTap({ ...practiceSess }, pex, { op: 'answer', n: 4, i: 0, arg: 0 });
check('a lesson tap on a practice session is refused', lessonTapOnPractice.view === null && lessonTapOnPractice.toast === STALE);

// --- practice migration: mode + practice round-trip through disk ---
const pFile = join(dir, 'practice.json');
await saveState(pFile, {
  offset: 0,
  chats: { '9': { sentDay: null, cursor: 2, practice: ['кыз|девочка'], session: practiceSess } },
});
const pBack = await loadState(pFile);
check('round-trip keeps the practice set', pBack.chats['9'].practice.join() === 'кыз|девочка', pBack.chats['9'].practice);
check('round-trip keeps a practice session mode+cards+seed', pBack.chats['9'].session?.mode === 'practice' && pBack.chats['9'].session?.cards?.length === 3 && pBack.chats['9'].session?.seed === 12345, pBack.chats['9'].session);
// старая запись без practice/mode → practice [], session mode 'lesson'
const oldFile = join(dir, 'old-practice.json');
await writeFile(oldFile, JSON.stringify({ offset: 0, chats: { '1': { sentDay: null, cursor: 1, session: { n: 1, i: 0, missed: [], msgId: 3, picked: [] } } } }), 'utf8');
const oldBack = await loadState(oldFile);
check('missing practice migrates to []', Array.isArray(oldBack.chats['1'].practice) && oldBack.chats['1'].practice.length === 0);
check('session without mode migrates to lesson', oldBack.chats['1'].session?.mode === 'lesson', oldBack.chats['1'].session);

// --- callback_data: новые операции влезают в лимит ---
const pView = render(practiceSess, pex);
const newData = ['add:1000000000:15', 'practice', ...pView.keyboard.flat().map((b) => b.callback_data)];
check('new callback_data is under 64 bytes', newData.every((d) => Buffer.byteLength(d) < 64), Math.max(0, ...newData.map((d) => Buffer.byteLength(d))));
check('practice summary offers a 🎯 Ещё button', summary(practiceSess, pex.length).keyboard[0][0].callback_data === 'practice');

// --- grammar tracks (Stage 2) ---
check('GRAMMAR_TRACKS is non-empty', GRAMMAR_TRACKS.length >= 1, GRAMMAR_TRACKS.length);
// Дрейф-страж: если task-метку переименуют в morphology.ts, трек перестанет давать дриллы.
check('every grammar track yields drills', GRAMMAR_TRACKS.every((t) => buildDrills(8, 1, t.tasks).length > 0), GRAMMAR_TRACKS.map((t) => buildDrills(8, 1, t.tasks).length));
check('grammarTrack returns a track for a valid index', grammarTrack(0)?.title === GRAMMAR_TRACKS[0].title);
check('grammarTrack rejects out-of-range and non-integer', grammarTrack(-1) === null && grammarTrack(999) === null && grammarTrack(1.5) === null);
const gex = buildGrammarExercises(GRAMMAR_TRACKS[1].tasks, 4242); // Падежи
check('grammar exercises are drills, capped and non-empty', gex.length > 0 && gex.length <= 8 && gex.every((e) => e.kind === 'drill'), gex.length);
check('grammar exercise has a non-empty answer', gex.every((e) => e.answer.length > 0));
check('buildGrammarExercises is deterministic', JSON.stringify(buildGrammarExercises(GRAMMAR_TRACKS[1].tasks, 7)) === JSON.stringify(buildGrammarExercises(GRAMMAR_TRACKS[1].tasks, 7)));
check('different tracks give different drills', buildGrammarExercises(GRAMMAR_TRACKS[0].tasks, 9)[0].prompt !== buildGrammarExercises(GRAMMAR_TRACKS[2].tasks, 9)[0].prompt);
const gramTap = parseTap('gram:2');
check('parseTap gram carries the track index', gramTap?.op === 'grammar' && gramTap.n === 2, gramTap);
check('parseTap gram without index rejected', parseTap('gram:') === null);

// grammar session identity (GRAMMAR_N=2e9) — взаимно неактуальна с уроком и тренировкой.
const gramSess: Session = { n: 2_000_000_000, mode: 'grammar', track: 1, seed: 4242, i: 0, missed: [], msgId: 8, picked: [] };
check('a lesson tap on a grammar session is refused', applyTap({ ...gramSess }, gex, { op: 'answer', n: 4, i: 0, arg: 0 }).toast === STALE);
check('a practice-identity tap on a grammar session is refused', applyTap({ ...gramSess }, gex, { op: 'answer', n: 1_000_000_000, i: 0, arg: 0 }).toast === STALE);
const gAns = gex[0] as ChoiceExercise;
check('the grammar answer is actually among the options', gAns.options.includes(gAns.answer), gAns.options);
const gAdv: Session = { ...gramSess, missed: [] };
const gAdvView = applyTap(gAdv, gex, { op: 'answer', n: 2_000_000_000, i: 0, arg: gAns.options.indexOf(gAns.answer) });
check('a correct grammar answer advances and is scored correct', gAdvView.view !== null && gAdv.i === 1 && gAdv.missed.length === 0, gAdv);
// заголовок и кнопка «🔁 Ещё»
const gSummary = summary(gramSess, gex.length);
check('grammar summary offers one Ещё button', gSummary.keyboard.length === 1 && gSummary.keyboard[0][0].callback_data === 'gram:1', gSummary.keyboard);
check('grammar header shows the track title', render(gramSess, gex).text.includes(GRAMMAR_TRACKS[1].title), render(gramSess, gex).text.slice(0, 40));
check('grammar callback_data under 64 bytes', ['gram:2', ...GRAMMAR_TRACKS.map((_, k) => `gram:${k}`)].every((d) => Buffer.byteLength(d) < 64));

// migration: grammar session round-trips; unknown mode → lesson.
const gFile = join(dir, 'grammar.json');
await saveState(gFile, { offset: 0, chats: { '3': { sentDay: null, cursor: 0, practice: [], session: gramSess } } });
const gBack = await loadState(gFile);
check('round-trip keeps a grammar session', gBack.chats['3'].session?.mode === 'grammar' && gBack.chats['3'].session?.track === 1 && gBack.chats['3'].session?.seed === 4242, gBack.chats['3'].session);
await writeFile(gFile, JSON.stringify({ offset: 0, chats: { '4': { sentDay: null, cursor: 0, practice: [], session: { n: 5, mode: 'bogus', i: 0, missed: [], msgId: 1, picked: [] } } } }), 'utf8');
check('unknown session mode migrates to lesson', (await loadState(gFile)).chats['4'].session?.mode === 'lesson');

// --- bot commands / menu (Stage 3) ---
check('BOT_COMMANDS covers the real commands',
  ['task', 'next', 'practice', 'grammar', 'stop'].every((c) => BOT_COMMANDS.some((b) => b.command === c)), BOT_COMMANDS.map((b) => b.command));
check('no command carries a leading slash (Bot API wants bare names)', BOT_COMMANDS.every((c) => !c.command.startsWith('/')));
check('command names match the Bot API pattern', BOT_COMMANDS.every((c) => /^[a-z0-9_]{1,32}$/.test(c.command)), BOT_COMMANDS.map((b) => b.command));
check('descriptions are non-empty and within 256 chars', BOT_COMMANDS.every((c) => c.description.length > 0 && c.description.length <= 256));
check('descriptions stay HTML-safe (rendered under parse_mode HTML)', BOT_COMMANDS.every((c) => !/[<>&]/.test(c.description)));
const help = commandsHelp();
check('commandsHelp lists every command as /cmd — desc', BOT_COMMANDS.every((c) => help.includes(`/${c.command} — ${c.description}`)), help);

// --- user identity ---
const pu = parseUser({ id: 42, username: 'bob', first_name: 'Боб', extra: 'ignored' });
check('parseUser maps raw from → identity', pu?.id === 42 && pu.username === 'bob' && pu.firstName === 'Боб', pu);
check('parseUser drops a non-finite id', parseUser({ username: 'x' }) === undefined && parseUser({ id: NaN }) === undefined);
check('parseUser drops non-string username/name', (() => { const u = parseUser({ id: 1, username: 5, first_name: {} }); return u?.id === 1 && u.username === undefined && u.firstName === undefined; })());
check('parseUser accepts the persisted shape (firstName)', parseUser({ id: 7, firstName: 'Ана' })?.firstName === 'Ана');
check('parseUser strips CR/LF from the name (log hygiene)', parseUser({ id: 1, first_name: 'a\nb' })?.firstName === 'a b');

// rememberUser: only on a subscribed chat, idempotent, updates on change
const us = emptyState();
check('rememberUser is a no-op for an unknown chat', rememberUser(us, 1, { id: 1, username: 'a' }) === false && us.chats['1'] === undefined);
addChat(us, 1);
check('rememberUser records identity on a subscribed chat', rememberUser(us, 1, { id: 1, username: 'a', first_name: 'A' }) === true && us.chats['1'].user?.username === 'a');
check('rememberUser is idempotent on unchanged identity', rememberUser(us, 1, { id: 1, username: 'a', first_name: 'A' }) === false);
check('rememberUser updates on a changed username', rememberUser(us, 1, { id: 1, username: 'a2', first_name: 'A' }) === true && us.chats['1'].user?.username === 'a2');
check('rememberUser updates on a changed name only', rememberUser(us, 1, { id: 1, username: 'a2', first_name: 'Б' }) === true && us.chats['1'].user?.firstName === 'Б');
const esc = String.fromCharCode(27); // ESC (0x1b) — C0 control, must be stripped
check("parseUser strips ANSI/C0 escapes from the name", parseUser({ id: 1, first_name: `a${esc}[31mX` })?.firstName === "a [31mX");

// migration: identity round-trips; a chat without user loads fine
const uFile = join(dir, 'identity.json');
await saveState(uFile, { offset: 0, chats: {
  '1': { sentDay: null, cursor: 2, practice: [], user: { id: 1, username: 'zed', firstName: 'Зед' }, session: null },
  '2': { sentDay: null, cursor: 0, practice: [], session: null },
} });
const uBack = await loadState(uFile);
check('round-trip keeps user identity', uBack.chats['1'].user?.id === 1 && uBack.chats['1'].user?.username === 'zed' && uBack.chats['1'].user?.firstName === 'Зед', uBack.chats['1'].user);
check('a chat without user loads with user absent', uBack.chats['2'].user === undefined && uBack.chats['2'].cursor === 0);

await rm(dir, { recursive: true, force: true });
done('BOT OK');
