# Bundler spike

Throwaway code that answers the risk behind step 1.11 of [docs/roadmap.md](../../docs/roadmap.md): can a private
world hold an ERC-4337 bundler and a test paymaster, so that a signed approval lands on the chain as one real
UserOperation? It builds on [spikes/containers](../containers/README.md): the world's chain is the same anvil
container behind a Durable Object, saved to R2 and stopped when idle, and the bundler is a second container in the
same world. It is deployed with Alchemy (`alchemy` 2.0.0-beta.85 on Effect 4.1.2) from an agent's container. Nothing
here is product code.

## What is proven (13 November 2026, from a Claude cloud container)

Four worlds were deployed, driven and destroyed (`bd-w1` to `bd-w4`). `records/bd-w4.prove.txt` is the output of
`./prove.sh bd-w4` run right after `bd-w4` was deployed from nothing (`records/bd-w4.deploy.txt`); every line quoted
below is in it. `records/bd-w1.prove.txt` is the same proof on the first world, with the same result.

| Question | Result |
|---|---|
| Does alto run as a Cloudflare Container in a world, pointed at that world's anvil, and answer `eth_supportedEntryPoints`? | Yes. Pimlico's alto 0.0.21 (the version the other line pinned), unpatched, on `basic` (1/4 vCPU, 1 GiB), reaches the chain the way Ponder does in spikes/containers: through the door's public address, on `/quiet-rpc`. Through the door's `/bundler` it answered `{"result":["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]}`, the EntryPoint v0.7 in `core.json`, and `eth_chainId` `0x14a34`. |
| Is a test paymaster on the chain and funded? | Yes. `MockPaymaster` (`packages/contracts/test/mocks/MockPaymaster.sol`, the accept-all mock the other line used, compiled here with solc 0.8.28) is deployed by anvil's unlocked account 0 against the seeded EntryPoint, and 1 ETH is put in its EntryPoint deposit with its `deposit()`. The setup reads back `paymasterEntryPoint 0x0000000071727De2...` and `paymasterDepositWei 1000000000000000000`. The bundler's executor and utility accounts get 10 ETH each from `anvil_setBalance`. |
| Does one real UserOperation from a Safe, sponsored by the paymaster, land through the bundler? | Yes. A Safe owned by one test key, created through the seeded Safe proxy factory with the seeded Safe4337Module as module and fallback handler, holding 1,000 of a test token (`MockERC20`), sent a 25-token transfer as a UserOperation signed by its owner through the module. `eth_sendUserOperation -> 0x2a35fe...d553` (the hash computed before sending matches); `eth_getUserOperationReceipt -> success True ... paymaster 0x2279...eBe6`, in tx `0xa9d068...bae` block 47893269 status `0x1`, sent by `0xa0Ee...9720` (alto's executor) to the EntryPoint. The chain: Safe `-25000000`, recipient `+25000000`, Safe ETH `0`, paymaster deposit `-213845795811200` wei. |
| Does the bundler stop with the world when it is idle, and work again after waking? | Yes. 30 s after the last call through `/rpc`, the chain stopped itself: the bundler first (193 ms), then the chain was saved (3.13 MB) and stopped. alto's own block polling, every second, did not keep the world up: its calls go to `/quiet-rpc`. The next bundler call woke the chain and started alto again in 8.1 s; the Safe's EntryPoint nonce was 1, as before the stop, and a second UserOperation landed in block 47893270 (`success True`, Safe `-25000000`). |
| Does destroy leave anything behind? | The world, no; its images, yes, as in spikes/containers. `alchemy destroy` removed the Worker with its two Durable Object namespaces, both container applications and the bucket in 4 to 6 s. `registry.py --delete` removed the two image repositories (`records/registry-delete.txt`); `records/check-clean.txt` shows nothing of this stack is left. |

## Timings

| Step | Seconds | Where |
|---|---|---|
| Deploy a world from nothing, building and pushing both images | 72 | `records/bd-w1.deploy.txt` |
| Deploy a world whose images are already published | 49 to 52 | `records/bd-w*.deploy.txt` |
| Destroy a world | 3.8 to 5.7 | `records/bd-w*.destroy.txt` |
| Put the paymaster, token and Safe on the chain and fund them (8 transactions) | 3.0 to 3.2 | `setup took` |
| Bundler cold start on a world's first minute, measured in the Durable Object | 19.6 (8 start calls) | `bd-w4` |
| Bundler cold start otherwise, measured in the Durable Object | 5.6 to 6.6 (1 start call) | `bd-w1`, `bd-w4` |
| First bundler call after an idle stop, chain and alto both woken, by the caller | 7.5 to 8.1 | `wake through the bundler` |
| `eth_sendUserOperation` answered | 0.18 to 0.27 | `accepted after` |
| `eth_sendUserOperation` to a receipt from `eth_getUserOperationReceipt` | 0.80 to 1.06 | `receipt after` |
| Stop the bundler; save the chain (3.13 MB) and stop it | 0.17 to 0.19; 2.4 to 3.0 | `chain stops`, `bundler stops` |

## What was learned on the way

- **A new container application refuses starts for a while, and says so.** On `bd-w2` and `bd-w3` the first bundler
  call, about 10 s after the deploy, failed with `There is no container instance that can be provided to this Durable
  Object, try again later` (`records/bd-w2.prove.txt`, `records/bd-w3.prove.txt`), from the start or from
  `setInactivityTimeout` right after it. The Durable Object now treats that as "not yet" and starts again every second
  for up to 240 s: on `bd-w4` the eighth start held, 19.6 s in. spikes/containers saw the same window as a start lost
  silently; it is the same thing.
- **alto needs no patch here.** The other line patched alto to listen on loopback and to read the chain's clock for
  validity windows. In a container alto may listen on `0.0.0.0`, and the proof's operation has no window (validAfter
  and validUntil zero) and the mock paymaster returns none, so alto's wall clock is never compared with the chain's.
  A signed paymaster with a window would meet that again: the seeded chain's time is weeks behind wall time.
