# core

The Capxul server (roadmap step 1.1): one Cloudflare Worker, written in Effect and deployed by Alchemy, that serves
every operation of the blueprint over HTTP with Effect's own Rpc server, and keeps every call's spans in its database
for the runner. Built from `spikes/pipeline/core`.

**Every handler is empty.** Each operation fails with the blueprint's `NotImplemented`, naming itself
(`packages/blueprint/decisions.md`, entry 33). The server compiles only with one handler per operation: delete a line
of `src/handlers.ts` and `pnpm types` fails with `Property '"record.export"' is missing`.

| File | What it is |
|---|---|
| `src/door.ts` | The door: the stack, `CoreRpcs`, `Served`, the span types, and `migrations`. |
| `src/handlers.ts` | One handler per operation, in its blueprint group. All twelve are empty. |
| `src/server.ts` | `CoreRpcs`, both blueprint groups merged onto one address (each Rpc keeps its own group's middlewares), and `Served`, its handlers and middlewares. |
| `src/telemetry/spans.ts` | One span per call, named after the operation, under the trace id of the caller's `traceparent`, with every span beneath it. |
| `src/telemetry/sink.ts` | Where a call's spans go: `app.spans`, written after the call ends and before the answer leaves. |
| `src/telemetry/middleware.ts` | The server half of `Telemetry`, `WorldSignIn` and `PlatformSignIn`, and `CoreIdentity` (the world and its owner). |
| `src/worker.ts` | The Worker: `RpcServer.toHttpEffect(CoreRpcs)` with `Served`, a database through Hyperdrive and JSON serialization. |
| `src/stack/database.ts` | A stage's database: a Neon project of its own, and Hyperdrive in front of it with its query cache off. |
| `alchemy.run.ts` | The stack `CapxulCore`. One stage is one Core and its database. |
| `migrations/` | The `app` schema: `app.spans` and `app.events`. Applied by the runner when a stage is created. |
| `test/server.test.ts` | Core served in memory: all twelve answer `NotImplemented` under one span each, kept with the caller's trace id. |

## What every call gets

- **A span.** Whichever middleware runs first (sign-in, which is outermost) opens the call's span, named after the
  operation, under the trace id of the `traceparent` header, or a new trace without one; the others join it. That span
  and every span beneath it are written to `app.spans` (trace id, span id, parent, name, outcome, duration in ms, end in
  epoch ms) before the answer leaves, so the caller can read them as soon as it holds the answer. A call whose spans
  cannot be written dies.
- **A caller.** Sign-in is provisional until the world's door gives Core its token (step 1.3): a call acts as the
  world's owner, or as the person named in `capxul-person`; a header that is not a person's name is refused with
  `NotSignedIn`. A platform call acts as the owner, who is the operator that deployed the stage.
- **`CurrentCall`**: its trace id and operation, for the events a built handler will emit into `app.events`.

Core serves the platform group too, until `packages/world` serves it (blueprint decisions.md, entry 11).

## A stage of `CapxulCore`

A stage is named `core-<6 hex>`, which is also its world's name. It holds a Neon project (`core-db`, London) whose
default branch is the database, a Hyperdrive configuration in front of it (`core-db`), and the Worker (`Core`). The
Worker reads `WORLD_OWNER` at deploy; Alchemy binds it into the Worker's environment. The runner
(`packages/runner`) deploys a stage, applies `migrations/`, waits for Core to answer, runs, reads the spans back and
destroys the stage, whatever happened. Alchemy's state is local (`.alchemy/`, never committed), so only the checkout
that created a stage can destroy it. Never run `alchemy nuke`.

Things learned in `spikes/pipeline` that still hold: the Worker's init runs again inside the Worker at cold start (so
`src/stack/database.ts` reads nothing from the deploy there); inside a Worker the clock moves only on I/O, so an empty
handler's span measures 0 ms; and Core answers every path with 200 and JSON, so a 404 that is not JSON is Cloudflare's
edge, not Core.

## Checks

`pnpm types` and `pnpm test` (in memory; no keys). The proof in a deployed stage is the runner's run record under
`packages/runner/records/`.
