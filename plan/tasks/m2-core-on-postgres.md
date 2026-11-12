## What
Rebuild spikes/skeleton/core as the backend on Postgres: the app schema with row-level security, the outbox and the record table, reading Ponder's views. This is the service part of m2-graduate-spike.
## Why
Aaron's storage decision, 12 November 2026 (aaron.postgres-and-ponder): keep Ponder and Postgres, one design everywhere. It replaces the SQLite route for the service that devnet.core-service-home recommended.
## Done when
- All 12 rows of the thin line (evals/thin-line.md) pass against the Postgres backend.
## From the Ponder measurement, 12 November 2026 (docs/mission/world-cost.md, Part 1)
- Postgres max_connections defaults to 100 and each Ponder holds up to 6 while catching up: size the limit or add a pooler for the backend's own connections beside Ponder's.
