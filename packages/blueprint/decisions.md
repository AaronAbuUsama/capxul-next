# Decisions behind the thin line's contract

Every design call made in writing this package, one short entry each: the question, the options, the choice and
why. The old blueprint's records (`docs/thin-line/operations.md` on the branch `claude/epic-allen-0n48sq`) were read
as a list of behaviours to consider, not as canon. Its names, flags, shapes and refusal codes were not kept for their
own sake.

Questions only Aaron can answer are at the end, with his answers. The contract compiled with the recommended
option of each, marked provisional.

## Rules set by Aaron (13 November 2026, through the lead)

**1. No JSON in strings.** Payloads and results are fully typed Schemas. No field carries JSON text to be parsed
later. A document's fields, a report's filters and rows, and a record entry's `carried` are typed as JSON values
(`Schema.Json`, `Values.Fields`). The old `--filters '<json>'` and `--input <file>` have no counterpart.

**2. One source for each speed budget.** A budget is declared once, on the operation (`budget` in its declaration),
and nowhere else: no class defaults, no budgets on internal steps. Each budget says what it measures (the p95 of the
server's own span for the call, over warm runs), which waits it leaves out, whether it is provisional, and its
basis. Internal steps are spans, reported as a breakdown of the operation's time. Every budget here is provisional;
the first green run's measurement replaces the number and the basis in the declaration. A budget is recorded, not
enforced: the runner stores it next to every call's measured time, and nothing fails on speed until a budget is set
from measured runs (AGENTS.md, "Measure first").

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
compiler and the client then hold the shape, and a refusal always needs the world's state to decide. How such a
payload surfaces: entry 43.

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
sign-in arrives, only the middleware. Amended by entry 36: the owner's operator token also signs in at the door.

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
Amended by entry 46: the refusal is removed and the rule stays, as a fault.

**20. The clock.** Chosen: a world begins at host time or a chosen time, but not before its seeded chain's last
block (`ClockBeforeSeed`), because the chain is loaded from saved state and cannot go back. A running clock runs at
rate 1: the old `rate` is dropped, since nothing in the thin line needs it and spikes/bench-clocks found a running
clock already drifts across daylight saving. A warp is by a number of seconds or to an instant, forward only.

**21. Export.** Chosen: `record.export` answers the entries; the command line writes files. It is the owner's, takes
an optional range, and is refused on a real world (Aaron's answers, 4).

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
USDC, and pat with none. Their keys are the chain's well-known test accounts. The test USDC comes from the token's open mint function, the world's faucet (Aaron's answers, 3). A real world has no cast.

**26. Founding with a board.** Chosen, and agreed by Aaron on 13 November 2026: `org.create` takes the founding Directors, the threshold, the
founding members and the founder's opening capital (Aaron's answers, 1 and 3). With the cast and
`approval.sign`, every starting world is then made by the twelve operations alone.

**27. The starting worlds.** Chosen: ten, declared in `src/starting-worlds.ts` and listed in claims.md: `nothing`,
`quota-full`, `fresh`, `founded`, `office-holder`, `payment-drafted`, `payment-held`, `paid`, `with-snapshot` and
`restored`. Each is made through the door from the one before it, saved as a template snapshot in a kept template
world, and restored by a scenario into a fresh private world. A step that waits for background work (a site
becoming ready) polls an operation until it answers differently. Five old names that no catalogue held
(`org-with-site`, `world-frozen` and others) are gone; `fresh` has a frozen clock, and `founded` has a ready site.
Amended by entry 39: four of them are made by their steps instead, and claims about lineage start from `nothing`.

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

