# The world package's layout

Status: agreed with Aaron, 15 November 2026, from the explorer "World Layout", with the four open questions as
recommended (below).

`packages/world` follows the blueprint's layout (`docs/design/blueprint.md`, parts 7 and 13) and its glossary
(part 12): a folder says what kind of thing lives in it, every thing has its own folder with the same files, nothing
is loose at the root of `src/`, the package's one import entry is `index.ts`, and generated files go in `generated/`.
It moves files and names them; it changes no behaviour, no Alchemy stack and nothing a world creates or destroys.

```
packages/world/
  README.md                one screen
  generated/index.md       the map: one line per file, from its opening comment
  docs/                    one page per task or question, cut from the old README
  src/
    index.ts               the one import entry (was door.ts)
    things/<thing>/        world, cluster, registry, site, site-template
      values.ts            what it is: its shape, names, limits
      stage.ts             its Alchemy stack, where it has one
      client.ts            how it is reached
      store.ts             its rows
      <verb>.ts            one per verb: create, destroy, list, reset, renew, sweep, use, keep, reserve, ...
    parts/<part>/          what runs in the cloud: gateway, api, chain, bundler, indexer, database, containers
    account/               the operations served outside any world
    stack/                 Alchemy: engine, images, names, the cloud accounts
    cli/                   the command line; main.ts is the only file that touches the process
    common/                failures, run records, timing
    proofs/                cases/, support/, cases.ts: frozen with records/
  test/                    unit tests, and layout.test.ts
  images/  ponder/  migrations/  records/  run.sh  alchemy.run.ts
```

| Kind | Holds | Why apart |
|---|---|---|
| `things/` | What the package makes and destroys, each with its verbs | `capxul world reset` is `things/world/reset.ts` |
| `parts/` | Code that runs on Cloudflare, and each part's client | A part is deployed; a thing is driven from a process |
| `account/` | The Rpc handlers and their server and store | Served to operators, outside any world |
| `stack/` | Alchemy and the provider accounts | Nothing else drives Alchemy |
| `cli/`, `common/`, `proofs/` | The command line, what all kinds share, the frozen proofs | |

**What checks it.** `test/layout.test.ts` fails a file outside these folders, a thing file that is neither one of
the four nor a verb, a README over one screen (60 lines), and a growing list of unfolded files (a ratchet: eleven
files that hold more than one verb, or a helper that folds into one of the four). `pnpm generate:check` holds the
map.

## Every move

Paths under `packages/world/`. Every file moved whole except `lifecycle/operations.ts`, cut along its functions.

**The import entry, command line and shared.**

| Was | Is | Why |
|---|---|---|
| `src/door.ts` | `src/index.ts` | The one file other packages import from, as in the blueprint (glossary: door.ts becomes index.ts). |
| `src/main.ts` | `src/cli/main.ts` | The process entry belongs with the command line it runs; nothing is loose at the root of src/. |
| `src/cli/commands.ts` | `src/cli/commands.ts` | The command tree. Command names keep today's words until the rename ratchet (3.8). |
| `src/cli/renew.ts` | `src/cli/renew.ts` | The renew command, kept apart by choice as its comment says. |
| `src/cli/report.ts` | `src/cli/report.ts` | How a command prints its result. |
| `src/failures.ts` | `src/common/failures.ts` | The package's own failures, used by almost every file: shared, so common/. |
| `src/lifecycle/describe.ts` | `src/common/describe.ts` | Turns any failure into one line; used package-wide, not a lifecycle verb. |
| `src/lifecycle/steps.ts` | `src/common/stopwatch.ts` | Times each part of a verb under its timeout. Named for what it is: 'step' is the journeys' word in the glossary. |
| `src/lifecycle/record.ts` | `src/common/record.ts` | The run record's and proof record's JSON file format, read by the proofs and the command line. |

**A world.**

