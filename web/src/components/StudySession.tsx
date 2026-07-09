import { useEffect, useMemo, useRef, useState } from 'react';
import { buildQueue, cardId, deckStats, grade, loadStore, saveStore } from '../lib/srs';
import type { DeckCard, Store } from '../lib/srs';

interface Props {
  /** Full vocabulary deck (also used to draw distractor options). */
  deck: DeckCard[];
  /** Optional week tag, e.g. "week03", to study only that week's words. */
  week?: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOptions(card: DeckCard, deck: DeckCard[]): string[] {
  const pool = [...new Set(deck.map((c) => c.ru))].filter((ru) => ru !== card.ru);
  return shuffle([card.ru, ...shuffle(pool).slice(0, 3)]);
}

export default function StudySession({ deck, week }: Props) {
  const [ready, setReady] = useState(false);
  const storeRef = useRef<Store>({});
  const [queue, setQueue] = useState<DeckCard[]>([]);
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  useEffect(() => {
    const store = loadStore();
    storeRef.current = store;
    setQueue(buildQueue(deck, store, Date.now(), { week }));
    setReady(true);
  }, [deck, week]);

  const card = queue[index];
  const options = useMemo(() => (card ? buildOptions(card, deck) : []), [card, deck]);

  function answer(opt: string) {
    if (choice || !card) return;
    setChoice(opt);
    const correct = opt === card.ru;
    const store = storeRef.current;
    store[cardId(card)] = grade(store[cardId(card)], correct, Date.now());
    saveStore(store);
    setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
  }

  function next() {
    setChoice(null);
    setIndex((i) => i + 1);
  }

  function restart() {
    setQueue(buildQueue(deck, storeRef.current, Date.now(), { week }));
    setIndex(0);
    setChoice(null);
    setScore({ correct: 0, total: 0 });
  }

  if (!ready) return <p className="study-meta">Загрузка…</p>;

  const stats = deckStats(deck, storeRef.current, Date.now(), week);

  if (queue.length === 0) {
    return (
      <div className="study-summary">
        <p>На сейчас повторять нечего — всё по расписанию. 👌</p>
        <p className="study-meta">Изучено {stats.seen} из {stats.total}. Возвращайтесь позже.</p>
      </div>
    );
  }

  if (index >= queue.length) {
    return (
      <div className="study-summary">
        <h2>Готово!</h2>
        <p>Правильно {score.correct} из {score.total}.</p>
        <p className="study-meta">Слова вернутся на повторение по расписанию. Изучено {stats.seen} из {stats.total}.</p>
        <button className="btn" onClick={restart}>Ещё круг</button>
      </div>
    );
  }

  return (
    <div className="study">
      <div className="study-progress">Вопрос {index + 1} / {queue.length}</div>
      <div className="study-card">
        <div className="prompt-label">Переведите на русский:</div>
        <div className="prompt-kg">{card.kg}</div>
        <div className="choices">
          {options.map((opt) => {
            let cls = 'choice';
            if (choice) {
              if (opt === card.ru) cls += ' correct';
              else if (opt === choice) cls += ' wrong';
            }
            return (
              <button key={opt} className={cls} onClick={() => answer(opt)} disabled={!!choice}>
                {opt}
              </button>
            );
          })}
        </div>
        {choice && card.example && (
          <div className="study-example">{card.example}</div>
        )}
      </div>
      <div className="study-footer">
        <div className="study-meta">Счёт: {score.correct} / {score.total}</div>
        {choice && (
          <button className="btn" onClick={next}>
            {index + 1 < queue.length ? 'Далее' : 'Завершить'}
          </button>
        )}
      </div>
    </div>
  );
}
