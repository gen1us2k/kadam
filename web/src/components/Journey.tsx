import { useEffect, useState } from 'react';
import StudySession from './StudySession';
import type { DeckCard } from '../lib/srs';
import type { JourneyStep } from '../lib/journey';

interface Props {
  steps: JourneyStep[];
  deck: DeckCard[];
}

const KEY = 'kyrgyz-journey-v1';
type Progress = Record<string, boolean>;

function load(): Progress {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

function save(p: Progress): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

const ICON: Record<JourneyStep['type'], string> = {
  grammar: '📖',
  vocab: '🗂️',
  review: '🔁',
};

const domId = (s: JourneyStep) => `jstep-${s.id.replace(/:/g, '-')}`;

export default function Journey({ steps, deck }: Props) {
  const [done, setDone] = useState<Progress>({});
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDone(load());
    setReady(true);
  }, []);

  useEffect(() => {
    if (openIdx == null) return;
    document.getElementById(domId(steps[openIdx]))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openIdx, steps]);

  function toggleDone(id: string) {
    setDone((d) => {
      const next = { ...d, [id]: !d[id] };
      save(next);
      return next;
    });
  }

  function goTo(idx: number) {
    if (idx >= 0 && idx < steps.length) setOpenIdx(idx);
  }

  const doneCount = ready ? steps.filter((s) => done[s.id]).length : 0;
  const currentIdx = ready ? steps.findIndex((s) => !done[s.id]) : -1;
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="journey">
      <div className="journey-progress">
        <div className="bar"><div className="bar-fill" style={{ width: `${percent}%` }} /></div>
        <span className="study-meta">{doneCount} из {steps.length}</span>
      </div>

      <ol className="journey-steps">
        {steps.map((s, i) => {
          const isDone = ready && !!done[s.id];
          const isOpen = i === openIdx;
          const isCurrent = i === currentIdx;
          return (
            <li
              key={s.id}
              id={domId(s)}
              className={`jstep ${s.type}${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}${isOpen ? ' open' : ''}`}
            >
              <button className="jstep-head" onClick={() => setOpenIdx(isOpen ? null : i)} aria-expanded={isOpen}>
                <span className="jstep-icon" aria-hidden="true">{ICON[s.type]}</span>
                <span className="jstep-body">
                  <span className="jstep-title">{s.title}</span>
                  {s.subtitle && <span className="study-meta">{s.subtitle}</span>}
                </span>
                <span className="jstep-toggle" aria-hidden="true">{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div className="jstep-panel">
                  {s.type === 'grammar' && s.html && (
                    <div className="lesson prose" dangerouslySetInnerHTML={{ __html: s.html }} />
                  )}
                  {(s.type === 'vocab' || s.type === 'review') && (
                    <StudySession deck={deck} week={s.type === 'vocab' ? s.week : undefined} />
                  )}

                  <div className="jstep-nav">
                    <button className="btn ghost" onClick={() => goTo(i - 1)} disabled={i === 0}>← Предыдущий</button>
                    <label className="jstep-check">
                      <input type="checkbox" checked={isDone} onChange={() => toggleDone(s.id)} /> пройдено
                    </label>
                    <button className="btn ghost" onClick={() => goTo(i + 1)} disabled={i === steps.length - 1}>Следующий →</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
