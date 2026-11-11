# Booking payments as it is: conventions every writer follows

This folder is the **as-is** book of the old system's `payments` concept, read from
`/home/user/factory` (branch `integration/factory` of Xelmar-tech/infrastructure). It records
what the old code does, including what is wrong with it. It is evidence, not the target design.

- Schema: `/home/user/capxul-next/packages/book/src/records/*.ts`. Example of every kind:
  `/home/user/capxul-next/packages/book/test/fixtures/invitations.ts`. Reading guide:
  `/home/user/capxul-next/docs/spec/50-design-book.md`.
- Import the schema as `import { … } from "../../../packages/book/src/index.ts";` and Effect as
  `import { Schema } from "effect";`.
- Each file is written by one writer. Import other files' records by the names below, from
  `./<file>.ts`. Never redefine a record another file owns. If you need a record no file owns,
  list it in your report under `missing`; do not invent it.

## Ids and export names (deterministic, so files agree without talking)

| Kind | id | export name | owner file |
|---|---|---|---|
| system | `capxul` | `system_capxul` | foundation.ts |
| component | `convex-backend`, `core-sdk`, `cli`, `ponder-indexer`, `chain`, `aa-gateway` | `component_<id with - → _>` | foundation.ts |
| concept | the old folder name: `payments`, `books`, `accounts`, … | `concept_<id>` | foundation.ts |
| environment | `devnet`, `staging` | `environment_<id>` | foundation.ts |
| error | the code: `INSUFFICIENT_FUNDS` | `error_<CODE>` | vocabulary.ts |
| event | the catalog name: `payment_transitioned` | `event_<name>` | vocabulary.ts |
| table | the Convex table name, kebab-cased: `payment-commands` | `table_<id with - → _>` | data.ts (payments) / neighbors.ts (others) |
| machine | the entity in kebab case: `payment`, `money-execution` | `machine_<id with - → _>` | data.ts |
| transition | **always named `to_<state>`**: one transition per target state, all its sources in `from` | `machine_x.t.to_<state>` | data.ts |
| integration | the `src/integrations/<vendor>` folder: `chain-rpc`, `chain-evidence`, `ponder`, `mail`, `openfort`, `bridge`, `roles`, `chainlink` (the bundler is reached through `chain-rpc`) | `integration_<id with - → _>` | external.ts |
| call | the old exported function name, camelCase: `readBalance` | `integration_x.c.<name>` | external.ts |
| contract | the Solidity contract, kebab: `capxul-payments-v3`, `payments` (v4), `budgets` | `contract_<id with - → _>` | external.ts |
| function / chain event | the Solidity name | `contract_x.f.<name>`, `contract_x.e.<Name>` | external.ts |
| procedure | `<concept>.<function name kebab-cased>`: `books.record-settled-payment-in-tx` | `procedure_<id with . and - → _>` | procedures.ts (payments' own door) / neighbors.ts (others') |
| rpc, public | the protocol row name kebab-cased: `payments.commands.prepare-organization` | `rpc_<id with . and - → _>` | the area file that implements it |
| rpc, internal | `payments.<area>.<operation file name>`: `payments.verifications.verify` | same rule | the area file |
| workflow | same id rule as an internal rpc, for operations that are scheduled, cron or triggered | `workflow_<…>` | the area file |
| flow | the SDK method kebab-cased: `client.payments.send` | `flow_<id with . and - → _>` | flows.ts |
| operation | the book id: `payment.send` | `operation_<id with . → _>` | operations.ts |

Ids must match `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$` (kebab-case; no camelCase). Codes are UPPER_SNAKE.

## Fidelity rules

- **Record what is, with evidence.** Every record has `was: ["<path>:<line>", …]` pointing at the
  old code it describes.
- **Do not fix the old design.** If the old code writes another concept's table directly, record
  the write: the build will report `write-boundary`, and that report is the finding.
- **Unknown is not invented.** No budget unless a measurement exists (omit `budget`). A refusal
  with no scenario world uses `given: "?"`. Input or output too deep to transcribe uses
  `Schema.Unknown` and says so in `about`.
- **Table fields**: translate Convex validators: `v.id(...)`/`v.string()` → `Schema.String`,
  `v.number()` → `Schema.Number`, `v.int64()` → `Schema.BigInt`, `v.boolean()` → `Schema.Boolean`,
  `v.optional(x)` → `Schema.optionalKey(x)`, `v.union(v.literal(...)…)` → `Schema.Literals([...])`,
  `v.object` → `Schema.Struct`, `v.array` → `Schema.Array`, `v.any()` → `Schema.Unknown`.
- **Internal operations** are rpcs (kind `query`, `mutation` or `action`) with `who: "internal: …"`,
  unless they are scheduled, cron-driven or triggered after another call: those are workflows.
  Telemetry-only operations (`emit-*`) are rpcs whose `about` starts with `Telemetry plumbing:`.
- Keep prose short: `title` ≤ 80, `about` ≤ 2000, lines ≤ 300 characters.
