# @capxul/platform

The shared platform every world on the shared bench borrows ([roadmap](../../docs/roadmap.md) milestone 2, steps
2.1, 2.2 and 2.5): the bench host on AWS, the Frappe bench on it, the site door that makes a world's company sites
with a token scoped to that world, the Cloudflare Tunnel that is the only way in, and the drift check. Graduated
from `spikes/platform` (13 November 2026); `alchemy` and `@alchemy.run/*` 2.0.0-beta.85 on Effect 4.1.2, run with
Bun, state in the account's shared Cloudflare state store.

Decided by Aaron, 13 November 2026: the bench host is **one EC2 machine on AWS** with a disk that survives restarts;
companies' sites are reached **through a Cloudflare Tunnel** and the machine accepts no inbound traffic; **CI's keys
are minted by code** (`bootstrap/`) and CI signs in to AWS through GitHub's OIDC, so no long-lived AWS key exists.

## The pieces

| Stack | File | What |
|---|---|---|
| `CapxulBenchHost` | `host.run.ts`, `src/aws.ts`, `src/user-data.ts` | The machine: a `t3.large` (2 vCPU, 8 GiB) on Amazon Linux 2023 in its own VPC and public subnet, a security group with **no inbound rule**, an encrypted 60 GiB gp3 data disk mounted at `/var/lib/docker` (images, build cache and the bench's MariaDB and sites volumes all live on it and survive restarts), a role carrying only `AmazonSSMManagedInstanceCore`, IMDSv2 with a hop limit of 1 so no container can borrow that role. Docker listens on the machine's loopback only |
| `CapxulPlatform` | `alchemy.run.ts`, `src/host.ts`, `src/bench.ts`, `src/edge.ts` | Through one Docker context: the bench image (`bench/`, pinned Frappe and ERPNext plus the capxul app) and the door's (`door/`), a network, MariaDB, Redis, the door, web, worker and scheduler; the tunnel, its ingress (`<stage>-door.<domain>` to the door, `*.<domain>` to web, anything else 404), its connector (cloudflared) on the machine, and two proxied CNAMEs, the door's and the wildcard |
| `CapxulBootstrap` | `bootstrap/` | CI's access, made once by Aaron ([BOOTSTRAP.md](bootstrap/BOOTSTRAP.md)) |

Two hosts, one platform stack. `PLATFORM_HOST=aws` reaches the bench host's Docker engine through an SSM port forward
that `bin/forward.sh` opens on the deployer's loopback (IAM decides who may open it; no port is open on the machine).
`PLATFORM_HOST=standin` (the default) uses a Docker engine the deployer reaches itself, by default its own: that is
how the package is rehearsed in an agent's container. Only `src/host.ts` differs between them.

Names (`src/names.ts`): stages are `staging` (the shared platform, on AWS) or `pr-<x>` (rehearsals); Docker objects
are `cx-platform-<stage>-…`, AWS objects `capxul-bench-<stage>…` (the CI role may touch IAM objects with that prefix
only); DNS names are one level under `PLATFORM_DOMAIN` (`worlds.abuusama.dev`), which is all Cloudflare's free
certificate covers, and rehearsals there are checked over HTTP (roadmap, "Test addresses").

## Cost

About **$79 a month** for `staging` in London (`eu-west-2`), on demand: the `t3.large` at $0.0944 an hour (about $69),
the 60 GiB data disk and 8 GiB root disk on gp3 (about $6), a public IPv4 address for outbound traffic ($3.65). SSM,
the tunnel and the DNS records cost nothing. List prices as known on 13 November 2026, not read from AWS from here.
A rehearsal on a stand-in host costs nothing but a DNS record that lives for its run.

## Per-world site tokens and the site door

`door/door.py` (the HTTP door and its checks) and `door/sites.py` (its bench half: the registry, making and removing a
site) are the only process that makes, uses or removes sites. A world's token, minted when the world is created
(`src/token.ts`; `mint`, `doorKey` and, for a caller that holds the state store open, `doorKeyIn` and
`platformOutputsIn` are exported through `src/door.ts` for `packages/world`), is

`v1.<world>.<quota>.<expires>.<HMAC-SHA256 under the platform's door key over the rest>`

where `<world>` is the blueprint's `WorldName`. The door checks the signature (a world cannot widen its own claims),
the expiry, the site's name (`<label>-<world>.<domain>`, the roadmap's `<company>-<world>`; a label has no dash, so the
name says whose site it is), that a site asked about is the token's world's (`site-not-in-world` otherwise), and for
a new site the quota, before any work. The door key is an `Alchemy.Random` of the platform stage (`DoorKey-g<n>`), read
from the shared state by whoever holds the Cloudflare key (`src/state.ts`), never an output. A new
`PLATFORM_DOOR_KEY_GENERATION` replaces it and so revokes every token. The token travels in `X-Capxul-Site-Token`.

