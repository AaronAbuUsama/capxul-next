# Decisions behind the thin line's contract

Every design call made in writing this package, one short entry each: the question, the options, the choice and
why. The old blueprint's records (`docs/thin-line/operations.md` on the branch `claude/epic-allen-0n48sq`) were read
as a list of behaviours to consider, not as canon. Its names, flags, shapes and refusal codes were not kept for their
own sake.

Questions only Aaron can answer are at the end, under "For Aaron". The contract compiles with the recommended
option of each, marked provisional.

## Rules set by Aaron (13 November 2026, through the lead)

**1. No JSON in strings.** Payloads and results are fully typed Schemas. No field carries JSON text to be parsed
later. A document's fields, a report's filters and rows, and a record entry's `carried` are typed as JSON values
(`Schema.Json`, `Values.Fields`). The old `--filters '<json>'` and `--input <file>` have no counterpart.

**2. One source for each speed budget.** A budget is declared once, on the operation (`budget` in its declaration),
and nowhere else: no class defaults, no budgets on internal steps. Each budget says what it measures (the p95 of the
server's own span for the call, over warm runs), which waits it leaves out, whether it is provisional, and its
basis. Internal steps are spans, reported as a breakdown of the operation's time. Every budget here is provisional;
the first green run's measurement replaces the number and the basis in the declaration.

**3. One name and one place for every other fact.** Every refusal is declared in `src/errors.ts`; every event in
its concept's `operations.ts`; every starting world in `src/starting-worlds.ts`; every claim in its concept's
`claims.ts`. Everything else imports them. claims.md is rendered from the sources and a test fails when it differs.
`test/contract.test.ts` fails when any event, outcome, refusal or service tag is defined twice, when a refusal is
defined outside `errors.ts`, or when a claim names a starting world or a refusal that is not declared for it.

## The format

**4. Several kinds of success.** `doc.submit` either posts a document or holds a payment; `approval.sign` either
keeps a signature, sends a transaction, or answers a replay. Options: one success shape with optional fields; split
each into two operations; a tagged union of outcomes, each declaring its own events. Chosen: the union. Each outcome
is a `Schema.TaggedClass`, declared with `outcome(rpc, tag, emits)`, and `carries` is typed by that outcome alone.
Leaving an outcome undeclared is a compile error. Why: the caller cannot choose the path (the document decides), so
two operations would be wrong, and optional fields would let an event read a field its path does not have.

**5. How the spike's format is extended.** Five additions, all in this package: `declareOutcomes` and `outcome`
(entry 4); `budget` in place of `budgetMs`, with `budgetMs` still derived for the spike's runner; `examples`, one
valid call per outcome, which the tests run through every `carries`; `refusalsOf`, which lists an operation's
refusal classes; and two sign-in middlewares (entry 16). `Operation` keeps every field the spike's runner reads
(`rpc`, `emits`, `budgetMs`, `expected`), so the runner works unchanged.

**6. What an event carries.** The old events carried values that were in neither the payload nor the result
(`epoch`, `person_id`, `nonce`). Chosen: an event carries a pure function of the payload and the answer, and where
an event needs a value, the answer carries it too (`org.create` answers `founder`; `org.member.grant` answers the
proposal's `nonce`). Events are named for what happened (`doc_created`, `payment_held`), not for a state machine's
transition. Why: the runner computes what each event must carry from what the caller saw; nothing else is checkable.

**7. Events of work after the answer.** A payment settles and a site is created after the call that started them
has answered. Chosen: such events are not a call's declared events. They go into the world's record under their own
trace. Why: "each declared event exactly once per successful call" must be decided when the call answers.

**8. The record is the world's events.** The old record was a separate log of commands. Chosen: a world's record is
the ordered list of every event emitted in it; `world_created` is its first entry; a world made from a snapshot
begins with its source's entries up to the snapshot. Why: one log instead of two that must agree, and the export is
the history the training data needs. A read emits nothing, so it adds nothing.

**9. Refusals and shape faults.** Chosen: a refusal is a typed error with the fields a caller needs to act, declared
once in `errors.ts` with its command-line exit code. A payload of the wrong shape (a hyphen too many, a negative
duration, a bio of 281 characters) is rejected by its schema before a handler runs, and is not a refusal. Why: the
compiler and the client then hold the shape, and a refusal always needs the world's state to decide.

**10. Old codes not kept.** `CLI_USAGE`, `CLI_DEADLINE`, `CLI_STORAGE` and `CANCELLED` are the command line's, not
the door's. `CAPACITY_REACHED` (one machine's room) became `WorldQuotaReached` (an owner's live worlds).
`FEATURE_NOT_AVAILABLE` (gates and the waitlist), `ROLE_CONFLICT` (budgets' offices), `PAYROLL_BUDGET_EXCEEDED`,
`AUTHORISED_EXCEEDED`, `INVALID_RECIPIENT` and `SUPERSEDED` belong to journeys outside the thin line.
`WRONG_ENVIRONMENT`, `WORK_DIED`, `PROVIDER_ERROR` and `PROVIDER_RESPONSE_INVALID` are faults, not refusals: they
travel as defects, and the runner reports them as failed calls. Two faults a caller can act on stay typed:
`SiteUnavailable` and `TransactionReverted`.

## Worlds

**11. Who serves a world operation.** A world's Core cannot create the world it runs in. Chosen: two Rpc groups.
`PlatformRpcs`, served by the platform's world service (`packages/world`), holds what must work while a world is
parked or does not exist: `world.create`, `world.show`, `world.snapshot.save`, `world.snapshot.restore`.
`WorldRpcs`, served by a world's Core through its door, holds everything that acts inside one running world,
`world.clock.warp` and `record.export` included.

**12. How a world is named.** Chosen: platform operations take `world`. Operations of a world take none: a client is
made for one world's door, whose address `world.create` and `world.show` answer. Why: a door serves one world, so a
`world` field could only disagree with it.

**13. When `world.create` answers.** The old operation answered `creating` and finished in the background. Chosen:
it answers once the world runs. Why: a run is one unit (roadmap rule 1), `packages/world` deploys in one step, and a
caller has nothing to do with a world that does not answer.

**14. Owner, expiry and name.** Chosen: the owner is the calling operator; the payload asks for a lifetime in
minutes, capped; the answer gives the expiry in host time. A world's name follows `packages/world`
(`^[a-z][a-z0-9-]{0,13}[a-z0-9]$`), so hyphens are allowed. Why: roadmap rule 2, and one rule for names in both
packages.

**15. Grades.** The old `kind` and `profile` described one machine. Chosen: `grade` is private, shared or real.
`world.create` makes private and shared worlds and refuses real ones (`GradeNotOffered`). Every world's companies get
sites; there is no profile. Why: a real world is made only with Aaron's written go-ahead (AGENTS.md).

**16. Sign-in.** Real sign-in is a phase 4 risk. Chosen: two middlewares that provide the caller or refuse with
`NotSignedIn`. A platform call acts as an operator. A call through a world's door with the door token acts as the
world's owner, or, with the `capxul-person` header, as that person of the world's cast. Only private and shared
worlds honour the header. Why: scenarios must act as several people now, and the contract must not change when real
sign-in arrives, only the middleware.

**17. Snapshots.** Chosen: a snapshot is a branch of the world's database, a copy of its chain state in R2 and a
backup of each site, named within its world and deleted with it. `template` lets anyone on the platform restore it;
otherwise only the owner may. A world made from a snapshot may not expire after its source (`ExpiryBeyondSource`).
Why: a branch fork is what spikes/hosting proved. The expiry rule assumes Neon will not delete a branch that has
children; step 1.3 must confirm it, and the rule goes if it is wrong.

**18. No restore in place.** Chosen: `world.snapshot.restore` always makes a new world; going back means restoring
into a new world. The old epochs go. Why: a fork is cheap, the record stays append-only, and nothing in the thin line
restores in place.

**19. A snapshot from other code.** Chosen: a restore deploys the running code and applies its pending migrations to
the forked database; when the snapshot's migrations are not a prefix of the code's, it is refused
(`SnapshotIncompatible`). No claim covers this yet: making such a snapshot needs two versions of the code.

**20. The clock.** Chosen: a world begins at host time or a chosen time, but not before its seeded chain's last
block (`ClockBeforeSeed`), because the chain is loaded from saved state and cannot go back. A running clock runs at
rate 1: the old `rate` is dropped, since nothing in the thin line needs it and spikes/bench-clocks found a running
clock already drifts across daylight saving. A warp is by a number of seconds or to an instant, forward only.

**21. Export.** Chosen: `record.export` answers the entries; the command line writes files. It is the owner's, takes
an optional range, and is refused on a real world (For Aaron, question 4).

## Signing, payments and the starting state

**22. A signature for a held payment.** No old operation signed a payment that already exists; the thin line's step
6 needs one. Options: keep `payment.send` and add a thirteenth operation; a payment-only `payment.sign`; one
`approval.sign` for every signature. Chosen: `approval.sign`, in place of `payment.send` in step 6. Why: the same
operation signs the held payment, a company's setup and a Director's approval of a proposal, which is how the
starting worlds get a second Director's signature. `payment.send` and its other claims stay with its own journey.

**23. Signatures are made with keys.** Chosen: no operation waits for a person. An operation that needs signatures
answers with approvals, each naming its signer, the address the signature must recover and the digest to sign, and
the signer gives the signature to `approval.sign`. A held payment's sponsorship is done before `doc.submit` answers,
so its digest is known. Why: every signature is made with a key, by a person's agent or by code, never in a browser.

**24. When `approval.sign` answers.** Chosen: when the transaction is in a block, or the signature is kept short of
the threshold. A replay of a sent signature answers `AlreadySent` and emits nothing. Why: a world's chain mines at
once, so the answer can be final. On a public chain (phase 4) confirmation becomes an excluded wait.

**25. The cast.** The old journey assumed sign-in, a member and a second Director that no step made. Chosen: every
private and shared world is born with a cast: dana, eli, sam and olga with claimed personal Safes holding 10,000 test
USDC, and pat with none. Their keys are the chain's well-known test accounts. A real world has no cast.

**26. Founding with a board.** Chosen, provisionally: `org.create` takes the founding Directors, the threshold, the
founding members and the founder's opening capital (For Aaron, questions 1 and 3). With the cast and
`approval.sign`, every starting world is then made by the twelve operations alone.

**27. The starting worlds.** Chosen: ten, declared in `src/starting-worlds.ts` and listed in claims.md: `nothing`,
`quota-full`, `fresh`, `founded`, `office-holder`, `payment-drafted`, `payment-held`, `paid`, `with-snapshot` and
`restored`. Each is made through the door from the one before it, saved as a template snapshot in a kept template
world, and restored by a scenario into a fresh private world. A step that waits for background work (a site
becoming ready) polls an operation until it answers differently. Five old names that no catalogue held
(`org-with-site`, `world-frozen` and others) are gone; `fresh` has a frozen clock, and `founded` has a ready site.

**28. Where a held payment's details come from.** Chosen: the hold reads the payee, the amount and the asset from
the Payment Entry, the payee's address from the Supplier, and the document hash from what `doc.create` stored.
`doc.create` answers the hash: keccak-256 of the document as the site stored it.

**29. Retrying a door call.** The old door had a `callId` for idempotency that was never tried. Chosen: dropped. No
claim needs it; the documents journey decides it.

**30. Report shapes.** Chosen: one result for every report: typed columns (`field`, `label`, `type`) and rows of
JSON values. Why: reports are Frappe's; a typed shape per report would be a second copy of the site's own.

## Budgets

**31. The contradictory budgets.** The old records gave an operation one number and its inner call another:
`report.run` 1,500 and 8,000 ms; `world.snapshot.save` 15,000 and 60,000 ms; `world.snapshot.restore` 15,000 and
90,000 ms; `world.create` 15,000 ms for a call that did not wait for the world. Chosen: one provisional number each,
from what the new spikes measured where they did: `world.create` 90,000 ms (a deploy took 39 to 43 s, a branch 8 to
10 s), `world.snapshot.save` 30,000 ms, `world.snapshot.restore` 120,000 ms, `report.run` 8,000 ms (nothing timed;
the larger number until a run measures it). The others are in claims.md, each with its basis.

**32. What a budget leaves out.** Operations served through a world's door leave out waking a parked world, because
their runs are measured warm. `approval.sign` also leaves out confirmation on a public chain, which does not arise
until phase 4. No budget leaves out a person signing, because no operation waits for one.

## For Aaron

**Question 1. Can a company be founded with more than one Director and with members?** The thin line needs a second
Director and a member, and no step of it seats them.

- A. `org.create` takes the founding Directors, the threshold and the founding members. *(Recommended. Provisional
  in this contract.)* Every starting world is then made by the twelve operations.
- B. Add operations that seat a Director and add a member, making the thin line fourteen operations.
- C. Starting worlds write Directors and members straight into the database and the chain, bypassing the door.

**Question 2. What may a private world cost?** Each live world holds a Neon branch, containers and a site.

- A. At most 24 hours and 3 live worlds per owner.
- B. At most 7 days and 5 live worlds per owner. *(Recommended. Provisional: `WORLD_LIMITS`.)* Long enough to keep a
  template world for a week of runs.
- C. At most 30 days and 10 live worlds per owner.

**Question 3. How does a new company's Safe get its first money?**

- A. The founder's opening capital, moved from the founder's Safe when the setup is signed. *(Recommended.
  Provisional.)* It is booked as the founder's capital.
- B. A separate payment after founding, which brings `payment.send` back into the thin line.
- C. In test worlds the company Safe receives test USDC at founding; real worlds decide later.

**Question 4. May a real world's record be exported?** It holds every company's history in that world.

- A. Not until a rule for the companies' consent exists. *(Recommended. Provisional: `ExportNotAllowed`.)*
- B. Yes, when every company in the world has consented.
- C. Yes, by the platform's owner only.
