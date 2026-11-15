# Sites from a pool, on a local bench (14 November 2026, roadmap 1.17)

`proof/prove.py` against `bin/pool-bench.sh`'s bench (the containers `src/bench.ts` declares, MariaDB with
`src/mariadb.ts`'s settings, from the images `cx-platform-bench:pr-sr1` and `cx-platform-door:pr-sr1`, this checkout's
site service and capxul app mounted in): **passed** (`pool.proof.json`, a part in each file beside it). A Claude cloud
container with 4 CPUs and 15.7 GiB that other agents shared, not the AWS bench host.

| Part | Measured | Record |
|---|---|---|
| Template world's site from nothing (`POST /sites`), then `founded`'s company setup | 138.1 s (new-site 22.2 s, ERPNext 50.1 s, HRMS 33.8 s, wizard 16.9 s, migrate 8.2 s), setup 3.2 s | `01-template-source.json` |
| Site template `founded` made from it | 2.9 s; the pool of 2 full 7.0 s later (refills 3.3 s and 3.0 s) | `02-template.json` |
| Takes: three at once, then one alone | 1.53 s and 1.55 s from the pool and 4.90 s copied (pool empty), at once; 1.31 s from the pool alone | `03-claim.json` |
| The three site operations through the site service, 3 rounds on each site | doc.create 25 to 184 ms, doc.submit 49 to 296 ms, report.run 15 to 393 ms (the first call of each site the slowest) | `04-operations.json` |
| Save to a site snapshot | 3.0 to 3.7 s a site (copy 2.9 to 3.7 s, checksums 57 to 68 ms) | `05-save.json` |
| Reset in place after 3 Journal Entries, a file, a clock change and a queued job | 0.08 to 0.25 s a site, two one after another and two at once: 7 tables put back, the file gone, 1 job removed, 584 cache keys cleared, the clock back; each site's state read over HTTP equal to the saved one | `06-reset.json` |
| A second change (5 entries) and reset of one site | 0.12 s, equal again | `07-reset-again.json` |
| Everything removed | no site folder and no database left but MariaDB's own | `08-cleanup.json` |

Against `spikes/site-speed`: a take is 1.3 to 1.6 s, not 1.1 s, since the join also settles the site's scheduled jobs
on the world's time (`capxul.jobs.settle_jobs`); resets are faster than its 0.5 s, with MariaDB's caches sized for many
sites and the saved copy's checksums taken once, at the save. Before the proof stopped the bench's scheduler and
worker, one of four resets read back a General Ledger row a background job had written: why a world is paused first.
