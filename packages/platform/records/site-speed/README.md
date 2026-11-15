# What company sites cost in time on one bench (13 November 2026)

From the site speed spike, asked by Aaron when the runner still built a world for every journey; the spike's code was
deleted when it graduated. Every file here is one run record, written by the spike's scripts (each holds its `script`
and `args`), timings only. What the numbers mean for one bench's capacity is [docs/capacity.md](../../docs/capacity.md).

**How.** A stand-in bench in a Claude cloud container (4 CPUs, 15.6 GiB, shared with other work, so the times are what
it gave, not floors), from the images the sites package had built (`cx-platform-bench:pr-sr1`: Frappe 16.54.0,
ERPNext, HRMS and capxul at the pins in `packages/bench-image/apps.lock.json`), with the processes
`src/bench.ts` declares. Bench commands ran as the site service runs them; HTTP calls went to web with the site's Host,
as the site's API user. CPU and memory in Q6 are read from each container's own cgroup.

| # | What | Result | Records |
|---|---|---|---|
| Q1 | New site from nothing, plus the company setup | 105.2 to 110.9 s (118.6 s on a busier machine), plus 1.4 to 1.6 s. Medians: new-site 16.1, ERPNext 37.0, HRMS 26.9, capxul 2.8, wizard 14.2, migrate 6.5 s | `q1-new-site-*` |
| Q1 | The same, as the site service timed it on stage pr-sr1 | 5 sites, median 119.9 s; 24 restores, median 9.6 s | `door-log-pr-sr1` |
| Q2 | Site restored from a template backup | Backup 2.5 s; restore 9.1 to 9.3 s, of which 3.4 s is four bench processes starting | `q2-restore-base-*` |
| Q2 | Restore against data | 9.3 s small (926 tables); 10.8 s at 20k GL rows; 23.7 and 26.4 s at 200k: about 5.5 s of schema, then about 75 µs a row | `q2-restore-*`, `q2-grow-*` |
| Q3a | Clone by `mariadb-dump \| mariadb`, joins in one process | 6.5 s; 23.0 s at 200k GL rows | `q3a-clone-dump*` |
| Q3a | Clone inside MariaDB (`CREATE TABLE … LIKE`, `INSERT … SELECT`) | 4.0 s in one process; 12.7 s at 200k GL rows | `q3a-clone-sql*` |
| Q3a | Clone by transportable tablespaces | 6.9 s; 10.3 s at 200k GL rows | `q3a-clone-tablespace-*` |
| Q3a | Do the clones work? | Yes: each reads its own world; three rounds of create, submit and report pass | `q3a-clones-checked` |
| Q3b | Refill a pool member (in-server copy) | 3.9 to 4.3 s, off the take's path | `q3b-pool-refill-*` |
| Q3b | Take a blank member | 6.6 s with a true company rename; 1.2 s setting only `company_name` | `q3b-pool-claim-1`, `-2-label-only` |
| Q3b | Take a copy of a template world's site | 1.1 s | `q3b-pool-claim-3-template` |
| Q3c | Another company on a site that has one | 1.6 to 1.8 s a company, 97 accounts each | `q3c-add-companies` |
| Q4 | Save a site in MariaDB / a spare copy / a gz dump | 3.1 / 3.1 / 2.5 s; at ×10 data 3.7 / 3.6 / 3.0 s | `q4-save*` |
| Q4 | Reset by `RENAME TABLE` of the spare | 3.6 s (×10: 3.0 s) | `q4-reset-rename*` |
| Q4 | Reset only the changed tables (`CHECKSUM TABLE`) | 0.54 s (6 tables); 1.9 s at ×10 | `q4-reset-changed*` |
| Q4 | Reset from the gz dump | 6.2 s (×10: 8.1 s); every reset read back the saved count | `q4-reset-dump*` |
| Q5 | Warp one site through `capxul.core_api.warp` | 1 day 1.3 to 2.6 s, 30 days 26.3 s, 180 days 147.8 s: about 0.8 s a day | `q5-warp-*` |
| Q5 | Where a warp's time goes (7 days) | 713 job runs of 104 types in 7.4 s; no single heavy job | `q5-warp-profile-7` |
| Q6 | Disk | 108 to 120 MiB a small site; 4.4 GiB with 30 sites | `q6-disk-*` |
| Q6 | Idle bench, jobs on their cadence | 15 sites 13.8 % of a CPU, 1,027 MiB; 30 sites 18.8 %, 1,094 MiB | `q6-idle-*`, `q6-jobs-due-*` |
| Q6 | Active sites, one client each | 1 site 34.7 calls/s; 4 sites 67.9; 16 sites 58.5, up to 1 s a call; 32 to 41 CPU ms a call | `q6-active-*` |

`ops-restored-r1` is the first run of the three operations on a restored site (medians 26, 44 and 18 ms).

## Findings on the way

- **A warp through the site service had a ceiling**: it forwarded to web with a 120 s socket timeout, and 180 days
  took 147.8 s. The api now warps in shorter calls (`packages/core/src/site-ops/world.ts`).
- **A new site's scheduler is idle for 5 h 30 min.** Install makes the job types before the wizard sets the time zone,
  so they are stamped in Frappe's default zone (Asia/Kolkata) and fall due only then. Fixed by `capxul/jobs.py`.
- **Each bench process pays Frappe's start-up**, about 0.5 to 0.6 s; four of them are 3.4 s of a 9.3 s restore.
- **The site service then made, restored and removed one site at a time** (`BENCH_LOCK`).
- **MariaDB was on its defaults** (`table_definition_cache` 400, `table_open_cache` 421, against 926 tables a site),
  so the cache churned; `src/mariadb.ts` now sets them.
