import { useEffect, useRef, useState } from 'react';
import { Recorder } from '../lib/audio';
import { analyze } from '../lib/asr';
import type { AsrStatus, Analysis } from '../lib/asr';
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

/** Color a per-letter acoustic score: green good, amber so-so, red weak. */
function letterColor(score: number): string {
  if (score >= 0.7) return '#1a7f37';
  if (score >= 0.4) return '#b8860b';
  return 'var(--accent)';
}

function verdict(percent: number): string {
  if (percent >= 75) return 'Отлично';
  if (percent >= 55) return 'Неплохо';
  return 'Ещё раз';
}

export default function SpeechCheck() {
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false); // stop -> recognize -> score window
  const [asrStatus, setAsrStatus] = useState<AsrStatus | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);

  // Release the mic if the user navigates away mid-recording.
  useEffect(() => () => recorderRef.current?.cancel(), []);

  const phrase = PHRASES[idx];
  const busy = processing;

  function reset() {
    setResult(null);
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
    setProcessing(true); // guard the stop -> recognize -> score window (mic still settling)
    try {
      const wave = await rec.stop();
      setResult(await analyze(wave, phrase.ky, setAsrStatus));
    } catch {
      setError('Не удалось распознать. Попробуйте ещё раз.');
    } finally {
      recorderRef.current = null;
      setProcessing(false);
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

      {result && (
        <div style={{ marginTop: '1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: 700, color: letterColor(result.percent / 100) }}>
              {result.percent}%
            </span>
            <span className="study-meta">{verdict(result.percent)} · произношение по звукам</span>
          </div>

          <div style={{ fontSize: '1.7rem', letterSpacing: '0.02em', margin: '0.6rem 0' }}>
            {result.letters.map((l, i) =>
              l.gap ? (
                <span key={i}>&nbsp;&nbsp;</span>
              ) : (
                <span key={i} title={`${Math.round(l.score * 100)}%`} style={{ color: letterColor(l.score) }}>
                  {l.ch}
                </span>
              ),
            )}
          </div>

          <div className="study-meta">
            Услышано (открытое распознавание): <b style={{ color: 'var(--text)' }}>{result.transcript || '—'}</b>
          </div>
        </div>
      )}
    </div>
  );
}
