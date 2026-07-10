// In-browser Kyrgyz speech recognition: wav2vec2-large-xlsr-kyrgyz (Wav2Vec2ForCTC),
// exported to ONNX int8 and run with onnxruntime-web — same client-side pattern as tts.ts.
// The model (~300 MB int8) is served locally from public/asr; init() loads it once per session.
// Input: 16 kHz mono Float32 waveform. Output: greedy CTC transcript (Cyrillic).

const BASE = import.meta.env.BASE_URL;
const MODEL_URL = `${BASE}asr/model.onnx`;
const VOCAB_URL = `${BASE}asr/vocab.json`;
const META_URL = `${BASE}asr/asr-meta.json`;

export type AsrStatus = 'downloading' | 'loading' | 'recognizing' | 'done' | 'error';

type Ort = typeof import('onnxruntime-web');
type Session = import('onnxruntime-web').InferenceSession;

interface AsrMeta {
  pad_token: string;
  pad_id: number;
  word_delimiter: string;
  do_normalize: boolean;
  sampling_rate: number;
}

interface Loaded {
  ort: Ort;
  session: Session;
  idToToken: Map<number, string>;
  meta: AsrMeta;
}

let initPromise: Promise<Loaded> | null = null;

async function fetchAsset(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res;
}

function init(onStatus?: (s: AsrStatus) => void) {
  if (!initPromise) {
    initPromise = (async () => {
      onStatus?.('downloading');
      const ort = await import('onnxruntime-web');
      const [vocabRes, metaRes, modelRes] = await Promise.all([
        fetchAsset(VOCAB_URL),
        fetchAsset(META_URL),
        fetchAsset(MODEL_URL),
      ]);
      const vocab = (await vocabRes.json()) as Record<string, number>;
      const meta = (await metaRes.json()) as AsrMeta;
      const idToToken = new Map<number, string>();
      for (const [tok, id] of Object.entries(vocab)) idToToken.set(id, tok);
      const model = await modelRes.arrayBuffer();
      onStatus?.('loading');
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { ort, session, idToToken, meta };
    })();
    initPromise.catch(() => {
      initPromise = null; // allow retry after a failed download
    });
  }
  return initPromise;
}

/** Zero-mean, unit-variance normalization — the wav2vec2 feature extractor's do_normalize. */
function normalize(wave: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < wave.length; i++) mean += wave[i];
  mean /= wave.length || 1;
  let variance = 0;
  for (let i = 0; i < wave.length; i++) variance += (wave[i] - mean) ** 2;
  variance /= wave.length || 1;
  const std = Math.sqrt(variance) + 1e-7;
  const out = new Float32Array(wave.length);
  for (let i = 0; i < wave.length; i++) out[i] = (wave[i] - mean) / std;
  return out;
}

/** Collapse a per-frame argmax path into text (CTC: drop repeats, drop blanks). */
function ctcDecode(logits: Float32Array, frames: number, vocabSize: number, loaded: Loaded): string {
  const { idToToken, meta } = loaded;
  const blank = meta.pad_id ?? 0;
  let prev = -1;
  const tokens: string[] = [];
  for (let t = 0; t < frames; t++) {
    const base = t * vocabSize;
    let best = 0;
    let bestVal = logits[base];
    for (let v = 1; v < vocabSize; v++) {
      const val = logits[base + v];
      if (val > bestVal) {
        bestVal = val;
        best = v;
      }
    }
    if (best !== prev && best !== blank) {
      tokens.push(idToToken.get(best) ?? '');
    }
    prev = best;
  }
  const text = tokens.join('').split(meta.word_delimiter).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

/** Recognize Kyrgyz speech from a 16 kHz mono waveform. Returns the transcript. */
export async function recognize(wave: Float32Array, onStatus?: (s: AsrStatus) => void): Promise<string> {
  try {
    const loaded = await init(onStatus);
    const { ort, session, meta } = loaded;
    onStatus?.('recognizing');

    const input = meta.do_normalize ? normalize(wave) : wave;
    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, input.length]),
    };
    const out = await session.run(feeds);
    const logitsTensor = out[session.outputNames[0]];
    const dims = logitsTensor.dims; // [1, frames, vocab]
    const frames = dims[1] as number;
    const vocabSize = dims[2] as number;
    const text = ctcDecode(logitsTensor.data as Float32Array, frames, vocabSize, loaded);

    onStatus?.('done');
    return text;
  } catch (e) {
    onStatus?.('error');
    throw e;
  }
}
