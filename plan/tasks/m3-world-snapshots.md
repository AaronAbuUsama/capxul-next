## What
The supervisor saves, lists and restores a world's snapshot: its Postgres database by template copy, together with the chain's state and the sites' backups.
## Why
Aaron's storage decision, 12 November 2026 (aaron.postgres-and-ponder): keep Ponder and Postgres, one design everywhere. A world's Postgres database is snapshotted by template copy, with the chain and the site backups.
## Done when
- The snapshot evals acc:world.snapshot.save/1, acc:world.snapshot.list/1, acc:world.snapshot.restore/1 and acc:world.snapshot.restore/2 pass.
