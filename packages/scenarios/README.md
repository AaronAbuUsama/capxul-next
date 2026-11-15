# scenarios

The thin line's journeys and each operation's checks (roadmap step 1.14; docs/roadmap.md, "Scenarios are
journeys", 14 November 2026). A journey is a story of operations in order, from one of the blueprint's starting
worlds; every call a journey makes is judged by its operation's checks, written once, which run on every call of
that operation in every journey. The runner (`packages/runner`) runs each journey in its one world, reset in place to
the journey's starting world, and adds its generic checks to every call: declared events, spans, and the timings it
records. So neither a journey nor a check judges those.

The journeys and the checks are written by an agent other than the builder, from the blueprint, and each journey
must fail at its first step against Core's empty handlers, which answer every call with `NotImplemented`. A builder
never changes this package.

| File | What it holds |
|---|---|
| `src/door.ts` | The door: everything below. The runner imports it. |
| `src/journey.ts` | The format: `outline` (a journey's steps) and `journey`. |
| `src/tries.ts` | How a step calls its operation: `succeeds`, `answers`, `refused`, `until`, `whileRefused`. Each try reads what the checks need, calls, holds the answer against what the step expects, then runs every check of the operation. |
| `src/journal.ts` | `Steps`, the runner's ear (each step's beginning, each try with its checks' outcomes, each end), and `Journal`, what a journey keeps while it runs. |
| `src/checks/` | One file per operation: its checks, on its successes and on each of its refusals. `format.ts` is the format and `OperationChecks`, the service a step's tries read them from; `all.ts` gathers every domain's, which the compiler holds complete. |
| `src/journeys/` | One file per journey, and what journeys share (`signatures.ts`, `books.ts`). |
| `src/domain.ts` | The format of one domain's scenarios: its operations' checks, the journeys it leads and its claims' places (`at`). |
| `src/domains/` | One file per domain of the blueprint (`world.ts`, `organizations.ts`, `people.ts`, `budgets.ts`, `documents.ts`, `approvals.ts`, `reports.ts`, `record.ts`), in that format. |
| `src/domains.ts` | Every domain's file, once, by the blueprint's name for it. The compiler asks for an entry for each domain of the blueprint. |
| `src/registry.ts` | `journeys`, every journey the runner runs, in order: each domain's, domain by domain, each given every operation's checks. |
| `src/coverage.ts` | Where each claim of claims.md is checked, by which operations' checks and which journeys' steps: each domain's places, gathered. |
| `src/client.ts` | `Capxul`, the one client a journey and a check call through, and `Given`, its starting world's facts. |
| `src/expectation.ts` | `ExpectationFailed`, `expect` and `given`. |
| `src/support/` | Reads of a world shared by checks and journeys: its view and record (`world.ts`), its chain (`chain.ts`, `hats.ts`, `budgets.ts`), its books (`site.ts`), signing with the cast's keys (`signing.ts`), waits (`wait.ts`). |
| `test/registry.test.ts` | Unique names; at least two journeys, each of 5 to 10 steps, from declared starting worlds; between them every operation. |
| `test/coverage.test.ts` | Every claim of every operation has its place, and every step it names exists. |
| `test/empty-handlers.test.ts` | Every journey fails at its first step against a Capxul whose every operation answers `NotImplemented`, on the `NotImplemented` its own operation answered, and none passes or dies. It checks `records/empty-handlers/` against the run: one file per registered journey, no other. |
| `records/empty-handlers/` | The record of that run in memory, one file per journey (`<journey name>.json`), so slices adding journeys write different files. Written by `pnpm record`, never by hand. The deployed run is the runner's (`packages/runner/records/`). |

## The journeys

| Journey | Given | Steps |
|---|---|---|
| two operators and their worlds (`journeys/two-operators.ts`) | `quota-full` | 1 `world.create`: the first operator, at the limit, is refused (`WorldQuotaReached`). 2 `world.create`: the second is refused a real world (`GradeNotOffered`) and one before the seed (`ClockBeforeSeed`). 3 `world.create`: the second opens a world halfway between the seed and host time, and cannot open it twice (`WorldExists`). 4 `world.show`: the new world as made, the first operator's world as theirs, no world for an unknown name (`WorldNotFound`). 5 `record.export`: the owner reads it; each person of the cast is signed in at its door and refused (`NotWorldOwner`). 6 `world.clock.warp`: dana may not move the clock (`NotWorldOwner`). 7 `world.snapshot.save`: the first operator (`NotWorldOwner`) and an unknown world (`WorldNotFound`) are refused; m3 is saved, not twice (`SnapshotExists`), then replaced, and draft is saved. 8 `world.snapshot.restore`: `SnapshotNotFound`, `WorldExists`, `ExpiryBeyondSource`, and the first operator, at the limit, `WorldQuotaReached`. |
| found Northwind and give sam the books (`journeys/found-northwind.ts`) | `fresh` | 1 `org.create`: `FounderNotReady` (pat), `PersonNotFound` (a Director, a member), `InsufficientBalance`, `PayloadRejected` (a bio of 281, and a typed payload with spaces around its bio and size). 2 `org.create`: dana founds Northwind as she typed it, decoded as the command line decodes it (bio and size trimmed); the same founding is `Resumed`; `FoundingChanged`, `HandleTaken`, `SetupUnfinished`. 3 `approval.sign`: dana `Collected`, eli `Sent`; the board and capital on the chain. 4 `world.show`: until the site is ready; everything the world was made with. 5 `org.member.grant`: `NotADirector`, `NotAMember`, `MemberHasNoSafe` (three permissions), manage-books for sam proposed with a note, `ChangeWaiting`; sam still has no site user. 6 `approval.sign`: dana `Collected`, eli `Sent`; the Books hat on sam's Safe. 7 `doc.create`: `NoSiteUser` (pat); sam, once his user reaches the site, makes Brightside; `SiteRefused` for validation and for permission. 8 `report.run`: the Supplier list is Brightside alone; `NoSiteUser`, `SiteRefused` (permission, not found). 9 `org.member.grant`: `AlreadyHeld`; manage-people for sam proposed. 10 `approval.sign`: the People hat on sam's Safe. |
| pay Brightside and branch the books (`journeys/pay-and-branch.ts`) | `payment-drafted` | 1 `doc.create`: a second invoice and a payment of 5,000. 2 `doc.submit`: `InsufficientBalance`, the second invoice `Posted`, the drafted payment `Held` with doc.create's hash, `NotADraft`. 3 `world.snapshot.save`: m3 (a template) and draft while the payment is held; nothing else changes. 4 `world.snapshot.restore`: the second operator is refused draft (`NotWorldOwner`) and restores m3 into a world of their own, which holds its books, balances, clock and sam's hat. 5 `approval.sign`: `SignatureInvalid`, `ApprovalNotFound`, `NotYourApproval`, `Sent`, `AlreadySent`; the branch sees none of it. 6 `report.run`: the books agree with the chain; the invoice is paid. 7 `doc.create`: a Supplier in the branch, which the first world never sees. 8 `world.clock.warp`: the branch a week on (its daily job runs seven times), `ClockBackwards`, then past the held approval's expiry. 9 `approval.sign`: `ApprovalExpired` in the branch; nothing sent. 10 `record.export`: every event once, in order; a range; past the head; the branch's lineage. |
| invite olga to Northwind (`journeys/invite-olga.ts`) | `founded` | 1 `org.member.list`: dana and eli Directors, sam and pat members; the owner sees the same; olga `NotAMember`, `OrgNotFound`. 2 `org.member.invite`: `CannotManagePeople` (sam, olga), `AlreadyAMember` (sam, eli), `OrgNotFound`, `PayloadRejected`; dana invites olga, pending with nothing signed; `AlreadyInvited`; rex@elsewhere.test invited. 3 `invite.list`: olga's one invitation; sam none. 4 `invite.decline`: `NotYourInvitation` (sam), olga declines, `InvitationClosed`, `InvitationNotFound`. 5 `org.member.invite`: eli invites olga again. 6 `invite.accept`: `InvitationClosed`, `InvitationNotFound`, `NotYourInvitation`; olga `Accepted`, then `AlreadyAccepted`. 7 `invite.list`: dana's declined, eli's accepted; nobody lists rex's. 8 `org.member.list`: olga last, as a member. 9 `org.member.invite`: `AlreadyAMember` (olga). 10 `org.member.grant`: issue-invoices for olga proposed. |
| give sam a budget at Northwind (`journeys/budget-sam.ts`) | `founded` | 1 `org.budget.list`: the top budget alone, 1,000,000 USDC a month, all left, of the Books hat, held by nobody; the owner sees the same; olga `NotAMember`, `OrgNotFound`. 2 `org.budget.show`: the top budget as dana and sam read it; olga `NotAMember`, `BudgetNotFound`, `OrgNotFound`. 3 `org.budget.create`: `NotADirector` (sam), `NotAMember` (olga, zed), `MemberHasNoSafe` (pat), `BudgetNotFound`, `ExceedsParent` (1,000,000.000001), `PayloadRejected` (an amount of 0, an empty name), `OrgNotFound`. 4 `org.budget.create`: dana proposes Office costs, 1,000 for sam inside the top budget, monthly in USDC; not listed yet. 5 `approval.sign`: dana `Collected`, eli `Sent`; one BudgetCreated inside the top budget, of a hat minted to sam's Safe; 1,000 on the chain, the top budget 999,000 left. 6 `org.budget.show`: sam's budget, held by sam, as sam and dana read it. 7 `org.budget.list`: both, the top first, 999,000 left. 8 `org.budget.create`: `ExceedsParent` (999,000.000001); Cleaners, 200 for sam, proposed inside Office costs. |

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

List it in its domain's `journeys` (`src/domains/<domain>.ts`), and place the claims it checks in that domain's
`coverage`: see "Adding a journey".

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

## Adding a journey

Every list of this package is kept per domain of the blueprint, so several slices can add journeys and operations at
once without editing the same file. Each domain of the blueprint has one file, `src/domains/<domain>.ts`, holding
`checks` (each of its operations' checks), `journeys` (the journeys it leads, in the order they run) and `coverage`
(the place of each claim of each of its operations, in claims.md's order). `checks/all.ts`, `registry.ts` and
`coverage.ts` gather them; none of them names a journey or an operation.

**A new journey** of a domain touches:

1. `src/journeys/<journey>.ts`, a new file declaring it (above). What several journeys share goes in a file of its own
   beside them, or in `src/support/`.
2. `src/domains/<domain>.ts`: the journey in `journeys`, and in `coverage` the steps that check the claims of the
   domain's operations.
3. `records/empty-handlers/<journey name>.json`, a new file written by `pnpm record` (below).

**A new operation's checks**, in an existing domain, touch:

1. `src/checks/<operation>.ts`, a new file (above, "Writing an operation's checks").
2. `src/domains/<domain>.ts`: the checks in `checks`, and one place per claim in `coverage`. The compiler fails until
   both have the operation, once the blueprint declares it.

**A new domain** is a new file `src/domains/<domain>.ts` with the three exports, `Domain<typeof Blueprint.<Domain>>`,
and one import and one entry in `src/domains.ts`. The compiler asks for that entry as soon as the blueprint declares the
domain. The journeys run domain by domain, in the order of `src/domains.ts`.

Nothing is found by walking the disk. A typed list per domain keeps what the registry always held: a journey or a
check that is not listed does not run, the compiler sees every one, and it holds that every operation has its checks
and its claims' places. Discovery would need the disk at run time and a dynamic import, and would find only files,
not whether each operation has its checks.

A journey's file never imports an operation's checks: a step's tries read them from `OperationChecks`, which the
registry provides to each journey it registers. So a domain's file can list both its checks and its journeys without
the two importing each other.

## Checks

`pnpm types` and `pnpm test`. `pnpm record` rewrites `records/empty-handlers/` from a run, one file per journey, and
removes the files of journeys no longer registered; `pnpm test` fails when the committed files and a run differ.
