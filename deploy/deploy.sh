#!/usr/bin/env bash
# Ship the app to a provisioned droplet, build it there, and restart the service.
# Run from your laptop, from the REPO ROOT:
#
#   deploy/deploy.sh root@<droplet-ip>
#
# Ships the whole repo (app/ + the repo-root anki/ + phrases.md the build reads) plus the ~450 MB
# model weights — the droplet never runs the heavy ASR export. Run deploy/setup.sh on the droplet
# first. Re-run this for every update (rsync only sends the delta).
set -euo pipefail

HOST="${1:?usage: deploy.sh user@droplet-ip}"
REMOTE_DIR=/opt/kadam
APP_USER=kadam
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf '\033[1m[deploy]\033[0m %s\n' "$*"; }

# Models are gitignored and generated locally — they must exist before the first deploy.
if [[ ! -f "$ROOT/app/models/model.onnx" || ! -f "$ROOT/app/models/tts/model.onnx" ]]; then
  echo "error: model weights missing. Run 'cd app && npm run fetch-models' first." >&2
  exit 1
fi

log "syncing repo + models to $HOST:$REMOTE_DIR"
rsync -az --delete --info=progress2 \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude '.astro' \
  --exclude '.venv' --exclude '.env' \
  --exclude '/app/data' \
  "$ROOT/" "$HOST:$REMOTE_DIR/"
# /app/data is the bot's LOCAL dev state (subscribers, session cursors). Production state lives in
# /var/lib/kadam, so shipping the dev file would only put a stray copy of chat ids on the server.

log "installing deps, building, restarting on the droplet"
ssh "$HOST" "bash -euo pipefail -s" <<REMOTE
  chown -R $APP_USER:$APP_USER "$REMOTE_DIR"
  cd "$REMOTE_DIR/app"
  # -H sets HOME=/home/$APP_USER so npm's cache doesn't hit /root/.npm (EACCES).
  sudo -Hu $APP_USER npm ci
  sudo -Hu $APP_USER npm run build
  systemctl restart kadam
  # The bot is optional. Without /etc/kadam-bot.env it exits 78 and RestartPreventExitStatus=78
  # keeps systemd from retrying, so the unit simply sits in failed state and the deploy succeeds.
  # `|| true` also covers droplets provisioned before the bot existed: no unit file there, and
  # under `set -e` a "unit not found" would abort the deploy before the site health check.
  systemctl restart kadam-bot || true
  # Wait for health — cold start loads ~470 MB of ONNX + ORT graph init, slow on a 1-vCPU box.
  for i in \$(seq 1 60); do
    if curl -fsS http://127.0.0.1:4321/api/health >/dev/null 2>&1; then echo "[deploy] healthy ✓"; exit 0; fi
    sleep 1
  done
  echo "[deploy] service did not become healthy in 60s — check: journalctl -u kadam -n 50" >&2
  exit 1
REMOTE

log "deployed. Site is live via Caddy (:80/:443)."
