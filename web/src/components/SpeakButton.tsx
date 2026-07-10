import { useState } from 'react';
import { speak } from '../lib/tts';
import type { TtsStatus } from '../lib/tts';

const LABEL: Record<TtsStatus, string> = {
  downloading: 'загрузка модели… (~113 МБ, один раз)',
  loading: 'запуск…',
  synthesizing: 'синтез…',
  playing: '▶ играет',
  done: '',
  error: 'не вышло — ещё раз?',
};

/** Embedded Kyrgyz pronunciation button (in-browser MMS TTS). */
export default function SpeakButton({ text, title }: { text: string; title?: string }) {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const busy = status !== null && status !== 'done' && status !== 'error';

  async function onClick() {
    if (busy) return;
    try {
      await speak(text, setStatus);
    } catch {
      // status already set to 'error'
    }
  }

  return (
    <button className="say-btn" onClick={onClick} disabled={busy} title={title ?? `Озвучить: ${text}`}>
      🔊{status && LABEL[status] ? ` ${LABEL[status]}` : ''}
    </button>
  );
}
