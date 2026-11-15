# The proposed layout of packages/world/src: every file today -> its place, with a one-line reason.
# Paths are relative to packages/world. A value of None for "to" means the file is split (see SPLITS).

MOVES = {
    # The package's one import entry and the command line.
    "src/door.ts": ("src/index.ts", "The one file other packages import from, as in the blueprint (glossary: door.ts becomes index.ts)."),
    "src/main.ts": ("src/cli/main.ts", "The process entry belongs with the command line it runs; nothing is loose at the root of src/."),
    "src/cli/commands.ts": ("src/cli/commands.ts", "The command tree. Command names keep today's words until the rename ratchet (3.8)."),
    "src/cli/renew.ts": ("src/cli/renew.ts", "The renew command, kept apart by choice as its comment says."),
    "src/cli/report.ts": ("src/cli/report.ts", "How a command prints its result."),
    "src/failures.ts": ("src/common/failures.ts", "The package's own failures, used by almost every file: shared, so common/."),
    "src/lifecycle/describe.ts": ("src/common/describe.ts", "Turns any failure into one line; used package-wide, not a lifecycle verb."),
    "src/lifecycle/steps.ts": ("src/common/stopwatch.ts", "Times each part of a verb under its timeout. Named for what it is: 'step' is the journeys' word in the glossary."),
    "src/lifecycle/record.ts": ("src/common/record.ts", "The run record's and proof record's JSON file format, read by the proofs and the command line."),

    # A world and its verbs.
    "src/lifecycle/spec.ts": ("src/things/world/values.ts", "What a world is: its spec, limits and timeouts. Every thing folder has values.ts."),
    "src/stack/stack.ts": ("src/things/world/stage.ts", "A world's Alchemy stack (its database and its api slot). stage.ts is where a thing's stack lives."),
    "src/lifecycle/parts.ts": ("src/things/world/client.ts", "Opening a world by name and calling its parts through the gateway: how a world is reached."),
    "src/platform/facts.ts": ("src/things/world/store.ts", "A world's facts as rows of its own database (clock, cast, companies, events): where a world keeps them."),
    "src/lifecycle/operations.ts": (None, "Three verbs in one file: split into create.ts, destroy.ts and list.ts, cut along its own functions."),
    "src/lifecycle/up.ts": ("src/things/world/bring-up.ts", "The steps a create runs (reserve, register on the cluster, chain and database side by side)."),
    "src/lifecycle/world.ts": ("src/things/world/take-down.ts", "Taking a world down, parking it, its plan and its lookup. On the ratchet: plan goes to create, park to keep."),
    "src/lifecycle/run.ts": ("src/things/world/use.ts", "withWorld: create a world, use it, write its record, destroy it."),
    "src/lifecycle/reset.ts": ("src/things/world/reset.ts", "Reset a world in place to one of its snapshots."),
    "src/lifecycle/renew.ts": ("src/things/world/renew.ts", "Move a world's expiry and redeploy it."),
    "src/lifecycle/sweep.ts": ("src/things/world/sweep.ts", "Delete expired worlds and what they left behind."),
    "src/lifecycle/expiry.ts": ("src/things/world/expiry.ts", "Expiry arithmetic and a world's state by it. On the ratchet: folds into values.ts."),
    "src/lifecycle/handle.ts": ("src/things/world/handle.ts", "A deployed world's handle from its stack outputs. On the ratchet: folds into client.ts."),
    "src/lifecycle/kept.ts": ("src/things/world/kept.ts", "The process's cache of handles. On the ratchet: folds into client.ts."),
    "src/lifecycle/validate.ts": ("src/things/world/names.ts", "Checks a world's and an owner's names. On the ratchet: folds into values.ts."),
    "src/platform/cast.ts": ("src/things/world/cast.ts", "A new world's cast: their Safes claimed and funded, its start mined. Done when a world is born, not by the account."),

    # The cluster: the shared containers worlds run on.
    "src/hub/names.ts": ("src/things/cluster/values.ts", "The cluster's names, capacity and regions (glossary: hub becomes cluster)."),
    "src/hub/stack.ts": ("src/things/cluster/stage.ts", "The cluster's Alchemy stack: the gateway, the three Durable Objects, the container apps, the bucket."),
    "src/hub/hub.ts": ("src/things/cluster/client.ts", "Bringing the cluster up and down, registering and forgetting worlds on it, reading its registry."),
    "src/hub/registration.ts": ("src/things/cluster/registration.ts", "A world's registration on the cluster: its schema, token and key."),
    "src/hub/idle.ts": ("src/things/cluster/idle.ts", "How many of the cluster's containers are running; the cluster proof waits on it."),

    # The registry: one row per world name.
    "src/lifecycle/claim.ts": ("src/things/registry/reserve.ts", "Reserving a world's name in the registry, which also admits it to the cluster (glossary: claim becomes reserve)."),
    "src/lifecycle/platform.ts": ("src/things/registry/stage.ts", "Deploys and destroys the registry's stage: the Neon project and the registry branch (was 'the platform stage')."),

    # A world's company sites, on the bench.
    "src/site/call.ts": ("src/things/site/client.ts", "Calls to the bench's site service, one-shot or as a job (glossary: site door becomes site service)."),
    "src/site/Bench.ts": ("src/things/site/bench.ts", "Grants a world its bench token, makes, lists, removes and reads its sites."),
    "src/site/Points.ts": ("src/things/site/reset.ts", "Puts a world's sites back in an in-place reset (glossary: point becomes site snapshot)."),
    "src/site/Saved.ts": ("src/things/site/snapshot.ts", "A world's sites in a snapshot, and remade in a restored world: the site snapshot."),
    "src/site/Templates.ts": ("src/things/site-template/sweep.ts", "Site templates' names and fingerprints, and sweeping idle ones (glossary: template becomes site template)."),
    "src/lifecycle/templates.ts": ("src/things/site-template/keep.ts", "Keeps a world's sites as the site template of its starting point."),

    # The account: the operations served outside any world.
    "src/platform/server.ts": ("src/account/server.ts", "Serves the account's Rpc group (glossary: platform, the group, becomes account)."),
    "src/platform/serve.ts": ("src/account/serve.ts", "Serves it on loopback with Bun."),
    "src/platform/operators.ts": ("src/account/operators.ts", "The operators' names and tokens, and who is signed in."),
    "src/platform/store.ts": ("src/account/store.ts", "The account's own tables: spans, calls, snapshots."),
    "src/platform/refusals.ts": ("src/account/refusals.ts", "Keeps declared refusals, turns the rest into defects."),
    "src/platform/view.ts": ("src/account/view.ts", "The world.show view, and the declared events it writes."),
    "src/platform/create.ts": ("src/account/worlds.ts", "world.create and world.show, and the helpers every handler shares."),
    "src/platform/inventory.ts": ("src/account/lists.ts", "world.list, world.snapshot.list and world.snapshot.delete."),
    "src/platform/snapshots.ts": ("src/account/snapshots.ts", "world.snapshot.save and world.snapshot.restore."),

    # The parts: what runs in the cloud, and each part's own client.
    "src/door/Door.ts": ("src/parts/gateway/Gateway.ts", "The cluster's one Worker, routing to each world's parts (glossary: the hub's door becomes gateway)."),
    "src/core/Core.ts": ("src/parts/api/Api.ts", "What fills a world's api slot (glossary: core becomes api; the exported name Core waits for the ratchet)."),
    "src/core/host.ts": ("src/parts/api/host.ts", "A host that runs the api off Cloudflare."),
    "src/core/health.ts": ("src/parts/api/health.ts", "The api's health path."),
    "src/platform/steady.ts": ("src/parts/api/steady.ts", "Waits until the api answers ten times in a row. Used by create and renew, never by the account."),
    "src/chain/Anvil.ts": ("src/parts/chain/Anvil.ts", "The chain's container."),
    "src/chain/Chain.ts": ("src/parts/chain/Chain.ts", "One world's chain: wakes and stops its anvil, saves and restores its state."),
    "src/chain/ChainState.ts": ("src/parts/chain/ChainState.ts", "Where stopped chains' state is kept."),
    "src/chain/abi.ts": ("src/parts/chain/abi.ts", "ABI encoding, no network."),
    "src/chain/admission.ts": ("src/parts/chain/admission.ts", "Inside the chain object: a world's registration, checked on every call."),
    "src/chain/calls.ts": ("src/parts/chain/calls.ts", "JSON-RPC from the chain object to anvil."),
    "src/chain/contracts.ts": ("src/parts/chain/contracts.ts", "The seed's head and the contracts' addresses."),
    "src/chain/faucet.ts": ("src/parts/chain/faucet.ts", "Test USDC: deploys and mints it."),
    "src/chain/objects.ts": ("src/parts/chain/objects.ts", "Removes a world's saved objects and registry entry from the cluster's bucket."),
    "src/chain/record.ts": ("src/parts/chain/record.ts", "The chain object's own record of starts and stops."),
    "src/chain/test-usdc.hex": ("src/parts/chain/test-usdc.hex", "Compiled MockERC20, read by faucet.ts."),
    "src/lifecycle/controls.ts": ("src/parts/chain/controls.ts", "Resets, mines and reads the chain's time, and stops the index, through the gateway: the chain's client."),
    "src/bundler/Alto.ts": ("src/parts/bundler/Alto.ts", "The bundler's container."),
    "src/bundler/Bundler.ts": ("src/parts/bundler/Bundler.ts", "One world's bundler object."),
    "src/bundler/Keys.ts": ("src/parts/bundler/Keys.ts", "The entry point, paymaster and keys every world shares."),
    "src/bundler/client.ts": ("src/parts/bundler/client.ts", "Calls a world's bundler from outside."),
    "src/bundler/setup.ts": ("src/parts/bundler/setup.ts", "Funds the bundler, deploys the paymaster, starts alto."),
    "src/bundler/test-paymaster.hex": ("src/parts/bundler/test-paymaster.hex", "Compiled MockPaymaster, read by setup.ts."),
    "src/index/Indexer.ts": ("src/parts/indexer/Indexer.ts", "One world's Ponder object. The folder becomes indexer/ so it never reads as index.ts."),
    "src/index/Ponder.ts": ("src/parts/indexer/Ponder.ts", "The indexer's container."),
    "src/index/account.ts": ("src/parts/indexer/starts.ts", "A one-line account of the indexer's starts. Renamed: 'account' is the glossary's word for sign-in."),
    "src/index/timeline.ts": ("src/parts/indexer/timeline.ts", "Ponder's metrics as a start timeline."),
    "src/database/Db.ts": ("src/parts/database/Database.ts", "The Neon project, the registry branch and a world's branch, as Alchemy resources."),
    "src/database/neon.ts": ("src/parts/database/neon.ts", "Fast Neon branch calls."),
    "src/database/sql.ts": ("src/parts/database/sql.ts", "SQL over Neon's HTTPS."),
    "src/platform/branches.ts": ("src/parts/database/branches.ts", "Snapshot branches through Neon's API: database plumbing, used by the account, reset and take-down."),
    "src/containers/patience.ts": ("src/parts/containers/patience.ts", "A container start, tried again with backoff; shared by chain, bundler and indexer."),
    "src/containers/record.ts": ("src/parts/containers/record.ts", "Timestamps and a keep-the-last-N list for the objects' records."),
    "src/containers/stop.ts": ("src/parts/containers/stop.ts", "SIGTERM, wait, then kill."),

    # Alchemy and the cloud accounts.
    "src/stack/engine.ts": ("src/stack/engine.ts", "The only file that drives Alchemy."),
    "src/stack/images.ts": ("src/stack/images.ts", "Image builds, pins and fingerprints."),
    "src/stack/names.ts": ("src/stack/names.ts", "Stack, stage and image names."),
    "src/stack/settings.ts": ("src/stack/settings.ts", "What a caller decides about a world: its cluster and bench grants."),
    "src/lifecycle/account.ts": ("src/stack/cloud.ts", "Reads the Cloudflare and Neon accounts directly. Renamed: 'account' is the glossary's word for sign-in."),

    # Proofs: frozen with their records; each case one file, the helpers apart.
    "src/proofs/proofs.ts": ("src/proofs/cases.ts", "The case names and the proof each runs."),
    "src/proofs/support.ts": ("src/proofs/support/conclude.ts", "check, conclude, inventories before and after, the command line as a process."),
    "src/proofs/checks.ts": ("src/proofs/support/payments.ts", "The addresses and the one-USDC payment the proofs check."),
    "src/proofs/userop.ts": ("src/proofs/support/userop.ts", "Builds, signs and sends one UserOperation."),
}
for case in ["bundler", "clock", "commands", "endings", "fresh", "hub", "patience", "reset", "shared", "site", "snapshot"]:
    MOVES[f"src/proofs/{case}.ts"] = (f"src/proofs/cases/{case}.ts", "One proof case; its file keeps the case's name, which its frozen record carries.")

# operations.ts is cut along its own functions. Each piece: (new path, header, names it exports, line-range test).
SPLITS = {
    "src/lifecycle/operations.ts": {
        "create": ("src/things/world/create.ts", "// Creates one world outside a run and leaves it up for its owner."),
        "destroy": ("src/things/world/destroy.ts", "// Destroys one world by name, from the shared state alone."),
        "listed": ("src/things/world/list.ts", "// Every world the shared state holds, as a listing shows it."),
        "Listed": ("src/things/world/list.ts", None),
        "list": ("src/things/world/list.ts", None),
    }
}

# Files outside src/ and what happens to them.
OUTSIDE = {
    "README.md": ("README.md", "Cut to one screen. Its how-to sections become pages under docs/, one task each; its reasoning goes with the layout's design page."),
    "package.json": ("package.json", "exports points at src/index.ts."),
    "run.sh": ("run.sh", "Stays until the CLI takes the world's verbs over (decision 8); it runs src/cli/main.ts."),
    "alchemy.run.ts": ("alchemy.run.ts", "Stays at the root, where Alchemy looks for it."),
    "tsconfig.json": ("tsconfig.json", "Unchanged."),
}
