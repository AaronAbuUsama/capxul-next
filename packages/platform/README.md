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
| `POST /sites {label, company, api_key, api_secret}` | Answers 202 and makes the site in the background: **a copy of the bench's blank company site** (below, "Blank company sites"; seconds to take, then about 20 s to configure) with the wizard run for the company, every app's `after_migrate` hooks, joining the token's world (its clock), the scheduler, and an API user of the site's own, `capxul-core@service.invalid`, with the key and secret the world sent and the roles `Accounts User`, `Purchase User`, `Sales User`. Never the bench's Administrator. With no blank it is made from nothing as before (one at a time; 2 to 4 minutes): new site, ERPNext, HRMS, capxul, the wizard, migrate, the scheduler, joining the world, the API user. `GET /sites/<site>`'s `made_from` says which (`{template, how}`, `how` being `pool` or `copy`; none when made from nothing) |
| `GET /sites/<site>`, `GET /world` | A site's state (`creating`, `ready`, `failed`) with each step's time; the world's sites. |
| `ANY /sites/<site>/api/...` | One call to the site's own REST API, carried to web with the site's Host, as the user `Authorization: token <key>:<secret>` names. Cookies are dropped and any other credential refused; a site not ready answers `site-creating` or `site-failed`. |
| `DELETE /sites/<site>`, `DELETE /world` | Removes a site (`bench drop-site`, its archive deleted; if that fails, its database and user dropped directly), or every site of the world and its saved backups. A token of quota 0 may do it, so the sweeper can for an expired world. A ready site's removal holds only its own lock, so it never waits behind another world's site being made; a site still being made from nothing or restored is removed once its build stops. |
| `POST /world/backup {snapshot}` | Starts saving every site of the world (each must be ready) under the snapshot's name (`door/snapshots.py`) and **answers 202 `saving` at once**: `bench backup` of its database and its encryption key, in the door's registry folder; a second save of the name replaces it. Seconds per site, once the bench's other long commands let it run (it waits behind a site being made from nothing, over two minutes, which answered on the request's path outlasted Cloudflare's 100 s: HTTP 524 in PR #227's CI run 43599082569). |
| `GET /world/backup/<snapshot>` | That backup: `saving`; `saved` with each site's `{site, label, ms, bytes}`; or `failed` with `error`. One saved before the door last started is read from its folder; none answers `backup-not-found`. |
| `POST /world/restore {snapshot, api_key, api_secret, clock}` | With the source world's token in `X-Capxul-Source-Token` as well: makes every site that world saved as the snapshot again in the token's world, under the same label, and answers 202. Each is a new site from the backup (`bench new-site --source-sql`), with the backup's encryption key, joined to the new world (`capxul.world.rewrite`), set to its clock, its API user given the new credential, its scheduler on: about 8 s in the rehearsal, against about 95 s for a new site. Within the token's quota. |
| `POST /templates {template, site}` or `{template, snapshot}` | Refuses a name beginning `blank-` (`template-reserved`; so does `POST /world/claim`): those are the door's own. Makes a **template**: a copy, inside MariaDB, of a ready site of the token's world (that world built it from nothing with `POST /sites` and ran the starting world's steps), or of every site in a snapshot it saved with `POST /world/backup`. `template` is a name of up to 40 of a-z, 0-9 and `-`; packages/world names it `<starting world>-<code>-<world>` ("Bench templates never change", below); each site keeps its label. Answers 200 with `made: true` when it is made (about 3 s a site), then fills its pool in the background (`door/pool.py`). **A template never changes**: when the name exists, nothing is made and the template is answered as it is, with `made: false` and each site's `made_by`; two makes of a new name at once make it once, the second waiting for the first. Any valid token may make one: they are the bench's, not a world's, and outlive the world that made them. |
| `GET /templates` | Every whole template (the door's blank too), its sites and how many ready copies each has in the pool, when it was last used (`used_at`, `idle_s`: made or claimed from), with the last refills' times, `pool_size`, `blank_pool_size` and `blank`: the blank's name, whether it is whole (`usable`) or being made, its make's time and steps, or its last failure. |
| `POST /templates/sweep {idle_s, dry_run?}` | Removes every template last used more than `idle_s` ago (whole seconds, at least `DOOR_TEMPLATE_MIN_IDLE_S`, an hour by default; `sweep-idle-invalid` otherwise), with its pool and their databases, and skips one whose lock is held (being made, copied from with its pool empty, or refilled). Answers `{removed, kept, busy}`; `dry_run` removes nothing. packages/world's `sweep` calls it with 6 hours. |
| `DELETE /templates/<template>` | Removes a template, its pool and their databases. For a person: no run removes a template by name. |
| `GET /health` | `{ok: true, app}`: `app` is a hash of the apps the bench makes sites with (the capxul app's files, and every other app's `__init__.py`, which holds its version), read at the door's start, which a template's name fingerprints. |
| `POST /world/claim {template, api_key, api_secret, clock?, browser_core_url?}` | Gives the token's world a ready copy of every site of the template, each `<label>-<world>.<domain>`, within its quota, and **answers 200 when they are ready** (about 1.4 s a site from the pool; about 4 s when the pool is empty and the copy is made from the template on the claim's path). Each copy is joined to the world (`capxul.world.rewrite`: its world, its host name, its jobs settled on the world's time), the world's clock set when `clock` (`{frozen_at_ms}` or `{offset_ms}`) is given, its API user given the world's credential, its scheduler on, all in one process (`door/claim.py`). The site then is a site of the world like one made by `POST /sites`: Core reaches it the same way. It holds the template world's company facts (org, Safe address, hats), so the world must hold the matching chain state (a restore of the same snapshot). |
| `POST /world/save {point}` | Saves every site of the world (each must be ready) to a **point**: a copy of its database inside MariaDB with each table's checksum, its files (`public/files`, `private/files`), its site config, and once the world's entry in the bench's world clocks. About 3 s a site. A second save of the name replaces it. (`door/points.py`) |
| `POST /world/reset {point}` | Resets every site the point saved **in place** (same name, database and credential): only the tables whose checksum differs are emptied and refilled from the saved copy in one transaction, a table made since is dropped and one dropped since made again, the files put back if any differ, the site config if it differs, the site's queued jobs removed and its cache keys in Redis cleared; then the world's clock entry put back (a frozen clock reads the saved instant again). Answers 200 with each site's steps, the tables put back and `sites_not_in_point` (sites made since, left alone). Well under a second for a small site. Refuses `point-not-found`, or `point-site-missing` if a saved site is gone or not ready. |
| `Prefer: respond-async` on any call above that answers when done (`POST /templates`, `/templates/sweep`, `/world/claim`, `/world/save`, `/world/reset`, `/clock`; `DELETE /world`, `/sites/<site>`) | The call runs as a **job** (`door/jobs.py`): the door waits up to `DOOR_JOB_WAIT_S` (20 s) and then answers as the call always has (200 and its result, or its refusal and status), or **202** `{job, state: running, what, running_ms}` while it still runs. Without the header the call answers when done, as before. packages/world asks for every one of them (`src/site/call.ts`, `doorJob`). |
| `GET /world/jobs/<job>` | That job, with the same world's token: waits up to `DOOR_JOB_WAIT_S` again, then the call's own answer, or 202 while it runs. Another world's job, or one a restarted door forgot (jobs live in its memory, a finished one an hour, `DOOR_JOB_KEEP_S`), is `job-not-found`. |
| `GET /world/points`, `DELETE /world/points/<point>` | The world's points; removes one and its saved databases. `DELETE /world` removes every point of the world, `DELETE /sites/<site>` what the points saved of that site. |

The platform records `doorUrl`, where a world reaches the door: `http://<stage>-door.<domain>` through the tunnel, or,
with `PLATFORM_EDGE=none`, the host's loopback port (only the host itself reaches it).

A world's site was made, read, refused to a second world and removed through this door by `packages/world`'s `site`
proof (`packages/world/records/site.proof.json`) on the stand-in stage `pr-site`, which was then destroyed.

## Sites from a pool, and reset in place (roadmap step 1.17)

The decision "Sites from a pool" (14 November 2026) as `spikes/site-speed` measured it, built into the door:

- **Templates** (`door/templates.py`). A starting world's company sites (`packages/blueprint/src/starting-points/points.ts`:
  `founded`, `office-holder`, `payment-drafted`, `payment-held`, `paid`; their one company is Northwind, label
  `northwind`). A template world makes the starting world once by its steps and hands its sites over with
  `POST /templates {template, site}` (or `{template, snapshot}` from a saved backup). A template is a database and a
  site folder under the door's registry: the bench neither serves nor schedules it, so it never drifts. It is made
  once, never changed, and removed by age ("Bench templates never change", below).
- **The pool**. `DOOR_POOL_SIZE` (default 2) ready copies of each template site: a copy of its database inside
  MariaDB with its own user, and its folder, off the top of `sites/`, so they cost disk (about 110 MiB each) and no
  CPU. Refilled in the background after every claim, one copy at a time bench-wide.
- **Claiming**. `POST /world/claim`: the copy's folder renamed to the world's site name and one bench process to join
  it (world, host name, settled jobs, clock, API user, scheduler). An empty pool falls back to a copy from the
  template on the claim's path.
- **Points and resets in place** (`door/points.py`, `door/db.py`). `POST /world/save` and `POST /world/reset`, above.

### For `packages/world` (step 1.16, a world reset in place)

1. **Pause the world** before a save and before a reset: no Core call, no chain delivery, and the bench's scheduled
   jobs off for its sites. The door does not pause anything. A save copies a site in one transaction, so it is one
   moment of the site whatever runs; but a job that writes between a reset and the next read makes the site differ
   from the point. The proof stops the bench's scheduler and worker for this; seen without it: one of four resets
   read back a General Ledger row a background job had written.
2. `POST /world/save {"point": "<name>"}` with the world's token: 200 `{world, point, ms, sites: [{site, ms, steps}]}`.
   The point holds every site of the world and the world's clock entry. Name it after the snapshot it belongs to.
3. `POST /world/reset {"point": "<name>"}`: 200 `{world, point, ms, sites: [{site, ms, steps}], clock: {entry, ms},
   sites_not_in_point}`. Each site's `steps` say which tables were put back (`tables_changed`, `tables_dropped`,
   `tables_made`), whether its files or site config were (`files_put_back`, `site_config_put_back`), and how many
   queued jobs and cache keys went (`jobs_removed`, `cache_keys_cleared`). A site made after the save is listed in
   `sites_not_in_point` and left as it is; remove it with `DELETE /sites/<site>` if the world must not hold it.
   Refusals: `point-invalid` (400), `point-not-found` (404), `point-site-missing` (409, a saved site gone or not
   ready), `point-site-changed` (409, the site has another database than when it was saved).
