#!/usr/bin/env bash
# Drives one deployed world through the spike's four questions and prints what it saw.
# Usage: ./prove.sh <stage>      (the stage must be deployed; the door's address is read from its local state)
# Nothing secret is printed: the door's token stays in .env.door and the database string stays in the state.
set -euo pipefail
cd "$(dirname "$0")"
stage="$1"
url="$(python3 -c "import json; print(json.load(open('.alchemy/state/CapxulSpikeContainers/$stage/__stack_output__.json'))['url'])")"
door="$url/$(cat .env.door)"
dev=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266          # anvil's first unlocked account
pinger=0x00000000000000000000000000000000000c0de1
# Bytecode that emits `event Ping()` on any call: PUSH32 keccak("Ping()") PUSH1 0 PUSH1 0 LOG1 STOP.
code=0x7fca6e822df923f741dfe968d15d80a18abd25bd1e748bcb9ad81fea5bbb7386af60006000a100

now() { date +%s.%N; }
since() { python3 -c "print(f'{$(now)-$1:.2f} s')"; }
rpc() { curl -sS --max-time 90 -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" "$door/rpc"; }
result() { python3 -c "import json,sys; print(json.load(sys.stdin)['result'])"; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
head_block() { rpc eth_getBlockByNumber '["latest",false]' | field "f\"block {int(d['result']['number'],16)} hash {d['result']['hash']}\""; }
ping() { rpc eth_sendTransaction "[{\"from\":\"$dev\",\"to\":\"$pinger\",\"gas\":\"0x186a0\"}]" | result; }
pings() { python3 sql.py "$stage" "select count(*) as pings, max(block_number) as head from ponder.pings"; }
chain() { curl -sS --max-time 90 "$door/chain/status"; }
indexer() { curl -sS --max-time 90 "$door/indexer/status"; }
wait_until() { # wait_until <seconds> <command that prints True when done>
  local t; t=$(now)
  until [ "$("${@:2}")" = True ]; do
    python3 -c "import sys; sys.exit(0 if $(now)-$t < $1 else 1)" || { echo "  gave up after $1 s"; return 1; }
    sleep 2
  done
  echo "  after $(since "$t")"
}
chain_down() { chain | field "not d['running']"; }
# The same is true of the indexer's application: a start made too early is lost, so it is made again until it holds.
indexer_ready() {
  local seen; seen="$(indexer)"
  [ "$(echo "$seen" | field "d['running']")" = True ] || curl -sS -X POST "$door/indexer/start?from=$from" >/dev/null
  echo "$seen" | field "d['ready'] == 200"
}
# A new container application answers "Container exited" until its first instance has the image, about a minute.
chain_up() { rpc eth_chainId | field "'result' in d"; }

echo "== 1. anvil in a Cloudflare Container answers JSON-RPC through its Worker and Durable Object"
echo "wrong token: HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$url/wrong/chain/status")"
echo "waiting for the first container instance"; wait_until 240 chain_up
echo "eth_chainId     $(rpc eth_chainId)"
echo "eth_blockNumber $(rpc eth_blockNumber)   (the seed core.json ends at 47893259 = 0x2dacb0b)"

echo "== 2. the chain's state survives a stop"
rpc anvil_setCode "[\"$pinger\",\"$code\"]" >/dev/null
echo "mined a block with tx $(ping)"
before="$(head_block)"; echo "before stop: $before"
t=$(now); echo "stop: $(curl -sS -X POST "$door/chain/stop")   ($(since "$t"))"
echo "stopped: $(chain | field "f\"running={d['running']}\"")"
t=$(now); after="$(head_block)"; echo "after start: $after   (first call after the stop: $(since "$t"))"
[ "$before" = "$after" ] && echo "SAME BLOCK AND HASH AFTER THE STOP" || { echo "DIFFERENT"; exit 1; }

echo "== 2b. a container that goes away without being stopped costs at most the last 20 s of the chain"
echo "mined a block with tx $(ping)"; kept="$(head_block)"; echo "head: $kept"
saved_head() { chain | field "(d['record'].get('lastSave') or {}).get('head') == hex(int('${kept#block }'.split()[0]))"; }
echo "waiting for the periodic save to reach that block"; wait_until 90 saved_head
echo "mined one more with tx $(ping), then killed the container without saving: $(head_block)"
curl -sS -X POST "$door/chain/kill" | field "f\"running={d['running']}\""
after="$(head_block)"; echo "after start: $after"
echo "start recorded as: $(chain | field "d['record']['starts'][-1]")"
[ "$kept" = "$after" ] && echo "BACK AT THE LAST SAVED BLOCK; THE ONE MINED AFTER IT IS LOST" || { echo "UNEXPECTED"; exit 1; }

echo "== 3. Ponder in a Cloudflare Container indexes the chain into the world's Neon branch"
from=$(( $(rpc eth_blockNumber | result) - 1 ))
t=$(now); echo "start: $(curl -sS -X POST "$door/indexer/start?from=$from")"
echo "waiting for Ponder's /ready"; wait_until 180 indexer_ready
echo "ponder says: $(indexer | field "d['indexed']")"
echo "neon says:   $(pings)"
echo "another event: tx $(ping)"; sleep 6
echo "neon says:   $(pings)"

echo "== the world stops when it is idle (30 s here), although the indexer never stops polling"
curl -sS -X POST "$door/chain/idle?seconds=30" >/dev/null; sleep 6
rpc eth_blockNumber >/dev/null; t=$(now); echo "last call through /rpc made; waiting for the chain to stop by itself"
wait_until 120 chain_down
echo "chain:   $(chain | field "f\"running={d['running']} last stop {d['record']['stops'][-1]}\"")"
echo "indexer: $(indexer | field "f\"running={d['running']} stops {d['record']['stops']}\"")"
curl -sS -X POST "$door/chain/idle?seconds=600" >/dev/null
t=$(now); echo "wake: eth_blockNumber $(rpc eth_blockNumber | result) ($(since "$t"))"
echo "one more event: tx $(ping)"; echo "waiting for Ponder's /ready"; wait_until 180 indexer_ready; sleep 4
echo "neon says:   $(pings)   (rows from before the stop are still there)"

echo "== 4. timings the world recorded about itself (ms)"
chain | field "'chain starts: ' + str([(s['from'], s.get('afterUnsavedStop'), s['ms']) for s in d['record']['starts']])"
chain | field "'chain stops:  ' + str([(s['why'], s['ms'], s['savedBytes']) for s in d['record']['stops']])"
indexer | field "'indexer starts (first seen healthy, ready; polled every 2 s): ' + str([(s['healthyMs'], s['readyMs']) for s in d['record']['starts']])"
