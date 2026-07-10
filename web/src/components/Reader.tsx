import { useMemo, useState } from 'react';
import type { DeckCard } from '../lib/srs';

interface Props {
  deck: DeckCard[];
}

const SAMPLE =
  'Мен бүгүн эрте турдум. Базарга барып, нан, сүт жана эт алдым. Күн ысык эле. ' +
  'Кечинде досум келди. Биз чай ичип, көпкө сүйлөштүк. Эртең мен китепканага барам.';

const cleanToken = (raw: string) => raw.replace(/[.,!?;:«»()\d]/g, '');

/** Graded-reading helper: click a word, see dictionary matches (exact, then longest stem). */
export default function Reader({ deck }: Props) {
  const [text, setText] = useState(SAMPLE);
  const [parsed, setParsed] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

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
              <strong>{selected}</strong>
              {matches.length === 0 && <p className="study-meta">Нет в словаре курса. Возможно, это форма незнакомого слова.</p>}
              {matches.map((m) => (
                <p key={`${m.kg}|${m.ru}`}>
                  <b>{m.kg}</b> — {m.ru}
                  {m.example && <span className="study-meta"> · {m.example}</span>}
                </p>
              ))}
            </div>
          )}

          <button className="btn ghost" onClick={() => { setParsed(null); setSelected(null); }}>← Другой текст</button>
        </>
      )}
    </div>
  );
}
