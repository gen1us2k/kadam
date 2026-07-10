// In-browser Kyrgyz speech recognition + pronunciation scoring. wav2vec2-large-xlsr-kyrgyz
// (Wav2Vec2ForCTC) exported to ONNX int8, run with onnxruntime-web — same client-side pattern
// as tts.ts. The model (~338 MB int8) is served locally from public/asr; init() loads it once.
//
// analyze() returns BOTH the open greedy transcript (what the recognizer heard) AND a
// target-aware pronunciation score: since we know the phrase the learner is attempting, we
// force-align it to the audio (CTC Viterbi) and read each letter's acoustic posterior. That
// forced-alignment score is far more robust than fuzzy transcript matching — it stays reliable
// even when open decoding drops an edge sound. Pure CTC math lives in ctc.ts (unit-tested).

import { forcedAlignGop, greedyDecode, softmaxRows } from './ctc';

const BASE = import.meta.env.BASE_URL;
const MODEL_URL = `${BASE}asr/model.onnx`;
const VOCAB_URL = `${BASE}asr/vocab.json`;
const META_URL = `${BASE}asr/asr-meta.json`;

export type AsrStatus = 'downloading' | 'loading' | 'recognizing' | 'done' | 'error';

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
  tokenToId: Map<string, number>;
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
      const tokenToId = new Map<string, number>();
      for (const [tok, id] of Object.entries(vocab)) {
        idToToken.set(id, tok);
        tokenToId.set(tok, id);
      }
      const model = await modelRes.arrayBuffer();
      onStatus?.('loading');
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { ort, session, idToToken, tokenToId, meta };
    })();
    initPromise.catch(() => {
      initPromise = null; // allow retry after a failed download
    });
  }
  return initPromise;
}

/** Zero-mean, unit-variance normalization — the wav2vec2 feature extractor's do_normalize. */
function normalizeWave(wave: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < wave.length; i++) mean += wave[i];
  mean /= wave.length || 1;
  let variance = 0;
  for (let i = 0; i < wave.length; i++) variance += (wave[i] - mean) ** 2;
  variance /= wave.length || 1;
  const std = Math.sqrt(variance + 1e-7); // HF zero_mean_unit_var_norm: epsilon inside sqrt
  const out = new Float32Array(wave.length);
  for (let i = 0; i < wave.length; i++) out[i] = (wave[i] - mean) / std;
  return out;
}

/**
 * Map a target phrase to CTC token ids (space -> word delimiter) + display chars. `outputDim` is
 * the model's CTC head size: vocab.json also lists <s>/</s> (ids beyond the head) which must never
 * index the logits, so ids >= outputDim are dropped.
 */
function targetTokens(text: string, loaded: Loaded, outputDim: number): { ids: number[]; chars: string[] } {
  const { tokenToId, meta } = loaded;
  const ids: number[] = [];
  const chars: string[] = [];
  for (const raw of text.toLowerCase().replace(/ё/g, 'е')) {
    const ch = raw === ' ' ? meta.word_delimiter : raw;
    const id = tokenToId.get(ch);
    if (id === undefined || id >= outputDim) continue; // outside the CTC output head
    ids.push(id);
    chars.push(raw === ' ' ? ' ' : raw);
  }
  return { ids, chars };
}

/** Recognize Kyrgyz speech and score it against the intended target phrase. */
export async function analyze(wave: Float32Array, target: string, onStatus?: (s: AsrStatus) => void): Promise<Analysis> {
  try {
    const loaded = await init(onStatus);
    const { ort, session, meta } = loaded;
    onStatus?.('recognizing');

    const input = meta.do_normalize ? normalizeWave(wave) : wave;
    const feeds: Record<string, import('onnxruntime-web').Tensor> = {
      [session.inputNames[0]]: new ort.Tensor('float32', input, [1, input.length]),
    };
    const out = await session.run(feeds);
    const logitsTensor = out[session.outputNames[0]];
    const frames = logitsTensor.dims[1] as number;
    const vocab = logitsTensor.dims[2] as number;
    const blank = meta.pad_id ?? 0;
    const probs = softmaxRows(logitsTensor.data as Float32Array, frames, vocab);

    const transcript = greedyDecode(probs, frames, vocab, loaded.idToToken, blank, meta.word_delimiter);

    const { ids, chars } = targetTokens(target, loaded, vocab);
    const gop = forcedAlignGop(probs, frames, vocab, ids, blank);
    const letters: LetterScore[] = chars.map((ch, i) =>
      ch === ' ' ? { ch: ' ', score: 0, gap: true } : { ch, score: gop[i] ?? 0 },
    );
    const scored = letters.filter((l) => !l.gap);
    const percent = scored.length === 0 ? 0 : Math.round((scored.reduce((a, l) => a + l.score, 0) / scored.length) * 100);

    onStatus?.('done');
    return { transcript, percent, letters };
  } catch (e) {
    onStatus?.('error');
    throw e;
  }
}
