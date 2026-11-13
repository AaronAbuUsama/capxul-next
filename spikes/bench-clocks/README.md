# Bench clocks spike

Throwaway code that answers one open risk of the rebuild line (roadmap step 0.8): **can two worlds at different clocks
share one Frappe bench?** A world is every company on one chain, with one clock. Each company has one Frappe site. Many
worlds' sites are meant to live on one bench: one set of Frappe processes, one MariaDB, one Redis. Nothing here is
product code, and `packages/frappe-app` is not changed.

## Verdict (13 November 2026, from a Claude cloud container)

**Proven, with four things the shared bench did not have** (next section); **all four are fixed** in the site app on
branch `fix/bench-gaps` and proven by a second full run (`observed-fixes.txt`, rows F1 to F4 below). The design in
`packages/frappe-app/capxul/clock.py` holds on a real bench: the clock is keyed by world, the wrapper reads the world of
the site being served on every call, and two worlds stayed apart in bench commands, in the web process under 60
requests at once, in the background worker and in the scheduler.

## What was run

`./run.sh all` builds one image (Frappe v16.54.0 and ERPNext v16.54.0 at the commits pinned in
`packages/bench-image/apps.lock.json`, plus the capxul app as it is on `master`), starts **one bench** (MariaDB 11.8,
Redis 7.4, one gunicorn web process with 2 workers of 4 threads, one `bench worker`, one `bench schedule` with a
15-second tick), creates three sites, runs the checks, measures, and removes everything. ERPNext is in the image only
because the capxul app does not install without it (`install-app capxul` on Frappe alone ends
`Could not find DocType: Supplier`). The transcript of the last run is in `observed.txt` (the image build and Docker's own lines left out).

Every time was set with the app's own functions through `bench execute`: `capxul.clock.join_world`,
`capxul.clock.write_world` and `capxul.clock.rewind_jobs`. The sites' time zone is Europe/London, so 10:00 UTC on
31 March 2027 reads 11:00 on a site. The host's real time during the run was 13 November 2026, about 09:00 UTC.

| # | Question | Result | Observed |
|---|---|---|---|
| 1 | One bench, three sites: two in world `alpha`, one in world `beta`? | Holds | `sites on the bench: alpha1.localhost alpha2.localhost beta1.localhost`, `databases on the one MariaDB: 3`, and `capxul_world` is `alpha`, `alpha`, `beta` in the three `site_config.json` files |
| 2 | Alpha frozen at one instant, beta running at another date, set with the app's own functions? | Holds | The bench's one clock file: `{"alpha": {"offset_ms": 0, "frozen_at_ms": 1806487200000, "rate": 1.0, ...}, "beta": -1303…}` (frozen at 2027-03-31 10:00 UTC; running from 2026-06-15 12:00 UTC) |
| 3 | Does each site read its world's time, and never the host's? | Holds in bench commands and web requests | Bench: alpha1 and alpha2 both `"now_datetime": "2027-03-31 11:00:00", "nowdate": "2027-03-31"`; beta1 `"2026-06-15 12:00:0x"`; host `2026-11-13`. Web (`GET /api/method/capxul.clock.now`): the same three readings. 60 requests at once over both gunicorn worker processes: `40 answers from world alpha read 2027-03-31`, `20 answers from world beta read 2026-06-15`, none mixed; each worker process answered all three sites (process 19: 17, 9 and 6 times; process 20: 4, 12 and 15) |
| 3b | Also in a web process that has just started? | **Fails for the first request** (finding 1) | A sign-in served as the first request stamps `User.last_login 2026-11-13 …` on beta (host time) while beta reads `2026-06-16`; after a restart the signed-in person gets `{"session_expired":1}` |
| 3c | Also in a Python process the bench CLI did not start? | **Fails** (finding 2) | `"now_datetime": "2026-11-13 …", "capxul_loaded": false, "wrapper": false` on all three sites |
| 4 | Does a document carry its world's time in `creation`? | Holds | `bench execute`: alpha1 and alpha2 `"creation": "2027-03-31 11:00:00"`, beta1 `"2026-06-15 12:00:2x"`. `POST /api/resource/ToDo` to the web process: the same |
| 5 | Does moving alpha forward move both alpha sites and leave beta alone? | Holds | One `write_world` from alpha2 (frozen at 2027-04-30 10:00 UTC): alpha1 and alpha2 read `2027-04-30 11:00:00` in bench and web at once; beta1 reads `2026-06-15 12:00:4x`, and beta's entry in the clock file is unchanged |
| 6a | Does a background job see its site's world? (one worker for all sites) | Holds | Six jobs, interleaved alpha1, beta1, alpha2, on a worker restarted just before: alpha jobs read `2027-04-30 11:00:00`, beta jobs `2026-06-15 12:0x`, each with `"capxul_loaded": true` before the job touched a document, and the ToDo each wrote has the same `creation` |
| 6b | Does the scheduler decide what is due by the site's world? (one scheduler for all sites) | Holds | Alpha: `capxul daily job ran for 2027-04-30` on both sites, though by the host's clock the job was not due until the next day. Beta, after `rewind_jobs`: three ticks, `"all_job_logs_on_site": 0` (by the host's clock every job would have been five months overdue); then beta moved to 23:59:15 and at its midnight `capxul daily job ran for 2026-06-16`, stamped `2026-06-16 00:00:31` |
| 7 | What does it cost? | Measured | See "Numbers" |
| F1 | Finding 1 fixed: a just-started web process reads world time from its first request | **Fixed** | `capxul/boot.py`: the image writes `capxul_world_clock.pth` (`import capxul`), so every Python process of the bench arms the clock at start and installs it the moment `import frappe` finishes. gunicorn still serves `frappe.app:application`: `sign-in as the first request after the start stamps User.last_login 2026-06-16 00:00:57 (beta reads 2026-06-16 00:01:01)`; `first request after a restart, same cookie: {"message":"Administrator"}` |
| F2 | Finding 2 fixed: a plain Python process on the bench reads world time | **Fixed** | The same `.pth`: `plain {"site": "alpha1.localhost", "world": "alpha", "now_datetime": "2027-03-31 11:00:00", ..., "capxul_loaded": true, "wrapper": true}`, beta `2026-06-15 13:00:15`, and its insert `"creation": "2027-03-31 11:00:00"`. If capxul cannot install the clock, `import frappe` fails, so host time is never read silently |
| F3 | Finding 3 fixed: a running clock started in summer reads site-local time | **Fixed** | `clock.py` makes every clock a UTC instant (`world_ms`) and reads it through the site's time zone (`site_time`); `advance` counts its stops the same way. Beta, running from 12:00 UTC on 15 June, reads `"now_datetime": "2026-06-15 13:00:06"` in bench and `"world_local": "2026-06-15 13:00:06"` in web; set to 22:59:15 UTC it read `23:59:17` and its daily job ran at its midnight (`capxul daily job ran for 2026-06-16`) |
| F4 | Finding 4 fixed: the encryption key, and how soon a world change reaches web | **Fixed** | `setup.after_install` writes the key when capxul is installed, before the site is served: key print `83f2b8f2` at creation, `83f2b8f2 after web served the site, 83f2b8f2 after a bench command stored its first secret, 83f2b8f2 after web used that secret twice (second request: accepted)`, on all three sites. `world_of_site` reads `capxul_world` from `site_config.json` by modification time instead of Frappe's 60 s copy: `web alpha2.localhost 2 s after the change: beta`, eight answers running as beta `3 s after the change` (was 60 s) |

## What did not hold, and the smallest change for each (all four now fixed: rows F1 to F4)

1. **The web process reads the host's time until its first hook.** gunicorn serves `frappe.app:application`, which
   imports no app. The capxul app, and so its clock wrapper, is loaded by the first hook Frappe calls, and Frappe resumes
   or creates the request's session before any hook. Observed on beta (five months behind the host): a sign-in that was
   the first request to a fresh web process stamped `User.last_login 2026-11-13 09:04:47` while the site read
   `2026-06-16 00:00`; and a person signed in before a restart was signed out by the first request after it
   (`{"session_expired":1,"exc_type":"SessionExpired"}`), because the session's last use (June) was compared with the
   host's November. `packages/bench-image/resources/start-web.sh` serves the same entry. *Smallest change:* serve an
   entry that imports capxul first. `probe/webentry.py` was that change, two lines, tried here (since replaced by F1): with it the first
   sign-in is stamped `2026-06-16 00:01:12` and the person stays signed in across the restart.
2. **Only processes started by the `bench` CLI have the wrapper from the start.** The CLI imports every app of the
   bench to look for commands, which is why `bench execute`, `bench worker` and `bench schedule` are right from their
   first reading. A plain Python process that calls `frappe.init` and `frappe.connect` reads the host's time, and a
   document it inserts is stamped with it (`"creation": "2026-11-13 09:01:14"` on an alpha site at 2027). *Smallest
   change:* a rule for the bench image, and a check for it: every process that touches a site starts through `bench`
   or imports `capxul` first.
3. **A running clock is an hour out across a daylight-saving change.** The frozen branch turns the world's instant
   into site time (10:00 UTC reads 11:00 in London's summer). The running branch adds the offset to the host's wall
   time, so beta at the instant 12:00 UTC on 15 June read `12:00`, where London reads 13:00. Two worlds at the same
   instant, one frozen and one running, would differ by an hour, and so would a site and its chain. *Smallest change:*
   in `clock.py` the running branch builds the time the way the frozen branch does, from
   `host_ms + offset_ms` through the site's time zone.
4. **Frappe keeps `site_config.json` in each web process for up to 60 seconds**, and the clock design keeps the site's
   world there. Two effects were observed.
   A site moved to another world with `join_world` was read by bench commands at once, and still answered as its old
   world in the web process 2 s later; it answered as the new world 60 s after the change (57 s in an earlier run).
   *Smallest change:* none needed if a site joins its world before it is first served (as a new or restored site
   does); otherwise restart the web process.
   The second is not about clocks and is Frappe's own race, but a shared bench makes it likely: a bench command made
   a site's first encrypted secret, and with it the site's encryption key; the web process, holding the older copy of
   the config, made a second key and wrote it over the first. The request was refused
   (`Failed to decrypt key User.Administrator.api_secret … Encryption key is invalid`) and the key's print went
   `none`, `cb748741`, `42a55495`. Whatever the first key encrypted is unreadable after that; on a company's site that
   would be the Capxul secret. It happened in every full run, on the first or first two sites. *Smallest change:* the
   site service writes the encryption key when it creates the site, before anything can serve it.

## Numbers

| What | Measured |
|---|---|
| Memory of the bench with three sites | 673 MiB in all: MariaDB 375, web (gunicorn, 2 workers) 130, worker 79 (in the middle of a job), scheduler 72, Redis 17 |
| Time to create a site | 95, 97 and 101 s (`bench new-site`, ERPNext, capxul, the setup wizard, migrate, scheduler on, join the world) |
| Total wall time of `./run.sh all` | 688 s with the image already built; the checks alone take about 6 minutes, 3 of them waiting on the scheduler and the 60-second config cache |
| Image | pull of `frappe/build` 31 s; cold build 93 s (bench init 40 s, ERPNext 7 s, export 42 s); 4.4 GB |

Four full runs gave 611 to 688 s, 95 to 106 s for a site, and 673 to 713 MiB.

## Not tested

- The six-app hosted image (`packages/bench-image`) with nginx in front. The wrapper does not depend on the other apps,
  but memory and site creation time here are for Frappe and ERPNext only.
- More than one worker container, `bench worker-pool`, or a second web container.
- A clock with a rate above 1 on the bench (`tests/test_clock.py` covers the arithmetic), and `capxul.clock.advance`
  stepping one world while the other runs.
- What still reads the host's time by design (`spikes/skeleton/FINDINGS.md` on `main`, "What follows the clock"): Redis
  lifetimes, the scheduler's own tick, the browser. A frozen world's jobs fall due only when the world is moved.
- Core and the chain. This spike is the Frappe side only.

## Run it

```bash
spikes/bench-clocks/run.sh all        # build, start, three sites, every check, memory, then remove everything
spikes/bench-clocks/run.sh up         # or step by step: up, sites, checks [step], stats, down
```

Docker must be running. `BENCH_PROJECT` and `BENCH_IMAGE` (default `bench-clocks` and `bench-clocks:spike`) name the compose project and image, so two runs on one Docker daemon stay apart. Behind a TLS-inspecting proxy the build takes the proxy's CA from `CAPXUL_BUILD_CA` (default
`/root/.ccr/ca-bundle.crt`). MariaDB and Redis come from Amazon's public mirror of the official images, because Docker
Hub answered `429 Too Many Requests` here. The transcript goes to `var/bench-clocks/run.log`.

| File | What |
|---|---|
| `Containerfile`, `image-build.sh`, `build.sh` | The image: pinned Frappe and ERPNext, the capxul app, no built assets |
| `compose.yaml` | The bench: one container per process, no published port |
| `run.sh`, `lib.sh` | Start, create the sites, measure, remove |
| `checks.sh`, `scheduler.sh` | The checks, in the order of the table |
| `probe/clockprobe.py` | What a process reads as now; it never imports capxul, so it shows whether the process had |
| `observed.txt` | The transcript of the first full run, before the fixes (it shows `probe/webentry.py`, since removed) |
| `observed-fixes.txt` | The transcript of the full run after the four fixes |
