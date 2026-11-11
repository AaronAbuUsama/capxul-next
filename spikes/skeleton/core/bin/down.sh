#!/usr/bin/env bash
# Stop the Core stub and anvil (anvil gets SIGTERM so it dumps its state and the chain survives a restart).
CORE="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${STATE_DIR:-$CORE/state}"
for name in core anvil; do
  f="$STATE_DIR/$name.pid"
  [ -f "$f" ] || continue
  pid="$(cat "$f")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid"
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    echo "stopped $name ($pid)"
  fi
  rm -f "$f"
done
