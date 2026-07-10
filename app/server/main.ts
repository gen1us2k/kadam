// Kyrgyz backend: ASR + pronunciation scoring, TTS synthesis, and serving the built site.
//
// One port serves the app (dist/) and the API. Audio is uploaded as a small WAV (ASR) or
// requested by text (TTS); the ~338 MB ASR and ~114 MB TTS ONNX models run here, not in the
// browser. CTC math lives in ctc.ts, locked to the reference fixture by test-ctc.ts.
//
// Run (from app/):  npm install && npm run serve      # builds dist, listens on :8000
// Model files come from app/models/ — ASR: scripts/export-asr.py; TTS: models/tts/ (see README).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import * as ort from 'onnxruntime-node';
import { softmaxRows, greedyDecode, forcedAlignGop } from './ctc.ts';
import { CONTENT_TYPES, cacheControl, resolveStatic, weakEtag } from './static.ts';
import { parseTokens, tokenize, encodeWav } from './tts.ts';

const MODELS_DIR = process.env.MODELS_DIR ?? fileURLToPath(new URL('../models', import.meta.url));
// The built app (astro build -> dist) is served from the same port as /api.
const STATIC_DIR = process.env.STATIC_DIR ?? fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT ?? 4321);
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 30;
const MAX_BODY = 44 + MAX_SECONDS * SAMPLE_RATE * 2; // WAV header + 30 s of 16-bit samples
const MAX_TTS_CHARS = 300; // synthesis guard — the app speaks words/short phrases


interface AsrMeta {
  pad_id: number;
  word_delimiter: string;
  do_normalize: boolean;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- model state, loaded once before listen ---
async function loadModels() {
  try {
    return {
      session: await ort.InferenceSession.create(`${MODELS_DIR}/model.onnx`),
      vocab: JSON.parse(await readFile(`${MODELS_DIR}/vocab.json`, 'utf8')) as Record<string, number>,
      meta: JSON.parse(await readFile(`${MODELS_DIR}/asr-meta.json`, 'utf8')) as AsrMeta,
      ttsSession: await ort.InferenceSession.create(`${MODELS_DIR}/tts/model.onnx`),
      ttsTokens: parseTokens(await readFile(`${MODELS_DIR}/tts/tokens.txt`, 'utf8')),
    };
  } catch (e) {
    throw new Error(
      `model files not found/loadable in ${MODELS_DIR} — ASR: scripts/export-asr.py; TTS: models/tts/{model.onnx,tokens.txt}`,
      { cause: e },
    );
  }
}
const { session, vocab, meta, ttsSession, ttsTokens } = await loadModels();
const idToToken = new Map<number, string>();
for (const [tok, id] of Object.entries(vocab)) idToToken.set(id, tok);

/** Parse a 16 kHz mono 16-bit PCM WAV into Float32 [-1, 1]. Throws 422 on anything else. */
function parseWav(buf: Buffer): Float32Array {
  const bad = (msg: string) => new HttpError(422, msg);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw bad('not a WAV file');
  }
  // Walk chunks to find fmt and data (robust to extra chunks some encoders insert).
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, Math.min(off + 8 + size, buf.length));
    if (id === 'fmt ' && body.length >= 16) {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        rate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === 'data') {
      data = body;
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw bad('missing fmt/data chunk');
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.rate !== SAMPLE_RATE || fmt.bits !== 16) {
    throw bad('expected 16 kHz mono 16-bit PCM WAV');
  }
  const samples = Math.floor(data.length / 2); // tolerate a truncated trailing byte
  if (samples > MAX_SECONDS * SAMPLE_RATE) throw new HttpError(413, `audio longer than ${MAX_SECONDS}s`);
  if (samples < SAMPLE_RATE / 10) throw bad('audio too short');
  const wave = new Float32Array(samples);
  for (let i = 0; i < samples; i++) wave[i] = data.readInt16LE(i * 2) / 32768;
  return wave;
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

/** Target phrase -> CTC token ids + display chars (space -> delimiter, off-head ids dropped). */
function targetTokens(text: string, outputDim: number): { ids: number[]; chars: string[] } {
  const ids: number[] = [];
  const chars: string[] = [];
  for (const raw of text.toLowerCase().replace(/ё/g, 'е')) {
    const ch = raw === ' ' ? meta.word_delimiter : raw;
    const id = vocab[ch];
    if (id === undefined || id >= outputDim) continue;
    ids.push(id);
    chars.push(raw);
  }
  return { ids, chars };
}

