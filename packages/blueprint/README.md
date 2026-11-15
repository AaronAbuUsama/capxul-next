# blueprint

The blueprint: what Capxul does, declared once as Effect code that the product imports. (Named `blueprint` so it is not confused with the Solidity contracts in `packages/contracts`.)

The thin line's contract (roadmap step 1.1): twelve operations declared as Effect code, with their refusals, the
events each kind of success emits and what each carries, one speed budget each, and numbered acceptance claims.
Declarations only: nothing here implements an operation or imports infrastructure. The servers and every client
import it; it imports neither.

| File | What it holds |
|---|---|
| `src/door.ts` | The one door: `operations` (every operation, by name), the two Rpc groups, `servedBy`, and `allClaims`, every claim, which the journeys' `coverage.ts` places. It gathers them from the domains and names none. |
| `src/domains.ts` | Every domain, by its folder: the one list a new domain joins. Its order is the order of `operations` and of each group. |
| `src/<domain>/` | One domain: `world`, `organizations`, `people`, `board`, `documents`, `approvals`, `reports`, `record`. Below. |
| `src/<domain>/` | One domain: `world`, `organizations`, `people`, `budgets`, `documents`, `approvals`, `reports`, `record`. Below. |
| `src/operation.ts` | The format: `declare`, `declareOutcomes`, `outcome`, `Budget`, and what the runner reads. |
| `src/machine.ts` | The machine format: `make`, and what it derives from a declaration. Below, "Machines". |
| `src/errors.ts` | Every refusal with its command-line exit code, gathered from the files that declare them: each domain's `refusals.ts`, and `src/errors/` for those several domains share (who is calling, a company and its site, `NotImplemented`, which every operation declares, decisions.md entry 33, and `PayloadRejected`, which the caller's own client makes, entry 43). |
| `src/gather.ts` | How a hub gathers its parts' records into one. |
| `src/values.ts` | The shared values: names, ids (declared in `src/ids.ts`), instants, money, approvals and their `Subject`, gathered from the domains' `subjects.ts`, the view of a world. |
| `src/telemetry.ts` | The trace, credential and person headers, the doors' paths (`PLATFORM_PATH`, `WORLD_PATH`, `CHAIN_PATH`) and the chain's read-only methods, `CallOptions` (`as`, `operator`, `at`), `Telemetry`, and the two sign-in middlewares. |
| `src/chain/` | The chain reads a caller makes through a world's door (`reads.ts`) and the logs they decode (`logs.ts`), with the contracts' Solidity signatures: `Chain` at the door. |
| `src/documents/site.ts` | The site's vocabulary: doctypes, field names, reports, filters, row fields, the Safe account, the daily job, the starting worlds' documents: `Site` at the door. |
| `src/starting-worlds.ts` | Every starting world whose state the claims speak of, how each is made and how a journey gets it (`made`). |
| `src/starting/facts.ts` | The facts each starting world hands a journey, and one example of each. |
| `claims.md` | What every claim shares, what the runner checks on every call, and the starting worlds. Rendered; do not edit. |
| `decisions.md` | Every design call, and the questions for Aaron. |
| `gaps.md` | The claims the scenario author could not check in full, by cause, and how each was closed, and the points still open. |
| `order.md` | The order to build the operations in: the parts of a world, and what can be built at the same time. |

A domain's folder, `src/<domain>/`:

