#!/usr/bin/env bash
#
# Deploy Speakr to an EXISTING Ubuntu server (e.g. blank DigitalOcean droplet).
# Run this on YOUR Mac/Linux from a clone of the repo — uses SSH + rsync (or tar).
#
# Requires: passwordless SSH to the server (ssh root@YOUR_IP must work).
#
#   export OPENAI_API_KEY="sk-..."
#   ./scripts/deploy-to-ip.sh 167.99.12.34
#
# Optional:
#   SSH_USER=ubuntu          # default: root
#   SSH_IDENTITY=~/.ssh/id_ed25519   # passed to ssh -i
#   DOMAIN=eigobot.com       # optional; adds HTTPS for that host + www (DNS A → server IP)
#
# Caddy listens on :80 / :443 — app stays on 127.0.0.1:3000. Users open http://IP/ (no :3000) or https://domain/
#
set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; DIM='\033[2m'; RST='\033[0m'
die() { echo -e "${RED}Error:${RST} $*" >&2; exit 1; }
info() { echo -e "${DIM}$*${RST}"; }
ok() { echo -e "${GRN}$*${RST}"; }

[[ -n "${OPENAI_API_KEY:-}" ]] || die "Set OPENAI_API_KEY (your OpenAI secret key)"
[[ -n "${1:-}" ]] || die "Usage: $0 <server-ip-or-hostname>"

TARGET="${1}"
SSH_USER="${SSH_USER:-root}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SSH_OPTS=(
  -o ConnectTimeout=20
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
)
[[ -n "${SSH_IDENTITY:-}" ]] && SSH_OPTS+=(-i "$SSH_IDENTITY")
SSH_BASE=(ssh "${SSH_OPTS[@]}" "${SSH_USER}@${TARGET}")

# rsync -e must be a single command string; keep in sync with SSH_OPTS / identity
if [[ -n "${SSH_IDENTITY:-}" ]]; then
  RSYNC_RSH="ssh -i ${SSH_IDENTITY} -o ConnectTimeout=20 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
else
  RSYNC_RSH="ssh -o ConnectTimeout=20 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
fi

if command -v rsync >/dev/null 2>&1; then
  USE_RSYNC=1
else
  USE_RSYNC=0
  info "rsync not found; using tar over ssh (install rsync for faster deploys)"
fi

# Node binds localhost only; Caddy terminates HTTP(S) on the public interfaces.
HOST_BIND="127.0.0.1"

info "Checking SSH to ${SSH_USER}@${TARGET}…"
"${SSH_BASE[@]}" "echo ok" >/dev/null || die "Cannot SSH to ${SSH_USER}@${TARGET}. Fix keys: ssh-copy-id ${SSH_USER}@${TARGET}"

info "Installing Node 20 + base packages on server…"
"${SSH_BASE[@]}" bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates tar
ver=0
command -v node >/dev/null 2>&1 && ver="$(node -p "parseInt(process.versions.node.split('.')[0],10)" 2>/dev/null)" || ver=0
if [ "${ver:-0}" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
mkdir -p /opt/speakr
REMOTE

info "Uploading app to /opt/speakr …"
if [[ "$USE_RSYNC" -eq 1 ]]; then
  rsync -az --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    -e "$RSYNC_RSH" \
    "$ROOT/" "${SSH_USER}@${TARGET}:/opt/speakr/"
else
  "${SSH_BASE[@]}" "rm -rf /opt/speakr && mkdir -p /opt/speakr"
  (cd "$ROOT" && tar czf - \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=.env \
    .) | "${SSH_BASE[@]}" "tar xzf - -C /opt/speakr"
fi

info "Writing /opt/speakr/.env on server…"
ENV_TMP="$(mktemp)"
trap 'rm -f "$ENV_TMP"' EXIT
{
  echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
  echo "PORT=3000"
  echo "HOST=${HOST_BIND}"
} >"$ENV_TMP"
scp "${SSH_OPTS[@]}" "$ENV_TMP" "${SSH_USER}@${TARGET}:/opt/speakr/.env"
rm -f "$ENV_TMP"
trap - EXIT

info "npm install + systemd…"
"${SSH_BASE[@]}" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/speakr
npm install --omit=dev
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
"${SSH_BASE[@]}" bash -s <<REMOTE
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq caddy
systemctl enable caddy
REMOTE

CADDY_TMP="$(mktemp)"
{
  echo "http://${TARGET} {"
  echo "	reverse_proxy 127.0.0.1:3000"
  echo "}"
  echo ""
  if [[ -n "${DOMAIN:-}" ]]; then
    echo "${DOMAIN}, www.${DOMAIN} {"
    echo "	reverse_proxy 127.0.0.1:3000"
    echo "}"
  fi
} >"$CADDY_TMP"
scp "${SSH_OPTS[@]}" "$CADDY_TMP" "${SSH_USER}@${TARGET}:/etc/caddy/Caddyfile"
rm -f "$CADDY_TMP"

"${SSH_BASE[@]}" "systemctl restart caddy && ufw allow 80/tcp && ufw allow 443/tcp && ufw delete allow 3000/tcp 2>/dev/null || true && ufw --force enable"

ok "http://${TARGET}/  (no :3000)"
[[ -n "${DOMAIN:-}" ]] && ok "https://${DOMAIN}/  (after DNS A → ${TARGET})" || true

echo ""
ok "Done."
info "Logs: ssh ${SSH_USER}@${TARGET} 'journalctl -u speakr -f'"