| Was | Is | Why |
|---|---|---|
| `src/lifecycle/spec.ts` | `src/things/world/values.ts` | What a world is: its spec, limits and timeouts. Every thing folder has values.ts. |
| `src/stack/stack.ts` | `src/things/world/stage.ts` | A world's Alchemy stack (its database and its api slot). stage.ts is where a thing's stack lives. |
| `src/lifecycle/parts.ts` | `src/things/world/client.ts` | Opening a world by name and calling its parts through the gateway: how a world is reached. |
| `src/platform/facts.ts` | `src/things/world/store.ts` | A world's facts as rows of its own database (clock, cast, companies, events): where a world keeps them. |
| `src/lifecycle/operations.ts` | `src/things/world/create.ts, destroy.ts, list.ts` | Three verbs in one file: split into create.ts, destroy.ts and list.ts, cut along its own functions. |
| `src/lifecycle/up.ts` | `src/things/world/bring-up.ts` | The steps a create runs (reserve, register on the cluster, chain and database side by side). |
| `src/lifecycle/world.ts` | `src/things/world/take-down.ts` | Taking a world down, parking it, its plan and its lookup. On the ratchet: plan goes to create, park to keep. |
| `src/lifecycle/run.ts` | `src/things/world/use.ts` | withWorld: create a world, use it, write its record, destroy it. |
| `src/lifecycle/reset.ts` | `src/things/world/reset.ts` | Reset a world in place to one of its snapshots. |
| `src/lifecycle/renew.ts` | `src/things/world/renew.ts` | Move a world's expiry and redeploy it. |
| `src/lifecycle/sweep.ts` | `src/things/world/sweep.ts` | Delete expired worlds and what they left behind. |
| `src/lifecycle/expiry.ts` | `src/things/world/expiry.ts` | Expiry arithmetic and a world's state by it. On the ratchet: folds into values.ts. |
| `src/lifecycle/handle.ts` | `src/things/world/handle.ts` | A deployed world's handle from its stack outputs. On the ratchet: folds into client.ts. |
| `src/lifecycle/kept.ts` | `src/things/world/kept.ts` | The process's cache of handles. On the ratchet: folds into client.ts. |
| `src/lifecycle/validate.ts` | `src/things/world/names.ts` | Checks a world's and an owner's names. On the ratchet: folds into values.ts. |
| `src/platform/cast.ts` | `src/things/world/cast.ts` | A new world's cast: their Safes claimed and funded, its start mined. Done when a world is born, not by the account. |

**The cluster and the registry.**

| Was | Is | Why |
|---|---|---|
| `src/hub/names.ts` | `src/things/cluster/values.ts` | The cluster's names, capacity and regions (glossary: hub becomes cluster). |
| `src/hub/stack.ts` | `src/things/cluster/stage.ts` | The cluster's Alchemy stack: the gateway, the three Durable Objects, the container apps, the bucket. |
| `src/hub/hub.ts` | `src/things/cluster/client.ts` | Bringing the cluster up and down, registering and forgetting worlds on it, reading its registry. |
| `src/hub/registration.ts` | `src/things/cluster/registration.ts` | A world's registration on the cluster: its schema, token and key. |
| `src/hub/idle.ts` | `src/things/cluster/idle.ts` | How many of the cluster's containers are running; the cluster proof waits on it. |
| `src/lifecycle/claim.ts` | `src/things/registry/reserve.ts` | Reserving a world's name in the registry, which also admits it to the cluster (glossary: claim becomes reserve). |
| `src/lifecycle/platform.ts` | `src/things/registry/stage.ts` | Deploys and destroys the registry's stage: the Neon project and the registry branch (was 'the platform stage'). |

**Sites and site templates.**

| Was | Is | Why |
|---|---|---|
| `src/site/call.ts` | `src/things/site/client.ts` | Calls to the bench's site service, one-shot or as a job (glossary: site door becomes site service). |
| `src/site/Bench.ts` | `src/things/site/bench.ts` | Grants a world its bench token, makes, lists, removes and reads its sites. |
| `src/site/Points.ts` | `src/things/site/reset.ts` | Puts a world's sites back in an in-place reset (glossary: point becomes site snapshot). |
| `src/site/Saved.ts` | `src/things/site/snapshot.ts` | A world's sites in a snapshot, and remade in a restored world: the site snapshot. |
| `src/site/Templates.ts` | `src/things/site-template/sweep.ts` | Site templates' names and fingerprints, and sweeping idle ones (glossary: template becomes site template). |
| `src/lifecycle/templates.ts` | `src/things/site-template/keep.ts` | Keeps a world's sites as the site template of its starting point. |

**The account.**

| Was | Is | Why |
|---|---|---|
| `src/platform/server.ts` | `src/account/server.ts` | Serves the account's Rpc group (glossary: platform, the group, becomes account). |
| `src/platform/serve.ts` | `src/account/serve.ts` | Serves it on loopback with Bun. |
| `src/platform/operators.ts` | `src/account/operators.ts` | The operators' names and tokens, and who is signed in. |
| `src/platform/store.ts` | `src/account/store.ts` | The account's own tables: spans, calls, snapshots. |
| `src/platform/refusals.ts` | `src/account/refusals.ts` | Keeps declared refusals, turns the rest into defects. |
| `src/platform/view.ts` | `src/account/view.ts` | The world.show view, and the declared events it writes. |
| `src/platform/create.ts` | `src/account/worlds.ts` | world.create and world.show, and the helpers every handler shares. |
| `src/platform/inventory.ts` | `src/account/lists.ts` | world.list, world.snapshot.list and world.snapshot.delete. |
| `src/platform/snapshots.ts` | `src/account/snapshots.ts` | world.snapshot.save and world.snapshot.restore. |

