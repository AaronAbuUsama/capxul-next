# The world's clock on a shared bench: what follows it, and what it costs

How the clock reaches a site is the header of `capxul/clock.py`, and how every process of the bench gets it from its
start is the header of `capxul/boot.py`. That two worlds at different clocks share one bench is proven by
[records/bench-clocks](../records/bench-clocks/README.md) (roadmap item 0.8).

## What follows the world's clock

Everything that reads `frappe.utils.data.now_datetime()`, directly or through `nowdate()`, `today()`, `nowtime()` or
`now()`: a document's `creation` and `modified`, in bench commands, web requests, worker jobs and plain Python
processes alike; and the scheduler's choice of what is due (`Scheduled Job Type.is_event_due`), so a site's daily job
runs at its world's midnight. A new site's job stamps are brought back to its now by `capxul/jobs.py`.

## What still reads the host's time

- **The scheduler's own tick.** `bench schedule` wakes on host time; it then asks each site what is due by the
  site's world. A frozen world's jobs fall due only when the world is moved (a warp steps the site through its due
  instants: `advance` in `capxul/clock.py`).
- **Redis lifetimes**: cache entries, locks and RQ's job timeouts expire on host time.
- **The browser**: anything a page works out from the person's own clock.
- **The rate above 1** was not run on a bench, only checked by `tests/test_clock.py`.

## What one bench of Frappe and ERPNext cost (13 November 2026)

Three sites on one bench, the image of Frappe and ERPNext only (the capxul app needs ERPNext to install; the hosted
six-app image is `packages/bench-image`, whose numbers are in `packages/platform/docs/capacity.md`).

| What | Measured |
|---|---|
| Memory of the bench with three sites | 673 to 713 MiB in all; in one run MariaDB 375, web (2 workers) 130, worker 79 in a job, scheduler 72, Redis 17 |
| Making a site (`bench new-site`, ERPNext, capxul, the setup wizard, migrate, scheduler on, join the world) | 95 to 106 s |
| The image | `frappe/build` pulled in 31 s; built cold in 93 s; 4.4 GB |