**33. An operation with no implementation.** Core serves every operation from step 1.1, but its handlers are empty
until each is built. Options: an empty handler dies with a defect (the pipeline spike's way); every operation declares
a refusal for it; or one middleware refuses for every operation. Chosen: `NotImplemented`, declared once in
`errors.ts` with exit code 6 and added to every operation's refusals; an empty handler fails with it and names the
operation. Why: the caller gets a typed answer it can recognise, the runner's checks see a declared refusal rather than
a fault, and a scenario run against an empty handler fails on its own expectation, which is what step 1.5 requires.
A middleware cannot do it, because a handler may only fail with its own operation's refusals. An operation keeps
the refusal after it is built; a built handler never returns it.

## Closing the scenarios' gaps (13 November 2026)

The scenarios' author found claims no scenario could check in full (gaps.md). Each entry closes one cause.

**34. Reading the chain.** Claims say "through the door's chain RPC", and `Capxul` read no chain. Options: a
thirteenth operation, `chain.read`, served by Core; or a typed read client on `Capxul`, backed by the world door's
chain JSON-RPC. Chosen: the read client, `capxul.chain`. Its eight reads (`head`, `balance`, `safe`, `hat`, `wears`,
`companySafeFor`, `transaction`, `logs`) are declared once in `src/chain/reads.ts`, with the logs they decode and
every Solidity signature they use in `src/chain/logs.ts`; the SDK serves them. Why: an operation would put a copy of
the chain's state behind Core, the very thing the claims check Core against, and would need its own events, budget,
claims and handler. Read directly, the chain is the one owner of its state. With it:
- the door's chain JSON-RPC is at `CHAIN_PATH` under the world's door and answers only `CHAIN_READ_METHODS`
  (src/telemetry.ts): it reads and never writes;
- `WorldView.contracts` names the addresses the reads take (USDC, Hats, Payments, the entry point, the company Safe
  minter, its owner and namespace), from the world's deployment;
- `Held.payment.paymentId` is the id `PaymentSent` carries, so a payment is found on the chain by what Core answered;
- a company Safe's `company`, in `CompanySafeMinted` and `companySafeAddressFor`, is the Organization's id;
- a new world's chain mines a block at its clock's start, so `chain.head` shows the start;
- an officer hat is known on the chain by its details (`OFFICER_HAT_DETAILS`: Books, Invoices, People).
The SDK decodes the ABI with viem as a pure codec, from the blueprint's signatures; it does no I/O, which is Effect's
HttpClient. viem is already a runtime dependency of the repository (the scenarios sign with it), so the count of
non-Effect runtime dependencies does not rise; whether a second package may depend on it is Aaron's to say (the
question is in the report of this change). `packages/indexer/abis.ts` still holds its own copy of the log
signatures; it should import them from here.

**35. Door paths.** `WorldView.door` is a base address. The blueprint declares where a door's parts answer:
`PLATFORM_PATH`, `WORLD_PATH` and `CHAIN_PATH`. Core imports the first two from here; the SDK builds every address
from them. Why: a caller that holds only a world's view must find its operations and its chain.

**36. Reaching another world.** A scenario could call only the world it was handed. Options: `world.create` and
`world.snapshot.restore` answer a door token; or the door accepts the credential of the operator who owns the world.
Chosen: the second, with `CallOptions.at` (a `WorldView.door`) on every world operation and chain read. A call `at`
another world's door signs in with the operator's token (`CallOptions.operator`); with `as`, it acts as that
person. Any other operator's token is not signed in at that door. Why: a token in an answer would be written into
every run record, and the operator is already who the caller is. This amends entry 16.

**37. Two operators, and who the caller is.** Chosen: `CallOptions.operator`, `first` (the default) or `second`,
picks whose credential signs a platform call or a call `at` another world. The starting world `nothing` hands both
operators' names as facts (`operators`), so a claim can name the caller. Why: the names are the platform's, and a
scenario learns them from the world it is handed, not from a setting of its own. The runner makes the second
operator's token (`CAPXUL_SECOND_PLATFORM_TOKEN`, name `WORLD_SECOND_OWNER`); the platform must accept it.

