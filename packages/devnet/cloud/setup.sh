#!/usr/bin/env bash
# Make a Claude cloud container (or any Linux box behind the agent proxy) able to run the product stack: Foundry, the
# Solidity compilers the contracts and the test sites pin, and Docker for the Frappe test sites. Safe to re-run.
#   source packages/devnet/cloud/setup.sh      # then: pnpm contracts:prove, spikes/skeleton/run.sh <slug>
# Why each workaround: the proxy refuses foundry.paradigm.xyz, GitHub release downloads and binaries.soliditylang.org,
# so Foundry comes from npm (@foundry-rs/*) and solc is solc-js behind a native-looking wrapper (solc-js.cjs). Docker's
# daemon is not running at start, and a container cannot reach the proxy on 127.0.0.1, so the bench shares the host
# network (compose.cloud.yml).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="${CAPXUL_CLOUD_TOOLS:-$HOME/.capxul-cloud}"
FOUNDRY_VERSION=1.7.1
mkdir -p "$TOOLS/bin"
if [ ! -x "$TOOLS/bin/anvil" ]; then
  (cd "$TOOLS" && npm i --no-save --silent "@foundry-rs/forge@$FOUNDRY_VERSION" "@foundry-rs/anvil@$FOUNDRY_VERSION" "@foundry-rs/cast@$FOUNDRY_VERSION")
  cp "$TOOLS"/node_modules/@foundry-rs/*-linux-*/bin/* "$TOOLS/bin/"
fi
for v in 0.8.28 0.8.24; do   # packages/contracts pins 0.8.28; spikes/skeleton/core/contracts pin 0.8.24
  if [ ! -x "$TOOLS/solc-$v/solc" ]; then
    mkdir -p "$TOOLS/solc-$v" && (cd "$TOOLS/solc-$v" && npm i --no-save --silent "solc@$v")
    cp "$HERE/solc-js.cjs" "$TOOLS/solc-$v/solc" && chmod +x "$TOOLS/solc-$v/solc"
  fi
done
if ! docker info >/dev/null 2>&1; then
  sudo -n sh -c 'nohup dockerd >/tmp/dockerd.log 2>&1 &'
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
export PATH="$TOOLS/bin:$PATH"
export FOUNDRY_OFFLINE=true
export FOUNDRY_SOLC="$TOOLS/solc-0.8.28/solc"   # the spike's chain-up needs "$TOOLS/solc-0.8.24/solc" instead
export CAPXUL_SOLC_0824="$TOOLS/solc-0.8.24/solc"
# The proxy port differs per container: rewrite the override to this container's proxy.
sed "s|http://127.0.0.1:[0-9]*|${HTTPS_PROXY:-http://127.0.0.1:3128}|g" "$HERE/compose.cloud.yml" > "$TOOLS/compose.cloud.yml"
export COMPOSE_FILE="compose.yml:$TOOLS/compose.cloud.yml"
echo "cloud tools ready: $(anvil --version | head -1); docker $(docker info --format '{{.ServerVersion}}' 2>/dev/null || echo 'not running')"
