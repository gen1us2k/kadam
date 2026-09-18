// Регрессионные проверки Telegram-бота: детерминизм задания дня, состав и длина сообщения,
// круговорот состояния через диск, гонка одновременных записей и классификация ответов Telegram
// API. Сети здесь нет — сетевой слой сведён к чистым classifyResponse и classifyPoll ради этого.
// Запуск: `npm test` (Node >=23 исполняет .ts напрямую).

import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecker } from './test-util.ts';
import { buildDailyTask, escapeHtml, loadDeck, renderTask, TELEGRAM_MAX_CHARS } from './daily-task.ts';
import { addChat, emptyState, loadState, removeChat, saveState, shouldSend } from './bot-state.ts';
import { broadcast } from './broadcast.ts';
import { classifyPoll, classifyResponse, sendMessage, type SendOutcome } from './telegram.ts';
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

const rendered = renderTask(a);
check('message under Telegram limit', rendered.length < TELEGRAM_MAX_CHARS, rendered.length);
check('message carries the day', rendered.includes('2026-09-19'));
check('answers are spoilered', rendered.includes('<tg-spoiler>'));
check('escapes html metacharacters', escapeHtml('a & b <c> d') === 'a &amp; b &lt;c&gt; d', escapeHtml('a & b <c> d'));
const huge = renderTask({ ...a, words: Array.from({ length: 4000 }, () => a.words[0]) });
check('oversized task is truncated to the limit', huge.length <= TELEGRAM_MAX_CHARS, huge.length);
check('truncation keeps whole entries', !huge.endsWith('<i>') && (huge.match(/<i>/g) ?? []).length === (huge.match(/<\/i>/g) ?? []).length);

// --- bot-state: подписки, круговорот через диск, атомарность ---
const st = emptyState();
check('add returns true for a new chat', addChat(st, 1) === true);
check('add is idempotent', addChat(st, 1) === false && st.chats.length === 1, st.chats);
check('remove returns true when subscribed', removeChat(st, 1) === true && st.chats.length === 0);
check('remove is idempotent', removeChat(st, 1) === false);

const dir = await mkdtemp(join(tmpdir(), 'kadam-bot-'));
const file = join(dir, 'nested', 'bot-state.json');
addChat(st, 42);
st.offset = 777;
st.lastSentDay = '2026-09-19';
await saveState(file, st);
const back = await loadState(file);
check('round-trip keeps chats', back.chats.join() === '42', back.chats);
check('round-trip keeps offset', back.offset === 777, back.offset);
check('round-trip keeps lastSentDay', back.lastSentDay === '2026-09-19', back.lastSentDay);
check('no .tmp left behind', (await readdir(join(dir, 'nested'))).join() === 'bot-state.json', await readdir(join(dir, 'nested')));

await writeFile(file, '{ this is not json', 'utf8');
const realError = console.error;
const logged: unknown[] = [];
console.error = (...args: unknown[]) => void logged.push(args);
// finally: if loadState ever rejects here, later check() failures must still be able to print.
const broken = await loadState(file).finally(() => {
  console.error = realError;
});
check('corrupt file yields empty state', broken.chats.length === 0 && broken.offset === 0 && broken.lastSentDay === null);
check('corrupt file is reported, not silent', logged.length === 1, logged);
await writeFile(file, 'null', 'utf8');
check('literal null yields empty state', (await loadState(file)).chats.length === 0);
check('missing file yields empty state', (await loadState(join(dir, 'nope.json'))).chats.length === 0);
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

// --- broadcast: порядок операций, удаление ушедших, /stop посреди рассылки ---
const bState = { ...emptyState(), chats: [1, 2, 3, 4] };
const events: string[] = [];
const outcomes: Record<number, SendOutcome> = {
  1: { kind: 'ok' },
  2: { kind: 'drop', reason: 'blocked' },
  3: { kind: 'transient', reason: 'http 500' },
};
const result = await broadcast(bState, '2026-09-19', 'task', {
  send: async (chatId) => {
    events.push(`send:${chatId}:claimed=${bState.lastSentDay}`);
    if (chatId === 1) removeChat(bState, 4); // chat 4 sends /stop while the broadcast is running
    return outcomes[chatId] as Exclude<SendOutcome, { kind: 'retry' }>;
  },
  save: async (s) => void events.push(`save:${s.lastSentDay}:same=${s === bState}`),
  log: (line) => void events.push(`log:${line}`),
  gapMs: 0,
});
check('day is persisted before the first send', events[0] === 'save:2026-09-19:same=true' && events[1] === 'send:1:claimed=2026-09-19', events);
check('state is persisted again after the loop', events.at(-1) === 'save:2026-09-19:same=true', events);
check('counts sent / dropped / failed', result.sent === 1 && result.dropped === 1 && result.failed === 1, result);
// Logged the moment it happens (before the next send), so a failing final save cannot eat it.
check('drop is logged live', events.indexOf('log:dropped 2: blocked') < events.findIndex((e) => e.startsWith('send:3')), events);
check('failure is logged live', events.includes('log:send to 3 failed: http 500'), events);
check('gone subscriber is removed, failing one is kept', bState.chats.join() === '1,3', bState.chats);
check('/stop mid-broadcast is honoured', !events.some((e) => e.startsWith('send:4')), events);

// --- shouldSend: раз в сутки, переживает рестарт ---
const fresh = emptyState();
check('before send time -> no', shouldSend(fresh, '09:00', new Date('2026-09-19T08:59:00')) === false);
check('at send time -> yes', shouldSend(fresh, '09:00', new Date('2026-09-19T09:00:00')) === true);
check('after send time -> yes (catch-up)', shouldSend(fresh, '09:00', new Date('2026-09-19T23:30:00')) === true);
const sentToday = { ...emptyState(), lastSentDay: '2026-09-19' };
check('already sent today -> no', shouldSend(sentToday, '09:00', new Date('2026-09-19T18:00:00')) === false);
check('next day before time -> no', shouldSend(sentToday, '09:00', new Date('2026-09-20T03:00:00')) === false);
check('next day after time -> yes', shouldSend(sentToday, '09:00', new Date('2026-09-20T09:01:00')) === true);

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
globalThis.fetch = realFetch;

// --- pickDeterministic never hands out the caller's own array ---
const tiny = ['a', 'b'];
check('small pool is copied, not aliased', pickDeterministic(tiny, 5, 1) !== tiny && pickDeterministic(tiny, 5, 1).join() === 'a,b');

await rm(dir, { recursive: true, force: true });
done('BOT OK');
