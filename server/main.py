"""Kyrgyz ASR + pronunciation-scoring backend.

Moves the ~338 MB wav2vec2 ONNX model out of the browser: the web app records audio, uploads a
small 16 kHz mono WAV (~64 KB per phrase), and gets back the same Analysis JSON the in-browser
pipeline produced — {transcript, percent, letters}. CTC math lives in ctc.py (fixture-locked).

Run:
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn main:app --port 8000        # from server/

Model files are read from server/models/ (see MODELS_DIR); regenerate with
web/scripts/export-asr.py.
"""
from __future__ import annotations

import io
import json
import os
import wave as wavelib

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from ctc import forced_align_gop, greedy_decode, softmax_rows

MODELS_DIR = os.environ.get("MODELS_DIR", os.path.join(os.path.dirname(__file__), "models"))
SAMPLE_RATE = 16000
MAX_SECONDS = 30  # PoC guard: reject absurdly long uploads

app = FastAPI(title="kyrgyz-asr")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4321", "http://localhost:4322"],  # astro dev/preview
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# --- model state, loaded once at startup ---
session: ort.InferenceSession | None = None
vocab: dict[str, int] = {}
id_to_token: dict[int, str] = {}
meta: dict = {}


@app.on_event("startup")
def load_model() -> None:
    global session, vocab, id_to_token, meta
    model_path = os.path.join(MODELS_DIR, "model.onnx")
    if not os.path.exists(model_path):
        raise RuntimeError(f"{model_path} not found — run web/scripts/export-asr.py first")
    session = ort.InferenceSession(model_path)
    with open(os.path.join(MODELS_DIR, "vocab.json"), encoding="utf-8") as f:
        vocab = json.load(f)
    with open(os.path.join(MODELS_DIR, "asr-meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    id_to_token.update({i: t for t, i in vocab.items()})


def parse_wav(data: bytes) -> np.ndarray:
    """Parse a 16 kHz mono 16-bit PCM WAV into float32 [-1, 1]."""
    try:
        with wavelib.open(io.BytesIO(data)) as w:
            if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise HTTPException(422, "expected 16 kHz mono 16-bit PCM WAV")
            if w.getnframes() > MAX_SECONDS * SAMPLE_RATE:
                raise HTTPException(413, f"audio longer than {MAX_SECONDS}s")
            frames = w.readframes(w.getnframes())
    except wavelib.Error as e:
        raise HTTPException(422, f"not a valid WAV: {e}") from e
    return np.frombuffer(frames, np.int16).astype(np.float32) / 32768.0


def target_tokens(text: str, output_dim: int, delimiter: str) -> tuple[list[int], list[str]]:
    """Target phrase -> CTC token ids + display chars (space -> delimiter, off-head ids dropped)."""
    ids: list[int] = []
    chars: list[str] = []
    for raw in text.lower().replace("ё", "е"):
        ch = delimiter if raw == " " else raw
        tid = vocab.get(ch)
        if tid is None or tid >= output_dim:
            continue
        ids.append(tid)
        chars.append(raw)
    return ids, chars


@app.get("/api/health")
def health() -> dict:
    return {"ok": session is not None}


@app.post("/api/asr/analyze")
async def analyze(audio: UploadFile = File(...), target: str = Form(...)) -> dict:
    """Recognize Kyrgyz speech and score it against the intended target phrase."""
    if session is None:
        raise HTTPException(503, "model not loaded")
    wave = parse_wav(await audio.read())
    if wave.size < SAMPLE_RATE // 10:
        raise HTTPException(422, "audio too short")

    x = ((wave - wave.mean()) / np.sqrt(wave.var() + 1e-7)).astype(np.float32)[None, :]
    logits = session.run([session.get_outputs()[0].name], {session.get_inputs()[0].name: x})[0][0]
    probs = softmax_rows(logits)
    output_dim = probs.shape[1]
    blank = meta["pad_id"]
    delimiter = meta["word_delimiter"]

    transcript = greedy_decode(probs, id_to_token, blank, delimiter)
    ids, chars = target_tokens(target, output_dim, delimiter)
    gop = forced_align_gop(probs, ids, blank)
    letters = [
        {"ch": ch, "score": 0.0, "gap": True} if ch == " " else {"ch": ch, "score": round(gop[i], 4)}
        for i, ch in enumerate(chars)
    ]
    scored = [l["score"] for l in letters if not l.get("gap")]
    percent = round(100 * sum(scored) / len(scored)) if scored else 0
    return {"transcript": transcript, "percent": percent, "letters": letters}