| Call | What |
|---|---|
| `POST /sites {label, company, api_key, api_secret}` | Answers 202 and makes the site in the background (one at a time; about 93 s): new site, ERPNext, capxul, the wizard with the company, migrate, the scheduler, joining the token's world (its clock), and an API user of the site's own, `capxul-core@service.invalid`, with the key and secret the world sent and the roles `Accounts User`, `Purchase User`, `Sales User`. Never the bench's Administrator. |
| `GET /sites/<site>`, `GET /world` | A site's state (`creating`, `ready`, `failed`) with each step's time; the world's sites. |
| `ANY /sites/<site>/api/...` | One call to the site's own REST API, carried to web with the site's Host, as the user `Authorization: token <key>:<secret>` names. Cookies are dropped and any other credential refused; a site not ready answers `site-creating` or `site-failed`. |
| `DELETE /sites/<site>`, `DELETE /world` | Removes a site (`bench drop-site`, its archive deleted; if that fails, its database and user dropped directly), or every site of the world. A token of quota 0 may do it, so the sweeper can for an expired world. |

The platform records `doorUrl`, where a world reaches the door: `http://<stage>-door.<domain>` through the tunnel, or,
with `PLATFORM_EDGE=none`, the host's loopback port (only the host itself reaches it).

A world's site was made, read, refused to a second world and removed through this door by `packages/world`'s `site`
proof (`packages/world/records/site.proof.json`) on the stand-in stage `pr-site`, which was then destroyed.

## The drift check

`src/run-drift.ts <stage> [record.json]` exits 0 clean, 2 drifted, 1 when the check itself failed. It is clean only
when both halves are (`src/drift.ts`):

1. **Settings**: Alchemy's own scan of every stack of the platform (with `PLATFORM_HOST=aws`, the bench host's too): a
   container stopped or gone, a DNS record edited, a new ingress version, an inbound rule added, a machine resized.
2. **Code**: `docker diff` of every container the platform recorded, keeping changed files under the door, the
   bench's apps and its Python environment (`src/code-drift.ts`). Alchemy reads a container's image, not what is in
   it, so code replaced inside a running container is invisible to the first half. The pinned `alchemy drift` exits 0
   on drift and misses this half (`records/spike/04-drift.txt`, and again in `records/rehearsal/03-drift.txt`).

## CI

| Workflow | When | What |
|---|---|---|
| `.github/workflows/platform.yml` | On demand (`deploy` or `plan`), and on a push to master touching this package | OIDC sign-in as the CI role; deploy `CapxulBenchHost`; `bin/forward.sh open`; deploy `CapxulPlatform`; a drift check, its record uploaded |
| `.github/workflows/drift.yml` | Every 6 hours, and on demand | The drift check on `staging`; drift fails the job; the record is uploaded either way |
| `.github/workflows/world.yml` | Pull requests into master (once `CAPXUL_CLOUD_READY` is `true`) and pushes to master | Roadmap step 1.8: a private world created by `packages/world`, the thin line's scenarios through `packages/runner`, the record uploaded, the world always destroyed |

A missing secret or variable fails a job by name (`bin/require.sh`), never skips it. Not touched: `check.yml`.

