#!/usr/bin/env bash
# Deploys or upgrades the built program on a local validator (run inside WSL/Linux).
set -euo pipefail
cd "$(dirname "$0")/../anchor"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
URL="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
SO=target/deploy/stillpaid.so
KEY=target/deploy/stillpaid-keypair.json
ID=$(solana address -k "$KEY")
SIZE=$(stat -c %s "$SO")
if solana program show "$ID" -u "$URL" >/dev/null 2>&1; then
  HAVE=$(solana program show "$ID" -u "$URL" | awk '/Data Length/ {print $3}')
  if [ "$HAVE" -lt "$SIZE" ]; then
    solana program extend "$ID" $(( SIZE * 12 / 10 - HAVE )) -u "$URL"
    sleep 2
  fi
fi
solana program deploy "$SO" --program-id "$KEY" -u "$URL"
