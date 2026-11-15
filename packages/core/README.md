# core

The Capxul server (roadmap step 1.1): one Cloudflare Worker, written in Effect and deployed by Alchemy, that serves
every operation of the blueprint over HTTP with Effect's own Rpc server, and keeps every call's spans in its database
for the runner. Built from `spikes/pipeline/core`. It has two doors, as the SDK (`packages/sdk`) calls them: the
platform group at `/platform` and the world group at `/world`, each an HTTP POST of Effect Rpc in JSON, at the paths
the blueprint declares. Beside them: the world's chain reads at `/chain` (`CHAIN_PATH`), and two routes that are not
the blueprint's operations, `/health` and the site probe (`src/probe.ts`). Any other path answers 404 in JSON.

It runs in two places, with the same code: a stage of its own stack `CapxulCore` (the runner's, with its own Neon
project), and a world's Core slot (`packages/world`, `src/core/Core.ts`), where it binds the world's branch, the
world's door and the world's bench. What a deploy binds is handed to it as a `Deployment` (`src/stack/deployment.ts`);
the running Worker reads every fact from its environment per request, by the names in `src/env.ts`.

**Every world handler is built.** Core builds the world group's sixteen (`src/site-ops/`, `src/organizations/`,
`src/people/` and `src/board/`, below); the platform group's four are `packages/world`'s (`src/platform`, blueprint decisions.md 51), so Core's own
platform handlers are empty: each fails with the blueprint's `NotImplemented`, naming itself (entry 33). The server compiles only with one handler per operation: leave a
domain out of `src/handlers.ts`, or an operation out of its `src/domains/` file, and `pnpm types` fails with
`Property '"record.export"' is missing`.

