// Kyrgyz speech recognition + pronunciation scoring — thin client for the ASR backend (server/).
// The ~338 MB wav2vec2 model no longer loads in the browser: we upload the recorded utterance as
// a small 16 kHz mono WAV (~64 KB per phrase) and get back the same Analysis the in-browser
// pipeline produced. CTC math (greedy decode + Viterbi forced-alignment GOP) runs server-side,
// locked to the same reference fixture (web/scripts/ctc-fixture.json <-> server/test_ctc.py).

import { encodeWav } from './audio';

const API_URL = `${import.meta.env.BASE_URL}api/asr/analyze`;

export type AsrStatus = 'recognizing' | 'done' | 'error';

export interface LetterScore {
  ch: string; // target letter (spaces are word gaps, not scored)
  score: number; // acoustic posterior 0..1
  gap?: boolean;
}

export interface Analysis {
  transcript: string; // open greedy CTC decode — what was heard
  percent: number; // overall pronunciation 0..100 (mean letter posterior)
  letters: LetterScore[]; // per-target-letter score for highlighting
}

/** Recognize Kyrgyz speech and score it against the intended target phrase (backend call). */
export async function analyze(wave: Float32Array, target: string, onStatus?: (s: AsrStatus) => void): Promise<Analysis> {
  try {
    onStatus?.('recognizing');
    const form = new FormData();
    form.append('audio', new Blob([encodeWav(wave)], { type: 'audio/wav' }), 'utterance.wav');
    form.append('target', target);
    const res = await fetch(API_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`asr backend: ${res.status} ${await res.text().catch(() => '')}`);
    const analysis = (await res.json()) as Analysis;
    onStatus?.('done');
    return analysis;
  } catch (e) {
    onStatus?.('error');
    throw e;
  }
}