## Run it

```bash
pnpm install                                           # from the repository root
bin/rehearse.sh pr-p2                                  # stand-in host: deploy, site by token, drift, repair, destroy
bin/run.sh deploy --stage pr-x1 --yes                  # or step by step, on the stand-in host
bin/run.sh bun src/run-mint.ts pr-x1 acme 1 <expires-unix> var/acme.token
bin/run.sh bun src/run-drift.ts pr-x1 drift.json       # 0 clean, 2 drifted, 1 failed
bin/run.sh destroy --stage pr-x1 --yes
bin/run.sh bun src/run-inventory.ts pr-x1              # what the shared state still holds for a stage
bin/zone.sh                                            # the zone's record count and a print of every other record
```

On AWS (CI, or a laptop with AWS credentials): `PLATFORM_HOST=aws bin/run.sh deploy -c host.run.ts --stage staging
--yes`, `bin/forward.sh open staging`, `PLATFORM_HOST=aws bin/run.sh deploy --stage staging --yes`,
`bin/forward.sh close`. Never `alchemy nuke`; only records under `worlds.abuusama.dev` are made.

## What is proven, and what only CI can prove

`bin/rehearse.sh pr-p2` ran once from nothing to nothing on 13 November 2026 in a Claude cloud container
(`PLATFORM_HOST=standin`, `PLATFORM_EDGE=none`); every line quoted is in `records/rehearsal/`, and `summary.json`
holds each step's exit code, the exit code it should have and its duration (`"outcome": "passed"`).

| Question | Result | Record |
|---|---|---|
| Is the platform deployed by Alchemy as one stack, and is a second deploy a no-op? | Yes. `Plan: 14 to create, 1 to adopted` (the context bin/run.sh made) … `Done: 15 succeeded`, 9.2 s with the bench image already built (an earlier run of the same script, `pr-p1`, built it cold: 160.8 s); again: `Plan: no changes`, 11.1 s | `01-deploy.txt` |
| A company site made with a token scoped to its world, the door key read from the shared state? | Yes. Tokens minted by `src/run-mint.ts` from the stage's `DoorKey-g1`; refusals `token-missing`, `token-signature-invalid` (quota raised by hand), `token-expired`, `site-label-invalid`, `site-quota-reached` (`acme holds 1 of 1`); globex's token sees `"sites": []`; the site, made in 100.8 s, reads `"world":"acme"`, `"world_local":"2027-03-31 11:00:00"` over plain HTTP to the bench's web process | `02-site.txt` |
| Does the drift check catch changed settings and code replaced by hand, exit non-zero, and come back clean after a repair? | Yes. Clean first (exit 0, 15 resources). Three hand changes: the door's DNS record edited through the API, the worker stopped, a line appended to `/opt/door/door.py` in the running door. The pinned `alchemy drift`: `Plan: 2 to update`, exit 0, the code not seen. Ours: `DoorRecord` and `Worker` `drifted`, `C /opt/door/door.py`, **exit 2**. After the repair (the door recreated, `alchemy drift --repair`): exit 0, the record's content back, the hand line gone, the site still answering | `03-drift.txt`, `drift-*.json` |
| Does destroy leave nothing? | Yes. `Done: 15 succeeded`; then no container, volume, network, image or context of the stage, `CapxulPlatform/pr-p2: none` in the shared state, and `abuusama.dev: 66 records; under worlds.abuusama.dev: 0`, the other 66 printing `00b6780dc2951888`, as before the run | `04-destroy.txt`, `00-zone-before.txt` |
| The AWS path, without AWS keys? | Types and lint pass for both stacks and the bootstrap; the unit tests read the IAM trust and permissions, the Cloudflare token's scope, the first boot and the token. The platform stack in its AWS form (`PLATFORM_HOST=aws`, `PLATFORM_EDGE=tunnel`, stage `staging`) plans against the shared state: 18 to create, the tunnel, ingress, wildcard and connector among them. The host stack loads and resolves its providers, then stops at AWS's sign-in (placeholder keys): Alchemy cannot plan AWS offline | `records/aws/` |
| Are the workflows valid? | `actionlint` 1.7.7, with shellcheck, finds nothing in the four workflows | (run, not recorded) |

