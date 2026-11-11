# What the hosted bench runs

Draft, 10 November 2026. Nothing was built or run. Read from the spike: `spikes/skeleton/frappe/compose.yml`,
`bin/up.sh`, `bin/new-site.sh`, `bin/add-app.sh`, `docker/entrypoint.sh`. Everything else is an estimate or must be
checked against current `frappe_docker` documentation before use.

## What the spike does that a hosted machine must not

| Spike (read) | Hosted machine |
|---|---|
| `frappe/bench:latest`, a development image, built on first run (10-25 minutes, `bin/up.sh`) | A custom image built once, pinned by digest |
| `bench start --no-dev`: the development process manager, one container for web, worker and scheduler | One container per process, restart policies, health checks |
| Port 8000 published, `host.docker.internal`, `.localhost` sites | Nothing published; one origin proxy on 443 |
| MariaDB root password `123`, admin password `admin` (`compose.yml`, `lib.sh`) | Generated, in `/etc/capxul/env/sites/*.env`, mode `0600` |
| `capxul` app mounted from the repository and linked into the bench | `capxul` built into the image from its repository |
| `mariadb:11.8`, one Redis with three databases | Same MariaDB major (verify), two Redis instances (cache, queue) |

## The image

Built the way `frappe_docker` builds a custom image: an `apps.json` listing the apps and a Containerfile build with the
base arguments (Frappe branch, `APPS_JSON_BASE64`). Do not run now.

```jsonc
[
  { "url": "https://github.com/frappe/erpnext", "branch": "version-16" },
  { "url": "https://github.com/frappe/hrms",    "branch": "version-16" },
  { "url": "https://github.com/frappe/crm",     "branch": "<verify: the spike's add-app.sh takes the branch as an argument>" },
  { "url": "https://github.com/<owner>/<capxul app repository>", "branch": "<release branch or tag>" }
]
```

`version-16` is read from `compose.yml` (`FRAPPE_BRANCH`). The CRM branch and the app repository are not in the spike
as fixed values. The `capxul` app repository is probably private: pass access as a build secret or a deploy key. Never put
a token in `apps.json`, because `APPS_JSON_BASE64` is recorded in image history. Tag the image by commit; deploy by digest.

## Services (one bench, several worlds)

Per bench, from `frappe_docker`'s compose layout (verify names):

| Service | Purpose |
|---|---|
| `configurator` (one-shot) | writes `common_site_config.json`: DB host, two Redis URLs, socket port |
| `backend` | gunicorn |
| `frontend` | nginx; picks the site from the `Host` header |
| `websocket` | the socket server |
| `queue-short`, `queue-long`, `queue-default` | background workers |
| `scheduler` | scheduled jobs |
| `mariadb` | `capxul-mariadb`; not published; character set `utf8mb4` as in the spike |
| `redis-cache`, `redis-queue` | queue persistent (append-only), cache not |
| `origin` | Caddy on 443 with the private origin certificate; routes by Host to `frontend`, or to a world's service |

Per world (created by a command, like a company):

| Service | Purpose |
|---|---|
| `capxul-chain-<w>` | that world's local test chain, own state directory, own clock rate |
| `capxul-service-<w>` | the Capxul service for that world; runs `bench new-site` for its companies using the same image and the sites volume; also holds the clock and the record writer |

`origin` can route per world because the world is the hostname suffix (`*-w7.<base>`), see `ingress.md`.
Several worlds share one bench: the site folder is `<company>-<world>.<base>`, and `world.json` is the registry.

## Where data lives (cloud convention: `/srv/capxul/volumes`, `/etc/capxul/env`)

| Path | Contents |
|---|---|
| `/srv/capxul/volumes/capxul-mariadb-data` | MariaDB |
| `/srv/capxul/volumes/capxul-sites` | the bench `sites` folder: every site, `common_site_config.json`, `apps.txt` |
| `/srv/capxul/volumes/capxul-redis-queue-data` | queue |
| `/srv/capxul/volumes/capxul-worlds/<w>/` | `world.json`, `clock.json`, `chain/`, `record/`, `snapshots/` |
| `/srv/capxul/sites-host/` | the Compose file and origin config |
| `/etc/capxul/env/sites/{mariadb,bench,service}.env` | secrets, mode `0600`, placed by an install script that refuses to overwrite (the pattern of `install_infisical.py` in `deploy/tools/infisical.md`) |

