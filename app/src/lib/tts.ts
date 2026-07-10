// Kyrgyz TTS — thin client for the backend (server/). The ~114 MB MMS model no longer loads in
// the browser: we fetch synthesized audio from GET /api/tts?text= (WAV, HTTP-cached per word) and
// play it. Synthesis (tokenize + onnxruntime-node) runs server-side; helpers live in server/tts.ts.

const API = `${import.meta.env.BASE_URL}api/tts`;

export type TtsStatus = 'synthesizing' | 'playing' | 'done' | 'error';

let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

/** Synthesize and play Kyrgyz text. Resolves when playback finishes. */
export async function speak(text: string, onStatus?: (s: TtsStatus) => void): Promise<void> {
  try {
    onStatus?.('synthesizing');
    const res = await fetch(`${API}?text=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`tts: ${res.status} ${await res.text().catch(() => '')}`);
    const bytes = await res.arrayBuffer();

    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const buffer = await audioCtx.decodeAudioData(bytes);

    onStatus?.('playing');
    currentSource?.stop();
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    currentSource = source;
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start();
    });
    onStatus?.('done');
  } catch (e) {
    onStatus?.('error');
    throw e;
  }
}