Only a CI run with the bootstrap's keys can prove: the machine coming up from its user data (disk found, formatted,
mounted, Docker on loopback), the SSM forward carrying Alchemy's Docker traffic (several connections at once), the
bench image built on the machine, the tunnel created and its connector reaching Cloudflare's edge, a site answering
at `http://<world>-<label>.worlds.abuusama.dev` through Cloudflare, the IAM policy being enough (a missing action shows
as `AccessDenied` in the first run) and the drift check on both stacks there. None of it was run: this session has
no AWS keys, may not create a Cloudflare credential (a tunnel's token is one), and cannot write GitHub secrets.

## Findings

| Finding | What follows |
|---|---|
| GitHub starts scheduled workflows only from the default branch, `main` here | `drift.yml`'s schedule fires once master is the default or a small dispatcher is on `main`: Aaron's call ([BOOTSTRAP.md](bootstrap/BOOTSTRAP.md), "The schedule") |
| GitHub's default OIDC subject for a pull request does not name its base branch | The bootstrap sets the repository's subject template to `repo, context, base_ref`; the role trusts only `master` and `base_ref:master` |
| A Docker context is in the deployer's `~/.docker`, not in the shared state | `bin/run.sh` makes it, exactly as `src/host.ts` declares it, before any alchemy command, so a fresh CI runner plans and checks the stage in sync (the plan shows it `adopted`) |
| `AWS.EC2.Instance` (2.0.0-beta.85) types its requirements as `any` | Narrowed in one place, `src/aws.ts`, with the reason |
| `amazonLinux2023()` resolves the newest image on every plan | The image is pinned (`PLATFORM_AMI_ID`, resolved once by the bootstrap): a new one replaces the machine. Replacing the machine was not rehearsed: the new attachment needs the data disk detached from the old machine first |
| Changing the machine's user data replaces it (EC2 runs user data once) | `src/user-data.ts` does only what Docker cannot do later |
| The bench is the light image (Frappe, ERPNext, capxul), not the hosted six-app image of `packages/bench-image` | Enough for the thin line; moving is a change of `src/bench.ts` and `bench/` |
| Sites under `worlds.abuusama.dev` are two levels under the zone, outside the free certificate | HTTP only until real worlds move to `capxul.com` (roadmap, "Test addresses"); a token sent to the door through the tunnel travels in clear until then |

| File | What |
|---|---|
| `alchemy.run.ts`, `host.run.ts` | The platform's stack and the bench host's |
| `src/names.ts`, `src/stage.ts` | Every name, from the stage |
| `src/host.ts`, `src/aws.ts`, `src/user-data.ts` | The machine: the Docker context, the AWS resources, the first boot |
| `src/bench.ts`, `bench/`, `door/`, `src/edge.ts` | The bench, its image, the site door, the tunnel and DNS |
| `src/token.ts`, `src/state.ts`, `src/door.ts`, `src/run-mint.ts` | Site tokens, the door key from the state, the package's door |
| `src/drift.ts`, `src/code-drift.ts`, `src/run-drift.ts`, `src/run-inventory.ts` | The drift check and the state inventory |
| `bin/` | `run.sh` (settings), `forward.sh` (SSM), `require.sh` (CI), `rehearse.sh` and `rehearse-drift.sh`, `zone.sh` |
| `bootstrap/` | CI's access: `bootstrap.sh`, `bootstrap.run.ts`, `src/aws-policy.ts`, `src/cloudflare-policy.ts`, `BOOTSTRAP.md` |
| `records/rehearsal/` | The stand-in rehearsal of this package: transcripts, drift reports, `summary.json` |
| `records/aws/` | The AWS path from here: the platform's plan for `staging`, and the host's plan stopping at AWS's sign-in |
| `records/spike/` | The spike's run, moved here when the spike was deleted |
