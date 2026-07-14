import { useEffect, useMemo, useState } from 'react';
import { buildDrills } from '../lib/morphology';
import { daySeed, recordAnswer } from '../lib/daily';
import { norm } from '../lib/study-utils';
import KgTextInput from './KgTextInput';
import AnswerFeedback from './AnswerFeedback';

interface Props {
  count?: number;
  types?: string[];
  /** Fired once when the set is finished (e.g. to mark a journey station done). */
  onComplete?: () => void;
}

export default function Drills({ count = 6, types, onComplete }: Props) {
  const drills = useMemo(() => buildDrills(count, daySeed(), types), [count, types]);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState('');
  const [answered, setAnswered] = useState<null | boolean>(null);
  const [score, setScore] = useState(0);

  const finished = drills.length > 0 && index >= drills.length;
  useEffect(() => {
    if (finished) onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on completion
  }, [finished]);

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
        <KgTextInput value={value} onChange={setValue} onSubmit={submit} disabled={answered !== null} />
        {answered !== null && (
          <AnswerFeedback correct={answered} answer={drill.answer} speakText={drill.answer} />
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
