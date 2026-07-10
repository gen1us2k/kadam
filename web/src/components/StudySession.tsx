import { useEffect, useMemo, useRef, useState } from 'react';
import { buildQueue, cardId, deckStats, grade, loadStore, saveStore } from '../lib/srs';
import type { DeckCard, Store } from '../lib/srs';
import { loadDaily, recordAnswer } from '../lib/daily';
import type { DailyState } from '../lib/daily';
import SpeakButton from './SpeakButton';

interface Props {
  /** Full vocabulary deck (also used to draw distractor options). */
  deck: DeckCard[];
  /** Optional tag filter: a week ("week03") or a CEFR level ("b1"). */
  week?: string;
}

/**
 * Card mode ladder (recognition → production):
 * new cards — multiple choice KG→RU; young — multiple choice RU→KG;
 * mature — typed RU→KG, alternating with cloze when an example exists.
 */
type Mode = 'mc' | 'mcrev' | 'typed' | 'cloze';

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
  if (clozeToken(card) && st.reps % 2 === 0) return 'cloze';
  return 'typed';
}

const KG_LETTERS = ['ң', 'ө', 'ү'];

export default function StudySession({ deck, week }: Props) {
  const [ready, setReady] = useState(false);
  const storeRef = useRef<Store>({});
  const [queue, setQueue] = useState<DeckCard[]>([]);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<null | { correct: boolean; picked?: string }>(null);
  const [typedValue, setTypedValue] = useState('');
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [daily, setDaily] = useState<DailyState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const store = loadStore();
    storeRef.current = store;
    setQueue(buildQueue(deck, store, Date.now(), { week }));
    setDaily(loadDaily());
    setReady(true);
  }, [deck, week]);

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
    store[cardId(card)] = grade(store[cardId(card)], correct, Date.now());
    saveStore(store);
    setDaily(recordAnswer());
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
    setAnswered({ correct, picked });
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
    setQueue(buildQueue(deck, storeRef.current, Date.now(), { week }));
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

  if (!ready) return <p className="study-meta">Загрузка…</p>;

  const stats = deckStats(deck, storeRef.current, Date.now(), week);
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
    return (
      <div className="study-summary">
        <h2>Готово!</h2>
        <p>Правильно {score.correct} из {score.total}.</p>
        <p className="study-meta">{dailyLine} · Изучено {stats.seen} из {stats.total}.</p>
        <button className="btn" onClick={restart}>Ещё круг</button>
      </div>
    );
  }

  const isChoice = mode === 'mc' || mode === 'mcrev';
  const promptLabel =
    mode === 'mc' ? 'Переведите на русский:'
    : mode === 'mcrev' ? 'Как это по-кыргызски?'
    : mode === 'typed' ? 'Напишите по-кыргызски:'
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
        <div className={mode === 'cloze' ? 'prompt-cloze' : 'prompt-kg'}>{promptText}</div>
        {mode === 'cloze' && <div className="study-meta">Подсказка: {card.ru}</div>}

        {isChoice && (
          <div className="choices">
            {options.map((opt) => {
              const rightOpt = mode === 'mc' ? card.ru : card.kg;
              let cls = 'choice';
              if (answered) {
                if (opt === rightOpt) cls += ' correct';
                else if (opt === answered.picked) cls += ' wrong';
              }
              return (
                <button key={opt} className={cls} onClick={() => commit(opt === rightOpt, opt)} disabled={!!answered}>
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {!isChoice && (
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
          </div>
        )}
      </div>
      <div className="study-footer">
        <div className="study-meta">Счёт: {score.correct} / {score.total}{dailyLine ? ` · ${dailyLine}` : ''}</div>
        {answered && (
          <button className="btn" onClick={next}>
            {index + 1 < queue.length ? 'Далее' : 'Завершить'}
          </button>
        )}
      </div>
    </div>
  );
}