Named volumes in the spike become bind directories, as everywhere else in the cloud, so `backup.py`-style tar works.

## Rolling out a new image

All sites on one bench run the same code. There is no per-site code version on one bench. Therefore:

1. Build and test the image locally (list below). Publish by digest.
2. Rehearse: restore the latest backup into the restore-check environment with the new image and run the migration on
   every restored site. Nothing live is touched.
3. Take a fresh backup (`backup.md`).
4. Pause worlds one at a time at the clock, put that world's sites in maintenance mode, and stop the bench containers.
5. Start the new containers. For each site run the migration (below). Resume the world.
6. Smoke test each world (one login, one page, one scheduled job).
7. Roll back by restoring that world from step 3 with the old digest. There is no safe downgrade of a migrated database.

Order of worlds: the least important world first, as a canary. Real downtime per world is the migration time of its sites;
estimate 1-3 minutes per site (unmeasured). Worlds are simulated, so pausing the clock means no one is affected.

If one bench must update without pausing others (second phase, perhaps never on the worlds machine): run a second bench
stack beside the first, migrate world by world on it, and move each world's suffix route in `origin` from the old stack to
the new one. This needs separate Redis queues and the scheduler paused per site on the stack that does not own it.
Do not build it until needed. A real-time company is a second machine with the same images (the owner's plan), so its
rollout is independent.

## Running `bench migrate` across sites

Per site, one at a time or two in parallel, never `--site all` blindly:

```bash
bench --site <site> set-maintenance-mode on
bench --site <site> migrate
bench --site <site> set-maintenance-mode off
```

driven by a small loop over the sites in `world.json`, stopping on the first failure and printing the site name, with a
receipt per site (image digest, duration). A failed site stays in maintenance mode and the world stays paused.
Migrations also run when `capxul` changes a Doctype, so they are part of every image roll, not only Frappe upgrades.

## Build and test locally before the machine is created

1. The image builds from `apps.json` in a clean build, with the private repository accessed by secret.
2. `docker compose up` of the hosted layout (not the spike's): every service healthy with nothing published except 443 on the origin.
3. Create two sites in two worlds on one bench. Open both through the origin using a local name like `acme-w1.localhost`.
   Check that each site's `host_name` is `https://...` and that login, websocket and file upload work behind the proxy
   (Frappe uses the forwarded protocol header: verify the origin proxy passes it).
4. `bench new-site` runs from the `capxul-service-<w>` container (same image, no Docker socket on the service).
5. Assets after an image change. A named or bound `sites` folder hides the assets baked into the image; check that assets
   are present and current after an upgrade, and add a copy-assets step to the start-up if not.
6. The migration loop above across two worlds' sites, including a deliberate failure.
7. Backup and restore check against the local stack (`backup.md`), including pause and resume of a world.
8. Memory: run the layout with ten sites in three worlds and read `docker stats`; replace the estimate below.
9. The origin certificate chain and strict verification from a Traefik container with `rootCAs` (the controller's setup).

## Memory budget (ESTIMATE: nothing measured; ten small sites, three worlds, 16 GiB machine)

| Part | One bench for all worlds | One bench per world |
|---|---|---|
| MariaDB (buffer pool about 2.5 GB; ten sites mean tens of thousands of tables) | 3.0 GB | 3.0 GB (shared) |
| Per bench: backend 1.2, workers 1.05, scheduler 0.3, websocket 0.15, nginx 0.05, Redis pair 0.65 | 3.4 GB x 1 | 3.4 GB x 3 |
| Per world: chain 0.25, service 0.35 | 0.6 x 3 = 1.8 GB | 1.8 GB |
| Ten sites' working set above the bench baseline (0.05 each) | 0.5 GB | 0.5 GB |
| Origin proxy, operating system, Docker | 0.9 GB | 0.9 GB |
| **Total** | **about 9.6 GB** | **about 16.4 GB** |
| Headroom for a migration spike or a build | about 6 GB | none (does not fit) |

One world on one bench is about 8 GB. A bench per world fits only one or two worlds on this machine, but isolates
rollouts and lets one world run a different image. **Recommend one bench for all worlds**; if worlds need independent
images, give those worlds their own machine. Swap is 4 GiB (`template.yaml`) as a safety net, not as capacity.
