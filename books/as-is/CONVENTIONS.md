# Booking the old system as it is: conventions for every writer

The **as-is** book records what the old system does today, including what is wrong with it. It is
evidence for the target design, not the target. The old code is read only, at `/home/user/factory`
(branch `integration/factory` of Xelmar-tech/infrastructure).

- Schema: `/home/user/capxul-next/packages/book/src/records/*.ts` (reading guide:
  `docs/spec/50-design-book.md`). A complete, reviewed example of a booked concept:
  `books/as-is/payments/` (read `commands.ts`, `data.ts`, `procedures.ts`, `flows.ts` before writing).
- Imports: the schema as `../../../packages/book/src/index.ts`; Effect as `effect`; shared records
  from `../shared/foundation.ts`, `../shared/vocabulary.ts`, `../shared/external.ts`; another
  concept's records from `../<concept>/<file>.ts` by the conventional export names below.
- Each file has one writer. Never define a record another file owns. If you need one, import it by
  its conventional name from the file that owns it, even if that file is being written right now;
  the assembly step reconciles names.
- `books/as-is/payments/neighbors.ts` holds stand-ins that payments needed for other concepts'
  tables and procedures. When you book a concept, define every one of its records listed there,
  with the **same id and export name**; the assembly step then deletes the stand-in.

## Folders

| What | File |
|---|---|
| system, components, concepts, environments | `shared/foundation.ts` (exists: all 17 concepts) |
| errors (all codes, exist) and events (the whole catalog) | `shared/vocabulary.ts` |
| integrations and contracts | `shared/external.ts` |
| a concept's tables and state machines | `<concept>/data.ts` |
| a concept's door: in-transaction functions other concepts call | `<concept>/procedures.ts` |
| a concept's rpcs and workflows, one file per area folder | `<concept>/<area>.ts` |
| the Core SDK flows of a concept (`packages/sdk/src/<concept>/`) | `<concept>/flows.ts` |
| a concept's module list | `<concept>/index.ts` (copy the shape of `payments/index.ts`, list only your files) |
| operation records, per old-book area | `operations/<area>.ts` |

## Ids and export names

| Kind | id | export name |
|---|---|---|
| table | the Convex table name, kebab-cased: `payment-commands` | `table_<id, - → _>` |
| machine | the entity, kebab: `payment`, `money-execution` | `machine_<id, - → _>` |
| transition | **always `to_<state>`**, one per target state, all sources in `from` | `machine_x.t.to_<state>` |
| procedure | `<concept>.<function name kebab>`: `books.record-settled-payment-in-tx` | `procedure_<id, . and - → _>` |
| rpc (public) | the protocol row name kebab-cased: `payments.commands.prepare-organization` | `rpc_<id, . and - → _>` |
| rpc (internal) | `<concept>.<area>.<operation file name>` | same rule |
| workflow | same id rule, for scheduled, cron, indexer or triggered work | `workflow_<…>` |
| flow | the SDK method path kebab-cased: `client.payments.send`, `client.org.books.accounts.add` | `flow_<id, . and - → _>` |
| operation | the old book id: `payment.send` | `operation_<id, . and - → _>` |
| error | the code | `error_<CODE>` |
| event | the catalog name | `event_<name>` |
| integration | the `src/integrations/<vendor>` folder | `integration_<id, - → _>`; calls `.c.<exported function name>` |
| contract | the Solidity contract, kebab | `contract_<id, - → _>`; `.f.<function>`, `.e.<Event>` |

Ids match `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$`: kebab-case, no camelCase. Codes are UPPER_SNAKE.

## Fidelity rules

- Every record has `was: ["<path>:<line>", …]` pointing at the old code it describes.
- **Record what is, not what should be.** A write into another concept's table is recorded as a
  write; the build reports `write-boundary`, and that report is the finding.
- **Unknown is not invented.** No budget unless measured (omit it). A refusal with no scenario world
  uses `given: "?"`. A shape too deep to transcribe is `Schema.Unknown`, said in `about`.
- Table fields: `v.id/v.string → Schema.String`, `v.number → Number`, `v.int64 → BigInt`,
  `v.boolean → Boolean`, `v.optional(x) → Schema.optionalKey(x)`, literal unions → `Schema.Literals`,
  `v.object → Struct`, `v.array → Array`, `v.any → Unknown`.
- Internal operations are rpcs with `who: "internal: …"`, unless scheduled, cron-driven, indexer-
  driven or triggered after another call: those are workflows. Telemetry-only operations are rpcs
  whose `about` starts with `Telemetry plumbing:`.
- Operations: build from the frozen text, never retype it:
  `defineOperation({ ...frozenText("payment.send"), priority, implementedBy, acceptance: frozenClaims("payment.send"), returns, refusals, errors? })`,
  imported from `../../frozen/index.ts`. `implementedBy` is the flow the CLI command's SDK method
  is, when it composes several calls, else the one rpc it reaches. `errors` lists what the CLI command
  produces itself (`CLI_USAGE`).
- Typecheck your files: `cd /home/user/capxul-next && npx tsc -p books 2>&1 | grep "as-is/<your folder>"`.
  Fix every error in your files except unresolved imports of sibling files being written now.
- Keep prose short: `title` ≤ 80, `about` ≤ 2000, a line ≤ 300 characters.