| File | What it is |
|---|---|
| `src/door.ts` | The door: the stack, the two door paths, `serveDoors`, `Served`, `CoreRpcs`, the span types, and `migrations`. |
| `src/doors.ts` | `serveDoors`: each request to the group its path names, `PLATFORM_PATH` or `WORLD_PATH`. |
| `src/handlers.ts` | One handler per operation, in its blueprint group, gathered from `src/domains/`. |
| `src/domains/` | One file per blueprint domain: its handlers, as its share of each group it serves (`platform`, `world`). The world group's come from `src/site-ops/`, `src/organizations/`, `src/people/` and `src/board/`; the platform group's are empty. |
| `src/empty-handlers.ts` | Core's empty-handler mode: every operation of both groups answers `NotImplemented`, whatever is built, made from the groups' own operations. A stage deployed with `CAPXUL_HANDLERS=empty` (`src/env.ts`) serves it, so the scenario author can show every journey fails against handlers that do nothing (`./run.sh scenarios --expect=not-implemented` in packages/runner, roadmap step 1.14). A world's Core never binds it. |
| `src/site-ops/` | The document, report, clock and record operations (below). `door.ts` is its door. |
| `src/organizations/`, `src/approvals/`, `src/chain/`, `src/cast/` | The chain operations, org.create, org.member.grant and approval.sign (below). `organizations/handlers.ts` is what `src/domains/` and the Worker use. What a subject's landing means is its domain's (`organizations/landed.ts`, and `approvals/payments.ts` for a payment); `approvals/landed.ts` gathers them by kind. |
| `src/people/` | The people operations, org.member.invite, invite.list, invite.accept, invite.decline and org.member.list (below). `people/handlers.ts` is what `src/domains/people.ts` uses; `people/roster.ts` is the one reading of who belongs to a company, which org.member.grant's member check reads too. |
| `src/board/` | The board operations, org.director.list, org.director.add and org.threshold.set (below). `board/handlers.ts` is what `src/domains/board.ts` uses; `board/landed.ts` is what a landed `board_change` means. |
| `src/server.ts` | `Served`, the handlers and middlewares of both groups, and `CoreRpcs`, both groups merged for a test in memory. |
| `src/telemetry/spans.ts` | One span per call, named after the operation, under the trace id of the caller's `traceparent`, with every span beneath it. |
| `src/telemetry/sink.ts` | Where a call's spans go: `app.spans`, written after the call ends and before the answer leaves. |
| `src/telemetry/middleware.ts` | The server half of `Telemetry`, `WorldSignIn` and `PlatformSignIn`, and `CoreIdentity` (the world, its owner, the doors' tokens). |
| `src/worker.ts` | The Worker: `/health`, `/chain`, the site probe, then `serveDoors` with `Served`, a database through Hyperdrive and JSON serialization. |
| `src/env.ts` | The names a deploy binds into the Worker's environment, and the Worker's reading of who it is from them. |
| `src/stack/deployment.ts` | `CoreDeployment`: what a deploy binds (its database and its facts). Left out, the stage's own (`ownDeployment`). |
| `src/chain.ts` | `/chain`: JSON-RPC limited to `CHAIN_READ_METHODS`, signed in as the world's door is, carried to the world's chain over a service binding to the world's door. Any other method is JSON-RPC's -32601 and never reaches the chain. |
| `src/site/SiteDoor.ts` | `SiteDoor`: a company site's ERPNext REST calls through the bench's site door, with the world's site token and the site's own API user, never the bench's admin. What the handlers of `doc.*` and `report.run` will use. |
| `src/probe.ts` | `/health`, and `GET /probe/site?path=…[&site=…]`: one read of a site through `SiteDoor`, signed in as the world's door is, reads only. Not a blueprint operation; it goes when an operation that reads a site is built. |
| `src/failures.ts` | Core's own failures: `SiteDoorFailed` (`unset`, `unreachable`, `refused`). |
| `src/stack/database.ts` | A stage's database: a Neon project of its own, and Hyperdrive in front of it with its query cache off. |
| `alchemy.run.ts` | The stack `CapxulCore`. One stage is one Core and its database. |
| `migrations/` | The `app` schema (named by the rule in "Migrations", below): `app.spans` and `app.events` (0001); `app.clock` and `app.documents` (0002); the world's chain contracts, cast and companies (`app.world`, `app.cast`, `app.companies`, 0003); the people domain's invitations and the members who joined by one (`app.invitations`, `app.members`, `0006_people_invitations.sql`); each change to a company's Board (`app.board_changes`, `0007_board.sql`). Applied by the runner when a stage is created, and by the world when it is made. |
| `test/server.test.ts` | Core's groups in memory: all twelve answer `NotImplemented` under one span each, kept with the caller's trace id; sign-in refusals. |
| `test/site-ops-documents.test.ts`, `test/site-ops-world.test.ts` | The five operations served in memory through Core's groups against a stand-in company site (`test/support/site-ops.ts`): what the site is asked, what Core answers, what the record keeps. |
| `test/site-ops-sql.test.ts` | The clock, the record, the document hashes and the cast in Postgres with the migrations applied. Runs only with `CAPXUL_TEST_DATABASE` (a throwaway Postgres); skipped otherwise, as in CI. |
| `test/chain/` | The chain operations end to end against a local stand-in of a world (`up.sh`: Anvil from the seed, the faucet's USDC, the test paymaster, alto from the world's bundler image, Postgres; `down.sh` removes it): `pnpm --filter @capxul/core chain:test`. Not in `pnpm test`, which has no chain. |
| `test/people-sql.test.ts` | The people operations served in memory against Postgres with the migrations applied, from Northwind founded: the journey "invite olga to Northwind" step by step, each answer, refusal and event, and org.member.grant passing its member check for olga once she accepted (`test/support/people.ts`). Runs only with `CAPXUL_TEST_DATABASE`; skipped otherwise, as in CI. |
| `test/doors.test.ts` | The SDK's own client against `serveDoors` over HTTP in this process: all twelve at their doors, the server span under the SDK's trace, wrong tokens refused, other paths 404 in JSON. |

## What every call gets

- **A span.** Whichever middleware runs first (sign-in, which is outermost) opens the call's span, named after the
  operation, as a child of the caller's span in the `traceparent` header (the SDK sends its own client span there),
  or in a new trace without one; the others join it. That span
  and every span beneath it are written to `app.spans` (trace id, span id, parent, name, outcome, duration in ms, end in
  epoch ms) before the answer leaves, so the caller can read them as soon as it holds the answer. A call whose spans
  cannot be written dies.
- **A caller.** Sign-in reads the blueprint's `CREDENTIAL_HEADER` (`authorization: Bearer <token>`): at `/world`
  the world's door token or the owner operator's token (blueprint decisions 36), at `/platform` the owner's token, or
  the second operator's (`WORLD_SECOND_OWNER`, `CAPXUL_SECOND_PLATFORM_TOKEN`, decisions 37) as that operator. No credential is `NotSignedIn` (`no_credential`),
  another token `NotSignedIn` (`unknown_caller`). A world call then acts as the world's owner, or as the person named
  in `capxul-person` (a header that is not a person's name is refused; the cast is not checked until step 1.12). A
  platform call acts as the owner, the operator that deployed the stage. Tokens are compared as strings.
- **`CurrentCall`**: its trace id and operation, for the events a built handler will emit into `app.events`.

`packages/world` serves the platform group (blueprint decisions.md, entries 11 and 51), with Core's own sign-in and
span middlewares, which the door exports (`PlatformSignInLive`, `TelemetryLive`). Core's platform door keeps its
empty handlers until it is removed; nothing calls it. A world's facts (its chain's contracts, its cast with the
signer and Safe of each person, its companies) are tables of the `app` schema too (`migrations/0003_world.sql`),
written by the platform and read by Core; its clock is `app.clock`, its grade and parent its record's latest
`world_created`.

## The document, report, clock and record operations (`src/site-ops/`)

| Operation | What it does |
|---|---|
| `doc.create` | Creates the document on the company's site as the caller's own site user (`capxul.core_api.create` in `packages/frappe-app`), answers it with its keccak-256 hash, keeps the hash in `app.documents`, and records `doc_created`. |
| `doc.submit` | Submits it as the caller. An ordinary document posts (`doc_submitted`); a Payment Entry from the company Safe is held (decisions.md, 28): its payee, amount and asset from the entry, the payee's address from the Supplier, its hash from `app.documents`; the approval is opened by `PaymentApprovals` (below), then the site keeps the hold (`capxul.core_api.hold`, a Capxul Payment Request waiting for the signature) and Core records `payment_held`. `NotADraft` for a document that is not a draft. |
| `report.run` | Runs the report as the caller, `company` and the period filled when left out (`capxul.core_api.report`); a doctype's name runs its list. |
| `world.clock.warp` | The owner's only. Every ready site of the world steps through each day between, running what fell due (`capxul.core_api.warp`; the last site writes the world's clock on the bench), in calls of at most 14 days of world time (`WARP_STEP_MS`: a site takes about 0.8 s a day, and one call must answer within the site door's 120 s and the tunnel's 100 s, so a warp past about 140 days failed as one call), then the chain mines a block at the new time (Anvil, over the `CHAIN` binding), then `app.clock` moves; records `clock_warped`. A warp to now or before is `ClockBackwards`. |
| `record.export` | The owner's only: the world's record, `app.events` in order, each entry's position its place (so no gap), its time the world's; the lineage and the grade from the latest `world_created` (`ExportNotAllowed` for a real world). |

