import { useMemo, useState } from 'react';
import { pickSentences } from '../lib/sentences';
import { daySeed, recordAnswer } from '../lib/daily';
import SpeakButton from './SpeakButton';

interface Props {
  /** Optional step tag, e.g. "step04". Omit for a mixed set. */
  tag?: string;
  count?: number;
}

interface Chip {
  w: string;
  id: number;
}

/** Shuffle the words into a bank; avoid handing back the already-correct order. */
function makeBank(words: string[], seed: number): Chip[] {
  const chips = words.map((w, id) => ({ w, id }));
  if (chips.length < 2) return chips;
  let x = seed || 1;
  const next = () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return Math.abs(x);
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    for (let i = chips.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      [chips[i], chips[j]] = [chips[j], chips[i]];
    }
    if (chips.some((c, i) => c.id !== i)) break; // not the original order
  }
  return chips;
}

/** Sentence-building drill: reassemble a Kyrgyz sentence (SOV) from a shuffled word bank. */
export default function SentenceBuild({ tag, count = 6 }: Props) {
  const sentences = useMemo(() => pickSentences(count, daySeed(), tag), [count, tag]);
  const [index, setIndex] = useState(0);
  const [placed, setPlaced] = useState<number[]>([]);
  const [answered, setAnswered] = useState<null | boolean>(null);
  const [score, setScore] = useState(0);

  const sentence = sentences[index];
  const bank = useMemo(
    () => (sentence ? makeBank(sentence.words, daySeed() + index * 97) : []),
    [sentence, index],
  );

  if (!sentence) {
    return <div className="study-summary"><p>Здесь пока нет предложений для сборки.</p></div>;
  }

  if (index >= sentences.length) {
    return (
      <div className="study-summary">
        <p>Предложения на сегодня собраны: {score} из {sentences.length}. 🧩</p>
      </div>
    );
  }

  const byId = (id: number) => bank.find((c) => c.id === id)!.w;
  const remaining = bank.filter((c) => !placed.includes(c.id));
  const built = placed.map(byId);

  function place(id: number) {
    if (answered !== null) return;
    setPlaced((p) => [...p, id]);
  }

  function unplace(id: number) {
    if (answered !== null) return;
    setPlaced((p) => p.filter((x) => x !== id));
  }

  function check() {
    if (answered !== null || placed.length !== sentence.words.length) return;
    const correct = built.join(' ') === sentence.words.join(' ');
    setAnswered(correct);
    if (correct) setScore((s) => s + 1);
    recordAnswer();
  }

  function next() {
    setAnswered(null);
    setPlaced([]);
    setIndex((i) => i + 1);
  }

  return (
    <div className="study">
      <div className="study-progress">Предложение {index + 1} / {sentences.length}</div>
      <div className="study-card">
        <div className="prompt-label">Соберите предложение (глагол — в конце):</div>
        <div className="prompt-ru">{sentence.ru}</div>

        <div className="sent-line" aria-label="Ваш вариант">
          {built.length === 0 && <span className="sent-placeholder">Нажимайте слова по порядку…</span>}
          {placed.map((id) => (
            <button key={id} className="sent-chip placed" onClick={() => unplace(id)} disabled={answered !== null}>
              {byId(id)}
            </button>
          ))}
        </div>

        <div className="sent-bank">
          {remaining.map((c) => (
            <button key={c.id} className="sent-chip" onClick={() => place(c.id)} disabled={answered !== null}>
              {c.w}
            </button>
          ))}
        </div>

        {answered === null ? (
          <button className="btn" onClick={check} disabled={placed.length !== sentence.words.length}>
            Проверить
          </button>
        ) : (
          <div className={`study-feedback ${answered ? 'ok' : 'bad'}`}>
            <div>
              {answered ? '✓ Верно' : `✗ Правильно: ${sentence.words.join(' ')}`}
              {' '}
              <SpeakButton text={sentence.words.join(' ')} title="Озвучить предложение" />
            </div>
          </div>
        )}
      </div>
      <div className="study-footer">
        <div className="study-meta">Счёт: {score} / {sentences.length}</div>
        {answered !== null && (
          <button className="btn" onClick={next}>{index + 1 < sentences.length ? 'Далее' : 'Завершить'}</button>
        )}
      </div>
    </div>
  );
}
