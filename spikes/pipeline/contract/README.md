# contract

The contract of the pipeline spike: pure Effect declarations, with no implementation and no infrastructure import.
The server (`../core`) and every client (`../runner`) import it; nothing here imports them.

| File | What it declares |
|---|---|
| `operation.ts` | What an operation declares beyond its Rpc: the events one successful call emits, and a speed budget in ms. |
| `telemetry.ts` | The header a caller names a call with (`traceparent`), the `Telemetry` middleware every operation runs under, and `CurrentCall`, which it gives each handler. |
| `record.ts` | The concept "record": `record.append`, `record.export`, the refusal `DuplicateEntry`, the event `record_appended`. |
| `door.ts` | The one door: `operations` (every operation with its declaration) and `CoreRpcs` (the Rpc group). |

## The operations

| Operation | Payload | Success | Typed refusal | Emits | Budget |
|---|---|---|---|---|---|
| `record.append` | `{ key: string, kind: string, body: json }` | `{ seq: integer }` | `DuplicateEntry { key }` | `record_appended { key, seq }` | 500 ms |
| `record.export` | none | `{ entries: [{ seq, key, kind, body }] }` | none | nothing | 500 ms |

## Acceptance claims

These are what the scenarios prove. Each holds in a fresh world.

1. The first append in a fresh world returns seq 1 and each later append returns the previous seq plus one.
2. Appending a key that was already appended is refused with DuplicateEntry naming the key, and the record is unchanged.
3. Export returns every appended entry exactly once, in seq order, with its key, kind and body as appended.
4. Export of a fresh world returns no entries.
5. Every successful append emits exactly one record_appended event carrying its key and seq, and a refused append emits none.

## What the compiler holds, and what it does not

- `CoreRpcs.toLayer` needs one handler for every operation in the group, with the declared payload, success and
  error types. A missing handler is a compile error (see `../core/README.md`).
- Core's `Events.emit(operation, event)` accepts only an instance of an event that `operation` declares.
- The compiler does not know whether a handler emits its events, or how fast it is. The runner's generic checks do
  (`../runner/checks.ts`): they read `emits` and `budgetMs` from `operations`, for every call of every scenario.

## Adding an operation

Declare it with `declare({ rpc, emits, budgetMs })` in its concept's file, add it to `operations` and to
`RpcGroup.make(...)` in `door.ts`. The server then does not compile until it has a handler.
