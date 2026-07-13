# Deploy Кадам to DigitalOcean

The app is a single Node service (`app/server/main.ts` serves the built site **and** `/api` on one
port). Deploy = a small droplet running the server behind Caddy (reverse proxy + automatic HTTPS),
kept alive by systemd. Models (~450 MB) are built once **on your laptop** and shipped by `rsync` —
the droplet never runs the heavy ASR export.

## Sizing (measured)

The two ONNX models hold ~870 MB resident, so a **1 GB droplet OOMs**. Minimum viable:

| Droplet | ~$/mo | Concurrent speakers* |
|---|---|---|
| **s-1vcpu-2gb** (min) | $12 | ~12–15 |
| s-2vcpu-2gb | $18 | ~25–30 |
| s-4vcpu-8gb | $48 | ~60 |

\* a "speaker" ≈ one active learner uploading a ~2 s clip every ~25 s; a 2 s recognition is
~1–1.5 CPU-s on a shared DO vCPU. Thousands of idle tabs are free — only concurrent *recognitions*
cost CPU. Scale past one box with several droplets behind a DO Load Balancer.

## First deploy

```bash
# 0. build the models locally once (needs Python + torch; see app/scripts/fetch-models.sh)
cd app && npm run fetch-models && cd ..

# 1. create the droplet (optional — or make one in the DO panel: Ubuntu 24.04, ≥2 GB)
deploy/create-droplet.sh kadam s-1vcpu-2gb fra1     # needs doctl

# 2. provision it (Node 24, Caddy, systemd, firewall)
scp deploy/setup.sh root@<ip>:
ssh root@<ip> "bash setup.sh example.com"           # or "_" for IP-only, plain http

# 3. ship the app + models, build, start
deploy/deploy.sh root@<ip>
```

Point an `A` record for `example.com` at the droplet IP and Caddy gets a TLS cert automatically.

## Updates

```bash
deploy/deploy.sh root@<ip>     # rsyncs only the delta, rebuilds, restarts, health-checks
```

## Operate

- Logs: `ssh root@<ip> journalctl -u kadam -f`
- Restart: `ssh root@<ip> systemctl restart kadam`
- The app binds `127.0.0.1:4321` (HOST env in the unit) — public traffic only through Caddy; the
  firewall additionally allows just SSH/80/443.

## Notes

- Node 24 runs `server/main.ts` (and its `.ts` imports) directly via type-stripping — no build step
  for the server; `npm run build` only produces the static site into `dist/`.
- Config is via env (see `app/.env.example`): the systemd unit sets `PORT`/`HOST`; add
  `Environment=MODELS_DIR=...` there to keep weights on a separate volume.
- No Docker on purpose (matches the app's zero-framework backend). If you prefer containers, a
  `node:24-slim` image copying `app/` + `models/` and running `node server/main.ts` works the same.
