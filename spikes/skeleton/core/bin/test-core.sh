#!/usr/bin/env bash
# Proves the Core half without the Frappe half. Runs on its own anvil (8546), Core (8788) and fake Frappe (8899)
# with a throwaway state dir, so it never touches a running up.sh.
set -uo pipefail
CORE="$(cd "$(dirname "$0")/.." && pwd)"
export STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/core-test.XXXXXX")"
export ANVIL_PORT=8546 CORE_PORT=8788 FAKE_PORT=8899
export RPC_URL="http://127.0.0.1:$ANVIL_PORT" FRAPPE_URL="http://127.0.0.1:$FAKE_PORT"
export FAKE_STATE="$STATE_DIR/fake.json" NEW_SITE_SCRIPT="$CORE/test/fake-new-site.sh"
export RETRY_MIN_MS=300 RETRY_MAX_MS=1500 POLL_MS=300
for p in $ANVIL_PORT $CORE_PORT $FAKE_PORT; do
  if lsof -i :"$p" >/dev/null 2>&1; then echo "port $p is busy; stop whatever uses it first" >&2; exit 2; fi
done
cleanup() { "$CORE/bin/down.sh" >/dev/null; rm -rf "$STATE_DIR"; }
trap cleanup EXIT
"$CORE/bin/chain-up.sh" >/dev/null || { echo "chain-up failed" >&2; exit 1; }
cd "$CORE" && node --experimental-strip-types --no-warnings test/checks.ts
