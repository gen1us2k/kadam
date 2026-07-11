import { useEffect, useRef, useState } from 'react';
import { Recorder } from '../lib/audio';
import { analyze } from '../lib/asr';
import type { AsrStatus, Analysis } from '../lib/asr';

const STATUS_LABEL: Record<AsrStatus, string> = {
  recognizing: 'слушаю…',
  done: '',
  error: 'не распозналось — ещё раз?',
};

function letterColor(score: number): string {
  if (score >= 0.7) return '#1a7f37';
  if (score >= 0.4) return '#b8860b';
  return 'var(--accent)';
}

/**
 * Record the learner saying `target`, score pronunciation via the ASR backend, and report the
 * Analysis to the parent. Compact, reusable inline version of the /poc-speech check.
 */
export default function SpeakPractice({
  target,
  answered = false,
  onResult,
}: {
  target: string;
  /** True once the parent has graded this card — freezes controls and releases the mic. */
  answered?: boolean;
  onResult: (a: Analysis) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<AsrStatus | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<Recorder | null>(null);

  // Release the mic if the card changes or the component unmounts mid-recording.
  useEffect(() => () => recorderRef.current?.cancel(), []);

  // If the card gets graded (e.g. «не сейчас») while still recording, stop the hot mic.
  useEffect(() => {
    if (answered && recording) {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setRecording(false);
    }
  }, [answered, recording]);

  const busy = status !== null && status !== 'done' && status !== 'error';
  const finished = result !== null;

  async function startRec() {
    setError(null);
    setStatus(null); // clear a stale error hint from a prior attempt
    try {
      const rec = new Recorder();
      await rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      setError('Нет доступа к микрофону.');
    }
  }

  async function stopRec() {
    const rec = recorderRef.current;
    if (!rec) return;
    setRecording(false);
    try {
      const wave = await rec.stop();
      const analysis = await analyze(wave, target, setStatus);
      setResult(analysis);
      onResult(analysis);
    } catch {
      setStatus(null); // don't also show the 'error' status label
      setError('Не удалось распознать. Попробуйте ещё раз.');
    } finally {
      recorderRef.current = null;
    }
  }

  return (
    <div className="speak-practice">
      {!finished && !answered && (
        <button
          className="btn"
          onClick={recording ? stopRec : startRec}
          disabled={busy}
          style={recording ? { background: 'var(--accent)', color: '#fff' } : undefined}
        >
          {recording ? '⏹ Остановить' : '🎤 Сказать'}
        </button>
      )}
      {status && STATUS_LABEL[status] ? <span className="study-meta">{STATUS_LABEL[status]}</span> : null}
      {error && <span className="study-meta">{error}</span>}

      {result && (
        <>
          <span className="speak-score" style={{ color: letterColor(result.percent / 100) }}>{result.percent}%</span>
          <div className="speak-letters">
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
        </>
      )}
    </div>
  );
}
