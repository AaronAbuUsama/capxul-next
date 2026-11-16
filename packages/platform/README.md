# @capxul/platform

The sites package (`packages/platform`): what hosts every world's company sites. One bench host on AWS, the Frappe
bench on it, the site service that makes, takes, saves and resets a world's sites with a token scoped to that world
(`door/`), the Cloudflare Tunnel that is the only way in, and the drift check. Why it is built this way is the
roadmap's decision "Hosting" ([docs/roadmap.md](../../docs/roadmap.md), "What was decided on 13 November 2026").

## Its stacks

- `CapxulBenchHost` (`host.run.ts`): the machine (`src/machines.ts`, a `t3.large`) in its own VPC with no inbound rule, an encrypted data
  disk at `/var/lib/docker` that survives restarts, and a role that carries only SSM.
- `CapxulPlatform` (`alchemy.run.ts`): through one Docker context, the bench (MariaDB, Redis, web, worker, scheduler),
  the site service, the tunnel and its connector, and two DNS names: the site service's and the wildcard for sites.
- `CapxulPlatform`, on Cloudflare (`src/collector/`): the collector, telemetry's one way in, a Worker at its
  workers.dev URL ([docs/collector.md](docs/collector.md)). `CapxulCollectorRehearsal` (`collector.run.ts`) is it alone.
- `CapxulBootstrap` (`bootstrap/`): CI's access, made once by Aaron ([BOOTSTRAP.md](bootstrap/BOOTSTRAP.md)).

`PLATFORM_HOST=aws` reaches the host's Docker engine through an SSM port forward (`bin/forward.sh`);
`PLATFORM_HOST=standin`, the default, uses a Docker engine the deployer reaches itself, to rehearse in a container.
Stages are `staging` (the shared bench, on AWS) or `pr-<x>` (rehearsals); every name comes from the stage
(`src/names.ts`).

Cost: about $79 a month for `staging` in `eu-west-2`, on demand (list prices of 13 November 2026); a rehearsal on a
stand-in host costs nothing.

## Run it

```bash
pnpm install                                           # from the repository root
bin/rehearse.sh pr-p2                                  # stand-in host: deploy, site by token, drift, repair, destroy
bin/run.sh deploy --stage pr-x1 --yes                  # or step by step, on the stand-in host
bin/run.sh bun src/run-mint.ts pr-x1 acme 1 <expires-unix> var/acme.token
bin/run.sh bun src/run-drift.ts pr-x1 drift.json       # 0 clean, 2 drifted, 1 failed
bin/run.sh destroy --stage pr-x1 --yes
bin/run.sh bun src/run-inventory.ts pr-x1              # what the shared state still holds for a stage
POOL_SECRETS=<file outside the repo> bin/pool-bench.sh up   # a local bench for the site pool
POOL_SECRETS=<same file> python3 proof/prove.py         # its proof, into records/site-pool/; then pool-bench.sh down
bin/zone.sh                                            # the zone's record count and a print of every other record
```

On AWS (CI, or a laptop with AWS credentials): `PLATFORM_HOST=aws bin/run.sh deploy -c host.run.ts --stage staging
--yes`, `bin/forward.sh open staging`, `PLATFORM_HOST=aws bin/run.sh deploy --stage staging --yes`,
`bin/forward.sh close`. Never `alchemy nuke`; only records under `worlds.abuusama.dev` are made.

## Where to read more

- The site service's API, its token and every call: [docs/site-service.md](docs/site-service.md).
- Site templates, the pool, blank company sites, saving and resetting in place, and what runs at once:
  [docs/site-templates.md](docs/site-templates.md).
- The collector: who may call it, what it stamps, its counts and its keys: [docs/collector.md](docs/collector.md).
- The drift check, settings and code: the header of `src/drift.ts`; `.github/workflows/drift.yml` runs it on
  `staging` every 6 hours.
- How each module works: the header of each file in `src/`, `door/` and `bootstrap/`.
- What was proven and measured, beside its evidence: [records/](records/), one README per record.
- Which workflow runs what, and when: [AGENTS.md](../../AGENTS.md), "How work flows".
