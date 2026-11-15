# Renewing a world that is meant to last

```bash
./run.sh renew <name> --lifetime "7 days"
```

In-process it is `renew` from the package's door (`src/lifecycle/renew.ts`, roadmap step 2.3). It keeps a world that
is meant to last, such as the shared world the runner uses: the SAME world, its name, branch, data, chain, sites and
snapshots, given an expiry `lifetime` from now and deployed again with the code that runs now. What it moves, in what
order, which token the renewed api accepts and what a renewal that fails half-way leaves, is the comment at the top of
`src/lifecycle/renew.ts`.

## What it refuses

A renewal never shortens a world (a world restored from it may live until its expiry), never passes its cluster's
expiry, and never asks more than `WORLD_MAX_LIFETIME` from now (`renewalOf`, `test/expiry.test.ts`). A parked or
half-made world is refused (`RenewRefused`). Its declared timeout is `WORLD_TIMEOUT_RENEW`.

## Rows written by older code

A world that lasts holds rows written by older code, and so do the snapshots it keeps, which every world restored from
them carries. When what the account calls read of a world changes (`src/platform/facts.ts`), those rows are moved by a
new migration of the api's (`packages/core/migrations/`), which a renewal and every restore apply; an applied
migration is never edited. On 15 November 2026 the blueprint's `ChainContracts` began to require `budgets`, the shared
world's rows did not name it, and its `world.show` failed with `Missing key` after renewal; `0008_world_budgets.sql`
moves such rows.

`test/old-rows.test.ts` keeps it from happening again: every format of rows in `test/rows/` is written into a real
Postgres with the migrations its world had, the later ones applied, and must then read through the account calls' own
queries and decoding. It needs `CAPXUL_ROWS_DATABASE` (CI's `gate` job has its own Postgres for it) and skips without
one outside CI. A new format of rows is a new file there, never an edited one.