4. The world's clock entry is put back as saved. A frozen clock reads the saved instant again. A running clock gets
   its saved offset and rate back, so it reads the host's now plus that offset, not the instant of the save; freeze
   the clock before saving to come back to an exact instant, or set it after the reset with `POST /clock`.
5. Points go with `DELETE /world`; `GET /world/points` and `DELETE /world/points/<point>` list and remove them.

### What runs at once, and what still waits

| Work | Holds | So |
|---|---|---|
| Claim, save, reset of a site | that site's lock and one of `DOOR_FAST_SLOTS` (default 4) | Different sites, of one world or many, run at once, up to 4; the same site's calls queue |
| Template made, claim with the pool empty, pool refill, sweep of that template | the template's lock | Copies from one template are made one after another; claims from the pool do not wait for them; a sweep passes over a template whose lock is held. A claim marks its template used under the lock first, so a sweep never removes one being claimed from |
| Refill | one bench-wide refill lock | One pool copy is made at a time, so refills never take more than one MariaDB copy's worth of the machine |
| New site from nothing, restore from a backup, `bench backup` | `BENCH_LOCK`, as before | Still one at a time across the bench (each runs bench commands for up to a minute or more), and each runs **off the request's path** (202, then a status call), so none holds a call through Cloudflare's edge, whose limit is 100 s; claims, saves, resets and removals do not wait for them |
| Removal of a site (`bench drop-site`) | that site's lock and one of `DOOR_FAST_SLOTS`; `BENCH_LOCK` too only for a site still being made from nothing or restored | A removal never waits behind another world's long command (it used to, and so could outlast the edge's 100 s) |
| Registry changes, quota checks | `REGISTRY_LOCK`, as before | Held for milliseconds |

Three claims at once took 1.5, 1.6 and 4.9 s (two from the pool, one copied with the pool empty), and two resets at
once 0.25 s each. Removing a site still goes through `bench drop-site` (about 2 s).

### A backup and a removal never hold a call through Cloudflare's edge (14 November 2026)

PR #227's CI run 43599082569 failed with HTTP 524 on `world.snapshot.save`: a second `world.yml` run built its
template world's site from nothing on `staging` at the same time, and `POST /world/backup` waited on the request's path
for `BENCH_LOCK` past Cloudflare's 100 s (the CI run 43599154936 beside it failed the same way). The backup now runs in
the background (`GET /world/backup/<snapshot>` for its state) and a ready site's removal no longer takes `BENCH_LOCK`.
`records/backup-async/` measured both doors, this one and the one before, on a stand-in bench (`prove.py`: the real
`door/door.py`, `bench` replaced by `bench-stand-in.sh`, whose `new-site` of another world's site holds the bench lock
for 130 s), with packages/world's own client saving the world (`save.ts.txt`):

| Call, while another world's site is made from nothing | Door before | This door |
|---|---|---|
| `POST /world/backup` | 200 after 132.2 s (Cloudflare answers 524 at 100 s) | 202 `saving` after 2 ms |
| `DELETE /sites/<ready site>` | 200 after 130.5 s | 200 after 1.0 s |
| packages/world's save (`backUp`: the POST, then `GET` until saved) | 131.4 s, one call held throughout | 130.3 s, no call over a second |

Not run on `staging`: the door changes there only when `platform.yml` deploys it. Until then packages/world's save
still takes the old door's answer.

### No call holds a request past Cloudflare's edge (14 November 2026)

Four `world` runs at once on `staging` met HTTP 524 on a reset's claim: with four runs building, claiming, saving and
resetting, a claim, a save or a reset waits for one of `DOOR_FAST_SLOTS` and behind joins slowed by a busy machine,
on the request's path. Every such call can now run as a job (above): no request is held longer than the door's
20 s wait, and the work takes as long as it did. The door's unit tests (`door/tests/test_jobs.py`) drive the real
door over HTTP. `records/capacity/` measured the door before and this one on a stand-in bench as busy as `staging` was,
every time a tenth of the bench's (one FAST slot for four runs, a claim's join 4 s, Cloudflare's 100 s as 10 s, the
door's 20 s wait as 2 s), four runs at once, each making its site, keeping a template, saving, removing, claiming,
saving, resetting, setting its clock and taking its world down (`prove.py`):

| | Door before, asked as before | This door, `Prefer: respond-async` | This door, asked as before (an old client) |
|---|---|---|---|
| Longest request | 16.0 s: a claim, and 12.0 s a save, past the edge (524 through Cloudflare) | 2.0 s | 4.0 s (one run) |
| Every call ended well | yes, on this machine; not through Cloudflare | yes | yes |
| The four runs, whole | 50.4 s | 50.4 s | |

packages/world's own client (`client.ts.txt`) ran two worlds at once against each door: every call ended well on
both, a claim taking 5.0 s through a job on this door and 4.0 s held open on the old one (`client.json`).

### Bench templates never change (14 November 2026)

Two CI `world` runs at once broke each other on `staging`: templates were named after their starting world
(`payment-drafted`) and any run replaced them and dropped them at its end, so one run dropped `payment-drafted` while
another was about to claim from it ("the bench keeps no template payment-drafted to claim them from"), and `world.yml`
ran one at a time. The decision (docs/roadmap.md, "Bench templates never change"), as built:

- **Named by what it holds.** packages/world names a template `<starting world>-<code>-<world>` (its
  `src/site/Templates.ts`): `code` fingerprints the code that makes it (the blueprint's starting worlds, Core, the
  world package and the runner's makers) and the bench's apps (`GET /health`'s `app`), and `world` is the world whose
  sites it copies. The world is in the name because a template's sites hold that world's company facts (the org id
  Core drew at random, the Safe minted under it, its approvals' and payments' ids): a copy claimed into another world
  answers `org-not-here` for that world's company. So a template can only serve the world that made it, and two runs
  never ask for the same one.
- **Made once, then only copied from.** The door makes a template in `<template>.making` and renames it into place
  once whole; a make of a name that exists makes nothing (`made: false`), and two at once make it once. packages/world
  refuses a template another world made. A half-made one left by a door that stopped is removed at its start.
- **No run removes one.** The runner no longer drops its templates at its end. packages/world's `sweep`, which
  `world.yml` runs after every run, asks the door to remove those unused for 6 hours (`POST /templates/sweep`); a
  claim marks its template used, and the sweep skips one whose lock is held.

`records/templates/` proves it on a stand-in bench (`run.sh`: the real `door/door.py`, `bench` replaced by
`records/backup-async/bench-stand-in.sh`, pymysql and the bench's Python by `stand-in/`, so no MariaDB), with two runs
A and B at once doing at the door what the runner does with its one world's site: made from nothing, kept as a
template, removed by a reset to `fresh`, claimed back by a reset to `payment-drafted`:

| | The door before, templates named after the starting world (`old-door.json`) | This door and naming (`new-door.json`) |
|---|---|---|
| B keeps its template while A is going | replaces A's `payment-drafted` | makes `payment-drafted-3f9a0c1d-wb`; A's `…-wa` untouched |
| A claims its site back | 200, a copy of **B's** site (B's company facts in A's world) | 200, a copy of its own |
| A's run ends | drops `payment-drafted` | drops nothing |
| B claims its site back | **404 `template-not-found`**: the failure seen in CI | 200, a copy of its own |
| Two makes of one new name at once | | one made (`made: true`), the other answered with it (`made: false`, the same database) |
| Another world makes a name that exists | | nothing made, answered with the first world's (`made_by`), which packages/world refuses |
| Sweeps (floor 2 s for the proof) | | `idle_s` 1 refused; idle 30 s removed nothing (one template busy refilling its pool); after a claim, idle 3 s removed the two unused and kept the one just claimed from; 3 s later removed it |

`records/templates/client.json` is packages/world's own client against the same door: `templateCode` read the door's
`app` and fingerprinted the code in under 0.1 s; `keepTemplate` made `payment-drafted-<code>-wd`, answered `made: false`
the second time, and failed for world `we` ("made by world wd, not we"); `sweepTemplates` kept it at once and removed
it 2.5 s later with `WORLD_TEMPLATE_IDLE` at 2 seconds.

Not run on `staging`: the door changes there only when `platform.yml` deploys it. Until then the runner's new names
already keep runs apart on the door there (a door that replaces a name nobody else uses changes nothing), but that
door neither refuses a second make nor sweeps (packages/world's sweep says so in its report and goes on), so templates
stay on the bench until it is deployed and the next sweep runs. Not measured: how many runs at once the bench holds;
each still makes its company site from nothing, one at a time across the bench (`BENCH_LOCK`, two to three minutes).

### Blank company sites (14 November 2026)

Four `world` runs at once on `staging` timed out waiting for their company sites: each run's `org.create` asks the door
for a site when its approval lands (packages/core, `src/organizations/site.ts`), and the door made each from nothing
under `BENCH_LOCK`, one at a time, 2 to 4 minutes each, so the fourth waited behind three ("waited ten minutes for
world.show to list northwind's site as ready"; a reset that restores sites past its 5 minutes). `door/blank.py` takes
that build off every run's path. The door's API, Core and packages/world are unchanged:

- **One blank per app fingerprint.** `blank-<app>`, where `<app>` is `GET /health`'s `app`: a site with ERPNext, HRMS
  and capxul installed and migrated and no company (the wizard not run), kept as a template (`templates.py`: never
  served, never changed). The door makes it in the background at its start, once `BENCH_LOCK` is free (it never jumps
  a queued build), under a site name no request can reach (`blank-<app>.invalid`), then moves it under the registry. A
  blank of another fingerprint is never copied and is removed at the door's start, so a deploy of new apps makes a new
  blank. The sweep keeps blanks (in `kept`, with `blank: true`); no world may make or claim one.
- **Kept warm.** `DOOR_BLANK_POOL_SIZE` (default 4) ready copies, refilled by `pool.py` after every use, one copy at a
  time bench-wide, as every template's pool is.
- **A company's site** (`POST /sites`): a ready copy renamed to the site's name, or with the pool empty a copy made
  from the blank on the build's thread (about 3 s); an encryption key of its own when its database holds nothing
  encrypted yet; then one Python process of the bench: the setup wizard with the company, every app's `after_migrate`
  hooks (what the old build's `migrate` after the wizard ran), joining the world, the API user, the scheduler. It holds
  the site's lock and one of `DOOR_FAST_SLOTS`, not `BENCH_LOCK`. Core then delivers `configure` (company and Safe),
  the clock, grants and capital as before.
- **Never worse.** With no blank of this fingerprint, a company waits for one being made (up to `DOOR_BLANK_WAIT_S`,
  900 s) and otherwise is made from nothing, as before; if one is made while it waits for `BENCH_LOCK`, it is used
  after all. A blank that failed is tried again only after `DOOR_BLANK_RETRY_S` (1800 s), and `GET /templates` says why.

`records/blank-sites/` measured four companies made at once (`run.sh`: the real `door/door.py` at `origin/master` and
this one; `bench`, the bench's Python and pymysql stood in, each command taking the time the same step took on a real
bench in `records/site-pool/01-template-source.json`, a tenth; two CPUs, each bench process holding one; a database
copy 3.3 s, a tenth). Times below are the stand-in's, times ten:

| Four companies at once, time to ready | Door before (`old-door.json`) | This door, warm (`warm.json`) | Pool of 2 (`pool2.json`) | Asked as the door starts (`cold.json`) |
|---|---|---|---|---|
| How each was made | from nothing, one at a time | 4 from the pool | 2 from the pool, 2 copied | 4 copied from the blank once made |
| Fastest, slowest | 139 s, 554 s | 30 s, 58 s | 30 s, 58 s | 154 s, 184 s |
| Mean | 346 s | 44 s | 44 s | 169 s |

The blank was made in 118 s and its pool of 4 was full 13 s later (`warm.json`, `warm_up`). Every company was ready,
and each world was then removed. The unit tests (`door/tests/test_blank.py`) cover a pooled copy, an empty pool, no
blank (made from nothing), a failed blank, a blank of other apps, two companies at once with one ready copy, the blank
waiting for an idle bench while a company waits for it, the refill to its own size, and the reserved names.

Not measured: a real bench. The configure process is charged what the steps it still runs took when a site was made
from nothing (27.8 s, `migrate` counted whole), and the stand-in neither runs Frappe nor slows the bench's other work.
Not run on a real bench: the configure process itself (the wizard and the `after_migrate` hooks in one process, in
place of `bench execute` and `bench migrate`), a copy getting its own encryption key (the stand-in's MariaDB answers no
rows, so the copies kept the blank's), and the blank's disk (one site's database and folder, plus 4 copies, about
110 MiB each). Copies of a blank share its Administrator password, random and never kept, as copies of a template do.

### What is proven, on a local bench

`proof/prove.py`, against `bin/pool-bench.sh`'s bench (the containers `src/bench.ts` declares, MariaDB with
`src/mariadb.ts`'s settings, from the images `cx-platform-bench:pr-sr1` and `cx-platform-door:pr-sr1` already on the
machine, this checkout's door and capxul app mounted in), on 14 November 2026: **passed**
(`records/site-pool/pool.proof.json`, a part a file beside it). A Claude cloud container with 4 CPUs and 15.7 GiB
that other agents shared; **not the AWS bench host**, which cannot be reached yet.

| Part | Measured | Record |
|---|---|---|
| Template world's site from nothing (`POST /sites`), then `founded`'s company setup | 138.1 s (new-site 22.2 s, ERPNext 50.1 s, HRMS 33.8 s, wizard 16.9 s, migrate 8.2 s), setup 3.2 s | `01-template-source.json` |
| Template `founded` made from it | 2.9 s; the pool of 2 full 7.0 s later (refills 3.3 s and 3.0 s) | `02-template.json` |
| Claims: three at once, then one alone | 1.53 s and 1.55 s from the pool and 4.90 s copied (pool empty), at once; 1.31 s from the pool alone. Of a pooled claim, the folder rename is 0 ms and the join process the rest | `03-claim.json` |
| The three site operations through the door, 3 rounds on each site | doc.create 25 to 184 ms, doc.submit 49 to 296 ms, report.run 15 to 393 ms (the first call of each site the slowest) | `04-operations.json` |
| Save to a point | 3.0 to 3.7 s a site (copy 2.9 to 3.7 s, checksums 57 to 68 ms) | `05-save.json` |
| Reset in place after 3 Journal Entries, a file, a clock change and a queued job | 0.08 to 0.25 s a site, two one after another and two at once: 7 tables put back, the file gone, 1 job removed, 584 cache keys cleared, the clock back; each site's state read over HTTP equal to the saved one | `06-reset.json` |
| A second change (5 entries) and reset of one site to the same point | 0.12 s, equal again | `07-reset-again.json` |
| Every world, point, template and pool copy removed | no site folder and no database left but MariaDB's own | `08-cleanup.json` |

Against the spike: the claim is 1.3 to 1.6 s, not 1.1 s. The join now also settles the site's scheduled jobs on the
world's time (`capxul.jobs.settle_jobs`, added after the spike), inside `capxul.world.rewrite`; the parts of the join
were not timed apart. Resets are faster than the spike's 0.5 s, with MariaDB's caches sized for many sites
(`src/mariadb.ts`) and the saved copy's checksums taken once, at the save.

### Not done

- **Jobs are not on `staging` until `platform.yml` deploys the door**; until then packages/world's long calls get the
  old door's answer, held open as before. Not measured: how long claims, saves and resets wait on `staging` with four
  runs at once, and the bench itself: sites made from nothing are still one at a time (`BENCH_LOCK`, 2 to 4 minutes
  each), so four runs' first builds queue for up to about 15 minutes, which a run's `site` step (8 minutes) and the
  runner's 10-minute wait for a site can still exceed. Blank company sites (above) take that queue away once
  `platform.yml` deploys this door; until then `staging` makes every company site from nothing.
- A deploy of the platform with these door calls, and the AWS bench host: the door image is built by
  `CapxulPlatform` (`door/Containerfile` copies every module), not rehearsed here; the proof mounted the code into
  the existing images.
- Callers: `packages/world` claims nothing yet, and makes, saves and resets no template or point (steps 1.12 and
  1.16); the runner makes no template world (1.18).
- A world's sites at a template are the template world's company facts (org, Safe address, hats): the world must
  hold the matching chain state, which a world restored from the same snapshot does.
- Not put back by a reset: a table's schema changed since the save (a migrate in between), a job already running,
  and Frappe's own 60 s cache of a site config (the reset writes the config only when it differs).
- Templates are the bench's: any valid token may make one or sweep them, and nothing stops a token's holder from
  removing one with `DELETE /templates/<template>`. Tokens are minted only by holders of the door key.
- A long pause of the world is not the door's job: it does not stop the scheduler for a world's sites.

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
POOL_SECRETS=<file outside the repo> bin/pool-bench.sh up   # a local bench for the site pool (step 1.17)
POOL_SECRETS=<same file> python3 proof/prove.py         # its proof, records into records/site-pool/; then bin/pool-bench.sh down
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
| The bench is the light image (Frappe, ERPNext, HRMS, capxul), not the hosted six-app image of `packages/bench-image` | HRMS was added for the thin line's payroll report (report.run 2), each pinned in `packages/bench-image/apps.lock.json`; moving to the hosted image is a change of `src/bench.ts` and `bench/` |
| MariaDB on its defaults keeps 400 table definitions and 421 open tables, against 926 tables a site, so its caches churn with a few sites (spikes/site-speed) | `src/mariadb.ts` starts it with 20,000 definitions, 10,000 open tables and a 1 GiB buffer pool, each with its reason (`test/mariadb.test.ts`); a deploy with the new flags recreates the MariaDB container on its same volume. Not yet measured on a bench |
| Sites under `worlds.abuusama.dev` are two levels under the zone, outside the free certificate | HTTP only until real worlds move to `capxul.com` (roadmap, "Test addresses"); a token sent to the door through the tunnel travels in clear until then |

| File | What |
|---|---|
| `alchemy.run.ts`, `host.run.ts` | The platform's stack and the bench host's |
| `src/names.ts`, `src/stage.ts` | Every name, from the stage |
| `src/host.ts`, `src/aws.ts`, `src/user-data.ts` | The machine: the Docker context, the AWS resources, the first boot |
| `src/bench.ts`, `src/mariadb.ts`, `bench/`, `door/`, `src/edge.ts` | The bench, its MariaDB's settings, its image, the site door (`door.py`; `sites.py`, `snapshots.py`, `templates.py`, `pool.py`, `blank.py`, `claim.py`, `points.py`, `db.py`, `jobs.py`; unit tests in `door/tests/`, `pnpm door:test`), the tunnel and DNS |
| `src/token.ts`, `src/state.ts`, `src/door.ts`, `src/run-mint.ts` | Site tokens, the door key from the state, the package's door |
| `src/drift.ts`, `src/code-drift.ts`, `src/run-drift.ts`, `src/run-inventory.ts` | The drift check and the state inventory |
| `bin/` | `run.sh` (settings), `forward.sh` (SSM), `require.sh` (CI), `rehearse.sh` and `rehearse-drift.sh`, `zone.sh`, `pool-bench.sh` |
| `bootstrap/` | CI's access: `bootstrap.sh`, `bootstrap.run.ts`, `src/aws-policy.ts`, `src/cloudflare-policy.ts`, `BOOTSTRAP.md` |
| `proof/`, `bin/pool-bench.sh`, `records/site-pool/` | The site pool's proof on a local bench, and its records |
| `records/backup-async/`, `records/templates/`, `records/capacity/`, `records/blank-sites/` | Proofs on a stand-in bench (the real door, `bench` and MariaDB stood in): the background backup, two runs at once sharing the bench's templates, four runs at once with long calls as jobs, and four companies at once made from the blank |
| `records/rehearsal/` | The stand-in rehearsal of this package: transcripts, drift reports, `summary.json` |
| `records/aws/` | The AWS path from here: the platform's plan for `staging`, and the host's plan stopping at AWS's sign-in |
| `records/spike/` | The spike's run, moved here when the spike was deleted |