**38. Starting worlds hand their facts.** A scenario could not see what the steps that made its world answered.
Chosen: each starting world declares `facts`, a schema of what its steps answered (each step names the fact its
last answer becomes), its parent's included, and an example of them. Every world also hands `calls`, each call made
in making it with its trace, payload and answer, and `nothing` hands `operators`. A scenario reads them with
`given(startingWorlds.x)` (packages/scenarios), typed by the world's schema, for its own world or any it is made
from. The maker of the world keeps the facts encoded; `Given` hands them. Why: an approval's digest, a document's
hash and a trace id are only ever answered once, to whoever made the world.

**39. Starting worlds and templates.** Entry 27 restores every starting world from a template, but a restored world
names its template as parent and its record ends with the restore's `world_created`, against `fresh`'s "parent
null, record one entry long". Chosen: entry 27 holds for `fresh` to `paid`, and the claims are made to agree: a
claim about a world made from nothing starts from `nothing` and makes it (world.show 2), and `fresh` no longer
promises its record's length. `quota-full` (the operator's own live worlds), `with-snapshot` and `restored` (a
snapshot belongs to the world it was saved in) are made by their steps for each scenario, from a restored `paid`.
`StartingWorld.made` says which. The `world` fact is the answer of the call that made the scenario's world, so
world.show 3 compares with it. Why: templates are the roadmap's (steps 0.9 and 1.12), and the record and the
lineage already say truthfully what a restore is.

**40. The site's vocabulary.** It lived in the scenarios' `support/books.ts`. Chosen: `src/documents/site.ts`
(`Site` at the door) declares the doctypes, field names, the Supplier's payment address field, the Safe account's
prefix, the reports, their filters and row fields, the daily job, and the documents the starting worlds make.
report.run fills `company`, and for a report over a period `from_date` and `to_date`, when the filters leave them
out; a doctype's name runs that doctype's list (Frappe's report view), so the Supplier list is the Supplier doctype
and the Scheduled Job Log is its doctype. `books.ts` re-exports it.

**41. `office-holder`'s wait.** It waited on doc.create, which makes a document when it stops refusing. Chosen: it
waits on report.run of the General Ledger, which makes nothing, so the site holds no document yet.

**42. Signing and subjects.** Chosen: an approval's `digest` is the exact 32-byte hash its signer signs with
secp256k1, with no prefix (no EIP-191 message prefix), `v` 27 or 28; the cast's keys are among the first ten
accounts of the public test mnemonic (`test test ... junk`), each named by its `signerAddress` (`CAST_KEYS`, src/values.ts). `Subject` is typed
by kind: an org setup by its org id, an officer change by its change id, a payment by its request id.

**43. A payload the schema rejects.** Chosen: the caller's client checks every payload against its operation's
schema before it sends anything, and refuses one that does not fit with `PayloadRejected` (in `errors.ts`, exit code
2, declared by no operation). Nothing reaches a door, so Core keeps no span: the runner records the call as
`rejected` and its generic checks require that no span exists under its trace. Why: Effect's Rpc client cannot send
such a payload at all, and the caller must be able to tell the rejection from a fault. This narrows entry 9.

**44. The job a warp runs.** world.clock.warp 1 named no job. Chosen: the Capxul app's daily job,
`capxul.clock.daily`, whose Scheduled Job Type is `clock.daily` (`Site.DAILY_JOB`).

**45. world.create 2's start.** It started a day after the seeded chain's last block, which is before host time only
if the seed is over a day old. Chosen: it starts halfway between that block and host time, which is always before
host time, so the claim needs no condition.

**46. `SnapshotIncompatible`.** No claim could exercise it: a snapshot from other code cannot be made through the
door. Chosen: the refusal is removed. A restore of a snapshot whose migrations are not a prefix of the running
code's still fails, as a fault (entry 10), and the templates are remade on every change to the code (entry 27).

**47. What a document's hash is, and who acts on a site.** Built with doc.create, doc.submit and report.run (13
November 2026). A document's hash is keccak-256 of its canonical JSON on the site (packages/frappe-app,
`capxul/canon.py`): for a Payment Entry, the canon that a payment's hold and its posting compare, so the hash
doc.create answers, the hold carries and the chain's `PaymentSent` carries are one; for any other document, its stored
fields without what changes on every save. A document or report call runs as the caller's own site user, the user of
their cast email; the world's owner, an operator, has none, so its call is `NoSiteUser` naming the owner. Which site is
the company's is the site's to say (its Capxul Settings `org_slug` is the org id), so Core asks the world's ready sites
in turn.

