# scenarios

The thin line's journeys and each operation's checks (roadmap step 1.14; docs/roadmap.md, "Scenarios are
journeys", 14 November 2026). A journey is a story of operations in order, from one of the blueprint's starting
worlds; every call a journey makes is judged by its operation's checks, written once, which run on every call of
that operation in every journey. The runner (`packages/runner`) runs each journey in a world of its own and adds its
generic checks to every call: declared events, spans, and the timings it records. So neither a journey nor a check
judges those.

The journeys and the checks are written by an agent other than the builder, from the blueprint, and each journey
must fail at its first step against Core's empty handlers, which answer every call with `NotImplemented`. A builder
never changes this package.

| File | What it holds |
|---|---|
| `src/door.ts` | The door: everything below. The runner imports it. |
| `src/journey.ts` | The format: `outline` (a journey's steps) and `journey`. |
| `src/tries.ts` | How a step calls its operation: `succeeds`, `answers`, `refused`, `until`, `whileRefused`. Each try reads what the checks need, calls, holds the answer against what the step expects, then runs every check of the operation. |
| `src/journal.ts` | `Steps`, the runner's ear (each step's beginning, each try with its checks' outcomes, each end), and `Journal`, what a journey keeps while it runs. |
| `src/checks/` | One file per operation: its checks, on its successes and on each of its refusals. `format.ts` is the format, `all.ts` the set of all twelve, which the compiler holds complete. |
| `src/journeys/` | The three journeys, and what they share (`signatures.ts`, `books.ts`). |
| `src/registry.ts` | `journeys`, every journey the runner runs, in order. |
| `src/coverage.ts` | Where each claim of claims.md is checked: by which operations' checks and which journeys' steps. |
| `src/client.ts` | `Capxul`, the one client a journey and a check call through, and `Given`, its starting world's facts. |
| `src/expectation.ts` | `ExpectationFailed`, `expect` and `given`. |
| `src/support/` | Reads of a world shared by checks and journeys: its view and record (`world.ts`), its chain (`chain.ts`, `hats.ts`), its books (`site.ts`), signing with the cast's keys (`signing.ts`), waits (`wait.ts`). |
| `test/registry.test.ts` | Unique names; two or three journeys of 5 to 10 steps each, from declared starting worlds; between them every operation. |
| `test/coverage.test.ts` | Every claim of every operation has its place, and every step it names exists. |
| `test/empty-handlers.test.ts` | Every journey fails at its first step against a Capxul whose every operation answers `NotImplemented`, on the `NotImplemented` its own operation answered, and none passes or dies. It checks `records/empty-handlers.json` against the run. |
| `records/empty-handlers.json` | The record of that run in memory. Written by `pnpm record`, never by hand. The deployed run is the runner's (`packages/runner/records/`). |

## The journeys

| Journey | Given | Steps |
|---|---|---|
| two operators and their worlds (`journeys/two-operators.ts`) | `quota-full` | 1 `world.create`: the first operator, at the limit, is refused (`WorldQuotaReached`). 2 `world.create`: the second is refused a real world (`GradeNotOffered`) and one before the seed (`ClockBeforeSeed`). 3 `world.create`: the second opens a world halfway between the seed and host time, and cannot open it twice (`WorldExists`). 4 `world.show`: the new world as made, the first operator's world as theirs, no world for an unknown name (`WorldNotFound`). 5 `record.export`: the owner reads it; each person of the cast is signed in at its door and refused (`NotWorldOwner`). 6 `world.clock.warp`: dana may not move the clock (`NotWorldOwner`). 7 `world.snapshot.save`: the first operator (`NotWorldOwner`) and an unknown world (`WorldNotFound`) are refused; m3 is saved, not twice (`SnapshotExists`), then replaced, and draft is saved. 8 `world.snapshot.restore`: `SnapshotNotFound`, `WorldExists`, `ExpiryBeyondSource`, and the first operator, at the limit, `WorldQuotaReached`. |
| found Northwind and give sam the books (`journeys/found-northwind.ts`) | `fresh` | 1 `org.create`: `FounderNotReady` (pat), `PersonNotFound` (a Director, a member), `InsufficientBalance`, `PayloadRejected` (a bio of 281). 2 `org.create`: dana founds Northwind (bio and size trimmed); the same founding is `Resumed`; `FoundingChanged`, `HandleTaken`, `SetupUnfinished`. 3 `approval.sign`: dana `Collected`, eli `Sent`; the board and capital on the chain. 4 `world.show`: until the site is ready; everything the world was made with. 5 `org.member.grant`: `NotADirector`, `NotAMember`, `MemberHasNoSafe` (three permissions), manage-books for sam proposed with a note, `ChangeWaiting`; sam still has no site user. 6 `approval.sign`: dana `Collected`, eli `Sent`; the Books hat on sam's Safe. 7 `doc.create`: `NoSiteUser` (pat); sam, once his user reaches the site, makes Brightside; `SiteRefused` for validation and for permission. 8 `report.run`: the Supplier list is Brightside alone; `NoSiteUser`, `SiteRefused` (permission, not found). 9 `org.member.grant`: `AlreadyHeld`; manage-people for sam proposed. 10 `approval.sign`: the People hat on sam's Safe. |
| pay Brightside and branch the books (`journeys/pay-and-branch.ts`) | `payment-drafted` | 1 `doc.create`: a second invoice and a payment of 5,000. 2 `doc.submit`: `InsufficientBalance`, the second invoice `Posted`, the drafted payment `Held` with doc.create's hash, `NotADraft`. 3 `world.snapshot.save`: m3 (a template) and draft while the payment is held; nothing else changes. 4 `world.snapshot.restore`: the second operator is refused draft (`NotWorldOwner`) and restores m3 into a world of their own, which holds its books, balances, clock and sam's hat. 5 `approval.sign`: `SignatureInvalid`, `ApprovalNotFound`, `NotYourApproval`, `Sent`, `AlreadySent`; the branch sees none of it. 6 `report.run`: the books agree with the chain; the invoice is paid. 7 `doc.create`: a Supplier in the branch, which the first world never sees. 8 `world.clock.warp`: the branch a week on (its daily job runs seven times), `ClockBackwards`, then past the held approval's expiry. 9 `approval.sign`: `ApprovalExpired` in the branch; nothing sent. 10 `record.export`: every event once, in order; a range; past the head; the branch's lineage. |

## Declaring a journey

```ts
const steps = outline({
  found: ["org.create", "dana founds Northwind"],
  sign: ["approval.sign", "dana and eli sign its setup"],
});

export const founding = journey(
  { name: "found Northwind", story: "…", given: startingWorlds.fresh, steps },
  Effect.gen(function* () {
    const founded = yield* steps.found.run((op) => op.answers("Founded", NORTHWIND_FOUNDING, { as: "dana" }));
    yield* steps.sign.run((op) => /* op.answers("Collected", …), op.answers("Sent", …) */);
  }),
);
```

Register it in `src/registry.ts`, and place the claims it checks in `src/coverage.ts`.

- A step calls one operation, once or a few times; each call says what it expects: `op.succeeds`, `op.answers(kind)`,
  `op.refused(tag)`, or a wait (`op.until`, `op.whileRefused`). Anything else fails the step: a `NotImplemented` as
  itself, anything else as `ExpectationFailed`. Steps run in the outline's order, each once.
- After its tries a step may read the world to observe what the story alone knows (`expect`, `same`, reads in
  `src/support/`). Those reads are looks: the runner checks them generically, but no operation's checks run on them.
- `{ as: "dana" }` acts as a person of the cast; `{ operator: "second" }` signs in as the second operator; `{ at:
  view.door }` calls another world's door.
- `yield* given(startingWorlds.paymentDrafted)` answers the facts of the starting world, or of one it is made from.

## Writing an operation's checks

`src/checks/<operation>.ts` declares `checks({ before, success, refusals })`: what it reads before every call, and
the checks of a success and of each refusal, each a sentence and the Effect that fails when it does not hold. A
claim about a refusal is a step of a journey that is refused, and the check of that refusal lives here.

## Checks

`pnpm types` and `pnpm test`. `pnpm record` rewrites `records/empty-handlers.json` from a run; `pnpm test` fails
when the committed record and a run differ.
