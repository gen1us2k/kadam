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
  for (let w = 0; w < n; w++) {
    let e = 0;
    for (let i = 0; i < win; i++) e += wave[w * win + i] ** 2;
    energy[w] = e / win;
  }
  // Reference = 95th-percentile window energy, NOT the max: a click/pop transient (button, mic)
  // spans only a window or two but can be 10-20 dB louder than speech — a max-relative gate then
  // rises above the speech level and trims the whole utterance away.
  const sorted = Float32Array.from(energy).sort();
  const ref = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  if (ref === 0) return wave;
  const gate = ref * 0.02; // -17 dB below the robust loud level
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

/** Encode a Float32 waveform as a 16-bit PCM mono WAV (what the ASR backend expects). */
export function encodeWav(wave: Float32Array, rate = TARGET_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + wave.length * 2);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + wave.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, wave.length * 2, true);
  for (let i = 0; i < wave.length; i++) {
    const s = Math.max(-1, Math.min(1, wave[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

let playbackCtx: AudioContext | null = null;

/** Play a 16 kHz mono waveform — lets the user hear exactly what the recognizer analyzed. */
export async function playWave(wave: Float32Array, rate = TARGET_RATE): Promise<void> {
  if (wave.length === 0) return;
  playbackCtx ??= new AudioContext({ sampleRate: rate });
  if (playbackCtx.state === 'suspended') await playbackCtx.resume();
  const buffer = playbackCtx.createBuffer(1, wave.length, rate);
  buffer.getChannelData(0).set(wave);
  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackCtx.destination);
  await new Promise<void>((resolve) => {
    source.onended = () => resolve();
    source.start();
  });
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

  const frames = Math.round(decoded.duration * TARGET_RATE);
  if (frames < 1) throw new Error('recording too short'); // OfflineAudioContext rejects length 0
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
