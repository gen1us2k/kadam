// Microphone capture for the speech PoC. Records via MediaRecorder, then decodes and
// resamples to 16 kHz mono Float32 — the input format wav2vec2 expects.

const TARGET_RATE = 16000;

export class Recorder {
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  /** Request the mic and start recording. Throws if permission is denied. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    return decodeTo16kMono(bytes);
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
