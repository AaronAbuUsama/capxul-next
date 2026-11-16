# Blank company sites (14 November 2026)

Four `world` runs at once on `staging` timed out waiting for their company sites: each run's `org.create` asks the
site service for a site when its approval lands (`packages/core`, `src/organizations/site.ts`), and each was made from
nothing under `BENCH_LOCK`, one at a time, 2 to 4 minutes each, so the fourth waited behind three. `door/blank.py`
takes that build off every run's path; its header says how.

This folder measured four companies made at once (`run.sh`: the real `door/door.py` before and after; `bench`, the
bench's Python and pymysql stood in, each command taking a tenth of the time the same step took on a real bench in
`../site-pool/01-template-source.json`; two CPUs, each bench process holding one; a database copy 3.3 s, a tenth).
Times below are the stand-in's, times ten:

| Four companies at once, time to ready | Before (`old-door.json`) | Warm (`warm.json`) | Pool of 2 (`pool2.json`) | Asked as it starts (`cold.json`) |
|---|---|---|---|---|
| How each was made | from nothing, one at a time | 4 from the pool | 2 from the pool, 2 copied | 4 copied from the blank once made |
| Fastest, slowest | 139 s, 554 s | 30 s, 58 s | 30 s, 58 s | 154 s, 184 s |
| Mean | 346 s | 44 s | 44 s | 169 s |

The blank was made in 118 s and its pool of 4 was full 13 s later (`warm.json`, `warm_up`). Every company was ready,
and each world was then removed. The unit tests (`door/tests/test_blank.py`) cover the cases.

Not measured here: a real bench. The configure process was charged what its steps took when a site was made from
nothing (27.8 s), the stand-in runs no Frappe, and its MariaDB answers no rows, so the copies kept the blank's
encryption key. Copies of a blank share its Administrator password, random and never kept, as copies of a site
template do.
