## What
A package holding a Ponder app for the v4 contracts: the indexing tables as Ponder handlers built from the blueprint's indexing records, with the log identity of indexing.log-identity.
## Why
Aaron's storage decision, 12 November 2026 (aaron.postgres-and-ponder): keep Ponder and Postgres, one design everywhere.
## Done when
- The chain-facts evals bound to indexing pass on a devnet against the Ponder app in packages/.
## From the Ponder measurement, 12 November 2026 (docs/mission/world-cost.md, Part 1)
- Derive a Safe's owners from its events (AddedOwner, RemovedOwner), not by reading the Safe at past blocks: those reads were 40% of catch-up and grow anvil by about 500 MB. packages/devnet/world-cost is the measured starting point.
- On chain (Safe 1.4.1) the owner in AddedOwner and RemovedOwner is indexed; blueprint/shared/external.ts gave it as not indexed when this was written, and a fix is coming separately.
