// In-browser Kyrgyz TTS: Meta MMS (facebook/mms-tts-kir) as ONNX, run with onnxruntime-web.
// The model (~114 MB fp32) ships in the repo under public/tts and is served locally — no CDN,
// no backend, no keys. The browser HTTP-caches the static file; init() loads it once per session.
// int8 quantization was tried and rejected: the graph's ConvInteger nodes are unsupported by ORT.

const BASE = import.meta.env.BASE_URL; // '/' by default; honours a configured Astro `base`
const MODEL_URL = `${BASE}tts/model.onnx`;
const TOKENS_URL = `${BASE}tts/tokens.txt`;
const SAMPLE_RATE = 16000;

export type TtsStatus = 'downloading' | 'loading' | 'synthesizing' | 'playing' | 'done' | 'error';

type Ort = typeof import('onnxruntime-web');
type Session = import('onnxruntime-web').InferenceSession;

let initPromise: Promise<{ ort: Ort; session: Session; tokens: Map<string, number> }> | null = null;
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

async function fetchAsset(url: string): Promise<Response> {
  // Local static asset (public/tts) — the browser handles HTTP caching across sessions.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res;
}

function parseTokens(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split('\n')) {
    // Format: "<char> <id>"; the space character itself is a valid token ("  <id>").
    if (line.startsWith('  ')) {
      map.set(' ', Number(line.trim()));
      continue;
    }
    const sep = line.indexOf(' ');
    if (sep <= 0) continue;
    const ch = line.slice(0, sep);
    const id = Number(line.slice(sep + 1));
    if (ch && Number.isFinite(id)) map.set(ch, id);
  }
  return map;
}

function init(onStatus?: (s: TtsStatus) => void) {
  if (!initPromise) {
    initPromise = (async () => {
      onStatus?.('downloading');
      // Vite emits the ORT wasm as a local hashed asset; the runtime resolves it itself.
      const ort = await import('onnxruntime-web');
      const [tokensRes, modelRes] = await Promise.all([fetchAsset(TOKENS_URL), fetchAsset(MODEL_URL)]);
      const tokens = parseTokens(await tokensRes.text());
      const model = await modelRes.arrayBuffer();
      onStatus?.('loading');
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { ort, session, tokens };
    })();
    initPromise.catch(() => {
      initPromise = null; // allow retry after a failed download
    });
  }
  return initPromise;
}

/** MMS frontend "characters" with add_blank=1: blank(0) interleaved between token ids. */
function tokenize(text: string, tokens: Map<string, number>): BigInt64Array {
  const ids: number[] = [];
  for (const ch of text) {
    const id = tokens.get(ch) ?? tokens.get(ch.toLowerCase());
    if (id !== undefined) ids.push(id);
  }
  const x: bigint[] = [0n];
  for (const id of ids) x.push(BigInt(id), 0n);
  return BigInt64Array.from(x);
}

/** Synthesize and play Kyrgyz text. Resolves when playback finishes. */
export async function speak(text: string, onStatus?: (s: TtsStatus) => void): Promise<void> {
  try {
    const { ort, session, tokens } = await init(onStatus);
    onStatus?.('synthesizing');

    const x = tokenize(text, tokens);
    if (x.length <= 1) throw new Error('nothing to synthesize');
    const feeds = {
      x: new ort.Tensor('int64', x, [1, x.length]),
      x_length: new ort.Tensor('int64', BigInt64Array.from([BigInt(x.length)]), [1]),
      noise_scale: new ort.Tensor('float32', Float32Array.from([0.667]), [1]),
      length_scale: new ort.Tensor('float32', Float32Array.from([1.0]), [1]),
      noise_scale_w: new ort.Tensor('float32', Float32Array.from([0.8]), [1]),
    };
    const out = await session.run(feeds);
    const wave = out.y.data as Float32Array;

    onStatus?.('playing');
    audioCtx ??= new AudioContext({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    currentSource?.stop();
    const buffer = audioCtx.createBuffer(1, wave.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(wave);
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