Every refusal of the site maps to the blueprint's: no user for the person is `NoSiteUser`, Frappe's own refusal is
`SiteRefused` with its reason (`permission`, `validation`, `not_found`, `part_off`), no ready site of the company is
`SiteUnavailable` (while one is being made) or `OrgNotFound`. Which site is the company's: Core asks each ready site of
the world, and a site that is not the company's answers `org-not-here`. A successful call records exactly what its
declaration computes from its payload and answer (`operation.expected`), at the world's time, under the call's trace.

What it reads that other operations write, each a seam with its own file:

| Seam | File | Who fills it |
|---|---|---|
| The world's clock, `app.clock` (one row; none is a running clock at host time) | `clock.ts` | `world.create` writes the clock a world begins with; `world.show` reads it |
| The first `world_created` of the record | `record.ts` | `world.create` (and the runner, for a stage: `packages/runner/src/world/born.ts`) |
| A person's site user, `app.cast (person, email)` | `cast.ts` | the world's cast (step 1.12); its users are made on the site by `org.create` and `org.member.grant` |
| A company's site: `Capxul Settings.org_slug` is the org id | `sites.ts` | `org.create`, when it configures the site |
| The approval of a held payment (`PaymentApprovals.open`) | `payments.ts` | `approval.sign`'s half: `PaymentApprovalsLive` (`organizations/handlers.ts`, `approvals/payments.ts`) |

## The people operations (`src/people/`)

A member's Seat is off the chain and off the site (blueprint `people/order.md`, ADR-0040 in infrastructure): no hat,
no Safe owner, no site user. So these touch only Core's database and the world's record; only `org.member.grant`
puts a hat on chain.

