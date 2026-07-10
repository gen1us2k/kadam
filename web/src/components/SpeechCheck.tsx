import { useRef, useState } from 'react';
import { Recorder } from '../lib/audio';
import { recognize } from '../lib/asr';
import type { AsrStatus } from '../lib/asr';
import { scorePronunciation } from '../lib/pronunciation';
import type { Score } from '../lib/pronunciation';
import SpeakButton from './SpeakButton';

// A few short PoC phrases — short utterances are where greedy CTC is most legible.
const PHRASES = [
  { ky: 'Салам', ru: 'Привет' },
  { ky: 'Рахмат', ru: 'Спасибо' },
  { ky: 'Кандайсың', ru: 'Как дела?' },
  { ky: 'Кечиресиз', ru: 'Извините' },
  { ky: 'Мен кыргызча үйрөнөм', ru: 'Я учу кыргызский' },
];

const ASR_LABEL: Record<AsrStatus, string> = {
  downloading: 'загрузка модели… (~338 МБ, один раз)',
  loading: 'запуск…',
  recognizing: 'распознаю…',
  done: '',
  error: 'ошибка распознавания',
};

const STATUS_COLOR: Record<string, string> = { ok: '#1a7f37', wrong: 'var(--accent)', missing: 'var(--muted)' };

export default function SpeechCheck() {
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);

  const phrase = PHRASES[idx];
  const busy = asrStatus !== null && asrStatus !== 'done' && asrStatus !== 'error';

  function reset() {
    setHeard(null);
    setScore(null);
    setError(null);
    setAsrStatus(null);
  }

  async function startRec() {
    reset();
    try {
      const rec = new Recorder();
      await rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError('Нет доступа к микрофону. Разрешите доступ и попробуйте снова.');
    }
  }

  async function stopRec() {
    const rec = recorderRef.current;
    if (!rec) return;
    setRecording(false);
    try {
      const wave = await rec.stop();
      const text = await recognize(wave, setAsrStatus);
      setHeard(text);
      setScore(scorePronunciation(phrase.ky, text));
    } catch {
      setError('Не удалось распознать. Попробуйте ещё раз.');
    } finally {
      recorderRef.current = null;
    }
  }

  return (
    <div className="card" style={{ display: 'block', padding: '1.1rem 1.2rem', marginTop: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        {PHRASES.map((p, i) => (
          <button
            key={p.ky}
            onClick={() => {
              setIdx(i);
              reset();
            }}
            disabled={busy || recording}
            style={{
              border: '1px solid var(--border)',
              background: i === idx ? 'var(--accent-soft)' : 'transparent',
              color: 'var(--text)',
              borderRadius: '999px',
              padding: '0.25rem 0.7rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {p.ky}
          </button>
        ))}
      </div>

      <div style={{ fontSize: '1.6rem', fontWeight: 600 }}>
        {phrase.ky} <SpeakButton text={phrase.ky} />
      </div>
      <div className="study-meta" style={{ marginBottom: '1rem' }}>{phrase.ru}</div>

      <button
        onClick={recording ? stopRec : startRec}
        disabled={busy}
        style={{
          border: 'none',
          borderRadius: '8px',
          padding: '0.6rem 1.1rem',
          fontSize: '1rem',
          cursor: busy ? 'wait' : 'pointer',
          background: recording ? 'var(--accent)' : 'var(--accent-soft)',
          color: recording ? '#fff' : 'var(--text)',
        }}
      >
        {recording ? '⏹ Остановить' : '🎤 Записать и проверить'}
      </button>
      {asrStatus && ASR_LABEL[asrStatus] ? (
        <span className="study-meta" style={{ marginLeft: '0.7rem' }}>{ASR_LABEL[asrStatus]}</span>
      ) : null}

      {error && (
        <div className="study-feedback" style={{ background: 'var(--accent-soft)', marginTop: '0.9rem' }}>
          {error}
        </div>
      )}

      {score && heard !== null && (
        <div style={{ marginTop: '1.1rem' }}>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: score.percent >= 70 ? '#1a7f37' : 'var(--accent)' }}>
            {score.percent}%
          </div>
          <div className="study-meta">
            Услышано: <b style={{ color: 'var(--text)' }}>{heard || '—'}</b>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
            {score.words.map((w, i) => (
              <span
                key={i}
                title={w.status === 'wrong' ? `услышано: ${w.heard}` : w.status === 'missing' ? 'не распознано' : ''}
                style={{
                  padding: '0.2rem 0.55rem',
                  borderRadius: '6px',
                  border: `1px solid ${STATUS_COLOR[w.status]}`,
                  color: STATUS_COLOR[w.status],
                  fontSize: '0.95rem',
                }}
              >
                {w.target}
                {w.status === 'wrong' ? ` → ${w.heard}` : ''}
              </span>
            ))}
          </div>
          {score.extra.length > 0 && (
            <div className="study-meta" style={{ marginTop: '0.5rem' }}>Лишнее: {score.extra.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
