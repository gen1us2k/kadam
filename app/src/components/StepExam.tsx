import { useEffect, useMemo, useRef, useState } from 'react';
import { deckStats, loadStore } from '../lib/srs';
import type { DeckCard } from '../lib/srs';
import { buildDrills } from '../lib/morphology';
import { daySeed, recordAnswer } from '../lib/daily';
import SpeakButton from './SpeakButton';

interface Props {
  deck: DeckCard[];
  /** Step tag to test, e.g. "step04". */
  tag: string;
  /** Optional morphology drill tasks to fold into the exam. */
  drillTasks?: string[];
  /** Pass threshold, 0..1. */
  pass?: number;
  /** Stable id for the best-score log (e.g. the journey step id). */
  examId?: string;
  /** Fired when a run reaches the pass threshold (e.g. to mark the journey step done). */
  onPassed?: () => void;
}

// Best-score log per exam — closes the exam → journey loop and fuels the retry screen.
const EXAM_KEY = 'kyrgyz-exams-v1';
type ExamLog = Record<string, { best: number; total: number }>;

function loadExamLog(): ExamLog {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(EXAM_KEY) ?? '{}') as ExamLog;
  } catch {
    return {};
  }
}

function recordExam(examId: string, score: number, total: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const log = loadExamLog();
    const prev = log[examId];
    if (!prev || score > prev.best || prev.total !== total) {
      log[examId] = { best: Math.max(score, prev?.total === total ? prev.best : 0), total };
      localStorage.setItem(EXAM_KEY, JSON.stringify(log));
    }
  } catch {
    // non-fatal
  }
}

const KG_LETTERS = ['ң', 'ө', 'ү'];
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

type Question =
  | { kind: 'mc'; prompt: string; kg: string; answer: string; options: string[] }
  | { kind: 'typed'; label: string; prompt: string; answer: string };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const VOCAB_Q = 8;

function buildExam(deck: DeckCard[], tag: string, drillTasks: string[] | undefined, seed: number): Question[] {
  const pool = deck.filter((c) => c.tags.includes(tag));
  const cards = shuffle(pool).slice(0, VOCAB_Q);
  const allRu = [...new Set(deck.map((c) => c.ru))];
  const allKg = [...new Set(deck.map((c) => c.kg))];

  const vocab: Question[] = cards.map((c, i) => {
    if (i % 2 === 0) {
      const opts = shuffle([c.ru, ...shuffle(allRu.filter((r) => r !== c.ru)).slice(0, 3)]);
      return { kind: 'mc', prompt: c.kg, kg: c.kg, answer: c.ru, options: opts };
    }
    const opts = shuffle([c.kg, ...shuffle(allKg.filter((k) => k !== c.kg)).slice(0, 3)]);
    return { kind: 'mc', prompt: c.ru, kg: c.kg, answer: c.kg, options: opts };
  });

  const drills: Question[] = (drillTasks?.length ? buildDrills(2, seed, drillTasks) : []).map((d) => ({
    kind: 'typed',
    label: `${d.task} (напр., ${d.hint})`,
    prompt: `${d.word} → ?`,
    answer: d.answer,
  }));

  return [...vocab, ...drills];
}