**48. How the chain operations reach the chain.** Built with org.create, org.member.grant and approval.sign (13
November 2026). Every subject lands as one UserOperation through the world's bundler, sponsored by its test
paymaster. A company's setup and a held payment are UserOperations of the signer's own Safe (the founder's; the
member's, whose Books hat pays through `Budgets.spend`), prepared when the approval is opened, so their digest is
the Safe4337Module's operation hash. An officer change is a company Safe transaction its Directors approve with
their own Safes (EIP-1271: each Director's digest is their Safe's `SafeMessage` hash of the transaction's hash), and
a relayer Safe of Core's service key carries it as its UserOperation; the relayer's signature authorises nothing in
the company. Why: an approval's digest is known before anyone signs (entry 23), and a transaction several Directors
approve cannot be any one signer's own UserOperation, whose signature would have to cover the others'. Each prepared
operation has a nonce key of its own, so two approvals of one Safe never wait on each other.

**49. What a setup needs, and what the board is on the chain.** The setup is sent once its threshold of Directors
have signed and the founder is among them, because it spends from the founder's Safe. One UserOperation moves the
founder's capital to the company Safe and runs the Installer's install batch, which makes every founding Director's
Safe a signer at the threshold (the Signer Gate as module and guard) and opens one top budget whose hat is Books, the
budget a held payment spends. Each officer hat (Books, Invoices, People) starts with one seat; a grant to a full hat
adds one first (org.member.grant 5). A founding Director with no claimed Safe cannot wear the Director hat, so they
are refused as the founder would be, with `FounderNotReady` naming them; org.member.grant of a company whose setup
has not landed is `OrgNotFound`: it has no board on the chain to propose to.

**50. Expiry and what a company's site is told.** An approval expires 24 hours of world time after it is opened, by
the world's clock; the chain's own validity window is left open, since the bundler would read it against its host's
clock. What a landing means for the company's site (its company and Safe, the bench's clock, each Director's and
member's hat, the founder's capital, a payment's posting) is queued with the landing and handed to the site in order
once the site is ready (packages/frappe-app `capxul/core_company.py`); the world sees the site `ready` only when it has
taken everything queued and the setup has landed. Nothing runs in the background of a Worker, so a site is moved on
when a landing finds it ready, and whenever the world's companies are read (Core's `companiesOf`, which world.show
lists).

**51. Where the platform group runs (step 1.6).** A world takes about 95 s of Alchemy deploys, with the Cloudflare
and Neon keys and, when an image changes, Docker: no Worker can host that, so a world's Core cannot serve
`world.create`. Options: (a) Core's platform door forwards to a platform service; (b) a hosted platform service in the
cloud (a Cloudflare Container running `packages/world`, or a process on the AWS bench host) holding the keys; (c) the
platform group served by `packages/world` itself, in the process that holds the keys: the runner in an agent's
container or in CI, or `world platform serve`, on the machine's loopback. Chosen: (c), the smallest sound design. It
changes no hosting, runs no new service in the cloud and costs nothing, and entry 11 already says `packages/world`
serves the group. Its handlers are `packages/world/src/platform`, its sign-in and spans Core's own middlewares (Core
exports them); its spans are kept in the schema `platform` of the registry's branch, with the world each successful
call acted on, and its events go into that world's record. A world's Core accepts its owner operator's own token
(entry 36): the platform binds it into the Core it deploys, as a secret. Core's platform door keeps its empty handlers
until it is removed: nothing calls it. What (c) cannot do: a caller on another machine (a shared world's people,
phase 2) cannot reach a loopback platform. Hosting it, (b), changes hosting and adds a running service with the keys
inside it, so it is a question for Aaron, not built here. With it:
- a world's facts (its chain's contracts, its cast, its companies) are rows of its own database
  (`packages/core/migrations/0003_world.sql`), which its Core reads too; its clock is `app.clock`, as Core's site
  operations keep it; its grade and parent are what its record's latest `world_created` carried, as record.export
  reads them; its owner and expiry stay the registry's;
