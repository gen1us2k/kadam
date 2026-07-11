import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildQueue, cardId, deckStats, grade, gradeAnswer, isUnverified,
  loadLearnList, loadStore, removeFromLearn, saveStore,
} from '../lib/srs';
import type { CardState, DeckCard, Grade, Store } from '../lib/srs';
import { loadDaily, recordAnswer } from '../lib/daily';
import type { DailyState } from '../lib/daily';
import { speak } from '../lib/tts';
import SpeakButton from './SpeakButton';
import SpeakPractice from './SpeakPractice';

interface Props {
  /** Full vocabulary deck (also used to draw distractor options). */
  deck: DeckCard[];
  /** Optional tag filter: a step ("step03") or a CEFR level ("b1"). */
  tag?: string;
}

/**
 * Card mode ladder (recognition → production):
 * new cards — multiple choice KG→RU; young — multiple choice RU→KG;
 * mature — rotates dictation (listen → type), cloze, speaking (say it aloud) and typed RU→KG.
 */
type Mode = 'mc' | 'mcrev' | 'typed' | 'cloze' | 'listen' | 'speak';

/** Pronunciation pass threshold (mean per-letter GOP, 0..1) for a mature spoken card. */
const SPEAK_PASS = 0.5;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

/** Find the example token that inflects the headword (longest shared prefix). */
function clozeToken(card: DeckCard): string | null {
  if (!card.example || card.kg.includes(' ')) return null;
  const kg = card.kg.toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const raw of card.example.split(/\s+/)) {
    const token = raw.replace(/[.,!?;:«»()]/g, '');
    if (token.length < 3) continue;
    const t = token.toLowerCase();
    let i = 0;
    while (i < Math.min(t.length, kg.length) && t[i] === kg[i]) i++;
    if (i >= 3 && i >= Math.floor(kg.length * 0.6) && i > bestLen) {
      best = token;
      bestLen = i;
    }
  }
  return best;
}

function modeFor(card: DeckCard, store: Store): Mode {
  const st = store[cardId(card)];
  if (!st || st.reps < 2) return 'mc';
  if (st.s < 7) return 'mcrev';
  // Mature: rotate dictation / cloze / speaking / typed for varied production practice.
  const slot = st.reps % 4;
  if (slot === 0) return 'listen';
  if (slot === 1) return clozeToken(card) ? 'cloze' : 'typed';
  if (slot === 2) return 'speak';
  return 'typed';
}

const KG_LETTERS = ['ң', 'ө', 'ү'];