- **alto needs its keys funded before it starts.** On its first start it deploys its simulation contracts with its
  utility key, through the deterministic deployer in the seed. So the world's setup funds the keys before the first
  bundler call. The contracts are then part of the saved state (2.45 MB became 3.13 MB) and a later start only finds
  them.
- **Unsafe mode only.** `ALTO_SAFE_MODE=false`: no ERC-7562 tracing (anvil's tracer is not geth's) and no stake checks
  on the paymaster. Safe mode was not tried.
- **Everything is deterministic.** The same addresses, UserOperation hash and transaction hash came out on every world,
  because the seed, the keys and the order of the setup are fixed.

## Not proven

- A signed paymaster (a verifying paymaster with a key and a validity window), or ERC-7677 `pm_*` methods.
- A Safe claimed through Companies House; the Safe here is made with the same factory, singleton and module directly.
- What alto's polling costs: it calls `/quiet-rpc` about once a second while it runs, each a Worker request.
- An operation in alto's mempool when the world stops: alto keeps its mempool in memory, so it would be lost.
- `lite` (256 MiB) for alto, and safe mode.

## Run it

`pnpm install --ignore-workspace` here and in `images/alto/` (its `node_modules` is copied into the image). Start a
Docker daemon if images must be built. Then `./run.sh deploy --stage bd-<name> --yes`, and `./prove.sh bd-<name>`
drives it through every question above (`prove/main.ts` is the part that signs and sends). Finish with
`./run.sh destroy --stage bd-<name> --yes`, `python3 registry.py --delete` for the images, and `./check-clean.sh`.
Never run `alchemy nuke`: it deletes every resource in the account, not only this stack's.

`src/chain` is the chain (copied from spikes/containers, the indexer replaced by the bundler), `src/bundler` the
bundler (alto's container and its Durable Object), `src/Door.ts` the Worker, `images/` the two images, `prove/` the
setup and the UserOperation.
