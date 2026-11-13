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

**Five handlers are built** (`src/site-ops/`, below): `doc.create`, `doc.submit`, `report.run`, `world.clock.warp` and
`record.export`. Every other handler is empty: it fails with the blueprint's `NotImplemented`, naming itself
(`packages/blueprint/decisions.md`, entry 33). The server compiles only with one handler per operation: delete a line
of `src/handlers.ts` and `pnpm types` fails with `Property '"record.export"' is missing`.

| File | What it is |
|---|---|
| `src/door.ts` | The door: the stack, the two door paths, `serveDoors`, `Served`, `CoreRpcs`, the span types, and `migrations`. |
| `src/doors.ts` | `serveDoors`: each request to the group its path names, `PLATFORM_PATH` or `WORLD_PATH`. |
| `src/handlers.ts` | One handler per operation, in its blueprint group. Five are `src/site-ops/`'s; the rest are empty. |
| `src/site-ops/` | The document, report, clock and record operations (below). `door.ts` is its door. |
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
| `migrations/` | The `app` schema: `app.spans` and `app.events` (0001); `app.clock` and `app.documents` (0002). Applied by the runner when a stage is created, and by the world when it is made. |
| `test/server.test.ts` | Core's groups in memory: all twelve answer `NotImplemented` under one span each, kept with the caller's trace id; sign-in refusals. |
| `test/site-ops-documents.test.ts`, `test/site-ops-world.test.ts` | The five operations served in memory through Core's groups against a stand-in company site (`test/support/site-ops.ts`): what the site is asked, what Core answers, what the record keeps. |
| `test/site-ops-sql.test.ts` | The clock, the record, the document hashes and the cast in Postgres with the migrations applied. Runs only with `CAPXUL_TEST_DATABASE` (a throwaway Postgres); skipped otherwise, as in CI. |
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

Core serves the platform group too, until `packages/world` serves it (blueprint decisions.md, entry 11).

## The document, report, clock and record operations (`src/site-ops/`)

| Operation | What it does |
|---|---|
| `doc.create` | Creates the document on the company's site as the caller's own site user (`capxul.core_api.create` in `packages/frappe-app`), answers it with its keccak-256 hash, keeps the hash in `app.documents`, and records `doc_created`. |
| `doc.submit` | Submits it as the caller. An ordinary document posts (`doc_submitted`); a Payment Entry from the company Safe is held (decisions.md, 28): its payee, amount and asset from the entry, the payee's address from the Supplier, its hash from `app.documents`; the approval is opened by `PaymentApprovals` (below), then the site keeps the hold (`capxul.core_api.hold`, a Capxul Payment Request waiting for the signature) and Core records `payment_held`. `NotADraft` for a document that is not a draft. |
| `report.run` | Runs the report as the caller, `company` and the period filled when left out (`capxul.core_api.report`); a doctype's name runs its list. |
| `world.clock.warp` | The owner's only. Every ready site of the world steps through each day between, running what fell due (`capxul.core_api.warp`; the last site writes the world's clock on the bench), then the chain mines a block at the new time (Anvil, over the `CHAIN` binding), then `app.clock` moves; records `clock_warped`. A warp to now or before is `ClockBackwards`. |
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
| The approval of a held payment (`PaymentApprovals.open`) | `payments.ts` | `approval.sign`'s half; until it is merged, a Safe payment dies naming it (`PaymentApprovalsUnbuilt`) |

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

## Checks

`pnpm types` and `pnpm test` (in memory; no keys). The proof in a deployed stage is the runner's run record under
`packages/runner/records/`.