| Operation | What it does |
|---|---|
| `org.member.invite` | A Director of the company invites an email as a member (only Directors in P1: `CannotManagePeople` for anyone else, the world's owner included). `AlreadyAMember` when a person of the cast signs in with that email and belongs to the company; `AlreadyInvited` while the company's invitation to it is pending. The invitation is pending at once, at world time; records `member_invited`, which carries no email. |
| `invite.list` | Every invitation sent to the caller's cast email, whatever its state, oldest first. None for the world's owner. |
| `invite.accept` | The invitee of a pending invitation joins the company at once (`app.members`) and records `invitation_accepted`. Accepting it again answers `AlreadyAccepted` and records nothing. Another's invitation is `NotYourInvitation`, a declined or cancelled one `InvitationClosed`, an unknown id `InvitationNotFound`. |
| `invite.decline` | Closes the caller's pending invitation and records `invitation_declined`, carrying neither the email nor who declined. The same refusals as `invite.accept`, and `InvitationClosed` for an accepted one. |
| `org.member.list` | The company's Directors in the board's order, then its founding members, then those who joined by an invitation in the order they joined, each with their cast email. Its people and the world's owner see it; anyone else is `NotAMember`. |

Who belongs is read in one place, `people/roster.ts`: the founding Directors and members of `app.organizations`, then
`app.members`. `org.member.grant`'s member check reads it, so a person who joined by an invitation can be granted a
permission like a founding member.

## The board operations (`src/board/`)

The Board cannot change itself: the Signer Gate refuses a company Safe transaction that calls the Safe, and the
Director hat and the Gate's threshold are administered by the Shareholders' top hat, which the founder's personal Safe
wears (blueprint `board/order.md`). So a change to the Board is one UserOperation of the founder's own Safe, with one
approval, the founder's, whose digest is the Safe4337Module's operation hash; `approval.sign` sends it at that first
signature. Every refusal is checked from Core's records (`app.organizations`, `app.board_changes`) before the chain
is read.

| Operation | What it does |
|---|---|
| `org.director.list` | The company Safe's owners and threshold, read from the chain, each owner named by the Director whose cast Safe it is, in the order Core seated them (the founder first). Its people and the world's owner see it; anyone else is `NotAMember`. |
| `org.director.add` | The founder only (`CannotChangeBoard`); a member (`NotAMember`) with a Safe (`MemberHasNoSafe`) who is not a Director (`AlreadyADirector`), while no other change waits (`BoardChangeWaiting`). The founder's Safe's MultiSendCallOnly batch: `Hats.changeHatMaxSupply` when every seat of the Director hat is worn, `Hats.mintHat` to the member's Safe, `HatsSignerGate.claimSignerFor`. The threshold stays as the Gate computes it (`min = target`). Records `board_change_proposed`. |
| `org.threshold.set` | The founder only; at most the Directors (`ThresholdTooHigh`), not the one it has (`ThresholdUnchanged`), while no other change waits. One call of the founder's Safe: `HatsSignerGate.setThresholdConfig({ ABSOLUTE, n, n })`. Records `board_change_proposed`. |

A change waits until it lands or its approval expires, in world time (`app.board_changes`). Its landing updates the
company's Directors and threshold in `app.organizations`, so `org.member.grant` then asks the new Board, and a seat
queues the new Director's `grant` of the site's Director hat (`SITE_HATS.director`), as the setup does for each
founding Director.

## The chain operations (`src/organizations/`, `src/approvals/`, `src/chain/`)

| Operation | What it does |
|---|---|
| `org.create` | Checks everything first (the founder's and every Director's claimed Safe, every person named, the handle, an unfinished founding, the capital against the founder's Safe). Then the service key mints the company Safe through Companies House's company role, under the org id, and sends the Installer's `deployMoney` (the Board's hats with Books, Invoices and People, the Director hat on every founding Director's Safe, the Signer Gate, Roles). The setup is prepared as one UserOperation of the founder's Safe (the capital, then the company Safe's install batch) and every Director gets an approval of its digest. Records `org_founded`, adds the company to `app.companies` and starts its site through `SiteDoor.make`. The same founding again answers `Resumed`. |
| `org.member.grant` | A Director proposes: the company Safe's transaction at its next nonce (one more seat when the hat is full, then the hat minted to the member's Safe), read live from the chain. Each Director's approval is their own Safe's EIP-1271 digest of it. Records `officer_change_proposed` and `proposal_opened`. |
| `approval.sign` | Checks the signer, the signature (raw secp256k1 over the digest), a subject already sent (`AlreadySent`) and the expiry in world time, keeps the signature, and once the threshold is signed (the founder among them, for a setup) sends the subject as one UserOperation through the world's bundler, sponsored by the test paymaster: the signer's own Safe's for a setup or a payment, the relayer's for a company Safe transaction. Answers once it is in a block; records `approval_signed` (and `approval_landed` when sent). |

How it reaches the chain: `chain/WorldChain.ts`, the world's chain and bundler over the Worker's `CHAIN` binding to
the world's door (`/<token>/rpc`, `/<token>/bundler`), with the door's token; the door's read-only `/chain` is the
callers'. The addresses and the service key are the seed's (`chain/seeded.ts`, checked against the contracts'
deployment record by `test/seeded.test.ts`). What a landing means for the company's site (its company and Safe, the bench's
clock, each hat, the founder's capital, a payment's posting) is queued in `app.site_deliveries` and handed to the site
once it is ready (`organizations/site.ts`, through `capxul.core_company` in `packages/frappe-app`). Blueprint
decisions.md 51 to 50 say why.

What it reads that others write:

| Seam | File | Who fills it |
|---|---|---|
| The world's cast, `app.cast (person, email, signer, safe)` | `cast/Cast.ts` | `world.create` (step 1.12) |
| The world's companies, `app.companies (org, handle, name, site_state, site_url)` | `organizations/store.ts` | the world's migration; org.create adds to it. `world.show` should list it through `companiesOf` (`organizations/site.ts`), which moves each site on first |
| The world's clock and record | `src/site-ops` | `WorldClock`, `WorldRecord` |

## A stage of `CapxulCore`

A stage is named `core-<6 hex>`, which is also its world's name. It holds a Neon project (`core-db`, London) whose
default branch is the database, a Hyperdrive configuration in front of it (`core-hyperdrive`), and the Worker (`Core`). The
Worker reads `WORLD_OWNER`, `CAPXUL_DOOR_TOKEN` and `CAPXUL_PLATFORM_TOKEN` at deploy; Alchemy binds them into the
Worker's environment, the tokens as secrets. The runner
(`packages/runner`) deploys a stage, applies `migrations/`, waits for Core to answer, runs, reads the spans back and
destroys the stage, whatever happened. Alchemy's state is local (`.alchemy/`, never committed), so only the checkout
that created a stage can destroy it. Never run `alchemy nuke`.

Things learned in `spikes/pipeline` that still hold: the Worker's init runs again inside the Worker at cold start (so
`src/stack/database.ts` reads nothing from the deploy there); inside a Worker the clock moves only on I/O, so an empty
handler's span measures 0 ms; and Core answers every path with JSON, so a 404 that is not JSON is Cloudflare's edge,
not Core. Effect's Rpc client posts to its URL with a trailing slash, so `/world/` is the world's door too.

