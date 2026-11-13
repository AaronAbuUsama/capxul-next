# core

The world's server: one Cloudflare Worker, written in Effect and deployed by Alchemy, that serves the contract's Rpc
group over HTTP and keeps its data in the world's Neon branch.

| File | What it is |
|---|---|
| `worker.ts` | The Worker. `RpcServer.toHttpEffect(CoreRpcs)` with the handlers, the telemetry and the database provided. |
| `handlers.ts` | One handler per operation. **Today this is the empty implementation**: every operation dies as `NotImplemented`. |
| `telemetry.ts` | The measurement plumbing: `TelemetryLive` (spans per call) and `Events` (declared events, in the caller's transaction). |
| `world.ts` | The world's resources: the Neon branch and the Hyperdrive configuration in front of it. |
| `migrations/` | The `app` schema. Applied by the runner when a world is created. |

## How the Worker reaches Neon

Hyperdrive plus Effect SQL, the path Alchemy documents. `world.ts` declares a `Cloudflare.Hyperdrive.Connection`
whose origin is the branch's direct endpoint; the Worker binds it (`Cloudflare.Hyperdrive.Connect`) and hands its
connection string to `@alchemy.run/sql/Postgres`, which is `@effect/sql-pg` with one pool per request. The Worker runs
with `nodejs_compat` because the driver opens its socket through Node's `net` and `tls`. The Worker never holds the
database's own connection string.

Measured on 13 November 2026 from a Worker to a branch in `aws-eu-west-2`: one statement took 81 to 130 ms, and a
transaction of `BEGIN`, one insert and `COMMIT` took 259 to 298 ms.

## A missing handler does not compile

With the `"record.export"` line deleted from `handlers.ts`, `pnpm typecheck` (`tsc -p .`) fails:

```
core/handlers.ts(19,46): error TS2345: Argument of type '{ "record.append": () => Effect.Effect<never, never, never>; }' is not assignable to parameter of type 'HandlersFrom<Rpc<"record.append", ...> | Rpc<...>> | Effect<...>'.
  Property '"record.export"' is missing in type '{ "record.append": () => Effect.Effect<never, never, never>; }' but required in type 'HandlersFrom<Rpc<"record.append", ...> | Rpc<...>>'.
```

## What a handler is given

- **`SqlClient`** (`effect/sql/SqlClient`), on the world's database.
- **`Events`**: `events.emit(Record.append, new Record.RecordAppended({ key, seq }))` writes a row to `app.events`
  (trace id, operation, event name, payload, at) through the same `SqlClient`. Inside `sql.withTransaction(...)` the
  event commits or rolls back with the write it reports. An event the operation does not declare is a compile error.
- **`CurrentCall`**: the trace id and the operation of the call being served.
- **A span**: the handler runs in a span named after its operation, under the trace id the caller sent in the
  `traceparent` header. That span, and every span beneath it (each SQL statement, anything wrapped in
  `Effect.withSpan`), is written to `app.spans` (trace id, span id, parent span id, name, outcome, duration ms, at)
  after the handler ends and before the answer leaves.

Proven on 13 November 2026 with a temporary handler that was not committed: an append that emitted inside a
transaction left one `app.events` row; the same handler failing with `DuplicateEntry` inside the transaction left
none, and the caller received the typed refusal. Both left their spans (`BEGIN`, the insert, `COMMIT` or `ROLLBACK`,
`sql.transaction`, `record.append`).

A handler builds its dependencies like this (the shape the temporary handler used):

```ts
export const HandlersLive = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const events = yield* Events;
    return { "record.append": (payload) => ..., "record.export": () => ... };
  }),
);
```

## Things to know

- A Worker's constructor runs twice: at deploy, and again inside the running Worker at cold start. So `world.ts`
  is evaluated in the Worker too; it skips the world's owner and expiry there (`ALCHEMY_PHASE`), because a Worker
  that asked for them answered 500.
- Inside a Worker the clock only moves when the Worker waits on I/O. A handler that does no I/O measures 0 ms.
- Writing the spans costs each call one more database round trip, which is not part of the call's measured duration.
- A defect in a handler answers that one call (`disableFatalDefects`); it reaches the caller as a defect with its
  name and message.
