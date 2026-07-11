#!/usr/bin/env bash
# Fetch the backend model weights into MODELS_DIR (default: <app>/models).
#
#   npm run fetch-models            # get whatever is missing
#   npm run fetch-models -- --force # re-fetch everything
#   MODELS_DIR=/data/models npm run fetch-models
#
# TTS (Meta MMS mms-tts-kir): a pre-built ONNX is published, so it's downloaded directly.
# ASR (wav2vec2-large-xlsr-kyrgyz): no public int8 ONNX exists — it's generated locally from the
# HuggingFace checkpoint via scripts/export-asr.py (needs Python + torch; this sets up a venv).
# The small decoder metadata (vocab.json, asr-meta.json, tts/tokens.txt) is committed in the repo;
# it's only downloaded here as a fallback if absent.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Load .env (PORT/MODELS_DIR/...) if present, without clobbering already-exported vars.
if [[ -f "$APP_DIR/.env" ]]; then set -a; . "$APP_DIR/.env"; set +a; fi
MODELS_DIR="${MODELS_DIR:-$APP_DIR/models}"
TTS_REPO="https://huggingface.co/willwade/mms-tts-multilingual-models-onnx/resolve/main/kir"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

log() { printf '\033[1m[fetch-models]\033[0m %s\n' "$*"; }

# download <url> <dest> — skip if present (unless --force); verify non-empty.
download() {
  local url="$1" dest="$2"
  if [[ -f "$dest" && "$FORCE" -eq 0 ]]; then
    log "have $(basename "$dest") ($(du -h "$dest" | cut -f1)) — skip"
    return
  fi
  log "downloading $(basename "$dest") <- $url"
  mkdir -p "$(dirname "$dest")"
  curl -fL --progress-bar "$url" -o "$dest.part"
  mv "$dest.part" "$dest"
  [[ -s "$dest" ]] || { echo "error: $dest is empty" >&2; exit 1; }
}

log "MODELS_DIR = $MODELS_DIR"

# --- TTS: direct download ---
download "$TTS_REPO/model.onnx" "$MODELS_DIR/tts/model.onnx"
[[ -f "$MODELS_DIR/tts/tokens.txt" ]] || download "$TTS_REPO/tokens.txt" "$MODELS_DIR/tts/tokens.txt"

# --- ASR: generate via export-asr.py (heavy: torch + 1.2 GB checkpoint) ---
if [[ -f "$MODELS_DIR/model.onnx" && "$FORCE" -eq 0 ]]; then
  log "have model.onnx ($(du -h "$MODELS_DIR/model.onnx" | cut -f1)) — skip ASR export"
else
  log "generating ASR model via export-asr.py (one-time, needs Python + torch; this is slow)"
  command -v python3 >/dev/null || { echo "error: python3 required for the ASR export" >&2; exit 1; }
  VENV="$APP_DIR/.venv"
  [[ -d "$VENV" ]] || python3 -m venv "$VENV"
  # shellcheck disable=SC1091
  . "$VENV/bin/activate"
  python -m pip install --quiet --upgrade pip
  python -c "import torch, transformers, onnx, onnxruntime" 2>/dev/null || \
    pip install --quiet "torch==2.8.0" "transformers==4.57.6" "onnx==1.19.1" "onnxruntime==1.19.2"
  MODELS_DIR="$MODELS_DIR" python "$APP_DIR/scripts/export-asr.py"
  deactivate
fi

log "done. Model files:"
ls -la "$MODELS_DIR" "$MODELS_DIR/tts" 2>/dev/null | awk 'NF>=9 {printf "  %10s  %s\n", $5, $NF}'
