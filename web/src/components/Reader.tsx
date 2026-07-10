import { useMemo, useState } from 'react';
import { addToLearn, cardId, loadLearnList, loadStore } from '../lib/srs';
import type { DeckCard } from '../lib/srs';
import SpeakButton from './SpeakButton';

interface Props {
  deck: DeckCard[];
  /** Pre-filled text (e.g. a graded journey text). */
  initialText?: string;
  /** Skip the textarea and show the parsed text immediately. */
  autoParse?: boolean;
}

const SAMPLE =
  'Мен бүгүн эрте турдум. Базарга барып, нан, сүт жана эт алдым. Күн ысык эле. ' +
  'Кечинде досум келди. Биз чай ичип, көпкө сүйлөштүк. Эртең мен китепканага барам.';

const cleanToken = (raw: string) => raw.replace(/[.,!?;:«»()\d]/g, '');

/** Graded-reading helper: click a word, see dictionary matches (exact, then longest stem). */
export default function Reader({ deck, initialText, autoParse = false }: Props) {
  const [text, setText] = useState(initialText ?? SAMPLE);
  const [parsed, setParsed] = useState<string[] | null>(autoParse ? (initialText ?? SAMPLE).split(/(\s+)/) : null);
  const [selected, setSelected] = useState<string | null>(null);
  // Queued/studied sets to close the reading → SRS loop. Read lazily on the client;
  // the lookup panel only renders after a click, so there is no hydration mismatch.
  const [queued, setQueued] = useState<Set<string>>(() => new Set(loadLearnList()));
  const studied = useMemo(() => new Set(Object.keys(loadStore())), []);

  function queueWord(card: DeckCard) {
    const id = cardId(card);
    addToLearn(id);
    setQueued((q) => new Set(q).add(id));
  }

  const byExact = useMemo(() => {
    const m = new Map<string, DeckCard[]>();
    for (const card of deck) {
      const key = card.kg.toLowerCase();
      m.set(key, [...(m.get(key) ?? []), card]);
    }
    return m;
  }, [deck]);

  function lookup(word: string): DeckCard[] {
    const w = word.toLowerCase();
    const exact = byExact.get(w);
    if (exact) return exact.slice(0, 3);
    // Suffix-stripped fallback: dictionary headwords that are the longest prefix of the token
    // (agglutinative suffixes hang off the stem: базарга → базар).
    let best: DeckCard[] = [];
    let bestLen = 0;
    for (const card of deck) {
      const kg = card.kg.toLowerCase();
      if (kg.length >= 3 && kg.length > bestLen && w.startsWith(kg)) {
        best = [card];
        bestLen = kg.length;
      }
    }
    return best;
  }

  const matches = selected ? lookup(selected) : [];

  return (
    <div className="reader">
      {!parsed && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="Вставьте кыргызский текст…"
          />
          <button className="btn" onClick={() => setParsed(text.split(/(\s+)/))}>Разобрать</button>
        </>
      )}

      {parsed && (
        <>
          <div className="reader-text">
            {parsed.map((chunk, i) => {
              const token = cleanToken(chunk);
              if (!token.trim() || /\s/.test(chunk)) return <span key={i}>{chunk}</span>;
              return (
                <button
                  key={i}
                  className={`reader-word${selected === token ? ' active' : ''}`}
                  onClick={() => setSelected(token)}
                >
                  {chunk}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="reader-panel">
              <strong>{selected}</strong> <SpeakButton text={selected} />
              {matches.length === 0 && <p className="study-meta">Нет в словаре курса. Возможно, это форма незнакомого слова.</p>}
              {matches.map((m) => {
                const id = cardId(m);
                return (
                  <p key={id}>
                    <b>{m.kg}</b> — {m.ru}
                    {m.example && <span className="study-meta"> · {m.example}</span>}
                    {' '}
                    {studied.has(id) ? (
                      <span className="study-meta">· изучается</span>
                    ) : queued.has(id) ? (
                      <span className="study-meta">· ✓ будет в следующей сессии</span>
                    ) : (
                      <button className="btn ghost queue-btn" onClick={() => queueWord(m)}>→ в повторение</button>
                    )}
                  </p>
                );
              })}
            </div>
          )}

          <button className="btn ghost" onClick={() => { setParsed(null); setSelected(null); }}>← Другой текст</button>
        </>
      )}
    </div>
  );
}