- the record is `app.events` in id order, an entry's position its rank, so a world restored from a snapshot holds its
  source's entries up to the snapshot and then its own `world_created`;
- a snapshot is a Neon branch of the world's branch with no compute, the chain's whole state saved in the world's own
  R2 bucket under the snapshot's name, and the platform's row of it (`platform.snapshots`); all of it goes with the
  world, whose destroy deletes the snapshot branches first. A company's site is not saved yet: saving or restoring a
  world with companies is a fault until the bench can back a site up (step 1.4);
- a world's chain is made with its clock just after the seed's last block, and its own start block is mined last, so
  `ClockBeforeSeed.earliest` is the seed's last block plus an hour of room for the blocks that make the world;
- the cast are test accounts 4 to 8 of `CAST_KEYS`' mnemonic (dana, eli, sam, pat, olga), clear of the faucet's
  operator (0), Companies House's Directors (0 to 2), its claim service (3) and the bundler's keys (9, 10); each
  Safe but pat's is claimed through Companies House's devnet claim role and minted 10,000 test USDC from the faucet;
- world.create and world.snapshot.restore answer once the new world's Core has answered its health check ten times
  in a row, so a caller's first call `at` it is not answered by Cloudflare's edge.

**52. A world's sites in its snapshots, and a rehearsal with Core off Cloudflare (step 1.6).** Amends 51, whose
"saving or restoring a world with companies is a fault" held until the bench could back a site up. Chosen: a snapshot
saves each of the world's sites as a backup of its database on the bench (`bench backup`), named by the snapshot and
kept by the site door beside the world's sites, removed with them; a restore makes each again in the new world under
its own label from that backup (`bench new-site --source-sql`), with the backup's encryption key, joined to the new
world and its clock, its API user given the new world's credential, and the new world's companies pointed at their
new sites. The door lets a world restore only backups of the world whose token is shown beside its own. Why: entry 17
always said a snapshot holds a backup of each site; only the bench's half was missing. Separately, until a bench
Cloudflare can reach exists (roadmap 2.1), the runner can run every world's Core in workerd on its own machine, next
to a stand-in bench (`./run.sh scenarios --core=local`), with the world's database, chain, index and bundler still on
Cloudflare and Neon. Such a run proves nothing a step needs: its records say so, and its outcome is at best
`rehearsed`, never `passed`. Found on the way, and true of the pinned Frappe: a new Scheduled Job Type is named by a
hash, not by its method (entry 44 assumed the latter); the Capxul app names the daily job's type `clock.daily` itself.

## Answered by Aaron, 13 November 2026

**1. Founding a company in one step.** Yes: `org.create` takes the founding Directors, the approval threshold and the
founding members.

**2. What a private world may cost.** Agreed: at most 7 days and 5 live worlds per owner (`WORLD_LIMITS`).

**3. How a company's Safe gets its first money.** The test tokens have open mint functions, which act as faucets. In
test worlds, the founder's personal Safe is funded from the faucet when the world's cast is made; the founder's
opening capital moves from that Safe to the company Safe when the setup is signed, and is booked as the founder's
capital, so the books agree with the chain. How it is done is ours to choose; the books coming out right is the rule.

**4. Exporting a real world's record.** Not asked yet: it matters only for real worlds (phase 4). Until then
`record.export` refuses on a real world (`ExportNotAllowed`).
