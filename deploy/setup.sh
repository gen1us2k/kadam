#!/usr/bin/env bash
# One-time provisioning for a fresh Ubuntu 22.04/24.04 DigitalOcean droplet.
# Run AS ROOT on the droplet (self-contained — needs no repo files):
#
#   scp deploy/setup.sh root@<droplet-ip>:
#   ssh root@<droplet-ip> "bash setup.sh example.com"        # domain -> auto-HTTPS
#   ssh root@<droplet-ip> "bash setup.sh _"                  # no domain -> plain :80
#
# Installs Node 24 (runs the .ts server directly), Caddy (reverse proxy + auto-TLS), a locked-down
# service user + systemd unit, and a firewall. Then push the app with deploy/deploy.sh from your
# laptop. Idempotent — safe to re-run.
set -euo pipefail

DOMAIN="${1:?usage: setup.sh <domain|_>}"
APP_USER=kadam
APP_DIR=/opt/kadam
PORT=4321

log() { printf '\033[1m[setup]\033[0m %s\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive

log "installing base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg rsync ufw debian-keyring debian-archive-keyring apt-transport-https

log "installing Node 24"
if ! node --version 2>/dev/null | grep -q '^v2[4-9]\|^v[3-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

log "installing Caddy"
if ! command -v caddy >/dev/null; then
  # Official Caddy apt repo — the deb.txt already references the dearmored keyring below.
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

log "creating service user + app dir ($APP_DIR)"
id "$APP_USER" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

log "writing systemd unit"
cat > /etc/systemd/system/kadam.service <<UNIT
[Unit]
Description=Kadam (Kyrgyz learning app)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/app
ExecStart=/usr/bin/node server/main.ts
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Restart=on-failure
RestartSec=3
# hardening — the app only reads its own files; state lives in the client
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
UNIT

log "writing Caddyfile (domain: $DOMAIN)"
if [[ "$DOMAIN" == "_" || -z "$DOMAIN" ]]; then
  SITE=":80"
else
  SITE="$DOMAIN"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDY

log "firewall: allow SSH + HTTP/HTTPS only (app port stays private)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

log "enabling services (kadam starts after the first deploy.sh)"
systemctl daemon-reload
systemctl enable kadam >/dev/null
systemctl restart caddy

log "done. Now from your laptop:  deploy/deploy.sh root@<droplet-ip>"
[[ "$DOMAIN" != "_" ]] && log "point an A record for $DOMAIN at this droplet's IP for auto-HTTPS."
exit 0
