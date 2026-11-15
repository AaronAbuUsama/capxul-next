# Make, list and destroy a world by hand

## Commands

`pnpm install` at the repository's root installs the package. From the root:

```bash
pnpm --filter @capxul/world world platform up      # once: the Neon project and the registry of world names
pnpm --filter @capxul/world world hub up --owner me --lifetime "7 days"   # once: the fleet hub every world runs on
pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" [--from other] [--mint 0xADDRESS=250000000]
WORLD_BENCH=pr-site pnpm --filter @capxul/world world create demo --owner me --lifetime "2 hours" --company "acme=Acme Ltd"
pnpm --filter @capxul/world world destroy demo
```

Inside `packages/world`, `pnpm world <command>` and `./run.sh <command>` are the same command line:

```bash
./run.sh show demo [--reveal]              # the world's addresses; the chain's token only with --reveal
./run.sh reset demo --to s0 [--template t] # rewind the world in place to its snapshot s0 (above)
./run.sh renew demo --lifetime "7 days"    # a later expiry, and Core deployed again with the running code (above)
./run.sh sql demo "select * from app.notes"
./run.sh list                              # every world in the shared state, with owner and expiry
./run.sh sweep [--dry-run]                 # destroy every expired world; remove what destroys leave behind, and the
                                           # bench templates unused for WORLD_TEMPLATE_IDLE (6 hours)
./run.sh inventory                         # what the two accounts hold, naming what is this stack's
./run.sh images                            # each image's pin and whether its inputs still match it
./run.sh platform down                     # refused while a world or a hub exists
./run.sh hub up|show|down [--hub <stage>]  # the fleet hub (above)
./run.sh prove <case>                      # the proofs below; each writes records/<case>.proof.json
```

A command prints its result as JSON on standard output (`pnpm --silent` keeps pnpm's own lines out of it) and its log
on standard error, and exits non-zero when it fails. The keys are the session's: the network proxy adds them to
requests for the Cloudflare and Neon API hosts, so `run.sh` only sets placeholders. Never run `alchemy nuke`, and
never deploy a world with the alchemy command line: `./run.sh alchemy` is for reading (`state list`, `drift`).

In-process, a scenario runner imports the package's door (`@capxul/world`):

```ts
const { record, used } = yield* withWorld({ name: "run-1", owner: "ci", lifetime: Duration.hours(1) }, (world) =>
  world.sql("select 1"),          // world.coreUrl, world.rpcUrl and world.bundlerUrl (secrets), world.sql, world.funded
);
```

Provide `SharedState.layer` over `Alchemist.layer()`. `spec.migrations` names Core's migrations directory.