| File | What it holds |
|---|---|
| `domain.ts` | Its door: `operations` (its own, by name), `platformRpcs` and `worldRpcs` (its share of each group, `RpcGroup.make()` when it has none), and `claims`, each operation's. It re-exports `operations.ts`, so the package's door exports it as the domain's namespace (`World`, `Organizations`, ...). |
| `operations.ts` | Its operations' declarations and events. |
| `claims.ts` | Its acceptance claims. |
| `machines.ts` | Its machines (`people`: the invitation's), which `domain.ts` lists in `machines`. Every other domain's `machines` is empty for now. |
| `refusals.ts` | The refusals only its operations make, each with its exit code (`refusals`, `exitCode`). None in `reports`. |
| `subjects.ts` | What its approvals authorise, when its operations ask for any: `organizations`, `board` and `documents`. |
| `subjects.ts` | What its approvals authorise, when its operations ask for any: `organizations`, `budgets` and `documents`. |
| `claims.md` | Its operations' claims, refusals, events and budgets. Rendered by `pnpm claims`; do not edit. |
| `order.md` | Where each of its operations comes in the build order, and what it needs. |

## The operations

The thin line's twelve, as the journey calls them. A later operation is listed in its domain's `claims.md`.

| # | Operation | Served by | Kinds of success and their events |
|---|---|---|---|
| 1 | `world.create` | platform | `world_created` |
| 2 | `org.create` | world | `Founded`: `org_founded`; `Resumed`: none |
| 3 | `org.member.grant` | world | `officer_change_proposed`, `proposal_opened` |
| 4 | `doc.create` | world | `doc_created` |
| 5 | `doc.submit` | world | `Posted`: `doc_submitted`; `Held`: `payment_held` |
| 6 | `approval.sign` | world | `Collected`: `approval_signed`; `Sent`: `approval_signed`, `approval_landed`; `AlreadySent`: none |
| 7 | `report.run` | world | none |
| 8 | `world.clock.warp` | world | `clock_warped` |
| 9 | `record.export` | world | none |
| 10 | `world.snapshot.save` | platform | `snapshot_saved` |
| 11 | `world.snapshot.restore` | platform | `world_created` |
| 12 | `world.show` | platform | none |

Refusals and budgets are in each domain's `claims.md`. The platform group is served by `packages/world`; the world group by a world's
Core, through its door. Each group's `toLayer` does not compile until every operation in it has a handler.

## Machines

A thing with a lifecycle that callers see and refusals depend on is a machine (docs/roadmap.md, "Lifecycles are
machines in the blueprint"), declared once in its domain's `machines.ts` with `Machine.make` (`src/machine.ts`): its
states, its start (the state, the operation that makes it and the event it sends), and its moves, each with the states
it starts `from`, the state it goes `to`, the operation `by` which it is made, the `event` it sends, and `otherwise`,
what it does from every other state: `{ refusal }`, a declared refusal, or `"unchanged"`. The type refuses an
`otherwise` that misses a state or names one in `from`. A machine names its operations, events and refusals by their
tags, since their declarations import its schemas; `test/machines.test.ts` proves each is declared. From the
declaration come `State` (the state schema), `refusedStates` and `RefusedState` (the closing refusal's `state` field),
`step` (what a move does from a state: `Moved`, `Unchanged` or `Refused`; Core moves the thing through it and nothing
else), `graph` (Effect's `Graph`), `diagram` (rendered into the domain's `claims.md`) and `check(column)` (the SQL
CHECK constraint, which Core's migrations hold; a change of states is a new migration). The door's `machines` holds
every machine by name, and the runner's path check reads each thing's events against it. The machines are flat: no
nested or parallel states, and no guards that run code.

## Adding an operation

Every hub of the blueprint is gathered from the domains, so several slices can add operations at once without editing
the same file.

**To an existing domain**, touch only that domain's folder, `src/<domain>/`:

1. Declare its events in `operations.ts`, and any refusal no other domain makes in `refusals.ts`, with its exit code
   (2 the request cannot be done as asked, 3 not signed in, 4 not allowed, 5 something outside failed, 6 a limit or
   a switch). A refusal several domains share goes in `src/errors/`. Every operation also lists `NotImplemented`.
2. Declare it in `operations.ts` with `declare({ rpc, emits, budget, examples })`, or with `declareOutcomes` and one
   `outcome` per member of a success union. Give one example per kind of success.
3. In `domain.ts`, add it to `operations`, to `platformRpcs` or `worldRpcs`, and its claims (written in `claims.ts`)
   to `claims`. If its approvals authorise a new kind of subject, add the kind to `subjects.ts`.
4. Add its row to `order.md`, then run `pnpm claims` to render the domain's `claims.md`, then `pnpm types` and
   `pnpm test`.

**A new domain** is a new folder with the files above, and one entry in each hub it needs:

- `src/domains.ts`: one import, and the folder in `domains` and in the export line. Nothing else names operations:
  `operations`, both groups, `allClaims` and the rendered `claims.md` follow from it.
- `src/errors.ts`, if it has refusals of its own: one import, one `export *` and one entry in `declaring`.
- `src/values.ts`, if its approvals authorise subjects: one import, and its `subjects` in `Subject`.

Core (`packages/core`) then needs the domain's handlers: see its README, "Adding an operation".

A budget is provisional until a green run measures the operation. That run's p95 then replaces `ms` and `basis` in
the declaration, and `provisional` becomes false. A budget is recorded next to every measured time and is not
enforced: nothing fails on speed until it is set from measured runs.

## Checks

It is a member of the root workspace: `pnpm install` at the root installs it. `pnpm types` type-checks
the package, including `test/types.ts`, whose lines marked `@ts-expect-error` prove the compiler refuses a `carries`
that does not fit. `pnpm test` runs `test/contract.test.ts`: every domain's operations once, each in its group with its group's
middlewares (the thin line's twelve among them), each example's events carrying exactly their event's fields,
nothing declared twice, claims that name only declared refusals and starting worlds, every `claims.md` in step with
its sources, and each domain's `order.md` listing its operations.
