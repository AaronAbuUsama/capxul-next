# What one bench can hold

Scaled from the measurements in [records/site-speed](../records/site-speed/README.md) (13 November 2026, a 4-CPU
stand-in with the bench's process layout: 2 web workers), not measured on the bench host itself. The host in the plan
is a `t3.large` (`src/aws.ts`): 2 vCPU and 8 GiB, burstable to a 30 % baseline per vCPU, so about 0.6 of a CPU
sustained, and a 60 GiB data disk. How MariaDB is sized for it is the header of `src/mariadb.ts`.

## Idle sites

- **Per small idle site**: about 0.33 % of one CPU, 4.4 MiB of memory and about 110 MiB of disk, on a base of about
  1 GiB of memory and 9 % of a CPU for the bench. The CPU is the worker running each site's "All" and Cron jobs every
  4-minute tick; hourly and daily jobs come on top and were not in the measured 10-minute windows.
- **On a `t3.large`**: CPU for about **150 idle sites** at its baseline (fewer with hourly and daily jobs), memory for
  several hundred, and disk for about 400 small sites, or about 200 if each keeps one site snapshot for resets in
  place. A world with one company and one kept snapshot holds two site databases, so about **100 such worlds**.

## Busy sites

About 35 CPU ms a site call (web about 70 %, MariaDB about 20 %). The two web workers top out at 60 to 68 calls a
second **whichever site is called**: throughput is set by the web workers, not by the number of sites, and each world
running journeys at once takes its share. With 16 sites busy at once a call's median was 158 to 278 ms, up to 1 s.

## A warp costs about 0.8 s a day

A site steps through every day it is warped and runs what fell due, about 94 jobs at each daily stop: 1 day 1.3 to
2.6 s, 30 days 26.3 s, 180 days 147.8 s. A warp of many sites, or of many worlds at once, is that times the sites,
on the same worker. Why the api splits a long warp is `WARP_STEP_MS` in `packages/core/src/site-ops/world.ts`.

## Why many companies on one site breaks the model (Q3c)

Adding a company to a site that has one is cheap (1.6 to 1.8 s), but Capxul is one company per site, and sharing a
site would break it:

- `Capxul Settings` is a single: `org_slug`, `safe_address`, `safe_account` and the chain cursor `last_seq` are each
  held once per site.
- The api finds a company's site by its `org_slug`, and the site API refuses any org but the site's own.
- Hats are roles on a site-wide User, so a person who keeps the books in one company would hold those roles in every
  company on the site. Feature switches, the scheduler, the world clock and the payment listener are per site too.
- The site service names, counts and removes sites, not companies.

Keying all of that by company is a design change, not a speed setting, and it would save only the 1.1 to 4 s a
take or a clone costs per extra company.
