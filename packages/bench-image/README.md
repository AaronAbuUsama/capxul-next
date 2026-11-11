# bench-image

The image the hosted bench runs, and the proof that it serves a production site (task `m3b-bench-image`, decision
`sites.bench-image`). It replaces, for hosting, the development bench the test sites use (`spikes/skeleton/frappe`):
same apps, but pinned, built once, and run as separate production processes.

```bash
packages/bench-image/bin/build.sh capxul-bench:dev     # build (about 15 minutes cold); writes var/bench-image/image.json
packages/bench-image/bin/check.sh                       # start the bench, create check.localhost, run the checks
packages/bench-image/bin/down.sh --wipe                 # stop, and delete the local data and secrets under var/
```

In a Claude cloud container start Docker first (`packages/devnet/cloud/setup.sh` does it, or `sudo dockerd`) and build
with `CAPXUL_BUILD_CA=/root/.ccr/ca-bundle.crt`: the proxy inspects TLS, so the build must trust its CA. The CA is a
build secret and never enters the image. The running bench needs no outbound network at all.

## What is in it

| File | What |
|---|---|
| `apps.lock.json` | Every input, pinned: the frappe/build and frappe/base images by digest; Frappe, ERPNext, Frappe HR, Frappe CRM and `frappe_whatsapp` by commit. The capxul app comes from this repository |
| `Containerfile` | Builder stage (runs `resources/build-bench.sh`), then the runtime stage on frappe/base with the bench copied in |
| `resources/build-bench.sh` | `bench init` at the pinned Frappe, each app fetched at its commit (refused if the commit differs), the capxul app copied in, `bench build --production`, `capxul-image.json` written, git history and caches removed |
| `resources/entrypoint.sh` | Links the image's assets into the sites folder at every start, so a new image serves its own assets |
| `resources/start-web.sh` | gunicorn, the web process |
| `compose.yaml` | The hosted layout, one container per process: `configurator` (one-shot), `backend`, `websocket`, `queue-short`, `queue-long`, `scheduler`, `frontend` (nginx, the only published port, on loopback), `mariadb`, `redis-cache`, `redis-queue`; `site-admin` (profile `admin`) is the one container with the database root password |
| `bin/build.sh` | Builds the image; uses the host network and the proxy variables when `HTTPS_PROXY` is set |
| `bin/env.sh` | Makes the secrets folder once (`mariadb.env`, `bench.env`, mode 0600); never overwrites |
| `bin/up.sh`, `bin/down.sh` | Start (makes the data folders on first run) and stop |
| `bin/new-site.sh` | Creates a site with every app, migrates it (the names and privacy hooks run), turns the scheduler on; safe to re-run |
| `bin/check.sh` | The proof, below. Writes `var/bench-image/check.json` |

`CAPXUL_APP_DIR` points the build at the capxul app. By default it is `packages/frappe-app` (the app's package, from
`m2-graduate-spike`), or the spike's copy while that package has not landed.

## What the check proves

`bin/check.sh` starts the bench from nothing, creates `check.localhost` and checks it the way a browser reaches it,
through nginx with the site picked from the Host header:

- every service starts and is healthy; the site has the six apps; the image's manifest names exactly the pinned commits;
- the web process is gunicorn, there is no development server, the workers and the scheduler run, developer mode is off;
- ping answers; an unknown host gets 404, not another company's site; Administrator signs in with the generated password
  and a wrong one is refused; the desk, its built stylesheet, the capxul app's own script and the CRM front end are
  served; a capxul method answers as the signed-in person; the socket server answers its handshake;
- a job on the short queue and one on the long queue run and return; the scheduler is on for the site;
- nothing reports outward (`sites.privacy`): telemetry, the update check, the CRM's first-run screen and enrichment are off;
- after a restart of every container the site still answers and its assets are still served.

## Before it runs on the machine

See `docs/mission/sites-host/bench-image.md` for what is still to do before the sites machine runs this image.
