#!/usr/bin/env bash
# Fetch the backend model weights into MODELS_DIR (default: <app>/models).
#
#   npm run fetch-models            # get whatever is missing
#   npm run fetch-models -- --force # re-fetch/regenerate everything
#   MODELS_DIR=/data/models npm run fetch-models
#
# TTS (Meta MMS mms-tts-kir): a pre-built ONNX is published, so it's downloaded directly and its
# sha256 is verified. ASR (wav2vec2-large-xlsr-kyrgyz): no public int8 ONNX exists — it's generated
# locally from the HuggingFace checkpoint via scripts/export-asr.py (needs Python + torch; this sets
# up a venv). The small decoder metadata (vocab.json, asr-meta.json, tts/tokens.txt) is committed in
# the repo; it's only downloaded here as a fallback if absent.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TTS_REPO="https://huggingface.co/willwade/mms-tts-multilingual-models-onnx/resolve/main/kir"
# Pin the pre-built TTS weight so a changed/compromised upstream fails loudly instead of loading a
# different model. Update this if you intentionally move to a new revision.
TTS_MODEL_SHA256="9d8bb52e185c154e6701df8f53bae11687ad30462a1b99e6ade202da79604ad7"

# Load app/.env (simple KEY=VALUE), real env vars winning — same precedence as the server's
# process.loadEnvFile. (Only unset keys are taken from .env.)
if [[ -f "$APP_DIR/.env" ]]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue # skip comments / blank lines
    [[ -n "${!key:-}" ]] && continue                     # real env wins
    export "$key=$val"
  done < "$APP_DIR/.env"
fi
MODELS_DIR="${MODELS_DIR:-$APP_DIR/models}"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

log() { printf '\033[1m[fetch-models]\033[0m %s\n' "$*"; }

# download <url> <dest> [sha256] — skip if present (unless --force); atomic; optional integrity check.
download() {
  local url="$1" dest="$2" sha="${3:-}"
  if [[ -f "$dest" && "$FORCE" -eq 0 ]]; then
    log "have $(basename "$dest") ($(du -h "$dest" | cut -f1)) — skip"
    return
  fi
  log "downloading $(basename "$dest") <- $url"
  mkdir -p "$(dirname "$dest")"
  curl -fL --progress-bar "$url" -o "$dest.part" || { rm -f "$dest.part"; echo "error: download failed" >&2; exit 1; }
  if [[ -n "$sha" ]]; then
    local got; got=$(shasum -a 256 "$dest.part" | awk '{print $1}')
    [[ "$got" == "$sha" ]] || { rm -f "$dest.part"; echo "error: sha256 mismatch for $(basename "$dest"): got $got, want $sha" >&2; exit 1; }
  fi
  [[ -s "$dest.part" ]] || { rm -f "$dest.part"; echo "error: $(basename "$dest") is empty" >&2; exit 1; }
  mv "$dest.part" "$dest"
}

log "MODELS_DIR = $MODELS_DIR"

# --- TTS: direct download ---
download "$TTS_REPO/model.onnx" "$MODELS_DIR/tts/model.onnx" "$TTS_MODEL_SHA256"
download "$TTS_REPO/tokens.txt" "$MODELS_DIR/tts/tokens.txt"

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
