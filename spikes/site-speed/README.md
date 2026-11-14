# Site speed spike

Throwaway measurements for one question from Aaron (13 November 2026): the runner builds a world for every scenario
and the test loop is far too slow. The goal is one world per runner, deployed once, moved by snapshot, restore in place
and clock warp. Each company in a world has an ERPNext site on the shared bench (roadmap, "Site creation on a shared
bench"; blueprint decisions.md 51 and 52), and nobody had measured what sites cost in time. This folder holds the
measurements. It is not product code, and nothing under `packages/` was changed.

Every number below is from a run on 13 November 2026 (UTC) and has its run record in `records/`. The runs were
made by the scripts here, and none was written by hand. Records hold timings only, with no key, secret or connection
string.

## The machine and the bench

- **Machine:** a Claude cloud container with 4 CPUs and 15.6 GiB of memory. Another agent's work and the platform's own
  stand-in stage (`cx-platform-pr-sr1-*`, left untouched) shared it, so the times are what this machine gave, not
  lower bounds. CPU and memory in Q6 are read from each container's own cgroup, so other work on the machine does not
  count there.
- **Bench:** `./bench.sh up` starts the containers `packages/platform/src/bench.ts` declares (MariaDB 11.8, Redis 7.4,
  gunicorn web with 2 workers of 4 threads, one `bench worker`, one `bench schedule`). They are named `cx-sitespeed-*`
  and run from the images the platform already built (`cx-platform-bench:pr-sr1`: Frappe 16.54.0, ERPNext, HRMS and
  capxul at the pins in `packages/bench-image/apps.lock.json`). Nothing was built. The door container runs no door
  here. It is where `harness/` runs the same bench commands the door runs (`packages/platform/door/sites.py`,
  `snapshots.py`).
- **Calls:** HTTP calls go to web with the site's Host header, as the site's own API user
  (`capxul-core@service.invalid`). That is what the door passes on for Core, without the door's own hop.

## Measurements

| # | What | Result | Records |
|---|---|---|---|
| Q1 | New company site from nothing, as the door builds one, plus the world's company setup | **105.2 to 110.9 s** at the door (3 runs; 118.6 s for a 4th made while the machine was busier), plus **1.4 to 1.6 s** of company setup. Steps (median of 3): new-site 16.1 s, install ERPNext 37.0 s, install HRMS 26.9 s, install capxul 2.8 s, setup wizard 14.2 s, migrate 6.5 s, scheduler 0.7 s, join world 0.6 s, API user 1.3 s. Company setup: configure 0.2 s, three hats 0.9 s, capital 0.3 to 0.4 s | `q1-new-site-1..3`, `q1-new-site-4-blank-template` |
| Q1 | The same steps, as the platform's own door timed them on stage pr-sr1 during the earlier `--core=local` runs | 5 sites from nothing: median **119.9 s** (111.3 to 135.0). 24 restores: median **9.6 s** (8.5 to 86.8; one outlier) | `door-log-pr-sr1` |
| Q2 | Site from a template: `bench backup`, then the door's restore path (new-site --source-sql, key, join world, clock, API user, scheduler) | Template backup **2.5 s**. Restore **9.1 to 9.3 s** (3 runs). Of that, new-site from backup is 5.5 to 5.9 s, and the four joins are 3.4 s, about 0.6 to 1.3 s each, mostly Python and Frappe starting up | `q2-restore-base-1..3` |
| Q2 | How restore scales with data | 926 tables, 27.6k rows, 1.2 MB gz: **9.3 s**. Plus 1,000 Journal Entries: 9.5 s. Plus 10k entries and 20k GL rows: **10.8 s** (load 7.4 s). Plus 100k entries and 200k GL rows (dump 3.3 MB gz): **23.7 s and 26.4 s** (load 20.5 s and 23.0 s). Roughly 5.5 s for the schema, then about 75 µs a row | `q2-restore-1k`, `-x10`, `-x100`, `-x100-b`; data from `q2-grow-*` |
| Q3a | Clone by `mariadb-dump \| mariadb` (no file, no gzip), then the site around it and the four joins | **9.1 s** with the joins as four processes, **6.5 s** with them in one. The copy alone is 5.1 to 5.4 s. At ×100 data: 23.0 s, copy 21.7 s | `q3a-clone-dump`, `-dump-oneproc`, `-dump-oneproc-x100` |
| Q3a | Clone inside MariaDB (`CREATE TABLE … LIKE` and `INSERT … SELECT` for every table and sequence) | **7.3 s** as four processes, **4.0 s** in one process. The copy alone is 2.8 to 3.7 s. At ×100 data: 12.7 s, copy 11.3 s | `q3a-clone-sql`, `-sql-oneproc`, `-sql-oneproc-x100` |
| Q3a | Clone at the storage level (InnoDB transportable tablespaces: create LIKE, discard, FLUSH … FOR EXPORT, copy the .ibd and .cfg files, import) | **6.9 s** in one process, copy 5.7 s. At ×100 data: 10.3 s, copy 8.9 s. The same as the SQL copy for a small site and faster only once the data is large: the three DDL statements per table (926 tables) cost more than the rows | `q3a-clone-tablespace-oneproc`, `-x100` |
| Q3a | Do the clones work? | Each clone reads its own world and has the template's 926 tables. Three rounds of doc.create, doc.submit and report.run pass on every one. Two bugs in the first scripts were caught this way: the 6 sequences left out, and a sequence's .ibd overwritten | `q3a-clones-checked` |
| Q3b | Pool of pre-made sites, claimed on demand: refill (in-server copy of a blank template) | **3.9 to 4.3 s** a member, off the claim's path. Fifteen more in-server copies (of `acme-w3`) made for Q6 took 4.1 to 4.6 s each (printed only, not kept) | `q3b-pool-refill-1..3` |
| Q3b | Claim a blank member: folder renamed (0 ms), then one process (company renamed, join world, clock, API user, scheduler), then the company setup | With `frappe.rename_doc("Company")`: **6.6 s** claim, of which the rename is 5.7 s (7.7 s with setup). Setting only `company_name` and keeping the placeholder's id: **1.2 s** claim (2.3 s with setup) | `q3b-pool-claim-1`, `-2-label-only`, `q3b-pool-claimed-checked` |
| Q3b | Claim a member that is a copy of a template world's site (company and setup already made) | **1.1 s**: folder rename and one process. The site works | `q3b-pool-claim-3-template`, `q3b-pool-claimed-checked-3` |
| Q3c | Another company on a site that already has one (ERPNext Company with its chart, then the Safe's accounts) | **1.6 to 1.8 s** a company, 2.3 to 2.4 s with the process start. 97 accounts a company | `q3c-add-companies` |
| Q4 | Save point for a reset in place | Saved copy in MariaDB 3.1 s, a spare copy 3.1 s, gz dump 2.5 s. At ×10 data: 3.7 s, 3.6 s and 3.0 s | `q4-save`, `q4-save-x10` |
| Q4 | Reset by swapping in the spare copy: one `RENAME TABLE` of 2 × 926 tables, then the site's Redis keys cleared | **3.6 s** (×10 data: **3.0 s**). Off the reset's path: old tables dropped 1.2 s, new spare 3.4 to 3.8 s | `q4-reset-rename`, `-x10` |
| Q4 | Reset only the changed tables (found with `CHECKSUM TABLE` against the saved copy, then emptied and refilled), Redis keys cleared | **0.54 s** after 5 rounds of the three operations (6 tables changed). **1.9 s** at ×10 data after 20 rounds, where refilling the big GL tables is 1.4 s. `UPDATE_TIME` found the same 6 tables | `q4-reset-changed`, `-x10` |
| Q4 | Reset from the saved dump (drop, create, load gz) | **6.2 s** (×10: **8.1 s**) | `q4-reset-dump`, `-x10` |
| Q4 | Back at the saved point? | Yes. The Journal Entry count read over HTTP after every reset equals the count at the save: 4, and 10,010 at ×10 | the `journal_entries_after` field of every `q4-*` |
| Q5 | Warp one site through `capxul.core_api.warp` over HTTP, as Core's world.clock.warp does for each site | 1 day 1.3 to 2.6 s, 7 days 6.4 s, 30 days 26.3 s, 90 days 71.4 s, 180 days **147.8 s**. That is about **0.8 s a day**, running about 94 jobs at each daily stop | `q5-warp-1-7-30`, `q5-warp-90-180` |
| Q5 | Where a warp's time goes (7 days in one process, rolled back) | 104 job types; 713 runs in 7.4 s. Daily Maintenance 2.9 s, Hourly Maintenance 1.2 s, Daily 1.1 s, Cron 0.5 s. No single heavy job: the slowest is capxul's own daily job (0.06 s a run) | `q5-warp-profile-7` |
| Q6 | Disk per site | 108 to 120 MiB of MariaDB files a small site (926 .ibd files), 208 MiB at ×10. Datadir: 2.7 GiB with 15 sites and 4 saved copies, 4.4 GiB with 30 sites | `q6-disk-15-sites`, `q6-disk-30-sites` |
| Q6 | Idle bench, scheduled jobs on their cadence | 15 sites: **13.8 %** of one CPU, 1,027 MiB RSS (MariaDB 629, web 231). 30 sites: **18.8 %**, 1,094 MiB. Per added small idle site: **about 0.33 % of one CPU and 4.4 MiB**, almost all of it the worker running "All" and Cron jobs every 4-minute tick | `q6-idle-15-sites-jobs-due`, `q6-idle-30-sites-jobs-due`, `q6-jobs-due-*` |
| Q6 | Active sites (one client a site, doc.create, doc.submit and report.run back to back) | 1 site: 34.7 calls/s, 15 to 32 ms median. 4 sites: **67.9 calls/s**, 32 to 78 ms. 8: 67.2 calls/s, 64 to 145 ms. 16: 58.5 calls/s, 158 to 278 ms median, up to 1 s. **32 to 41 CPU ms a call** (web about 70 %, MariaDB about 20 %). Web RSS grows 231 to 404 MiB as 16 sites are used, about 8 to 11 MiB a site | `q6-active-1-site`, `-4-sites`, `-8-sites`, `-16-sites` |

`ops-restored-r1` is the first run of the three operations on a restored site: create 26 ms, submit 44 ms and report
18 ms (medians). `q6-idle-15-sites` is the idle bench before the jobs were put on their cadence: 0.5 % CPU, because no
job was due (see Findings).

## The options, side by side

Times are for a small company site, the size every starting world has now. "Per world" means once for each company
site a world gets.

| Way to give a world a company site | Measured | On the claim's path | What it needs |
|---|---|---|---|
| New site from nothing (today's `POST /sites`) | 105 to 120 s | all of it | nothing |
| Restore from a template backup (today's `POST /world/restore`) | 9.1 to 9.6 s; 23.7 s at 200k GL rows | all of it | a backup per template |
| Clone the template's database inside MariaDB, joins in one process | **4.0 s**; 12.7 s at 200k GL rows | all of it | the template site kept live on the bench |
| Claim a pooled copy of the template's site | **1.1 s** | folder rename plus one process | a pool per template, refilled at about 4 s a member off the path; about 110 MiB of disk a member |
| Claim a pooled blank site, then the company setup | 2.3 s (label only) or 7.7 s (true rename) | as left | one pool for all worlds, but the starting world's documents still have to be made |

| Way to reset a world's site in place to a snapshot | Measured | What it needs |
|---|---|---|
| Changed tables only, from a saved copy in MariaDB | **0.5 s** small; 1.9 s at 20k GL rows | a saved copy of each site at each kept point (about 110 MiB) and a `CHECKSUM TABLE` pass |
| Swap in a spare copy (`RENAME TABLE`) | 3.0 to 3.6 s, and 4.6 to 5.0 s more off the path | two copies per kept point |
| Reload the saved dump | 6.2 to 8.1 s | the gz dump the door already keeps |
| Restore into a new site (today) | 9.1 to 9.6 s | as today |

**The fastest credible way.** One template site per starting world lives on the bench, made once by the maker the
runner already has. A runner's world takes its company site by **claiming a pooled copy (1.1 s)**, or by an in-server
clone of the template if the pool is empty (4.0 s). A **snapshot of the world keeps a saved copy of each of its sites
in MariaDB** (3.1 s each). **A restore in place puts back only the tables that changed (0.5 to 1.9 s)** and clears the
site's Redis keys. Each of these steps is measured here. The whole chain has not been run in one go, and none of it is
built in `packages/platform` (see "Still unknown"). Next to Q1's 105 to 120 s per scenario, it removes nearly all of
the sites' time from the loop. What it leaves is the warp: about 0.8 s per site for each day warped.

**Many companies on one site (Q3c).** Adding a company is cheap (1.6 to 1.8 s), but Capxul's model is one company per
site, and this would break it:

- `Capxul Settings` is a single, read in 20 places across 12 modules: `org_slug`, `safe_address`, `safe_account` and
  the chain cursor `last_seq` are each held once per site.
- Core finds a company's site by asking each ready site for its `org_slug` (decisions.md 47), and `core_company._as_core`
  and `core_api._as_person` refuse any org but the one site's.
- Hats are roles on a site-wide User, so a person who keeps the books in one company would get those roles in every
  company on the site. Feature switches, the scheduler, the world clock and the payment listener are per site too.
- The door names, counts and removes sites, not companies.

Several companies of **one world** on one site would need all of those keyed by company. That is a design change, not
a speed setting. It saves only the 1.1 to 4 s per extra company that a pooled claim or a clone costs.

## Findings on the way

- **A warp through the door has a ceiling.** The door forwards a call to web with a 120 s socket timeout
  (`packages/platform/door/door.py`, line 135). One site needs 147.8 s to warp 180 days, so anything past about 140
  days fails at the door, even though gunicorn answered (the gthread worker did not time out). Core warps the sites
  of a world one after another. Over the Cloudflare Tunnel, the edge's own response timeout would apply as well; it
  is not measured here.
- **A new site's scheduler is idle for 5 h 30 min.** The job types are made during install, before the wizard sets
  the time zone, and are stamped in Frappe's default zone. All 104 had `creation` 2026-11-14 04:48 on a site made at
  23:18 UTC, while its Company reads 23:19 (`q6-jobs-due-15`). So no job of a fresh site, or of one restored from it,
  falls due until then. A warp is not affected: it rewinds `last_execution` itself.
- **Each bench process pays Frappe's start-up.** A `bench execute` or a plain Python process costs about 0.5 to 0.6 s
  before it does anything. Four of them make up 3.4 s of a restore's 9.3 s. Running the four joins in one process
  takes 1.1 to 1.4 s. A door that kept Frappe imported would save about 0.5 s more (not measured).
- **The door makes, restores and removes one site at a time** (`BENCH_LOCK` in `sites.py`). Every step above holds it,
  so resets of many worlds' sites queue behind each other.
- **MariaDB is on its defaults:** `table_definition_cache` 400 and `table_open_cache` 421, against 926 tables a site.
  After this spike's runs, `Opened_table_definitions` stood at 212,838, so the cache churns. With the
  default 128 MiB buffer pool, MariaDB stayed at 629 to 670 MiB RSS from 15 to 30 sites. These are the first settings
  to raise on the bench host.

## What one bench can hold

From Q6, on this machine with the platform's process layout (2 web workers):

- **Idle:** about 0.33 % of one CPU, 4.4 MiB of memory and about 110 MiB of disk per small site, on top of a base of
  about 1 GiB of RSS for the bench. The scheduler's per-site work is the CPU cost. Hourly and daily jobs come on top
  and were not in the 10-minute windows.
- **Active:** about 35 CPU ms per site call. The two web workers top out at **60 to 68 calls/s, whichever site is
  called**. Throughput is set by the web workers, not by the number of sites.
- **The bench host in the plan** is a `t3.large`: 2 vCPU and 8 GiB, burstable to a 30 % baseline per vCPU, so about
  0.6 of a CPU sustained. Scaled from here, not measured there: CPU for about **150 idle sites** at that baseline (a base of about 9 % of a CPU, then 0.33 % a site)
  (fewer with hourly and daily jobs), memory for several hundred, and the 60 GiB disk for about **400 small sites**
  without saved copies. That is about **200 sites if each keeps one saved copy** for resets in place. A world
  with one company and one kept snapshot holds 2 site databases, so about **100 such worlds**, and fewer when they run
  scenarios at once: each busy world costs about 35 CPU ms per site call.

## Still unknown

- **The chain as one run.** Template, pool claim, saved copy and changed-table reset were each measured alone, not
  end to end through the door and Core in a world. No `world create` was made here, because the spike needed no
  Cloudflare or Neon.
- **Changed-table detection on a busy bench.** `CHECKSUM TABLE` was 0.5 s on small sites, but it reads every row, so
  it grows with data. `UPDATE_TIME` agreed with it here but is kept only in memory and lost when a table leaves the
  definition cache (400 entries by default), so it can be trusted only with a cache sized for every table. A row-level
  delta was not tried.
- **What a reset in place must also put back.** Rows were measured, plus Redis keys. Also needed, but not measured: the
  site's files (`public/files`, `private/files`), queued RQ jobs of the site, the world's entry in
  `capxul-world-clocks.json`, and the 60 s site-config cache of the web process. The changed-table reset leaves
  `site_config.json` alone, so that cache is not involved.
- **Hourly and daily jobs on an idle bench.** The idle windows were 10 minutes. A full day per site was not measured.
- **The AWS host itself.** `t3.large` CPU credits, gp3 disk speed, and the tunnel's timeouts were not tried here. The
  capacity above is scaled from this 4-CPU container.
- **Several companies on one site in Capxul's flows.** Only the ERPNext side (adding companies) was timed. Nothing
  was changed to make Capxul key its settings by company.
- **Concurrency.** Every site operation here ran alone, one at a time, as the door's lock makes them. Parallel clones
  or resets were not timed.

## Files

| File | What |
|---|---|
| `bench.sh` | `up`, `down`, `exec`, `sql`: the spike's own stand-in bench from the platform's images |
| `rec.sh`, `hrec.sh` | Run a harness script in the bench (`rec.sh`) or on the host (`hrec.sh`) and keep what it prints as `records/<name>.json` |
| `harness/lib.py` | What the scripts share: bench and SQL calls, HTTP to web, the door's own API-user scripts, the company setup |
| `harness/new_site.py` | Q1 |
| `harness/restore.py`, `harness/grow.py` | Q2 |
| `harness/clone.py`, `clone_ts.py` | Q3a (in-server, dump, and storage level) |
| `harness/pool_claim.py` | Q3b |
| `harness/add_company.py` | Q3c |
| `harness/reset.py` | Q4 |
| `harness/warp.py`, `harness/warp_profile.py` | Q5 |
| `capacity.py`, `harness/jobs_due.py` | Q6 |
| `harness/ops.py`, `harness/check_sites.py` | The three site operations over HTTP, and the check that a made site works |
| `harness/drop.py` | Removes sites as the door does |
| `door_log.py` | Reads the platform stage's door log (read-only) |
| `records/` | Every run record |

To run again: `./bench.sh up`, then `./rec.sh q1-new-site-1 new_site.py acme-w1.sitespeed.test w1 "Acme One Ltd"`
and so on, as each record's `script` and `args` say. `./bench.sh down` removes every container, volume and network
the spike made. It needs about 5 GB of free disk for 30 sites.
