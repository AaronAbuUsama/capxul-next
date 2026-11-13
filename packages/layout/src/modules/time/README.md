# time: no direct reads of the host clock

The static half of `inv:time.no-direct-reads` (decisions `time.no-direct-reads` and `devnet.one-world-clock`).
`pnpm layout` scans the product code for host clock reads: every package's `src/` plus the paths in `include` of
`packages/layout/time-reads.json`, minus the tooling named in `exclude` (each with its reason), in TypeScript, JavaScript,
SQL and Python. It looks for `Date.now()`, `new Date()`, `performance.now()`, `datetime.now/today/utcnow()`,
`time.time()`, and SQL's clock in every file kind (`now()`, `current_date`, `transaction_timestamp()`, `curdate()`, ...),
including `default now()` columns.

`packages/runtime/src/time/` is the one clock module (RealTime and, next, the world's now): reads inside it are the door and take no label.
Every other read must be labelled by an entry naming its whole trimmed line (and `hits` when the same line occurs more than
once), so a new read can never hide behind an old entry's text, and every entry must still label its reads:

| label | meaning |
|---|---|
| `rebound` | the world clock replaces it at runtime (Frappe's patched `now`, the bench clock file) |
| `real-on-purpose` | a measure or protection that `time.real-elapsed` keeps on real time: timeouts, retries, alert ages, token expiry |
| `world` | already reads the world clock |
| `owed` | business time still on the host; it passes the scan, names an `owner`, and keeps the invariant false until it is gone |

`work` lists clock work a decision promises that no scanned line shows (the pinned apps' reads of devnet.site-follows-world),
each with its owner; it counts as owed.

To add a read, label it with a reason. A business time (a record's `at`, a row's `created_at`) takes `worldNow`, not a label.

Tests (`*.test.ts`), opt-in native proofs (`*.native.ts`) and generated code are not product code and are not scanned.

- `service.ts`: the scan and the check, pure. `time.test.ts`: the negative controls.
