# time: no direct reads of the host clock

The static half of `inv:time.no-direct-reads` (decisions `time.no-direct-reads` and `devnet.one-world-clock`).
`pnpm layout` scans the product code under the scopes in `packages/layout/time-reads.json` (TypeScript, SQL, and the
Frappe app's Python) for host clock reads: `Date.now()`, `new Date()`, `now()`, `current_date`, `datetime.now()`,
`time.time()` and the like, including `default now()` columns.

`packages/runtime/src/time/` is the one clock module (RealTime and, next, the world's now): reads inside it are the door and take no label.
Every other read must be labelled by one entry in `time-reads.json`, and every entry must still label a read:

| label | meaning |
|---|---|
| `rebound` | the world clock replaces it at runtime (Frappe's patched `now`, the bench clock file) |
| `real-on-purpose` | a measure or protection that `time.real-elapsed` keeps on real time: timeouts, retries, alert ages, token expiry |
| `world` | already reads the world clock |
| `owed` | business time still on the host; it passes the scan, names an `owner`, and keeps the invariant false until it is gone |

To add a read, label it with a reason. A business time (a record's `at`, a row's `created_at`) takes `worldNow`, not a label.

Tests (`*.test.ts`), opt-in native proofs (`*.native.ts`) and generated code are not product code and are not scanned.

- `service.ts`: the scan and the check, pure. `time.test.ts`: the negative controls.
