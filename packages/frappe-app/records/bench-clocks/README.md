# Two worlds at different clocks on one bench (13 November 2026)

The Proof of roadmap item 0.8, from the bench clocks spike; the spike's code was deleted when it graduated. One bench
(MariaDB 11.8, Redis 7.4, one gunicorn web process of 2 workers and 4 threads, one `bench worker`, one
`bench schedule` on a 15-second tick), Frappe and ERPNext v16.54.0 at the pins in
`packages/bench-image/apps.lock.json`, and the capxul app as it was on `master`. Three sites: `alpha1` and `alpha2` in
world `alpha`, `beta1` in world `beta`. Every time was set with the app's own functions through `bench execute`
(`capxul.clock.join_world`, `write_world`, `rewind_jobs`); the sites' time zone was Europe/London, and the host's real
time about 09:00 UTC on 13 November 2026.

- `observed.txt`: the transcript of the first full run, before the fixes. Its `probe/webentry.py` was a trial fix,
  since replaced by `capxul/boot.py`.
- `observed-fixes.txt`: the transcript of the full run after the four fixes.

## What held

| # | Question | Result |
|---|---|---|
| 1 | One bench, three sites of two worlds | `capxul_world` is `alpha`, `alpha`, `beta` in the three `site_config.json`; three databases on the one MariaDB |
| 2 | Alpha frozen at 2027-03-31 10:00 UTC, beta running from 2026-06-15 12:00 UTC | One clock file on the bench holds both entries |
| 3 | Each site reads its world's time, never the host's | In bench commands and web requests; 60 requests at once over both web workers: 40 alpha answers read 2027-03-31, 20 beta answers read 2026-06-15, none mixed |
| 4 | A document's `creation` is its world's time | Through `bench execute` and through `POST /api/resource/ToDo` |
| 5 | Moving alpha moves both alpha sites and leaves beta alone | One `write_world` from alpha2; beta's entry unchanged |
| 6a | One worker runs every site's jobs in its site's world | Six interleaved jobs, each reading its world with `capxul_loaded` true before it touched a document |
| 6b | One scheduler decides what is due by each site's world | Alpha's daily job ran for 2027-04-30; beta's ran at beta's own midnight, not the host's |

## What did not hold at first, and its fix (rows F1 to F4 of `observed-fixes.txt`)

1. **A just-started web process read host time until its first hook**: gunicorn serves `frappe.app:application`,
   which imports no app, so a first sign-in was stamped with host time and a signed-in person was signed out after a
   restart. Fixed by `capxul/boot.py`: every Python process of the bench imports capxul at start.
2. **A plain Python process** (`frappe.init`, `frappe.connect`, not through `bench`) read host time. The same fix.
3. **A running clock was an hour out across daylight saving**: it added its offset to host wall time. Fixed in
   `capxul/clock.py`: every clock is a UTC instant read through the site's time zone.
4. **Frappe keeps `site_config.json` in a web process for 60 s**, so a site that changed world answered as its old
   world for a minute, and a web process with an old copy wrote a second encryption key over the first (a secret
   stored under the first became unreadable, in every full run). Fixed: `world_of_site` reads the file by its
   modification time, and `setup.after_install` writes the key before the site is served.

`tests/test_bench_gaps.py` holds each of the four without a site. The bench's memory and how long a site took are in
[docs/clock.md](../../docs/clock.md).
