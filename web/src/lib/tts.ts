// In-browser Kyrgyz TTS: Meta MMS (facebook/mms-tts-kir) as ONNX, run with onnxruntime-web.
// The model (~113 MB fp32) is fetched once from the HuggingFace CDN and kept in the Cache API;
// synthesis is fully client-side afterwards — no backend, no keys. int8 quantization was tried
// and rejected: the graph's ConvInteger nodes are unsupported by ORT.

const REPO = 'https://huggingface.co/willwade/mms-tts-multilingual-models-onnx/resolve/main/kir';
const MODEL_URL = `${REPO}/model.onnx`;
const TOKENS_URL = `${REPO}/tokens.txt`;
const CACHE_NAME = 'kyrgyz-tts-v1';
const SAMPLE_RATE = 16000;

export type TtsStatus = 'downloading' | 'loading' | 'synthesizing' | 'playing' | 'done' | 'error';

type Ort = typeof import('onnxruntime-web');
type Session = import('onnxruntime-web').InferenceSession;

let initPromise: Promise<{ ort: Ort; session: Session; tokens: Map<string, number> }> | null = null;
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;

async function fetchCached(url: string): Promise<Response> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    await cache.put(url, res.clone());
    return res;
  } catch {
    // Cache API unavailable (private mode) — plain fetch.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    return res;
  }
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
      const [tokensRes, modelRes] = await Promise.all([fetchCached(TOKENS_URL), fetchCached(MODEL_URL)]);
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
