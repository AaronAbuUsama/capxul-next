# Site templates, the pool, and resetting sites in place

How the site service gives a world its company sites quickly and puts them back. It carries out two roadmap
decisions, "Sites from a pool" and "Bench templates never change" ([docs/roadmap.md](../../../docs/roadmap.md), "What
was decided on 13 November 2026"); the calls are in [site-service.md](site-service.md).

## Site templates, the pool and taking sites

- **A site template** is a starting point's company sites kept on the bench and never served: a database and a site
  folder under the site service's registry. A template world makes the starting point once by its steps and hands its
  sites over with `POST /templates`. How a site template is named, made once, never changed and removed by age is
  `door/templates.py`'s header; it is the one place that says how.
- **The pool** keeps `DOOR_POOL_SIZE` (default 2) ready copies of each site template's sites: a database copy inside
  MariaDB with its own user, and a folder outside the bench's served sites, so they cost disk (about 110 MiB each) and
  no CPU. It is refilled in the background after every take, one copy at a time bench-wide (`door/pool.py`).
- **Taking** (`POST /world/claim`, `door/claim.py`): a copy's folder renamed to the world's site name, then one bench
  process joins it to the world. An empty pool falls back to a copy from the site template on the call's path.
- **Blank company sites** (`door/blank.py`): one blank site template per app fingerprint, a site with every app
  installed and no company, kept warm in a pool of `DOOR_BLANK_POOL_SIZE` (default 4), so `POST /sites` starts a
  company's site from a copy instead of building it from nothing.

## Saving and resetting a world's sites in place

`door/points.py` does the work; this is what `packages/world` relies on.

1. **Pause the world** before a save and before a reset: no api call, no chain delivery, and the bench's scheduled
   jobs off for its sites. The site service pauses nothing. A save copies a site in one transaction, so it is one
   moment of the site; but a job that writes between a reset and the next read makes the site differ from the site
   snapshot.
2. `POST /world/save {"point": "<name>"}` answers 200 `{world, point, ms, sites: [{site, ms, steps}]}`. The site
   snapshot holds every site of the world and the world's clock entry. Name it after the world's snapshot it belongs to.
3. `POST /world/reset {"point": "<name>"}` answers 200 `{world, point, ms, sites, clock: {entry, ms},
   sites_not_in_point}`. Each site's `steps` say which tables were put back (`tables_changed`, `tables_dropped`,
   `tables_made`), whether its files or site config were (`files_put_back`, `site_config_put_back`), and how many
   queued jobs and cache keys went (`jobs_removed`, `cache_keys_cleared`). A site made after the save is listed in
   `sites_not_in_point` and left as it is; remove it with `DELETE /sites/<site>` if the world must not hold it.
4. The world's clock entry is put back as saved. A frozen clock reads the saved instant again; a running clock gets its
   saved offset and rate back, so it reads the host's now plus that offset. Freeze the clock before saving to come back
   to an exact instant, or set it after the reset with `POST /clock`.
5. Site snapshots go with `DELETE /world`; `GET /world/points` and `DELETE /world/points/<point>` list and remove them.

A reset does not put back a table whose schema changed since the save (a migrate in between), a job already running,
or Frappe's own 60 s cache of a site config.

## What runs at once

| Work | Holds | So |
|---|---|---|
| Take, save, reset or removal of a site | that site's lock and one of `DOOR_FAST_SLOTS` (default 4) | Different sites, of one world or many, run at once, up to 4; the same site's calls queue |
| A site template made, a take with the pool empty, a refill, a sweep of that template | the site template's lock | Copies from one site template are made one after another; takes from the pool do not wait for them; a sweep passes over a site template whose lock is held |
| Refill | one bench-wide refill lock | One pool copy is made at a time |
| A site made from nothing or restored, a blank made, `bench backup` | `BENCH_LOCK` | One at a time across the bench, each off the request's path; takes, saves, resets and removals of ready sites do not wait for them |
| Registry changes, quota checks | `REGISTRY_LOCK` | Held for milliseconds |

Site templates are the bench's, not a world's: any valid token may make one, sweep them or remove one by name. Tokens
are minted only by holders of the door key.
