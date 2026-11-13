# core

The Capxul server (roadmap step 1.1): one Cloudflare Worker, written in Effect and deployed by Alchemy, that serves
every operation of the blueprint over HTTP with Effect's own Rpc server, and keeps every call's spans in its database
for the runner. Built from `spikes/pipeline/core`. It has two doors, as the SDK (`packages/sdk`) calls them: the
platform group at `/platform` and the world group at `/world`, each an HTTP POST of Effect Rpc in JSON. Any other
path answers 404 in JSON.

**Every handler is empty.** Each operation fails with the blueprint's `NotImplemented`, naming itself
(`packages/blueprint/decisions.md`, entry 33). The server compiles only with one handler per operation: delete a line
of `src/handlers.ts` and `pnpm types` fails with `Property '"record.export"' is missing`.

| File | What it is |
|---|---|
| `src/door.ts` | The door: the stack, the two door paths, `serveDoors`, `Served`, `CoreRpcs`, the span types, and `migrations`. |
| `src/doors.ts` | `serveDoors`: each request to the group its path names, `PLATFORM_PATH` or `WORLD_PATH`. |
| `src/handlers.ts` | One handler per operation, in its blueprint group. All twelve are empty. |
| `src/server.ts` | `Served`, the handlers and middlewares of both groups, and `CoreRpcs`, both groups merged for a test in memory. |
| `src/telemetry/spans.ts` | One span per call, named after the operation, under the trace id of the caller's `traceparent`, with every span beneath it. |
| `src/telemetry/sink.ts` | Where a call's spans go: `app.spans`, written after the call ends and before the answer leaves. |
| `src/telemetry/middleware.ts` | The server half of `Telemetry`, `WorldSignIn` and `PlatformSignIn`, and `CoreIdentity` (the world, its owner, the doors' tokens). |
| `src/worker.ts` | The Worker: `serveDoors` with `Served`, a database through Hyperdrive and JSON serialization. |
| `src/stack/database.ts` | A stage's database: a Neon project of its own, and Hyperdrive in front of it with its query cache off. |
| `alchemy.run.ts` | The stack `CapxulCore`. One stage is one Core and its database. |
| `migrations/` | The `app` schema: `app.spans` and `app.events`. Applied by the runner when a stage is created. |
| `test/server.test.ts` | Core's groups in memory: all twelve answer `NotImplemented` under one span each, kept with the caller's trace id; sign-in refusals. |
| `test/doors.test.ts` | The SDK's own client against `serveDoors` over HTTP in this process: all twelve at their doors, the server span under the SDK's trace, wrong tokens refused, other paths 404 in JSON. |

## What every call gets

- **A span.** Whichever middleware runs first (sign-in, which is outermost) opens the call's span, named after the
  operation, as a child of the caller's span in the `traceparent` header (the SDK sends its own client span there),
  or in a new trace without one; the others join it. That span
  and every span beneath it are written to `app.spans` (trace id, span id, parent, name, outcome, duration in ms, end in
  epoch ms) before the answer leaves, so the caller can read them as soon as it holds the answer. A call whose spans
  cannot be written dies.
- **A caller.** Sign-in reads the blueprint's `CREDENTIAL_HEADER` (`authorization: Bearer <token>`): the world's
  door token at `/world`, the operator's token at `/platform`. No credential is `NotSignedIn` (`no_credential`),
  another token `NotSignedIn` (`unknown_caller`). A world call then acts as the world's owner, or as the person named
  in `capxul-person` (a header that is not a person's name is refused; the cast is not checked until step 1.12). A
  platform call acts as the owner, the operator that deployed the stage. Tokens are compared as strings.
- **`CurrentCall`**: its trace id and operation, for the events a built handler will emit into `app.events`.

Core serves the platform group too, until `packages/world` serves it (blueprint decisions.md, entry 11).

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

## Checks

`pnpm types` and `pnpm test` (in memory; no keys). The proof in a deployed stage is the runner's run record under
`packages/runner/records/`.
