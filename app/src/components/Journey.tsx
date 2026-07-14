import { useEffect, useState } from 'react';
import StudySession from './StudySession';
import Drills from './Drills';
import Reader from './Reader';
import SentenceBuild from './SentenceBuild';
import StepExam from './StepExam';
import { deckStats, loadStore } from '../lib/srs';
import type { DeckCard, DeckStats } from '../lib/srs';
import type { JourneyStep } from '../lib/journey';
import { loadJson, saveJson } from '../lib/storage';

interface Props {
  steps: JourneyStep[];
  deck: DeckCard[];
}

const KEY = 'kyrgyz-journey-v1';
type Progress = Record<string, boolean>;

const load = (): Progress => loadJson<Progress>(KEY, {});
const save = (p: Progress): void => saveJson(KEY, p);

const ICON: Record<JourneyStep['type'], string> = {
  grammar: '📖',
  vocab: '🗂️',
  review: '🔁',
  corpus: '📚',
  drill: '✏️',
  reader: '📰',
  phrases: '💬',
  sentence: '🧩',
  exam: '🎯',
};

const domId = (s: JourneyStep) => `jstep-${s.id.replace(/:/g, '-')}`;

/** Steps whose progress can be derived from SRS data instead of a manual checkbox. */
const hasMastery = (s: JourneyStep) => (s.type === 'vocab' || s.type === 'corpus') && !!s.tag;

export default function Journey({ steps, deck }: Props) {
  const [done, setDone] = useState<Progress>({});
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [mastery, setMastery] = useState<Record<string, DeckStats>>({});
  const [dueTotal, setDueTotal] = useState(0);

  useEffect(() => {
    const store = loadStore();
    const now = Date.now();
    const m: Record<string, DeckStats> = {};
    for (const s of steps) {
      if (hasMastery(s)) m[s.id] = deckStats(deck, store, now, s.tag);
    }
    // Persist auto-done once 80% retained is first reached, so progress stays monotonic even as
    // retention later decays. Only when the key is absent — a manual check/uncheck is respected.
    const p = load();
    let changed = false;
    for (const s of steps) {
      if (hasMastery(s) && p[s.id] === undefined) {
        const st = m[s.id];
        if (st && st.total > 0 && st.retained / st.total >= 0.8) {
          p[s.id] = true;
          changed = true;
        }
      }
    }
    if (changed) save(p);
    setDone(p);
    setMastery(m);
    setDueTotal(deckStats(deck, store, now).due);
    setReady(true);
    // Deep link: /#jstep-<id> opens that station (e.g. lesson links to the phrases station).
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('jstep-')) {
      const idx = steps.findIndex((s) => domId(s) === hash);
      if (idx >= 0) setOpenIdx(idx);
    }
  }, [steps, deck]);

  function toggleDone(id: string) {
    setDone((d) => {
      const next = { ...d, [id]: !d[id] };
      save(next);
      return next;
    });
  }

  /** One-way completion signal from a station (drill/sentence set finished, exam passed). */
  function markDone(id: string) {
    setDone((d) => {
      if (d[id]) return d;
      const next = { ...d, [id]: true };
      save(next);
      return next;
    });
  }

  function goTo(idx: number) {
    if (idx >= 0 && idx < steps.length) setOpenIdx(idx);
  }

  useEffect(() => {
    if (openIdx == null) return;
    document.getElementById(domId(steps[openIdx]))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openIdx, steps]);

  // Inline 🔊 buttons inside lesson html (phonetics examples) — event delegation.
  function onRootClick(e: React.MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.say-btn[data-say]');
    if (!btn?.dataset.say) return;
    import('../lib/tts').then((m) => m.speak(btn.dataset.say as string)).catch(() => {});
  }

  /** A vocab/corpus step counts as done once 80% of its words are retained (learned), not merely seen. */
  const isAutoDone = (s: JourneyStep) => {
    const st = mastery[s.id];
    return !!st && st.total > 0 && st.retained / st.total >= 0.8;
  };
  const isStepDone = (s: JourneyStep) => !!done[s.id] || isAutoDone(s);

  const doneCount = ready ? steps.filter(isStepDone).length : 0;
  const currentIdx = ready ? steps.findIndex((s) => !isStepDone(s)) : -1;
  const percent = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="journey" onClick={onRootClick}>
      <div className="journey-progress">
        <div className="bar"><div className="bar-fill" style={{ width: `${percent}%` }} /></div>
        <span className="study-meta">
          {doneCount} из {steps.length}{dueTotal > 0 ? ` · к повторению ${dueTotal}` : ''}
        </span>
      </div>

      <ol className="journey-steps">
        {steps.map((s, i) => {
          const isDone = ready && isStepDone(s);
          const isCurrent = i === currentIdx;
          const isOpen = i === openIdx;
          const st = mastery[s.id];
          const masteryLine = st && st.seen > 0
            ? `изучено ${st.seen}/${st.total} · удержано ${st.retained}${st.due ? ` · к повт. ${st.due}` : ''}`
            : s.subtitle;
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
                  {(hasMastery(s) ? masteryLine : s.subtitle) && (
                    <span className="study-meta">{hasMastery(s) ? masteryLine : s.subtitle}</span>
                  )}
                </span>
                <span className="jstep-toggle" aria-hidden="true">{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div className="jstep-panel">
                  {(s.type === 'grammar' || s.type === 'phrases') && s.html && (
                    <div className="lesson prose" dangerouslySetInnerHTML={{ __html: s.html }} />
                  )}
                  {(s.type === 'vocab' || s.type === 'review' || s.type === 'corpus') && (
                    <StudySession deck={deck} tag={s.type === 'review' ? undefined : s.tag} />
                  )}
                  {s.type === 'drill' && <Drills types={s.drillTasks} onComplete={() => markDone(s.id)} />}
                  {s.type === 'reader' && s.text && <Reader deck={deck} initialText={s.text} autoParse />}
                  {s.type === 'sentence' && <SentenceBuild tag={s.tag} count={15} onComplete={() => markDone(s.id)} />}
                  {s.type === 'exam' && s.tag && (
                    <StepExam deck={deck} tag={s.tag} drillTasks={s.drillTasks} examId={s.id} onPassed={() => markDone(s.id)} />
                  )}

                  <div className="jstep-nav">
                    <button className="btn ghost" onClick={() => goTo(i - 1)} disabled={i === 0}>← Предыдущий</button>
                    <label className="jstep-check">
                      <input type="checkbox" checked={isDone} onChange={() => toggleDone(s.id)} /> пройдено
                      {ready && isAutoDone(s) && !done[s.id] ? ' (авто)' : ''}
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
