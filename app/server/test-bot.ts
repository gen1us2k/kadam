// Регрессионные проверки Telegram-бота: детерминизм задания дня, состав и длина сообщения,
// круговорот состояния через диск, гонка одновременных записей и классификация ответов Telegram
// API. Сети здесь нет — сетевой слой сведён к чистым classifyResponse и classifyPoll ради этого.
// Запуск: `npm test` (Node >=23 исполняет .ts напрямую).

import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecker } from './test-util.ts';
import { buildDailyTask, escapeHtml, loadDeck, renderTask, TELEGRAM_MAX_CHARS } from './daily-task.ts';
import { addChat, emptyState, loadState, removeChat, saveState, shouldSend } from './bot-state.ts';
import { classifyPoll, classifyResponse } from './telegram.ts';
import { parseVocab, mergeVocab, cardId } from '../src/lib/vocab-parse.ts';
import { pickSentences } from '../src/lib/sentences.ts';
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
const broken = await loadState(file);
check('corrupt file yields empty state', broken.chats.length === 0 && broken.offset === 0 && broken.lastSentDay === null);
check('missing file yields empty state', (await loadState(join(dir, 'nope.json'))).chats.length === 0);

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

done('BOT OK');
