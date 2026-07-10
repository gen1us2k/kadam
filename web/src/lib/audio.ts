// Microphone capture for the speech PoC. Records via MediaRecorder, then decodes and
// resamples to 16 kHz mono Float32 — the input format wav2vec2 expects.

const TARGET_RATE = 16000;

export class Recorder {
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  /** Request the mic and start recording. Throws if permission is denied. */
  async start(): Promise<void> {
    // Mono + browser cleanup (noise suppression / auto-gain) gives the recognizer cleaner input.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TARGET_RATE,
        noiseSuppression: true,
        autoGainControl: true,
        echoCancellation: true,
      },
    });
    this.chunks = [];
    this.media = new MediaRecorder(this.stream);
    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.media.start();
  }

  /** Stop recording and return the captured audio as 16 kHz mono Float32. */
  async stop(): Promise<Float32Array> {
    const media = this.media;
    if (!media) throw new Error('recorder not started');
    const done = new Promise<void>((resolve) => {
      media.onstop = () => resolve();
    });
    media.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.media = null;

    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || 'audio/webm' });
    const bytes = await blob.arrayBuffer();
    return trimSilence(await decodeTo16kMono(bytes));
  }

  /** Abort recording and release the mic without decoding (e.g. on unmount). */
  cancel(): void {
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.media = null;
    this.chunks = [];
  }
}

/**
 * Trim leading/trailing near-silence so the recognizer doesn't see the start/stop click or dead
 * air (which can make wav2vec2 drop or hallucinate edge sounds). Energy gate over 20 ms windows,
 * relative to the clip's own peak window; keeps a short margin around detected speech.
 */
export function trimSilence(wave: Float32Array, rate = TARGET_RATE): Float32Array {
  const win = Math.max(1, Math.round(0.02 * rate)); // 20 ms
  const n = Math.floor(wave.length / win);
  if (n < 2) return wave;
  const energy = new Float32Array(n);
  let peak = 0;
  for (let w = 0; w < n; w++) {
    let e = 0;
    for (let i = 0; i < win; i++) e += wave[w * win + i] ** 2;
    energy[w] = e / win;
    peak = Math.max(peak, energy[w]);
  }
  if (peak === 0) return wave;
  const gate = peak * 0.02; // -17 dB below the loudest window
  let first = 0;
  while (first < n && energy[first] < gate) first++;
  let last = n - 1;
  while (last > first && energy[last] < gate) last--;
  if (first >= last) return wave; // all silence — leave as-is
  const margin = 4; // ~80 ms of context around speech
  const start = Math.max(0, (first - margin) * win);
  const end = Math.min(wave.length, (last + 1 + margin) * win);
  return wave.slice(start, end);
}

/** Decode an encoded audio blob and resample to 16 kHz mono Float32. */
async function decodeTo16kMono(bytes: ArrayBuffer): Promise<Float32Array> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const tmp = new AudioCtx();
  let decoded: AudioBuffer;
  try {
    decoded = await tmp.decodeAudioData(bytes.slice(0));
  } finally {
    await tmp.close();
  }

  const frames = Math.round((decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
