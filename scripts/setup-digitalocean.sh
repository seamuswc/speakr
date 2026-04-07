#!/usr/bin/env bash
#
# One-shot DigitalOcean: Ubuntu droplet → Node 20 → clone Speakr → .env → systemd → firewall.
# Optional HTTPS: set DOMAIN=app.example.com (A record → droplet IP) to install Caddy.
#
# On your machine:
#   brew install doctl
#   Add an SSH key: https://cloud.digitalocean.com/account/security
#
# Run:
#   export DIGITALOCEAN_ACCESS_TOKEN="dop_v1_..."
#   export OPENAI_API_KEY="sk-..."
#   ./scripts/setup-digitalocean.sh
#
# Optional env: REGION=nyc1  SIZE=s-1vcpu-1gb  REPO_URL=...  SSH_KEY_IDS=id1,id2  DOMAIN=app.example.com
#
set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; DIM='\033[2m'; RST='\033[0m'
die() { echo -e "${RED}Error:${RST} $*" >&2; exit 1; }
info() { echo -e "${DIM}$*${RST}"; }
ok() { echo -e "${GRN}$*${RST}"; }

command -v doctl >/dev/null 2>&1 || die "Install doctl: brew install doctl"
command -v ssh >/dev/null 2>&1 || die "ssh not found"
command -v scp >/dev/null 2>&1 || die "scp not found"

[[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ]] || die "Set DIGITALOCEAN_ACCESS_TOKEN"
[[ -n "${OPENAI_API_KEY:-}" ]] || die "Set OPENAI_API_KEY"

export DIGITALOCEAN_ACCESS_TOKEN

DROPLET_NAME="${1:-speakr-$(date +%s)}"
REGION="${REGION:-nyc1}"
SIZE="${SIZE:-s-1vcpu-1gb}"
REPO_URL="${REPO_URL:-https://github.com/seamuswc/speakr.git}"

SSH_KEY_IDS="${SSH_KEY_IDS:-$(doctl compute ssh-key list --format ID --no-header 2>/dev/null | tr '\n' ',' | sed 's/,$//')}"
[[ -n "$SSH_KEY_IDS" ]] || die "No SSH keys in DigitalOcean. Add one at https://cloud.digitalocean.com/account/security or set SSH_KEY_IDS=id1,id2"

HOST_BIND="127.0.0.1"

CLOUD_INIT="$(mktemp)"
trap 'rm -f "$CLOUD_INIT"' EXIT

cat >"$CLOUD_INIT" <<EOF
#cloud-config
package_update: true
packages:
  - git
  - curl
  - ca-certificates
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  - apt-get install -y nodejs
  - rm -rf /opt/speakr
  - git clone ${REPO_URL} /opt/speakr
  - cd /opt/speakr && npm install --omit=dev
  - touch /opt/speakr/.cloud-init-done
EOF

info "Creating droplet ${DROPLET_NAME} (${SIZE}, ${REGION})…"
doctl compute droplet create "$DROPLET_NAME" \
  --image ubuntu-22-04-x64 \
  --size "$SIZE" \
  --region "$REGION" \
  --ssh-keys "$SSH_KEY_IDS" \
  --user-data-file "$CLOUD_INIT" \
  --wait

PUBLIC_IP="$(doctl compute droplet get "$DROPLET_NAME" --format PublicIPv4 --no-header 2>/dev/null | tr -d '[:space:]')"
[[ -n "$PUBLIC_IP" ]] || die "Could not read droplet IPv4. Try: doctl compute droplet list"

# Wider compatibility than accept-new (older OpenSSH)
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15)

info "Waiting for cloud-init on root@${PUBLIC_IP}…"
READY=0
for _ in $(seq 1 72); do
  if ssh "${SSH_OPTS[@]}" "root@${PUBLIC_IP}" "test -f /opt/speakr/.cloud-init-done" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 5
done
[[ "$READY" -eq 1 ]] || die "Timeout waiting for cloud-init. Check: ssh root@${PUBLIC_IP}"

info "Writing /opt/speakr/.env …"
ENV_TMP="$(mktemp)"
trap 'rm -f "$CLOUD_INIT" "$ENV_TMP"' EXIT
{
  echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
  echo "PORT=3000"
  echo "HOST=${HOST_BIND}"
} >"$ENV_TMP"
scp "${SSH_OPTS[@]}" "$ENV_TMP" "root@${PUBLIC_IP}:/opt/speakr/.env"
rm -f "$ENV_TMP"

info "systemd + firewall…"
ssh "${SSH_OPTS[@]}" "root@${PUBLIC_IP}" bash -s <<'REMOTE'
set -euo pipefail
cat >/etc/systemd/system/speakr.service <<'UNIT'
[Unit]
Description=eigobot AI call assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/speakr
EnvironmentFile=/opt/speakr/.env
ExecStart=/usr/bin/node /opt/speakr/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now speakr.service
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
ufw allow OpenSSH
REMOTE

info "Caddy (ports 80/443) → app on 127.0.0.1:3000…"
ssh "${SSH_OPTS[@]}" "root@${PUBLIC_IP}" bash -s <<'REMOTE'
set -euo pipefail
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
systemctl enable caddy
REMOTE

CF_TMP="$(mktemp)"
{
  echo "http://${PUBLIC_IP} {"
  echo "	reverse_proxy 127.0.0.1:3000"
  echo "}"
  echo ""
  if [[ -n "${DOMAIN:-}" ]]; then
    echo "${DOMAIN}, www.${DOMAIN} {"
    echo "	reverse_proxy 127.0.0.1:3000"
    echo "}"
  fi
} >"$CF_TMP"
scp "${SSH_OPTS[@]}" "$CF_TMP" "root@${PUBLIC_IP}:/etc/caddy/Caddyfile"
rm -f "$CF_TMP"

ssh "${SSH_OPTS[@]}" "root@${PUBLIC_IP}" "systemctl restart caddy && ufw allow 80/tcp && ufw allow 443/tcp && ufw delete allow 3000/tcp 2>/dev/null || true && ufw --force enable"

ok "http://${PUBLIC_IP}/  (no :3000)"
[[ -n "${DOMAIN:-}" ]] && ok "https://${DOMAIN}/  (needs DNS A → ${PUBLIC_IP})" || true

echo ""
ok "Droplet: ${DROPLET_NAME}  |  IP: ${PUBLIC_IP}"
info "SSH:  ssh root@${PUBLIC_IP}"
info "Logs: ssh root@${PUBLIC_IP} 'journalctl -u speakr -f'"
