#!/usr/bin/env bash
#
# Push main to origin, then deploy to the server in deploy/ip.txt.
# Loads OPENAI_API_KEY from .env. Optional: DOMAIN (default eigobot.com).
#
#   npm run push:deploy
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"

git push "$REMOTE" "$BRANCH"

set -a
if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env
fi
set +a

[[ -n "${OPENAI_API_KEY:-}" ]] || {
  echo "Error: OPENAI_API_KEY missing. Set it in .env" >&2
  exit 1
}

IP_FILE="$ROOT/deploy/ip.txt"
[[ -f "$IP_FILE" ]] || {
  echo "Error: missing $IP_FILE" >&2
  exit 1
}
TARGET="$(tr -d '[:space:]' < "$IP_FILE")"

export DOMAIN="${DOMAIN:-eigobot.com}"

exec bash "$ROOT/scripts/deploy-to-ip.sh" "$TARGET"