async function analyze(wavBody: Buffer, target: string) {
  const wave = parseWav(wavBody);
  const input = meta.do_normalize ? normalizeWave(wave) : wave;
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, input.length]) };
  const out = await session.run(feeds);
  const logits = out[session.outputNames[0]];
  const frames = logits.dims[1] as number;
  const vocabDim = logits.dims[2] as number;
  const probs = softmaxRows(logits.data as Float32Array, frames, vocabDim);

  const transcript = greedyDecode(probs, frames, vocabDim, idToToken, meta.pad_id, meta.word_delimiter);
  const { ids, chars } = targetTokens(target, vocabDim);
  const gop = forcedAlignGop(probs, frames, vocabDim, ids, meta.pad_id);
  const letters = chars.map((ch, i) =>
    ch === ' ' ? { ch: ' ', score: 0, gap: true } : { ch, score: Math.round(gop[i] * 10000) / 10000 },
  );
  const scored = chars.map((ch, i) => (ch === ' ' ? null : gop[i])).filter((v): v is number => v !== null);
  const percent = scored.length === 0 ? 0 : Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 100);
  return { transcript, percent, letters };
}

/** Synthesize Kyrgyz text to a 16 kHz mono WAV via the MMS model. */
async function synthesizeTts(text: string): Promise<Buffer> {
  const x = tokenize(text, ttsTokens);
  if (x.length <= 1) throw new HttpError(422, 'nothing to synthesize');
  const feeds = {
    x: new ort.Tensor('int64', x, [1, x.length]),
    x_length: new ort.Tensor('int64', BigInt64Array.from([BigInt(x.length)]), [1]),
    noise_scale: new ort.Tensor('float32', Float32Array.from([0.667]), [1]),
    length_scale: new ort.Tensor('float32', Float32Array.from([1.0]), [1]),
    noise_scale_w: new ort.Tensor('float32', Float32Array.from([0.8]), [1]),
  };
  const out = await ttsSession.run(feeds);
  const wave = out[ttsSession.outputNames[0]].data as Float32Array;
  return encodeWav(wave, SAMPLE_RATE);
}

/** Serve a built static asset from dist/. Streamed so large JS bundles don't buffer in memory. */
async function serveStatic(pathname: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const file = resolveStatic(STATIC_DIR, pathname);
  if (!file) {
    res.writeHead(400).end('bad path');
    return;
  }
  let size: number;
  let etag: string;
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    size = s.size;
    etag = weakEtag(s.mtimeMs, s.size);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(pathname) }).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
  });
  createReadStream(file)
    // Headers are already flushed mid-stream — abort the connection so the client sees a hard
    // failure instead of a silently truncated 200.
    .on('error', () => res.destroy())
    .pipe(res);
}

// Astro dev/preview origins. Same-origin in normal use (unified server or astro proxy); the
// header only matters when the page talks to the API cross-origin. Widen deliberately if deployed.
const ALLOWED_ORIGINS = new Set(['http://localhost:4321', 'http://localhost:4322']);

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (req.method === 'GET' && url.pathname === '/api/health') return send(200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/tts') {
      const text = url.searchParams.get('text')?.trim();
      if (!text) throw new HttpError(422, 'missing ?text=');
      if (text.length > MAX_TTS_CHARS) throw new HttpError(413, `text longer than ${MAX_TTS_CHARS} chars`);
      const wav = await synthesizeTts(text);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        // Deterministic enough per word; let the browser cache repeated vocabulary.
        'Cache-Control': 'public, max-age=31536000',
      });
      return void res.end(wav);
    }
    if (req.method === 'POST' && url.pathname === '/api/asr/analyze') {
      const target = url.searchParams.get('target')?.trim();
      if (!target) throw new HttpError(422, 'missing ?target=');
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_BODY) throw new HttpError(413, 'body too large');
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of req) {
        received += (chunk as Buffer).length;
        if (received > MAX_BODY) throw new HttpError(413, 'body too large');
        chunks.push(chunk as Buffer);
      }
      return send(200, await analyze(Buffer.concat(chunks), target));
    }
    if (url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });
    // Everything else: the built web app.
    if (req.method === 'GET' || req.method === 'HEAD') return void (await serveStatic(url.pathname, req, res));
    send(404, { error: 'not found' });
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error(e);
    send(500, { error: 'internal error' });
  }
});

try {
  if (!(await stat(`${STATIC_DIR}/index.html`)).isFile()) throw new Error();
} catch {
  console.warn(`[warn] ${STATIC_DIR}/index.html not found — run \`cd web && npm run build\` to serve the app`);
}

server.listen(PORT, () => console.log(`kyrgyz app on http://localhost:${PORT}  (api + dist, models: ${MODELS_DIR})`));
