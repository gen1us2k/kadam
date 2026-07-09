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

export default function Journey({ steps, deck }: Props) {
  const [done, setDone] = useState<Progress>({});
  const [open, setOpen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDone(load());
    setReady(true);
  }, []);

  function toggle(id: string) {
    setDone((d) => {
      const next = { ...d, [id]: !d[id] };
      save(next);
      return next;
    });
  }

  const doneCount = ready ? steps.filter((s) => done[s.id]).length : 0;
  const currentIdx = ready ? steps.findIndex((s) => !done[s.id]) : -1;
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="journey">
      <div className="journey-progress">
        <div className="bar"><div className="bar-fill" style={{ width: `${percent}%` }} /></div>
        <span className="study-meta">{doneCount} из {steps.length} шагов</span>
      </div>

      <ol className="journey-steps">
        {steps.map((s, i) => {
          const isDone = ready && !!done[s.id];
          const isCurrent = i === currentIdx;
          const isOpen = open === s.id;
          return (
            <li key={s.id} className={`jstep ${s.type}${isDone ? ' done' : ''}${isCurrent ? ' current' : ''}`}>
              <div className="jstep-head">
                <span className="jstep-icon" aria-hidden="true">{ICON[s.type]}</span>
                <div className="jstep-body">
                  <div className="jstep-title">{s.title}</div>
                  {s.subtitle && <div className="study-meta">{s.subtitle}</div>}
                </div>
                <label className="jstep-check">
                  <input type="checkbox" checked={isDone} onChange={() => toggle(s.id)} /> готово
                </label>
              </div>

              <div className="jstep-actions">
                {s.type === 'grammar' && s.href && (
                  <a className="btn ghost" href={s.href}>Открыть урок</a>
                )}
                {(s.type === 'vocab' || s.type === 'review') && (
                  <button className="btn ghost" onClick={() => setOpen(isOpen ? null : s.id)}>
                    {isOpen ? 'Свернуть' : s.type === 'vocab' ? 'Тренировать' : 'Повторить'}
                  </button>
                )}
              </div>

              {isOpen && (s.type === 'vocab' || s.type === 'review') && (
                <div className="jstep-study">
                  <StudySession deck={deck} week={s.type === 'vocab' ? s.week : undefined} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
