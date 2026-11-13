#!/usr/bin/env bash
# Drives one deployed world through the spike's questions and prints what it saw.
# Usage: ./prove.sh <stage>      (the stage must be deployed; the door's address is read from its local state)
# Nothing secret is printed: the door's token stays in .env.door. The keys in src/bundler/Keys.ts and prove/setup.ts
# are public test keys for a disposable chain.
set -euo pipefail
cd "$(dirname "$0")"
stage="$1"
url="$(python3 -c "import json; print(json.load(open('.alchemy/state/CapxulSpikeBundler/$stage/__stack_output__.json'))['url'])")"
door="$url/$(cat .env.door)"
mkdir -p var
world="var/$stage.world.json"

now() { date +%s.%N; }
since() { python3 -c "print(f'{$(now)-$1:.2f} s')"; }
post() { curl -sS --max-time 300 -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$2\",\"params\":${3:-[]}}" "$door/$1"; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
chain() { curl -sS --max-time 90 "$door/chain/status"; }
bundler() { curl -sS --max-time 90 "$door/bundler/status"; }
wait_until() { # wait_until <seconds> <command that prints True when done>
  local t; t=$(now)
  until [ "$("${@:2}")" = True ]; do
    python3 -c "import sys; sys.exit(0 if $(now)-$t < $1 else 1)" || { echo "  gave up after $1 s"; return 1; }
    sleep 2
  done
  echo "  after $(since "$t")"
}
chain_up() { post rpc eth_chainId | field "'result' in d"; }
chain_down() { chain | field "not d['running']"; }
send() { bun prove/main.ts send "$door/rpc" "$door/bundler" "$world"; }
show_send() { # prints the lines of a send's answer that the README quotes
  python3 -c "
import json,sys
d=json.load(sys.stdin); r=d['receipt']; e=d['effect']
print('eth_sendUserOperation ->', d['userOpHash'], '(the hash computed before sending matches:', str(d['expectedHashMatches']) + ')')
print('  accepted after', d['acceptedMs'], 'ms; receipt after', d['receiptMs'], 'ms')
print('eth_getUserOperationReceipt -> success', r['success'], 'sender', r['sender'], 'paymaster', r['paymaster'])
print('  actualGasCost', int(r['actualGasCost'],16), 'wei, in tx', r['transactionHash'], 'block', int(r['blockNumber'],16), 'status', r['status'])
print('  the transaction was sent by', r['bundledBy'], 'to', r['to'], '(the bundler executor, to the EntryPoint)')
print('chain: Safe test USD', e['safeTokenDelta'], 'recipient', e['recipientTokenDelta'], 'Safe ETH', e['safeEthDelta'], 'paymaster deposit', e['paymasterDepositDelta'], 'wei')"
}

echo "== world $stage at ${url}"
echo "wrong token: HTTP $(curl -sS -o /dev/null -w '%{http_code}' "$url/wrong/chain/status")"
echo "waiting for the chain's first container instance"; wait_until 240 chain_up
echo "eth_chainId     $(post rpc eth_chainId)"
echo "eth_blockNumber $(post rpc eth_blockNumber)   (the seed core.json ends at 47893259 = 0x2dacb0b)"

echo "== 2. the test paymaster, a test token and a Safe go on the chain; the faucet funds them"
t=$(now); bun prove/main.ts setup "$door/rpc" >"$world"; echo "setup took $(since "$t")"
cat "$world"; echo

echo "== 1. alto in a Cloudflare Container answers through the door, pointed at this world's chain"
t=$(now); echo "eth_supportedEntryPoints $(post bundler eth_supportedEntryPoints)   (bundler cold start, by the caller: $(since "$t"))"
echo "eth_chainId (bundler)    $(post bundler eth_chainId)"
echo "bundler: $(bundler | field "f\"running={d['running']} starts={d['record']['starts']}\"")"

echo "== 3. one UserOperation from the Safe, sponsored by the paymaster, sent through the bundler"
send | tee "var/$stage.send-1.json" | show_send

echo "== 4. the world stops when it is idle (30 s here), the bundler with it, and works again after waking"
curl -sS -X POST "$door/chain/idle?seconds=30" >/dev/null; sleep 6
post rpc eth_blockNumber >/dev/null; echo "last call through /rpc made; waiting for the chain to stop by itself"
wait_until 150 chain_down
echo "chain:   $(chain | field "f\"running={d['running']} last stop {d['record']['stops'][-1]}\"")"
echo "bundler: $(bundler | field "f\"running={d['running']} stops={d['record']['stops']}\"")"
curl -sS -X POST "$door/chain/idle?seconds=600" >/dev/null
echo "chain after setIdle (no bundler call yet): $(chain | field "f\"running={d['running']}\"")"
t=$(now); echo "wake through the bundler: eth_supportedEntryPoints $(post bundler eth_supportedEntryPoints)   ($(since "$t"))"
echo "the Safe's nonce at the EntryPoint survived the stop: $(post rpc eth_call "[{\"to\":\"0x0000000071727De22E5E9d8BAf0edAc6f37da032\",\"data\":\"0x35567e1a$(python3 -c "import json; print(json.load(open('$world'))['world']['safe'][2:].lower().rjust(64,'0'))")$(printf '0%.0s' {1..64})\"},\"latest\"]" | field "int(d['result'],16)")"
send | tee "var/$stage.send-2.json" | show_send

echo "== 5. timings the world recorded about itself (ms)"
chain | field "'chain starts: ' + str([(s['from'], s.get('afterUnsavedStop'), s['ms']) for s in d['record']['starts']])"
chain | field "'chain stops:  ' + str([(s['why'], s['ms'], s['savedBytes']) for s in d['record']['stops']])"
bundler | field "'bundler starts (ready ms, start calls): ' + str([(s['readyMs'], s['startCalls']) for s in d['record']['starts']])"
bundler | field "'bundler stops (ms): ' + str([s['ms'] for s in d['record']['stops']])"
