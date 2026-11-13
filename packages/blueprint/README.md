# blueprint

The blueprint: what Capxul does, declared once as Effect code that the product imports. (Named `blueprint` so it is not confused with the Solidity contracts in `packages/contracts`.)

The thin line's contract (roadmap step 1.1): twelve operations declared as Effect code, with their refusals, the
events each kind of success emits and what each carries, one speed budget each, and numbered acceptance claims.
Declarations only: nothing here implements an operation or imports infrastructure. The servers and every client
import it; it imports neither.

| File | What it holds |
|---|---|
| `src/door.ts` | The one door: `operations` (the twelve, by name), the two Rpc groups, `servedBy`, and `allClaims`, which scenarios name the claim they prove by. |
| `src/operation.ts` | The format: `declare`, `declareOutcomes`, `outcome`, `Budget`, and what the runner reads. |
| `src/errors.ts` | Every refusal, declared once, with its command-line exit code, `NotImplemented` included (every operation declares it; decisions.md, entry 33). |
| `src/values.ts` | The shared values: names, ids, instants, money, approvals, the view of a world. |
| `src/telemetry.ts` | The trace header, `Telemetry`, and the two sign-in middlewares. |
| `src/starting-worlds.ts` | Every starting world the claims begin from, and how each is made. |
| `src/<concept>/operations.ts` | A concept's operations and events: `world`, `organizations`, `documents`, `approvals`, `reports`, `record`. |
| `src/<concept>/claims.ts` | Its acceptance claims. `src/claims/` renders them into claims.md. |
| `claims.md` | Every operation's claims, refusals, events and budget, and the starting worlds. Rendered; do not edit. |
| `decisions.md` | Every design call, and the questions for Aaron. |
| `order.md` | The order to build the twelve in, and the starting worlds each needs. |

## The operations

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

Refusals and budgets are in claims.md. The platform group is served by `packages/world`; the world group by a world's
Core, through its door. Each group's `toLayer` does not compile until every operation in it has a handler.

## Adding or changing an operation

1. Declare its refusals in `src/errors.ts` (add each to `refusals` and `exitCode`; every operation also lists
   `NotImplemented`), and its events in its concept's `operations.ts`.
2. Declare it with `declare({ rpc, emits, budget, examples })`, or with `declareOutcomes` and one `outcome` per
   member of a success union. Give one example per kind of success.
3. Add it to `operations` and to one Rpc group in `src/door.ts`, and its claims to its concept's `claims.ts` and to
   `src/claims/all.ts`.
4. Run `pnpm claims` to render claims.md, then `pnpm types` and `pnpm test`.

A budget is provisional until a green run measures the operation. That run's p95 then replaces `ms` and `basis` in
the declaration, and `provisional` becomes false. A budget is recorded next to every measured time and is not
enforced: nothing fails on speed until it is set from measured runs.

## Checks

It is a member of the root workspace: `pnpm install` at the root installs it. `pnpm types` type-checks
the package, including `test/types.ts`, whose lines marked `@ts-expect-error` prove the compiler refuses a `carries`
that does not fit. `pnpm test` runs `test/contract.test.ts`: twelve operations, each example's events carrying
exactly their event's fields, nothing declared twice, claims that name only declared refusals and starting worlds,
and claims.md and order.md in step with the sources.
