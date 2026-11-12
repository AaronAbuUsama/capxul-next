# @capxul/devnet

The local chain's tools: deploy and verify the v4 contracts, run the proof, and build the seeded state. Modules:

| Module | What |
|---|---|
| `chain` | the one port to a chain (viem) |
| `test-keys` | Anvil's published test keys, by role |
| `protocol` | Companies House, its Roles roles, and the 15 contracts deployed through it (the small version of the old `packages/tools` `companies-house apply` and `protocol deploy|verify`) |
| `company` | a company's life on the real v4 contracts as functions: born under Companies House with its authority installed, departments, hats, budgets, and a wearer's payment with a document hash, refusals named in the blueprint's words. What the test sites' Core calls in place of the stand-in chain (plan task `m2-contracts-under-sites`); its test runs against the seeded chain when `DEVNET_RPC` is set |
| `proof` | the company-life proof that `packages/contracts/bin/prove-core.sh` runs |
| `chain-state` | builds the seeded state's pin from what a recording run touched |
| `devnet` | whole-world recovery: stopped Anvil files, a fenced full-Postgres template, native Frappe database/files/configuration backups and fail-closed restore |

`src/main.ts` is the composition root and the only place that reads the environment, files and argv, and prints:
`deploy`, `verify`, `prove`, `seed-pin`. Run with `node --experimental-strip-types`. Anvil's published test keys only. `pnpm devnet:test`
runs the module tests. `orb/` prepares native Amp toolchains and the pinned local Frappe/Postgres stack (see its README).
`cloud/` keeps the Claude proxy setup. `world-cost/` is a minimal Ponder app
over one world and the harness that measured what Ponder costs per world (`docs/mission/world-cost.md`); it has its own
`npm install`, outside the workspace.

## Whole-world recovery

`src/devnet/door.ts` exposes `saveSnapshot`, `readSnapshot`, and `restoreSnapshot`. A host supplies its snapshot root, code pin, maintenance Postgres connection (`psqlAdmin` needs psql 17), complete world/site inventory, and runtime. `runtime.ts` composes HMAC Core pause/resume, the Core database helpers and the host's process supervisor; `bench.ts` supplies `composeBench(["-f", absoluteComposeFile, ...])` for `packages/bench-image/compose.yaml`, not the old all-in-one spike bench. Compose's usual image/env/volume variables must be present. The Python helper runs offline in `site-admin`; mount the same current app code into every bench service during local development.

The site adapter requires the signed-assertion/pull Frappe boundary: `capxul.world.rewrite` keeps its old four-argument signature but ignores both legacy Core URLs and removes old OAuth wiring. Recovery intentionally passes empty compatibility arguments, not new outbound Core endpoints. Pair this recovery module with that boundary; the old OAuth/outbound-payment implementation is not supported. A save checks `Runtime.running` before pausing anything and refuses a stopped source without activating it.

For a gateway on a world-specific public port, supply `composeBench(composeArgs, undefined, siteUrl)` where `siteUrl(site)` returns that site's complete customer origin. The offline rewrite applies it to `host_name` after the world rewrite, before any service resumes. Omit it to keep the site's standard port-8000 default; never substitute the private bench/Core origin for the customer origin.

The supervisor fences every mutation entrance, including direct chain/bundler access, waits for clean exits, and starts Core paused without running migration. Each store callback must retarget both restricted runtime URLs to `world.database` and close its pools before returning. A single shared snapshot root serializes recovery on the host. The whole shared bench pauses while its writers drain, so another world's sites on that bench pause temporarily too. A stale host lock, bench guard or `restore-pending.json` is an operator-recovery condition, not permission to delete it and start a mixed world.

Snapshots are host-local: the checksummed folder references a nonconnectable PostgreSQL template by name and OID. The template contains every schema and retains database/schema/table ACLs and RLS. It is not a portable database export. Files and encryption keys are sensitive; keep the root private on protected storage and do not upload it unencrypted. Separate restores require new database/directory/site names and new database credentials; saved site encryption keys remain unchanged. Optional `stateDir/site-service/<site>.json` provisioning intents are captured and remapped to the new world/site/filename without changing company, Safe or admin identity. A restore replaces post-cut intents; older worlds without them remain supported, and the site service still checks restored `org_slug`/`safe_address`. In-place restore retains the abandoned database rather than deleting its record branch. Redis jobs must drain before save; browser sessions/cache are invalidated on restore. Only local/simulated worlds are supported.

The real PostgreSQL integration check is opt-in: set `WORLD_SNAPSHOT_PG` to a disposable PG17 maintenance database and run `pnpm devnet:test`. It creates uniquely named fixture databases and roles and removes only those it owns. It checks full-schema data, tenant RLS, Ponder's database CREATE grant, independent clones, in-place abandoned data, oversized file transport, corruption refusal and recovery failures. It does not claim the complete Core/Ponder/Frappe supplier-payment acceptance run.