export default function StudySession({ deck, tag }: Props) {
  const [ready, setReady] = useState(false);
  const storeRef = useRef<Store>({});
  const [queue, setQueue] = useState<DeckCard[]>([]);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<null | { correct: boolean; picked?: string; prev?: CardState }>(null);
  const [typedValue, setTypedValue] = useState('');
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [daily, setDaily] = useState<DailyState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const store = loadStore();
    storeRef.current = store;
    setQueue(buildQueue(deck, store, Date.now(), { tag, priority: loadLearnList() }));
    setDaily(loadDaily());
    setReady(true);
  }, [deck, tag]);

  const card = queue[index];
  const mode = useMemo(() => (card ? modeFor(card, storeRef.current) : 'mc'), [card]);
  const cloze = useMemo(() => (card && mode === 'cloze' ? clozeToken(card) : null), [card, mode]);

  const options = useMemo(() => {
    if (!card || (mode !== 'mc' && mode !== 'mcrev')) return [];
    if (mode === 'mc') {
      const pool = [...new Set(deck.map((c) => c.ru))].filter((ru) => ru !== card.ru);
      return shuffle([card.ru, ...shuffle(pool).slice(0, 3)]);
    }
    const pool = [...new Set(deck.map((c) => c.kg))].filter((kg) => kg !== card.kg);
    return shuffle([card.kg, ...shuffle(pool).slice(0, 3)]);
  }, [card, mode, deck]);

  function commit(correct: boolean, picked?: string) {
    if (answered || !card) return;
    const store = storeRef.current;
    const id = cardId(card);
    const prev = store[id];
    store[id] = grade(prev, correct, Date.now());
    saveStore(store);
    removeFromLearn(id); // studied now — no longer needs hand-picked priority
    setDaily(recordAnswer());
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    setAnswered({ correct, picked, prev });
  }

  /** Optional post-answer refinement: replace the auto-applied Good with Hard/Easy, then advance. */
  function regradeAndNext(g: Grade) {
    if (!answered || !card) return;
    const store = storeRef.current;
    store[cardId(card)] = gradeAnswer(answered.prev, g, Date.now());
    saveStore(store);
    next();
  }

  function submitTyped() {
    if (!card) return;
    const expected = mode === 'cloze' && cloze ? cloze : card.kg;
    commit(norm(typedValue) === norm(expected), typedValue);
  }

  function next() {
    setAnswered(null);
    setTypedValue('');
    setIndex((i) => i + 1);
  }

  function restart() {
    setQueue(buildQueue(deck, storeRef.current, Date.now(), { tag, priority: loadLearnList() }));
    setIndex(0);
    setAnswered(null);
    setTypedValue('');
    setScore({ correct: 0, total: 0 });
  }

  function insertLetter(ch: string) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? typedValue.length;
    const end = el.selectionEnd ?? typedValue.length;
    const nextVal = typedValue.slice(0, start) + ch + typedValue.slice(end);
    setTypedValue(nextVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  }

  const isChoice = mode === 'mc' || mode === 'mcrev';

  // Keyboard: number keys pick MC options; after answering, Enter/Space advance and 1/2 regrade;
  // Alt+R replays the word's audio. Typing keys are left to the focused input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey && (e.key === 'r' || e.key === 'к')) {
        if (card) { e.preventDefault(); speak(card.kg).catch(() => {}); }
        return;
      }
      const inInput = (document.activeElement as HTMLElement | null)?.tagName === 'INPUT';
      if (inInput) return; // the focused input owns typing + Enter-to-submit
      if (!answered) {
        if (isChoice) {
          const n = Number(e.key);
          if (n >= 1 && n <= options.length) {
            e.preventDefault();
            const right = mode === 'mc' ? card!.ru : card!.kg;
            commit(options[n - 1] === right, options[n - 1]);
          }
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
      else if (answered.correct && e.key === '1') { e.preventDefault(); regradeAndNext(2); }
      else if (answered.correct && e.key === '2') { e.preventDefault(); regradeAndNext(4); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closures read fresh state each render
  }, [answered, card, mode, isChoice, options]);

  if (!ready) return <p className="study-meta">Загрузка…</p>;

  const stats = deckStats(deck, storeRef.current, Date.now(), tag);
  const dailyLine = daily ? `Сегодня: ${daily.done}/${daily.goal}${daily.streak ? ` · 🔥 ${daily.streak}` : ''}` : '';

  if (queue.length === 0) {
    return (
      <div className="study-summary">
        <p>На сейчас повторять нечего — всё по расписанию. 👌</p>
        <p className="study-meta">Изучено {stats.seen} из {stats.total}. {dailyLine}</p>
      </div>
    );
  }

  if (index >= queue.length) {
    const pct = score.total ? Math.round((score.correct / score.total) * 100) : 0;
    return (
      <div className="study-summary">
        <h2>Готово!</h2>
        <ul className="recap">
          <li><span>Правильно</span><b>{score.correct} / {score.total} ({pct}%)</b></li>
          <li><span>Удержано слов</span><b>{stats.retained} / {stats.total}</b></li>
          {daily && <li><span>Дневная цель</span><b>{daily.done}/{daily.goal}{daily.streak ? ` · 🔥 ${daily.streak}` : ''}</b></li>}
          {stats.leeches > 0 && <li><span>Трудные («пиявки»)</span><b>{stats.leeches} — разобрать отдельно</b></li>}
        </ul>
        <button className="btn" onClick={restart}>Ещё круг</button>
      </div>
    );
  }

  const promptLabel =
    mode === 'mc' ? 'Переведите на русский:'
    : mode === 'mcrev' ? 'Как это по-кыргызски?'
    : mode === 'typed' ? 'Напишите по-кыргызски:'
    : mode === 'listen' ? 'Прослушайте и впишите по-кыргызски:'
    : mode === 'speak' ? 'Произнесите по-кыргызски:'
    : 'Впишите пропущенное слово:';
  const promptText =
    mode === 'mc' ? card.kg
    : mode === 'cloze' && cloze && card.example ? card.example.replace(cloze, '____')
    : card.ru;
  const expectedAnswer = mode === 'cloze' && cloze ? cloze : mode === 'mc' ? card.ru : card.kg;

  return (
    <div className="study">
      <div className="study-progress">Вопрос {index + 1} / {queue.length}</div>
      <div className="study-card">
        <div className="prompt-label">{promptLabel}</div>
        {mode === 'listen' ? (
          <div className="prompt-listen">
            <SpeakButton text={card.kg} title="Прослушать снова" />
            <span className="study-meta">Нажмите 🔊 и запишите, что услышали</span>
          </div>
        ) : (
          <div className={mode === 'cloze' ? 'prompt-cloze' : 'prompt-kg'}>
            {promptText}
            {mode === 'speak' && <> <SpeakButton text={card.kg} title="Послушать образец" /></>}
          </div>
        )}
        {mode === 'cloze' && <div className="study-meta">Подсказка: {card.ru}</div>}

        {isChoice && (
          <div className="choices">
            {options.map((opt, i) => {
              const rightOpt = mode === 'mc' ? card.ru : card.kg;
              let cls = 'choice';
              if (answered) {
                if (opt === rightOpt) cls += ' correct';
                else if (opt === answered.picked) cls += ' wrong';
              }
              return (
                <button key={opt} className={cls} onClick={() => commit(opt === rightOpt, opt)} disabled={!!answered}>
                  <span className="choice-key">{i + 1}</span> {opt}
                </button>
              );
            })}
          </div>
        )}

        {mode === 'speak' && (
          <div>
            {!answered && (
              <SpeakPractice key={cardId(card)} target={card.kg} onResult={(a) => commit(a.percent >= SPEAK_PASS * 100)} />
            )}
            {!answered && (
              <button className="btn ghost" onClick={() => commit(true)} title="Пропустить произношение">
                не сейчас
              </button>
            )}
          </div>
        )}

        {(mode === 'typed' || mode === 'cloze' || mode === 'listen') && (
          <div className="typed">
            <input
              ref={inputRef}
              type="text"
              value={typedValue}
              disabled={!!answered}
              onChange={(e) => setTypedValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !answered) submitTyped(); }}
              placeholder="кыргызча…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="typed-tools">
              {KG_LETTERS.map((ch) => (
                <button key={ch} className="kbd-btn" onClick={() => insertLetter(ch)} disabled={!!answered}>{ch}</button>
              ))}
              {!answered && <button className="btn" onClick={submitTyped}>Проверить</button>}
            </div>
          </div>
        )}

        {answered && (
          <div className={`study-feedback ${answered.correct ? 'ok' : 'bad'}`}>
            <div>
              {answered.correct ? '✓ Верно' : `✗ Правильно: ${expectedAnswer}`}
              {' '}
              <SpeakButton text={card.kg} />
            </div>
            {card.example && (
              <div className="study-example">
                {card.example} <SpeakButton text={card.example} title="Озвучить пример" />
              </div>
            )}
            {isUnverified(card) && (
              <div className="study-meta unverified-note">⚠ Перевод сгенерирован, не проверен носителем</div>
            )}
          </div>
        )}
      </div>
      <div className="study-footer">
        <div className="study-meta">Счёт: {score.correct} / {score.total}{dailyLine ? ` · ${dailyLine}` : ''}</div>
        {answered && (
          <div className="grade-btns">
            {answered.correct && (
              <button className="btn ghost" onClick={() => regradeAndNext(2)} title="Вспомнил с трудом — показать раньше">
                Тяжело
              </button>
            )}
            <button className="btn" onClick={next}>
              {index + 1 < queue.length ? 'Далее' : 'Завершить'}
            </button>
            {answered.correct && (
              <button className="btn ghost" onClick={() => regradeAndNext(4)} title="Слишком легко — показать намного позже">
                Легко
              </button>
            )}
          </div>
        )}
        <div className="kbd-hints">
          {isChoice && !answered && <><kbd>1</kbd>–<kbd>4</kbd> выбор · </>}
          {answered && <><kbd>Enter</kbd> далее · {answered.correct && <><kbd>1</kbd> тяжело <kbd>2</kbd> легко · </>}</>}
          <kbd>Alt</kbd>+<kbd>R</kbd> прослушать
        </div>
      </div>
    </div>
  );
}
