import { useMemo, useRef, useState } from 'react';
import { buildDrills } from '../lib/morphology';
import { recordAnswer } from '../lib/daily';
import SpeakButton from './SpeakButton';

const KG_LETTERS = ['ң', 'ө', 'ү'];
const norm = (s: string) => s.toLowerCase().trim();

/** Deterministic per-day seed so everyone gets the same daily drill set. */
function daySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export default function Drills({ count = 6 }: { count?: number }) {
  const drills = useMemo(() => buildDrills(count, daySeed()), [count]);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [answered, setAnswered] = useState<null | boolean>(null);
  const [score, setScore] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const drill = drills[index];

  function submit() {
    if (answered !== null || !drill) return;
    const correct = norm(value) === norm(drill.answer);
    setAnswered(correct);
    if (correct) setScore((s) => s + 1);
    recordAnswer();
  }

  function next() {
    setAnswered(null);
    setValue('');
    setIndex((i) => i + 1);
  }

  function insertLetter(ch: string) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + ch + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  }

  if (index >= drills.length) {
    return (
      <div className="study-summary">
        <p>Дриллы на сегодня сделаны: {score} из {drills.length}. 💪</p>
      </div>
    );
  }

  return (
    <div className="study">
      <div className="study-progress">Дрилл {index + 1} / {drills.length}</div>
      <div className="study-card">
        <div className="prompt-label">{drill.task} <span className="study-meta">(напр., {drill.hint})</span></div>
        <div className="prompt-kg">{drill.word} → ?</div>
        <div className="typed">
          <input
            ref={inputRef}
            type="text"
            value={value}
            disabled={answered !== null}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && answered === null) submit(); }}
            placeholder="кыргызча…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="typed-tools">
            {KG_LETTERS.map((ch) => (
              <button key={ch} className="kbd-btn" onClick={() => insertLetter(ch)} disabled={answered !== null}>{ch}</button>
            ))}
            {answered === null && <button className="btn" onClick={submit}>Проверить</button>}
          </div>
        </div>
        {answered !== null && (
          <div className={`study-feedback ${answered ? 'ok' : 'bad'}`}>
            {answered ? '✓ Верно' : `✗ Правильно: ${drill.answer}`} <SpeakButton text={drill.answer} />
          </div>
        )}
      </div>
      <div className="study-footer">
        <div className="study-meta">Счёт: {score} / {drills.length}</div>
        {answered !== null && (
          <button className="btn" onClick={next}>{index + 1 < drills.length ? 'Далее' : 'Завершить'}</button>
        )}
      </div>
    </div>
  );
}
