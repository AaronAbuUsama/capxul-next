# The world package's records

Each proof is `./run.sh prove <case>` (`src/proofs`). It writes `<case>.proof.json`: its claim (`proof`), its
`outcome` (passed only when every check held), each check, its observations, and both accounts' inventory before and
after. The `p-*.json` files are `withWorld`'s own records of the proofs' worlds, with each step's duration and
declared timeout. The accounts are shared with other builders, so "the accounts hold what they held before" sets aside
resources named for another world's stage; the record keeps the account-wide comparison (`sameAsBeforeAccountWide`)
and names what it set aside (`otherWorlds`).

## Where each proof ran

- **On the cluster** (`fleet`, 14 November 2026): `hub`, `reset` and `clock`. Their timings are in
  [hub/README.md](hub/README.md).
- **Before the cluster** (13 and 14 November 2026), when every world deployed its own containers: every other proof.
  All but `site` were run again after the patient container starts (`src/containers/patience.ts`) and passed; their
  code was brought to the cluster but not run there again.
- **`site`** ran on a stand-in bench in an agent's container, where the api on Cloudflare could not reach it: its probe
  answered `unreachable`. The api reaching a company's site on a real bench was proven since by the runner, in
  `packages/runner/records/run-138efc` (roadmap step 1.4, Done).
- `snapshot.proof.json`'s claim names "four operations": the account calls of its day. The blueprint now declares more.

The other folders: [admission](admission/README.md) (a world's place on the cluster), [speed](speed/README.md) (image
pins and the one clock), [hub](hub/README.md) (the cluster's deploys and spans) and
[spike-bundler](spike-bundler/README.md) (the spike that proved the bundler).

## Before the cluster (13 November 2026)

Eight creates one at a time, three at once and seven destroys (the `p-*.json` files as they were at `20833298`). A
create's median was 102.6 s (91.7 to 111.7; 132 to 223 three at once), nearly all Alchemy's deploy (median 60.5 s:
three container applications, each made twice to attach its Durable Object) and the index's first start (36.8 s); a
destroy's 16.2 s. The chain step's median was 2.5 s; the bundler step's 16.7 s (11.7 to 44.6, alto's first start
taking 2 to 13 start calls), beside the index's. The bundler added about 15 s, all in the deploy. From `bundler.proof.json`: `eth_sendUserOperation`
answered in 0.20 s, the receipt came 1.04 s after the send, and the index wrote the transfer 9.1 s after that.

**The index step.** 32 creates before the patient starts (`packages/runner/records/run-717645`, `run-e710b3` and these
records at `20833298`): median 39.4 s, slowest 83.4 s one at a time and 128.3 s three at once; one ran out of its
180 s. It was two things in turn: Cloudflare refusing the start of a just-made container application (0 to 54 s), then
Ponder's own start (20 to 30 s), of which 17 to 21 s were 73 to 87 round trips to a Neon branch an ocean away. With
Ponder placed in western Europe and every start patient (`patience.proof.json`, four in a row): 0 to 6 refusals, 8.4 to
15.0 s from an accepted start to ready, steps of 13.5 to 38.0 s. `WORLD_TIMEOUT_INDEX` went from 3 to 5 minutes:
`INDEX_START`'s 4 minutes for the refusals, as long as the bundler's, then a minute for Ponder, twice its slowest start.

## What was learned

- **A refused start often looks accepted**: Cloudflare takes the start call, then fails the first call after it, or
  lets the container go within seconds. A start now holds only once the container answers, and each try is recorded.
- **Ponder must be stopped with SIGTERM**: one killed outright leaves its schema locked, and the next waits it out.
- **Neon refuses to fork a branch that has an expiry of its own**, so a world another is made from has Neon's expiry
  lifted and is deleted by the sweeper at its recorded expiry. A fork must be destroyed before its parent.
- **A fork carries its parent's index**: Ponder resumes from the forked schema, and the chain's state is copied after
  the database, so the chain is never behind the index. Fork a quiet world.
- **anvil answers `null` to `anvil_setBalance`**, so the bundler's setup reads the balance back.
- **The bundler keeps the chain address of its first start**: the gateway builds it from the request's host, which is
  wrong over a service binding.
- **Two runs of the `snapshot` proof failed before one passed**: an index step out of its 5 minutes (its own record now
  travels in its failure, `src/index/account.ts`), and a chain whose container went before its first save.
