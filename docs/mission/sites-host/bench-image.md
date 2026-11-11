# The bench image: what is proven, what remains before the machine

11 November 2026, a cloud thread (task `m3b-bench-image`, decision `sites.bench-image`). The image and its check are in
`packages/bench-image`; this note is what the draft `compose.md` called "build and test locally", measured.

## Proven in a cloud container

- **The image builds from pinned inputs.** `apps.lock.json` pins the frappe/build and frappe/base images by digest, and
  Frappe v16.54.0, ERPNext v16.54.0, Frappe HR v16.53.2, Frappe CRM v16.0.2 and `frappe_whatsapp` 1.0.12 by commit;
  the build refuses any other commit. The capxul app is copied from this repository (no token). Cold build: 469 s on 4
  CPUs; a rebuild after a change to the runtime stage only: seconds. Image: 6.4 GB unpacked, 1.3 GB compressed.
- **The hosted layout runs.** One container per process (gunicorn, two workers, scheduler, socket server, nginx),
  MariaDB 11.8, a cache Redis without persistence and a queue Redis with append-only. Only nginx is published, on
  loopback. Secrets are generated once; only the site-admin container holds the database root password.
- **`bin/check.sh` passes 22 of 22** from wiped data (276 s, including site creation), and again on the existing site
  (60 s): every service healthy; the six apps on the site; the manifest equals the pins; gunicorn, no development
  server, developer mode off; ping, sign-in, wrong password refused, unknown host 404; desk, its built stylesheet, the
  capxul script and the CRM served through nginx by Host header; a capxul method as the signed-in person; the socket
  handshake; a job on each queue runs; the scheduler on; nothing reports outward; a restart of every container keeps
  the site and its assets.
- **The running bench needs no outbound network.** Its containers are on Docker's own network, not the host's, and
  cannot reach the cloud container's proxy. Everything above passed that way.
- **Idle memory** after a restart, one site: MariaDB 128 MiB, backend 99 MiB, websocket 57 MiB, each worker and the
  scheduler 41 MiB, nginx and both Redis about 5 MiB each. Idle numbers only. The estimate in `compose.md` is for load
  and ten sites, and is still unmeasured.

## Found on the way

- **The capxul app's migrate hooks need a site that has been through the setup wizard.** `capxul.brand.apply` saves
  System Settings, which refuses without a time zone, so `bench migrate` fails on a bare site. The test sites never saw
  this because `configure_site` runs the wizard first. `bin/new-site.sh` runs `capxul.setup.run_wizard` before
  migrating. The app should either skip these hooks until setup is complete, or the site service must always run the
  wizard first. This belongs to the app's graduation (`m2-graduate-spike`).
- `bench new-site` on v16 installs every app in `apps.txt`, so "every app on every site" (`sites.features-reachability`)
  comes for free; `new-site.sh` still installs any missing app, so it is safe to re-run.
- The desk moved to `/desk` in v16; `/app` now redirects there.

## What remains before it runs on the machine

In the order they block:

1. **The end-to-end script against this image.** The task's "done when" includes it. `spikes/skeleton/run.sh` drives
   the development bench (`docker compose exec bench`, port 8000, Core at `host.docker.internal:8787`). Pointing it at
   this layout means the site scripts run through `site-admin`/`backend` and the site's Core URL is set by the site
   service. Do this once the app and the scripts have moved into packages (`m2-graduate-spike`), not in the spike.
2. **How the image reaches the machine.** There is no registry, and this thread made no account or key. Options: build
   on the machine from a commit of this repository (needs read access to the repository there); copy the image
   (`docker save`, then load and compare the digest); or push to GitHub's registry (needs a token that can write
   packages). Recommended: copy by digest from wherever it was built and checked, so the machine runs exactly the image
   the check passed. Building on the machine gives a different digest.
3. **The origin proxy in front of nginx** (`compose.md`, `ingress.md`): Caddy on 443 with the origin certificate,
   routing `*-<world>.<base>` to `frontend`, passing `X-Forwarded-Proto` and `X-Forwarded-For`; set
   `CAPXUL_UPSTREAM_REAL_IP` to the proxy's address and `CAPXUL_SITE_SCHEME=https`. Then recheck sign-in, the socket and
   file upload behind it.
4. **Machine paths and secrets.** `CAPXUL_VOLUMES=/srv/capxul/volumes`, `CAPXUL_ENV_DIR=/etc/capxul/env/sites`, made by
   an install script that refuses to overwrite (`bin/env.sh` already behaves this way). Add the sites folder and a
   MariaDB dump to the nightly backup, and run the restore check (`backup.md`) with this image.
5. **The site service creates sites.** On the machine, `site-admin`'s job (new site, wizard, migrate, scheduler) is the
   site service's, with the same image and sites folder, plus `configure_site` (Company, Safe bank account, sign-in key,
   Core URL) and joining the world's clock.
6. **The rollout drill** from `compose.md`: two worlds on one bench, the migration loop including a deliberate failure,
   assets after an image change (relinked at every start, as the check shows), then ten sites in three worlds under
   `docker stats` to replace the memory estimate.
7. **Smaller items.** Memory limits and log rotation for each service. The database root password and the admin
   password pass as arguments to `bench new-site` inside the site-admin container, so they are visible in that
   container's process list while it runs. The image could shrink by dropping front-end `node_modules` once the socket
   server's needs are known. The pins need a weekly bump: change `apps.lock.json`, rebuild, run the check. The CRM's
   AGPL notice for a hosted product is still a lawyer's question (`sites.names-only`).