/** Milestone self-test: mixed vocab + grammar with a pass threshold. No SRS writes. */
export default function StepExam({ deck, tag, drillTasks, pass = 0.8, examId, onPassed }: Props) {
  const [round, setRound] = useState(0);
  const questions = useMemo(
    () => buildExam(deck, tag, drillTasks, daySeed() + round),
    [deck, tag, drillTasks, round],
  );
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<null | { correct: boolean; picked?: string }>(null);
  const [typedValue, setTypedValue] = useState('');
  const [score, setScore] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Readiness: how much of this step's vocabulary is actually retained before attempting the test.
  // Computed in an effect (not during render) so it doesn't read localStorage during SSR.
  const [ready, setReady] = useState<{ retained: number; total: number; frac: number; ok: boolean } | null>(null);
  useEffect(() => {
    const s = deckStats(deck, loadStore(), Date.now(), tag);
    const frac = s.total > 0 ? s.retained / s.total : 0;
    setReady({ retained: s.retained, total: s.total, frac, ok: frac >= 0.5 });
  }, [deck, tag]);

  const finished = questions.length > 0 && index >= questions.length;
  const passedNow = finished && score / questions.length >= pass;
  useEffect(() => {
    if (!finished) return;
    if (examId) recordExam(examId, score, questions.length);
    if (passedNow) onPassed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per finished run
  }, [finished]);

  const q = questions[index];

  function commit(correct: boolean, picked?: string) {
    if (answered) return;
    setAnswered({ correct, picked });
    if (correct) setScore((s) => s + 1);
    recordAnswer();
  }

  function submitTyped() {
    if (!q || q.kind !== 'typed') return;
    commit(norm(typedValue) === norm(q.answer), typedValue);
  }

  function next() {
    setAnswered(null);
    setTypedValue('');
    setIndex((i) => i + 1);
  }

  function retry() {
    setRound((r) => r + 1);
    setIndex(0);
    setAnswered(null);
    setTypedValue('');
    setScore(0);
  }

  function insertLetter(ch: string) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? typedValue.length;
    const end = el.selectionEnd ?? typedValue.length;
    setTypedValue(typedValue.slice(0, start) + ch + typedValue.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  }

  if (questions.length === 0) {
    return <div className="study-summary"><p>Для этого шага нет материала для экзамена.</p></div>;
  }

  if (index >= questions.length) {
    const pct = Math.round((score / questions.length) * 100);
    const passed = score / questions.length >= pass;
    const logged = examId ? loadExamLog()[examId] : undefined;
    const best = Math.max(score, logged?.total === questions.length ? logged.best : 0);
    return (
      <div className="study-summary">
        <h2>{passed ? '🎯 Сдано!' : 'Ещё не сдано'}</h2>
        <p>{score} из {questions.length} ({pct}%). Порог — {Math.round(pass * 100)}%.</p>
        {best > score && <p className="study-meta">Лучший результат: {best}/{questions.length}.</p>}
        <p className="study-meta">
          {passed ? 'Шаг закреплён — двигайтесь дальше.' : 'Повторите слабые места и пересдайте.'}
        </p>
        <button className="btn" onClick={retry}>Пересдать</button>
      </div>
    );
  }

  const isMc = q.kind === 'mc';

  return (
    <div className="study">
      {ready && ready.total > 0 && (
        <div className={`exam-ready ${ready.ok ? 'ok' : 'low'}`} title="Слова шага, реально удержанные в памяти (FSRS)">
          Готовность: {Math.round(ready.frac * 100)}% ({ready.retained}/{ready.total} слов)
          {!ready.ok && ' — стоит сперва повторить слова шага'}
        </div>
      )}
      <div className="study-progress">Вопрос {index + 1} / {questions.length} · счёт {score}</div>
      <div className="study-card">
        <div className="prompt-label">{isMc ? 'Выберите перевод:' : q.label}</div>
        <div className="prompt-kg">{q.prompt}</div>

        {isMc && (
          <div className="choices">
            {q.options.map((opt) => {
              let cls = 'choice';
              if (answered) {
                if (opt === q.answer) cls += ' correct';
                else if (opt === answered.picked) cls += ' wrong';
              }
              return (
                <button key={opt} className={cls} onClick={() => commit(opt === q.answer, opt)} disabled={!!answered}>
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {!isMc && (
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
            {answered.correct ? '✓ Верно' : `✗ Правильно: ${q.answer}`}
            {' '}
            <SpeakButton text={q.kind === 'mc' ? q.kg : q.answer} />
          </div>
        )}
      </div>
      <div className="study-footer">
        <div className="study-meta">Экзамен-веха · без записи в повторение</div>
        {answered && (
          <button className="btn" onClick={next}>{index + 1 < questions.length ? 'Далее' : 'Итог'}</button>
        )}
      </div>
    </div>
  );
}
