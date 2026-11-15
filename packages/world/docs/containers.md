# How a refused container start is tried again

### Containers: a refused start is tried again

Cloudflare refuses to start a container now and then: "There is no container instance that can be provided to this
Durable Object, try again later". It does so for a while on a container application the deploy has just made, until
the application has instances, and again, now and then, when a world's container has stopped or gone away and its
Durable Object starts it anew. Often the start call itself is accepted and the refusal comes from the first call to the
container after it, or the container is gone again within seconds. So the chain, the index and the bundler start their
containers through one helper, `src/parts/containers/patience.ts`:

- Each try starts the container if it is not running, together with that first call (its inactivity timeout), then asks
  whether it is ready: the chain answers `eth_chainId`, Ponder's server answers `/health`, alto names the EntryPoint.
- A refused try doubles the wait before the next (1, 2, 4, 4 ... s); a container that runs but does not answer yet is
  looked at again after 1 s. No try begins once it could not finish inside the window, and the whole is cut off at it.
- Every try is written down with when it began, how long it took, whether it asked Cloudflare to start the container,
  how it ended and why: in the part's own record (`GET /chain/status`, `/index/status`, `/bundler/status`), under each
  start (`attempts`, `startCalls`, `refusals`), and under `gaveUp` for a start that never got ready.

| Part | Window | Inside the step | Set from |
|---|---|---|---|
| Chain | `CHAIN_START`, 2 min | `chain`, 3 min | anvil answers within 1 to 3 s of an accepted start; the chain step's slowest recorded run, a restore copying its source's state, took 46.7 s |
| Index | `INDEX_START`, 4 min | `index`, 5 min | below (Timings, the index step) |
| Bundler | `BUNDLER_START`, 4 min | `bundler`, 5 min | as before: alto's first start took 2 to 13 start calls on a new application (`records/spike-bundler`) |

`test/patience.test.ts` runs the helper against a stubbed refusal (two refusals then a start; a refusal for good,
which gives up inside its window with every try; a container that runs but does not answer yet; a try that hangs) and
checks that each step's declared timeout holds its part's window and a minute more. A chain that never answers fails
the call that woke it with `ChainFailed` (`start`), naming its tries; a refused index never fails or holds up a chain
call: the chain asks for it (`resume`) and the index's Durable Object starts it from a durable callback, which a stop
cancels.
