## What
A package holding a Ponder app for the v4 contracts: the indexing tables as Ponder handlers built from the blueprint's indexing records, with the log identity of indexing.log-identity.
## Why
Aaron's storage decision, 12 November 2026 (aaron.postgres-and-ponder): keep Ponder and Postgres, one design everywhere.
## Done when
- The chain-facts evals bound to indexing pass on a devnet against the Ponder app in packages/.
## From the Ponder measurement, 12 November 2026 (docs/mission/world-cost.md, Part 1)
- Derive a Safe's owners from its events (AddedOwner, RemovedOwner), not by reading the Safe at past blocks: those reads were 40% of catch-up and grow anvil by about 500 MB. packages/devnet/world-cost is the measured starting point.
- The owner in Safe's AddedOwner and RemovedOwner is indexed (Safe 1.5.0); blueprint/shared/external.ts records it so since PR #28 (a4e421d), so the handlers can take it from the topic.
