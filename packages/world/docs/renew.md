# Renew a world

## Renewing a world (step 2.3)

`./run.sh renew <name> --lifetime "7 days"` (`renew` from the package's door, `src/things/world/renew.ts`) keeps a world
that is meant to last, such as the shared world (packages/runner, "A run on the shared world"): the SAME world, its
name, branch, data, chain, sites and snapshots, given an expiry `lifetime` from now and deployed again with the code
that runs now. A renewal never shortens a world (a world restored from it may live until its expiry), never passes its
hub's expiry and never asks more than `WORLD_MAX_LIFETIME` from now (`renewalOf`, `test/expiry.test.ts`); a parked or
half-made world is refused (`RenewRefused`).

| Part | What |
|---|---|
| registry | the name's row moved, so the owner's count of live worlds reads the new expiry |
| branch | Neon's own expiry on the world's branch lifted (Neon would delete it at the old one); the sweeper deletes the world at its recorded expiry |
| hub | the world registered again with the new expiry: its door token is an HMAC over it, so the old token reaches nothing |
| deploy | Core deployed again: the new door token, a site token minted anew until the new expiry, the world's own operator token, the running code; the stage's outputs then hold the new expiry |
| migrate, core | Core's pending migrations; Core waited for until it answers steadily |

A renewed world's Core accepts its own operator token (`operator-token`, which `open` hands whoever holds the
Cloudflare key) rather than the token of the process that made it, so a world that outlives that process is reached
the way its hub is, through the shared state. Between the hub's registration and Core's deploy, Core reaches no chain
for some seconds; a renewal that fails half-way is run again. Declared timeout `WORLD_TIMEOUT_RENEW`, 6 minutes.

A world that lasts holds rows written by older code, and so do the snapshots it keeps, which every world restored
from them carries. When what the platform reads of a world changes (`src/things/world/store.ts`), those rows are moved by a
new migration of Core's, which renewal and every restore apply, never by editing an applied one. On 15 November 2026
the blueprint's `ChainContracts` began to require `budgets`, the shared world's contracts (14 November) did not name
it, and its world.show failed with `Missing key` after renewal (platform.yml run 43700976392); `0008_world_budgets.sql`
moves such rows. `test/old-rows.test.ts` keeps it from happening again: every format of rows in `test/rows/` is written
into a real Postgres with the migrations its world had, the later ones applied, and must then read through the
platform's own queries and decoding. It needs `CAPXUL_ROWS_DATABASE` (CI's `gate` job has its own Postgres for it) and
skips without one outside CI. A new format of rows is added as a new file there, never one edited.
