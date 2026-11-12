# Capxul in an Amp orb

One independent checkout and development stack per native Amp agent. `build.amp` has removed the repository's old loop and worker provisioner; this setup does not recreate them. Wave 0 requires real Postgres/Ponder Core, ERPNext, the v4 contracts, one reconciled supplier payment and recovery. A healthy skeleton Core is not that acceptance result.

## Prepare and start

```bash
.agents/setup                        # reusable toolchains, artifacts and images; no company sites
source packages/devnet/orb/env.sh     # local Compose selectors and dev-only PG_ADMIN_URL
amp orb services ensure              # supervised local stack and the book
```

Setup installs checksum-verified Node 24.22.2, Foundry 1.8.5 and native solc 0.8.28/0.8.24, uses pnpm 12.18.0 with the frozen workspace and separate skeleton Core lockfiles, verifies the chain seed and builds contract artifacts. It builds `capxul-bench:orb` from `packages/bench-image/apps.lock.json` and pulls the backing images. Docker's own cache invalidates changed app inputs. No Claude proxy, solc-js, TLS bypass, host-network workaround, Cloudflare token or model gateway is needed.

The production bench layout remains in `packages/bench-image`. The orb layout uses its pinned six-app build, a development test server and a read-only source mount for Capxul Python. Restart for Python changes; rebuild for changed assets or upstream pins.

Amp's built-in orb has Docker Engine. Setup enables its systemd daemon and installs Compose/Buildx if absent. The local Docker CLI shim uses existing sudo rights without exposing Docker over TCP or making its socket world-writable. Resume restarts the daemon and fails visibly if it cannot. A backend without systemd/Docker would need a separate native bench bootstrap.

Cold builds need public GitHub, npm/PyPI and registry access, about 20 GB of free build space and several minutes. Setup must finish within Amp's 20-minute limit. Snapshots retain tools/images, not running company sites or user authentication. Actual fresh-snapshot activation and pause/resume must be verified separately from warm setup reruns.

## Runtime contract

| Service | Local address and state |
|---|---|
| Postgres | `postgres:17-alpine`, loopback 5432, database `capxul`, persistent `orb-postgres` volume |
| Frappe | loopback 8000 and Socket.IO 9000; pinned ERPNext/HRMS/CRM/WhatsApp/Capxul; persistent sites/logs |
| MariaDB / Redis | 11.8 / 7.4, container-internal only; MariaDB is for Frappe, not Core |
| v4 Anvil | loopback 8545; committed seed and private per-world state |
| Core | loopback 8787; startup, schema, migrations and readiness belong to the Core package |
| Ponder | package/version, handlers and startup belong to the Core/Ponder implementation |

`env.sh` exports public dev-only connection URLs: `PG_ADMIN_URL` for `capxul_admin`, plus `DATABASE_URL`, `WORKER_DATABASE_URL` and `PONDER_DATABASE_URL` for `capxul_core`, `capxul_worker` and `capxul_ponder`. Core's migration creates those restricted roles/RLS and reads their passwords from the URLs; no runtime URL substitutes the admin account. No app tables or runtime roles are invented in bootstrap. The file also selects the local v4 deployment and shared signing fixture, with finality depth zero explicitly limited to Anvil acceptance.

`serve.sh` starts the foundation and real v4 chain, never the legacy JSON-file Core server. Core/Ponder wiring awaits their verified package commands: migrate first, start Ponder 0.18.6, bind its SQL views, then start the backend and check both `/ready` endpoints. Running services must not inherit `PG_ADMIN_URL`. The separate site-service package owns provisioning. No real-Core wave-zero pass is claimed before those processes and the reconciled payment/recovery checks run together.

The slice-zero supervisor owns selected-stack orchestration and uses the production-shaped `packages/bench-image/compose.yaml` for recovery. Do not start the all-in-one `capxul-stack` foundation alongside it: they would collide on ports and its single bench service is not the production recovery topology. `.agents/setup` only prepares tools, dependencies and images, so it can run before either layout without starting their services.

At a new world's birth, after `chain-up.sh` writes its static deployment and before clock/authority services start, run `node packages/devnet/orb/prepare-chain.mjs`. It prepares at most the deficit to deployment block plus 200 empty two-second blocks, then verifies Ponder's head-minus-90 block exists and is at least 180 seconds older. A repeat or a restored chain with that history mines nothing. A retained world with `clock.json` but insufficient history is refused rather than advancing its clock. The Anvil process uses `--state` and `--preserve-historical-states`; its stopped native JSON state, not the gzip-hex `anvil_dumpState` RPC result, is the loadable recovery input. Deployment manifests include the real seeded Installer and `env.sh` selects EntryPoint v0.7 explicitly.

The committed skeleton passwords and signing keys are public development fixtures. Never use real money, production data or broad deployment credentials. Preserve HMAC/hat/site checks, world clocks, isolated data, snapshot lineage and cleanup. Additional worlds need independent ports/state; never share their directories between orbs.

```bash
amp orb service logs capxul-stack
amp orb service logs capxul-chain-main
amp orb service stop capxul-stack      # stops its chain and containers; keeps data
```

Stop retains Postgres, MariaDB, company sites and chain data. Do not use `down --volumes`, `reset` or `docker system prune` on a retained orb. Use the world's existing stop command for extra worlds. Run one destructive eval at a time per orb; keep interactive browser review separate from clock/snapshot runs.

Only `pnpm evals` writes local verdicts. Return commit/run-qualified evidence to the coordinator rather than merging competing `status/status.json` or writing authoritative `plan/` from worker clones. The book's live-view changes are owned separately; this recipe does not implement its refresh behavior.

## Activation and capacity

The project currently starts new orbs from GitHub's default `main`. Both remote branches were at `6ff775e` on 12 November during this validation; that does not include these setup edits. Aaron authorized this setup's pull request into `integration/wave-0`; that branch's coordinator owns merging and promotion through `integration/build` to the approved `main` catch-up. A local setup change or one only on an integration branch cannot seed default-branch orbs. No Amp Base Branch change is needed while the default branch is current; any later override needs approval and also changes Ship's target. Do not delete healthy snapshots to apply an ordinary setup update.

On 12 November, the inspected project default was `a1.medium` (4 CPU/8 GB); the existing filesystem showed 64 GiB, while public docs promise 60 GB. One existing orb is not a measurement of fifteen full-stack orbs.

Public docs allow a burst of 20 metered starts followed by one start per five minutes. That is launch pacing, not an active-orb/model-concurrency entitlement. `amp usage` reports account allowances; model-provider routing is not readable in this multiplayer thread. Aaron/provider administrators and Amp support must confirm the actual limits.

At standard prices, fifteen medium workers cost $4.95/hour in compute equivalent, excluding inference/tools and the coordinator. Approve a finite resource/time/spend envelope before provisioning. Verify one fresh orb and snapshot reuse first, then ramp useful full-stack work through 2, 4, 8 and 15 concurrent workers. Record readiness, payment/recovery correctness, CPU/memory/disk, start queues, rate-limit failures and cleanup at each stage. Stop on resource pressure or unexpected routing/charges. No fifteen-stack result is claimed here.

Separate orbs prevent local port, database and git-index collisions, not shared remote-branch conflicts or provider limits. Assign unique task/branch owners centrally, serialize integration and keep credentials minimal.
