# Platform spike

Throwaway code that rehearses milestone 2 of [the roadmap](../../docs/roadmap.md) ("Staging": a shared hosted world,
deployed by Alchemy, with a clean drift check) on a stand-in host: the Claude cloud container it ran in. The real
host is not chosen yet (step 2.1 waits on Aaron); the same code targets it by changing one setting. `alchemy` and
`@alchemy.run/*` 2.0.0-beta.85 on Effect 4.1.2, run with Bun, state in the account's shared Cloudflare state store.
Nothing here is product code.

The bench is the lighter spike bench of [spikes/bench-clocks](../bench-clocks/README.md) (pinned Frappe and ERPNext
plus the capxul app, no nginx, no built assets), not the hosted six-app image in `packages/bench-image`.

## Verdict (13 November 2026, from a Claude cloud container)

`./rehearse.sh all` ran once from nothing to nothing; every line quoted here is in `records/`. `records/summary.json`
holds each step's exit code, the exit code it should have, and its duration (`"outcome": "passed"`).

| # | Question | Result | Observed | Record |
|---|---|---|---|---|
| 1 | Is the platform deployed by Alchemy as one stack? | **Proven, without the tunnel** | `Plan: 14 to create` … `Done: 14 succeeded`: Docker context, network, two volumes (MariaDB, sites), two images, MariaDB, Redis, door, web, worker, scheduler, the platform's DNS record. Second deploy: `Plan: no changes` | `02-deploy.txt` |
| 1a | ... with a Cloudflare Tunnel, its ingress and the connector? | **Killed here, by this container's egress policy** | Creating the tunnel: `Forbidden: denied by policy: this request might create, show or change an API token or another credential for this vendor`. The connector could not get out either: TCP to the edge (`198.41.192.7:7844`) is refused, and through the proxy the TLS hello is reset. The code is in the stack (`PLATFORM_EDGE=tunnel`, the default); the run used `PLATFORM_EDGE=none` | `01-tunnel-refused.txt` |
| 2 | A company site for a world, made with a credential scoped to that world, answering with the world's clock? | **Proven on the bench; not through the tunnel** | `site creation: exit 0 in 78.3 s`; refusals `token-missing`, `token-signature-invalid` (quota raised by hand), `token-expired`, `site-label-invalid`, `site-quota-reached` (`acme holds 1 of 1`); globex's token sees `"sites": []`. Host time `2026-11-13T11:26:41Z`, the site (plain HTTP to the bench's web process, `Host: acme-r1.worlds.abuusama.dev`) reads `"world":"acme"`, `"world_local":"2027-03-31 11:00:00"`. Neither plain HTTP nor `curl --insecure` through Cloudflare was possible: there is no tunnel | `03-world-and-site.txt` |
| 3 | Does a drift check catch changes by hand, exit non-zero, and come back clean after a repair? | **Proven, with our check; the pinned `alchemy drift` exits 0** | Three changes: the platform's DNS record edited through the API, the worker stopped, a line appended to the door's code inside its running container. `alchemy drift`: `Plan: 2 to update` (DNS record, worker), **exit 0**, the code change not seen. `src/run-drift.ts`: DNS record and worker `drifted`, `C /opt/door/door.py`, **exit 2**. After repair: `"clean": true`, exit 0 | `04-drift.txt` |
| 4 | What changes to target another machine? | **Shown in code and plan; not proven on a second machine** | Only `src/host.ts` reads `PLATFORM_DOCKER_HOST`. A new stage on `ssh://deploy@192.0.2.10`: `Plan: 14 to create`, the same resources. The live stage with that endpoint: `Plan: 12 to update` (everything on the context) | `05-swap-host.txt` |
| 5 | Does destroy leave nothing? | **Proven** | `Done: 1 succeeded` (world), `Done: 14 succeeded` (platform); then no container, volume, network, image or context of the stack, no tunnel named `cx-platform-*`, and `abuusama.dev: 66 records; under worlds.abuusama.dev: 0`, the other 66 with the same print `00b6780dc2951888` as before | `06-destroy.txt`, `00-zone-before.txt` |

## Durations (the recorded run)

| Step | Seconds |
|---|---|
| Deploy the platform from nothing (14 resources; image layers already in this machine's build cache) | 8.7 |
| Door ready after the deploy | 3.1 |
| Deploy again with no change | 9.8 |
| Deploy a world (its site's DNS record) | 8.5 |
| Create a site through the door (new-site 17.7, ERPNext 38.5, capxul 2.9, wizard 12.2, migrate 5.6, scheduler 0.8, join world 0.6) | 78.3 |
| Drift check (`src/run-drift.ts`), clean / drifted / after repair | 15.9 / 16.2 / 15.7 |
| Pinned `alchemy drift` | 7.6 |
| Repair (`alchemy drift --repair`) | 8.5 |
| Destroy the world, then the platform | 6.7, 18.5 |

The image build was warm: the bench's layers were already in this machine's build cache. A cold build of the same
image took 93 s in spikes/bench-clocks (plus 31 s to pull `frappe/build`).

## How the per-world site credential works

`door/door.py` is the only process that creates sites. It runs in its own container on the bench, shares the sites
volume, and is published on the host's loopback only (`127.0.0.1:18100`); with the tunnel it is also
`<stage>-door.<domain>`. A world's token, minted when the world is created (`src/run-mint.ts`, `src/token.ts`), is

`v1.<world>.<quota>.<expires>.<HMAC-SHA256 under the platform's door key over the rest>`

The door checks, before any work: the signature (a world cannot widen its own claims: raising the quota by hand gave
`token-signature-invalid`), the expiry (real time, the world's lifetime), the site's name (`<world>-<label>.<domain>`
only: a world names sites only in its own namespace), and the quota (sites on the bench whose `capxul_world` is the
token's world, counted from their `site_config.json`). The site joins the token's world, never one named in the
request. The door serves one request at a time, so two requests cannot both pass the quota. The smallest honest
version leaves out: revocation (only a new door key revokes, and it revokes every token), a site that fails half-way
(it holds no `capxul_world` yet, so it does not count), dropping a world's sites when the world is destroyed (the
platform's destroy removes them with the volume), and where the door key lives (a file per checkout here; on the real
line it belongs in the state store or Secrets Store so any container holding the Cloudflare key can mint).

## What the drift check compares

`src/drift.ts` is clean only when both halves are:

1. **Settings**: Alchemy's own scan (`Alchemist.Drift.scan`), which re-reads every resource of the stage and
   deep-compares it with what the last deploy recorded: a stopped or missing container, a changed DNS record, a missing
   volume or network, and (with the tunnel) a new version of the ingress configuration.
2. **Code**: `docker diff` of every container the stage recorded, against its image, keeping changed files (not
   directories, not Python caches) under `/opt/door/`, the bench's `apps/` and its `env/`. Alchemy's container read
   reports the image a container was created from, not what is in it, so code changed inside a running container is
   invisible to it, as Worker code replaced by hand was in spikes/state.

The repair recreates each container whose code changed (removes it; `alchemy drift --repair` creates it again from its
image) and lets Alchemy restore the settings.

## Findings

| Finding | What follows |
|---|---|
| This container's egress policy refuses to create a Cloudflare Tunnel (the response holds the connector's token), and cloudflared cannot reach the tunnel edge from here (port 7844 refused, no proxy support in cloudflared) | The tunnel must be created and its connector run from somewhere else: the bench host itself, or a hand-made tunnel the stack adopts. A decision for Aaron |
| `alchemy drift` 2.0.0-beta.85 exits 0 on drift and does not see code changed inside a container | Use `src/run-drift.ts` (exit 2) or move the pin; the code half is needed on any version |
| BuildKit's provenance attestation carries the build time, so with the containerd image store every rebuild from a full cache gave a new image id, and every deploy replaced the bench's containers | `--provenance=false` on both images; then `Plan: no changes` |
| A Docker context lives in the deployer's `~/.docker/contexts`, not in the shared state | A second container destroying the stage needs the context first; deploy and destroy here ran from one container |
| The pinned Docker provider tells contexts apart by name, not endpoint. A new endpoint on a live stage plans an update of every resource; read from its source, each container is then created on the new machine and the old machine's containers and volumes are left with no state | A stage's host is fixed at creation; moving means a new stage on the new machine, then a destroy of the old |
| The CA bundle this machine's build needs is 186 KB, too long for one environment variable, which is how Alchemy passes `secrets` to `docker build` | The bundle goes by path (`--secret id=build_ca,src=…`) in `build.options`; on a host with plain egress there is none |
| Cloudflare's free certificate covers one level under the domain, so `https://<site>.worlds.abuusama.dev` would not have a valid certificate | A certificate for `*.worlds.abuusama.dev` is a decision for Aaron; nothing about certificates was changed here |

## What must change for the real host

`PLATFORM_DOCKER_HOST=ssh://deploy@<host>` (a `deploy` user in the `docker` group, with the deployer's SSH key) and a
new stage. Nothing else in the stack names the machine. Also, outside the stack: run with `PLATFORM_EDGE=tunnel` from
somewhere that may create a tunnel; drop the proxy settings (`PLATFORM_BUILD_PROXY`, `PLATFORM_BUILD_CA`, unset when
`HTTPS_PROXY` is); and put the door key somewhere shared. Not proven: a second machine, the tunnel, reaching a site
through Cloudflare, the six-app image.

## Run it

```bash
bun install
./rehearse.sh all    # deploy, no-change deploy, a world and its site, drift, host swap plans, destroy; writes records/
./run.sh deploy --stage pr-x1 --yes          # or step by step: the platform (alchemy.run.ts)
./run.sh deploy -c world.run.ts --stage pr-acme --yes   # a world (needs WORLD_* settings, see world.run.ts)
./run.sh bun src/run-drift.ts pr-x1          # 0 clean, 2 drifted
./zone.sh                                    # the test zone's record count and print
```

Stage names start `pr-`; every Docker object is named `cx-platform-<stage>…`; DNS records are created only under
`worlds.abuusama.dev`. Finish with a destroy of every world and then the platform. Never run `alchemy nuke`.

| File | What |
|---|---|
| `alchemy.run.ts`, `src/host.ts`, `src/bench.ts`, `src/edge.ts`, `src/names.ts` | The platform stack: the host's context, the bench, the tunnel and the DNS names |
| `world.run.ts` | A world's stack: its sites' DNS records, borrowing the platform's outputs (`Output.stackRef`) |
| `door/` | The site door and its image (the bench's image plus `door.py`) |
| `src/token.ts`, `src/run-mint.ts` | A world's site token |
| `src/drift.ts`, `src/run-drift.ts` | The drift check |
| `run.sh`, `rehearse.sh`, `rehearse-drift.sh`, `zone.sh` | Settings, the whole rehearsal, the zone's count and print |
| `records/` | The transcripts of the recorded run and `summary.json` |
