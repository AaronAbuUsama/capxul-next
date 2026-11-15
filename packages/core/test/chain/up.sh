#!/usr/bin/env bash
# A local stand-in of what a world gives Core's chain operations, for test/chain: Anvil from the seeded state with the
# faucet's test USDC, the test paymaster and its deposit (as packages/world makes them), Pimlico's alto in Docker from
# the world's published bundler image, and a Postgres in Docker. Ports are the CHAIN_* variables below; `down.sh`
# removes all of it. Needs anvil and cast (Foundry 1.9.0) and Docker; nothing here reaches the network.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
export PATH="${FOUNDRY_BIN:-$HOME/.foundry/bin}:$PATH"
port=${CHAIN_PORT:-28545}
bport=${CHAIN_BUNDLER_PORT:-24337}
dbport=${CHAIN_DB_PORT:-25432}
anvil=${ANVIL:-anvil}
rpc=http://127.0.0.1:$port
"$here/down.sh" >/dev/null 2>&1 || true
"$anvil" --port "$port" --chain-id 84532 --silent --no-request-size-limit --load-state "$repo/packages/contracts/state/core.json" &
mkdir -p "$repo/var" && echo $! >"$repo/var/chainops-anvil.pid"
for _ in $(seq 1 50); do cast chain-id --rpc-url "$rpc" >/dev/null 2>&1 && break; sleep 0.2; done
op=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
send() { cast send --legacy --gas-price 2000000000 --gas-limit 6000000 --rpc-url "$rpc" --unlocked --from "$op" "$@" >/dev/null; }
args=$(cast abi-encode "f(string,string,uint8)" "World test USD" "USDC" 6)
send --create "0x$(tr -d '\n' <"$repo/packages/world/src/parts/chain/test-usdc.hex")${args:2}"
ep=0x0000000071727De22E5E9d8BAf0edAc6f37da032
cast rpc --rpc-url "$rpc" anvil_setBalance 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 0x8ac7230489e80000 >/dev/null
cast rpc --rpc-url "$rpc" anvil_setBalance 0xBcd4042DE499D14e55001CcbB24a551F3b954096 0x8ac7230489e80000 >/dev/null
epw=$(printf '%064s' "${ep:2}" | tr ' ' 0 | tr 'A-F' 'a-f')
send 0x4e59b44847b379578588920ca78fbf26c0b4956c "0x$(printf '%064d' 0)$(tr -d '\n' <"${PAYMASTER_HEX:-$repo/packages/world/src/parts/bundler/test-paymaster.hex}")$epw"
send 0xE2dE380E3e8281e2cc458675102c3FC2277fC5A8 "deposit()" --value 1ether
docker run -d --name chainops-alto --network host \
  -e ALTO_RPC_URL="$rpc" -e ALTO_ENTRYPOINTS=$ep \
  -e ALTO_EXECUTOR_PRIVATE_KEYS=0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 \
  -e ALTO_UTILITY_PRIVATE_KEY=0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897 \
  -e ALTO_PORT="$bport" -e ALTO_SAFE_MODE=false -e ALTO_BLOCK_TIME=2000 -e ALTO_LOG_LEVEL=warn \
  "${ALTO_IMAGE:?set ALTO_IMAGE to a local Docker image of the bundler of packages/world}" >/dev/null
docker run -d --name chainops-pg -e POSTGRES_PASSWORD=test -p "$dbport:5432" postgres:17-alpine >/dev/null
for _ in $(seq 1 120); do
  if curl -s -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_supportedEntryPoints","params":[]}' "http://127.0.0.1:$bport" | grep -q 0x &&
    docker exec chainops-pg pg_isready -U postgres >/dev/null 2>&1; then
    echo "CHAIN_RPC=$rpc CHAIN_BUNDLER=http://127.0.0.1:$bport CHAIN_DATABASE=postgres://postgres:test@127.0.0.1:$dbport/postgres"
    exit 0
  fi
  sleep 1
done
echo "the bundler or the database did not come up" >&2
exit 1