**The parts.**

| Was | Is | Why |
|---|---|---|
| `src/door/Door.ts` | `src/parts/gateway/Gateway.ts` | The cluster's one Worker, routing to each world's parts (glossary: the hub's door becomes gateway). |
| `src/core/Core.ts` | `src/parts/api/Api.ts` | What fills a world's api slot (glossary: core becomes api; the exported name Core waits for the ratchet). |
| `src/core/host.ts` | `src/parts/api/host.ts` | A host that runs the api off Cloudflare. |
| `src/core/health.ts` | `src/parts/api/health.ts` | The api's health path. |
| `src/platform/steady.ts` | `src/parts/api/steady.ts` | Waits until the api answers ten times in a row. Used by create and renew, never by the account. |
| `src/chain/Anvil.ts` | `src/parts/chain/Anvil.ts` | The chain's container. |
| `src/chain/Chain.ts` | `src/parts/chain/Chain.ts` | One world's chain: wakes and stops its anvil, saves and restores its state. |
| `src/chain/ChainState.ts` | `src/parts/chain/ChainState.ts` | Where stopped chains' state is kept. |
| `src/chain/abi.ts` | `src/parts/chain/abi.ts` | ABI encoding, no network. |
| `src/chain/admission.ts` | `src/parts/chain/admission.ts` | Inside the chain object: a world's registration, checked on every call. |
| `src/chain/calls.ts` | `src/parts/chain/calls.ts` | JSON-RPC from the chain object to anvil. |
| `src/chain/contracts.ts` | `src/parts/chain/contracts.ts` | The seed's head and the contracts' addresses. |
| `src/chain/faucet.ts` | `src/parts/chain/faucet.ts` | Test USDC: deploys and mints it. |
| `src/chain/objects.ts` | `src/parts/chain/objects.ts` | Removes a world's saved objects and registry entry from the cluster's bucket. |
| `src/chain/record.ts` | `src/parts/chain/record.ts` | The chain object's own record of starts and stops. |
| `src/chain/test-usdc.hex` | `src/parts/chain/test-usdc.hex` | Compiled MockERC20, read by faucet.ts. |
| `src/lifecycle/controls.ts` | `src/parts/chain/controls.ts` | Resets, mines and reads the chain's time, and stops the index, through the gateway: the chain's client. |
| `src/bundler/Alto.ts` | `src/parts/bundler/Alto.ts` | The bundler's container. |
| `src/bundler/Bundler.ts` | `src/parts/bundler/Bundler.ts` | One world's bundler object. |
| `src/bundler/Keys.ts` | `src/parts/bundler/Keys.ts` | The entry point, paymaster and keys every world shares. |
| `src/bundler/client.ts` | `src/parts/bundler/client.ts` | Calls a world's bundler from outside. |
| `src/bundler/setup.ts` | `src/parts/bundler/setup.ts` | Funds the bundler, deploys the paymaster, starts alto. |
| `src/bundler/test-paymaster.hex` | `src/parts/bundler/test-paymaster.hex` | Compiled MockPaymaster, read by setup.ts. |
| `src/index/Indexer.ts` | `src/parts/indexer/Indexer.ts` | One world's Ponder object. The folder becomes indexer/ so it never reads as index.ts. |
| `src/index/Ponder.ts` | `src/parts/indexer/Ponder.ts` | The indexer's container. |
| `src/index/account.ts` | `src/parts/indexer/starts.ts` | A one-line account of the indexer's starts. Renamed: 'account' is the glossary's word for sign-in. |
| `src/index/timeline.ts` | `src/parts/indexer/timeline.ts` | Ponder's metrics as a start timeline. |
| `src/database/Db.ts` | `src/parts/database/Database.ts` | The Neon project, the registry branch and a world's branch, as Alchemy resources. |
| `src/database/neon.ts` | `src/parts/database/neon.ts` | Fast Neon branch calls. |
| `src/database/sql.ts` | `src/parts/database/sql.ts` | SQL over Neon's HTTPS. |
| `src/platform/branches.ts` | `src/parts/database/branches.ts` | Snapshot branches through Neon's API: database plumbing, used by the account, reset and take-down. |
| `src/containers/patience.ts` | `src/parts/containers/patience.ts` | A container start, tried again with backoff; shared by chain, bundler and indexer. |
| `src/containers/record.ts` | `src/parts/containers/record.ts` | Timestamps and a keep-the-last-N list for the objects' records. |
| `src/containers/stop.ts` | `src/parts/containers/stop.ts` | SIGTERM, wait, then kill. |

**Alchemy.**

| Was | Is | Why |
|---|---|---|
| `src/stack/engine.ts` | `src/stack/engine.ts` | The only file that drives Alchemy. |
| `src/stack/images.ts` | `src/stack/images.ts` | Image builds, pins and fingerprints. |
| `src/stack/names.ts` | `src/stack/names.ts` | Stack, stage and image names. |
| `src/stack/settings.ts` | `src/stack/settings.ts` | What a caller decides about a world: its cluster and bench grants. |
| `src/lifecycle/account.ts` | `src/stack/cloud.ts` | Reads the Cloudflare and Neon accounts directly. Renamed: 'account' is the glossary's word for sign-in. |

**Proofs.**

| Was | Is | Why |
|---|---|---|
| `src/proofs/proofs.ts` | `src/proofs/cases.ts` | The case names and the proof each runs. |
| `src/proofs/support.ts` | `src/proofs/support/conclude.ts` | check, conclude, inventories before and after, the command line as a process. |
| `src/proofs/checks.ts` | `src/proofs/support/payments.ts` | The addresses and the one-USDC payment the proofs check. |
| `src/proofs/userop.ts` | `src/proofs/support/userop.ts` | Builds, signs and sends one UserOperation. |
| `src/proofs/bundler.ts` | `src/proofs/cases/bundler.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/clock.ts` | `src/proofs/cases/clock.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/commands.ts` | `src/proofs/cases/commands.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/endings.ts` | `src/proofs/cases/endings.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/fresh.ts` | `src/proofs/cases/fresh.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/hub.ts` | `src/proofs/cases/hub.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/patience.ts` | `src/proofs/cases/patience.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/reset.ts` | `src/proofs/cases/reset.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/shared.ts` | `src/proofs/cases/shared.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/site.ts` | `src/proofs/cases/site.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |
| `src/proofs/snapshot.ts` | `src/proofs/cases/snapshot.ts` | One proof case; its file keeps the case's name, which its frozen record carries. |

## What other packages meet

- **The CLI (decision 8).** The verb files are named as `capxul <thing> <verb>` will name the commands:
  `things/world/reset.ts` is `capxul world reset`, `things/cluster/client.ts`'s up and down are `capxul cluster up|down`.
  When the blueprint's pipeline operations declare these verbs, each command's handler is the verb file of the same
  name here; until then `run.sh` runs `src/cli/main.ts`.
- **The account.** `account/` serves the blueprint's platform group (`PlatformRpcs`). The glossary calls that group
  the account; the group's own name is the blueprint's to change (3.8), and this package follows it.
- **Exported names** (`hubUp`, `platformUp`, `Core`, `CoreHost`, `BenchStage`, `withWorld`) are unchanged, so the
  runner and every other importer of `@capxul/world` are untouched; they change with the rename ratchet (3.8).
- **The generated map** is written by `packages/generate` for each package named in `MAPS`
  (`packages/generate/src/sources.ts`): one line per file from its opening comment. Any package can join by one line.
- **The layout's check** is `packages/world/test/layout.test.ts`. Its rules (kinds of folder, a thing's four files,
  verbs, a shrinking list of unfolded files) are written for this package; a shared check would move to `packages/lint`.

**The four questions, as agreed.**

1. Exported names keep today's words (`hubUp`, `Core`, `platformUp`, `BenchStage`), and so do the words inside the
   files' comments; the glossary's renames run on their own ratchet (3.8). The move renames paths only.
2. `run.sh` stays at the package root, running `src/cli/main.ts`, until the CLI takes the world's verbs over
   (decision 8).
3. The README is one screen. The rest is pages under `packages/world/docs/`, one task or question each; the timings
   stay in the frozen records they came from, "Not done" goes to the roadmap, and the hand-written list of files is
   dropped.
4. A file that holds more than one verb, or a helper that belongs in one of a thing's four files, moves whole under an
   honest name and is listed as unfolded: `lifecycle/operations.ts` alone is cut, into `create.ts`, `destroy.ts` and
   `list.ts`.

**What it does not do.** No behaviour changes, no Alchemy stack changes, nothing a world creates or destroys. The
runner fingerprints `world/src` for its starting points, so the first run after the move remakes their site
templates once.
