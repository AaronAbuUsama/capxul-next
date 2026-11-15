# The cluster's records (14 November 2026)

The cluster's deploys (`up-*.log` and `up-*.out.json`: the first from nothing, and `up-6`, the one the proofs ran on)
and the spans of the `hub` and `reset` proofs (`hub-spans.jsonl`, `reset-spans.jsonl`, written with `WORLD_SPANS`).
The proofs' own records are `../hub.proof.json`, `../reset.proof.json` and `../clock.proof.json`; each reset's
milliseconds per step are in `../reset.proof.json`.

## Timings on the cluster

Run from a Claude cloud container near Cloudflare's IAD, the cluster in western Europe. `world.create` through the
account call, with its cast, took 18.4, 15.7 and 16.2 s, and `world destroy` 3.6, 3.9 and 3.6 s; before the cluster a
create was 95 to 102 s and a destroy 13.5 to 19.5 s. The first create in a process is the slowest: the api's bundle is
made then (one in `../reset.proof.json` took 20.2 s). From `hub-spans.jsonl`, a create's spans:

| Lane | Span | s | |
|---|---|---|---|
| | claim | 0.4 to 0.7 | The name's row and the world's record in the shared state. |
| chain | register | 1.1 to 1.6 | The cluster's admin call: the chain's object and the registry entry. |
| chain | chain | 1.3 to 1.5 | anvil from the seed on the cluster's warm application: no refused start. |
| chain | fund, bundler | 0.7 to 0.9, 9.6 to 10.8 | The faucet; the bundler's accounts and paymaster (2.9 to 3.1), then alto's start (4.7 to 7.7) beside the cast. |
| database | branch | 1.9 to 2.6 | Neon's API, looked at every 250 ms. |
| database | migrate | 0.8 | |
| database | index | 8.7 to 13.1 | Ponder, started once the branch and the chain are there. |
| database | deploy | 9.1 to 11.5 | Alchemy: the plan, the Hyperdrive configuration (2.3 to 2.6), the api's Worker (6 to 8). |
| database | core | 3.1 to 3.3 | The api's health answered ten times in a row, 250 ms apart. |
| | facts | about 0.6 | The world's facts and `world_created`, side by side. |

The critical path is the claim, the branch, the api's deploy and its steady answers; the index runs beside it. What is
left of a create under 20 s is mostly the api's own bundle (3 to 4 s of this machine's CPU) and its upload.

## What was learned

- **A Durable Object stays where it was first made.** Before the cluster's objects were made with
  `locationHint: "weur"` (`src/hub/names.ts`), a chain object was made near its first caller (IAD), and Ponder in
  western Europe spent 9 s of its 12 s start on 22 calls through it. The trial worlds `w-f1` to `w-f5` keep their
  (emptied) objects in the US.
- **Cloudflare's count of active containers lags**: right after the last world was forgotten each application still
  showed one active instance; about 16 s later none (`../hub.proof.json`, `containersAfter`).
- **The clock**: after the two resets the chain's time and the api's clock were 348 and 486 ms apart, measured on
  Cloudflare's own clock (`../reset.proof.json`).
