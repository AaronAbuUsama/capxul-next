## What
Run the backend on Postgres (m2-core-on-postgres, with Ponder per aaron.postgres-and-ponder) with a registry and a supervisor that starts, stops, parks and wakes worlds on the machine, each with its own chain from the seeded state and its own Postgres database. This replaced the one-file lean service (m2-lean-service, dropped 12 November 2026). Run twenty core worlds at once and measure memory, start time and steps per second.
## Why
Everything else in the platform stands on a world being cheap. A world's cost on Postgres and Ponder is an estimate until it is measured (m3b-ponder-world-cost measures one).
## Done when
- Twenty core worlds run at once on the machine and the measured figures replace the estimates in the book