## In a world

Proven by the runner's door check against a world that `world create` made (`packages/runner/records/w-c1/door.json`,
`passed`): all twelve operations answered `NotImplemented` at the world's Core, with every span read back from the
world's own branch. `/chain` answered `eth_blockNumber` from the world's chain and refused `eth_sendTransaction`.
`SiteDoor` was deployed in a world with a company site (`packages/world/records/site.proof.json`), but the only bench
there was, a stand-in in an agent's container, is not reachable from Cloudflare: the probe answered `SiteDoorFailed`
`unreachable`, as it should. Reaching a site from Core waits for the AWS bench and its tunnel.

## Adding an operation

To a domain Core already serves: its handler where its kind of work lives (`src/site-ops/`, `src/organizations/`),
and one entry in that domain's file in `src/domains/`. A subject its approvals authorise gets an entry in its
domain's `landings` (`organizations/landed.ts`, `approvals/payments.ts`).

A new domain: a new file in `src/domains/`, then one import and one entry per group it serves in `src/handlers.ts`,
and, if its approvals authorise subjects, one entry in `landings` in `src/approvals/landed.ts` (the type refuses a
kind of the blueprint's `Subject` with none). `src/empty-handlers.ts` needs nothing.

## Migrations

Both migrators (the runner's for a stage, `packages/world`'s for a world) apply the `.sql` files of `migrations/` in
name order; a world keeps the names it has applied and is given only the files it has not seen. So a name is never
changed once merged, and two slices must never write the same name. The rule, checked by `test/migrations.test.ts`:

- A file is `NNNN_<domain>.sql` or `NNNN_<domain>_<what>.sql`. `<domain>` is a blueprint domain (its folder, such as
  `organizations`), or `core` for Core's own tables. `0001` to `0005` were named before the rule and keep their
  names.
- `NNNN` is one more than the highest number on the branch the slice was cut from. Two slices may take the same
  number: their domains make the names differ, and the two files apply in the order of their domains' names.
- So a migration may depend only on files with a lower number. One that needs another domain's new table waits for
  it to merge, and takes the next number then.

## Checks

`pnpm types` and `pnpm test` (in memory; no keys). The proof in a deployed stage is the runner's run record under
`packages/runner/records/`.
