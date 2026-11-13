# core

The world's server: one Cloudflare Worker, written in Effect and deployed by Alchemy, that serves the contract's Rpc
group over HTTP and keeps its data in the world's Neon branch.

| File | What it is |
|---|---|
| `worker.ts` | The Worker. `RpcServer.toHttpEffect(CoreRpcs)` with the handlers, the telemetry and the database provided. |
| `handlers.ts` | One handler per operation, each a thin line over the concept that owns it. A database failure dies as a defect; only declared refusals stay typed. |
| `record.ts` | The concept "record": `RecordStore`, with `append` (one transaction: move the head, insert the entry, emit `record_appended`) and `entries` (one `select`). |
| `telemetry.ts` | The measurement plumbing: `TelemetryLive` (spans per call) and `Events` (declared events, in the caller's transaction). |
| `world.ts` | The world's resources: the Neon branch and the Hyperdrive configuration in front of it, with its query cache off. |
| `migrations/` | The `app` schema. Applied by the runner when a world is created. |

## How the Worker reaches Neon

Hyperdrive plus Effect SQL, the path Alchemy documents. `world.ts` declares a `Cloudflare.Hyperdrive.Connection`
whose origin is the branch's direct endpoint; the Worker binds it (`Cloudflare.Hyperdrive.Connect`) and hands its
connection string to `@alchemy.run/sql/Postgres`, which is `@effect/sql-pg` with one pool per request. The Worker runs
with `nodejs_compat` because the driver opens its socket through Node's `net` and `tls`. The Worker never holds the
database's own connection string.

**Hyperdrive's query cache is off** (`caching: { disabled: true }` in `world.ts`). With it on, which is Hyperdrive's
default, a `select` outside a transaction is answered from a cache for up to 60 seconds: an export just after an
append came back without the new entry. With the cache off every statement reaches the database, so
`RecordStore.entries` is one bare `select` and one round trip. It used to run inside a transaction only to get
past the cache, which cost two more round trips (`BEGIN` and `COMMIT`).

Measured on 13 November 2026 from a Worker in the eastern United States to a branch in `aws-eu-west-2`, over 84
calls (`../../../packages/runner/records/spike/`): every statement is one round trip, median 87 ms. An accepted append is four (`BEGIN`,
the insert, the event, `COMMIT`): 331 to 504 ms. An export is one: 83 to 144 ms. The first statement of a call
takes 560 to 890 ms instead when no connection to Neon is open for it; that happens to most calls in a world's
first 10 s, and afterwards to the first call of about half of all worlds (`../README.md`, "Speed").

## A missing handler does not compile

With the `"record.export"` line deleted from `handlers.ts`, `pnpm typecheck` (`tsc -p .`) fails. The line that says
why, of the three it prints:

```
core/handlers.ts(22,3): error TS2345: Argument of type 'Effect<{ "record.append": ... }, never, RecordStore>' is not assignable to parameter of type 'HandlersFrom<Rpc<"record.append", ...> | Rpc<...>> | Effect<...>'.
    Property '"record.export"' is missing in type '{ "record.append": (payload: ...) => Effect<{ readonly seq: number; }, DuplicateEntry, CurrentCall>; }' but required in type 'HandlersFrom<Rpc<"record.append", ...> | Rpc<...>>'.
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

Proven on 13 November 2026 by the five scenarios (`../../../packages/runner/records/spike/`): an accepted append leaves one `app.events`
row; one refused with `DuplicateEntry` inside the transaction leaves none, and the caller receives the typed
refusal. Both leave their spans (`BEGIN`, the insert, `COMMIT` or `ROLLBACK`, `sql.transaction`, `record.append`),
and each run record lists them for every call as its `steps`.

The handlers build their dependencies like this (`handlers.ts`; `RecordStoreLive` in `record.ts` asks for
`SqlClient` and `Events`):

```ts
export const HandlersLive = CoreRpcs.toLayer(
  Effect.gen(function* () {
    const record = yield* RecordStore;
    return { "record.append": (payload) => ..., "record.export": () => ... };
  }),
).pipe(Layer.provide(RecordStoreLive));
```

## Things to know

- A Worker's constructor runs twice: at deploy, and again inside the running Worker at cold start. So `world.ts`
  is evaluated in the Worker too; it skips the world's owner and expiry there (`ALCHEMY_PHASE`), because a Worker
  that asked for them answered 500.
- Inside a Worker the clock only moves when the Worker waits on I/O. A handler that does no I/O measures 0 ms.
- The Worker answers every path and method through the Rpc server, always with status 200 and JSON. So a 404 that
  is not JSON was never Core's: it is Cloudflare's edge, answering for an address it has not routed yet. The runner
  relies on this (`../runner/warmup.ts`).
- Writing the spans costs each call one more database round trip, which is not part of the call's measured duration.
- A defect in a handler answers that one call (`disableFatalDefects`); it reaches the caller as a defect with its
  name and message.
