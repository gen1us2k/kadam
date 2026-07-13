#!/usr/bin/env bash
# Optional: create the DigitalOcean droplet with doctl (https://docs.digitalocean.com/reference/doctl/).
# Needs `doctl auth init` done and an SSH key added to your DO account.
#
#   deploy/create-droplet.sh [name] [size] [region]
#
# Default size s-1vcpu-2gb ($12/mo) — the minimum that fits the ~870 MB model working set
# (a 1 GB droplet OOMs). Bump to s-2vcpu-2gb / s-2vcpu-4gb for more concurrent recognitions.
set -euo pipefail

NAME="${1:-kadam}"
SIZE="${2:-s-1vcpu-2gb}"
REGION="${3:-fra1}"
IMAGE="ubuntu-24-04-x64"

command -v doctl >/dev/null || { echo "install doctl first: https://docs.digitalocean.com/reference/doctl/how-to/install/" >&2; exit 1; }

# Use every SSH key registered in the DO account (so you can ssh in immediately).
KEYS="$(doctl compute ssh-key list --format ID --no-header | paste -sd, -)"
[[ -n "$KEYS" ]] || { echo "no SSH keys in your DO account — add one: doctl compute ssh-key import" >&2; exit 1; }

echo "[create] $NAME  $SIZE  $REGION  $IMAGE"
doctl compute droplet create "$NAME" \
  --size "$SIZE" --region "$REGION" --image "$IMAGE" \
  --ssh-keys "$KEYS" --wait --format ID,Name,PublicIPv4

IP="$(doctl compute droplet get "$NAME" --format PublicIPv4 --no-header)"
echo
echo "[create] droplet up at $IP"
echo "  next:"
echo "    scp deploy/setup.sh root@$IP:"
echo "    ssh root@$IP 'bash setup.sh <domain|_>'"
echo "    deploy/deploy.sh root@$IP"
