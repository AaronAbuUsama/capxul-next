# Activity selected-stack checks

`bash run.sh --list` needs no fixture. Normal execution requires the supervisor's private `CAPXUL_WORLD_CONFIG`, post-restore `CAPXUL_ACCEPTANCE_FIXTURE` and harness-owned running `CAPXUL_EVAL_RUN_DIR`. It uses only restricted tenant/worker connections, validates the pinned live world through public `world inspect`, and saves sanitized evidence under the same run's `activity/`. It never migrates or restores, and it never commits a write: every refused attempt and every redelivery rolls back.

`main.ts` runs the checks in order. `tables.ts` holds the table checks:

- `schema`: exact fields, key and indexes, and the table is not owned by a runtime role.
- `constraints`: every CHECK, NOT NULL and unique key refuses a bad row.
- `tenancy`: each owner sees exactly its own rows at one MVCC cut.
- `cross-owner`: Core owner transactions are refused every insert, update, delete and truncate, on another owner's rows and on their own.
- `writer-acl`: grants, plus the worker actually being refused update, delete and truncate.

`workflows.ts` holds `note-payment-<t>.idempotent`. For each kind of transition it samples real transitions that Core emitted and the relay acknowledged in this run. Each must be noted exactly once in each feed holding its Payment, and redelivery through the ACK, or through the `by-owner-event` key alone, must change nothing.

`note-movement-record` samples real Movement transitions acknowledged in this run. Each `record` must be noted exactly once in its side's feed, as the Movement's `<chain>:<tx>:<log>:<side>` id with the event's fields. Each `remove`/`restore` must be acknowledged without an append, and redelivery must change nothing.

It also holds `note-payment-<t>.resume`, which runs first. For each kind it arms Runtime's fault mount for the next Activity delivery of that transition only (`world fixture resume-arm activity.changes --event payment_transitioned --transition <t>`), drives one real transition with `world fixture payment <t>`, and runs `resume-kill`, which SIGKILLs Core between the appender and its ACK, then restarts and resumes it. The check then requires exactly one ACK committed after the kill, exactly one change per holding feed with the event's fields, and gapless feed `seq`. The faulted event must be the transition event id that `world fixture payment` prints as `eventId`, and come after the outbox position read before arming, and the check waits up to the workflow's 30 s for the restarted relay's ACK. ACK times are compared with host times only while `transition_acks.acked_at` is the database host clock; if that column's source changes, the check fails. If the drive fails, the arm is removed with `resume-disarm` (or `resume-kill`'s timeout), and only when the world has no `payment` fixture at all do the remaining kinds fail at once; a refusal for one kind fails that kind alone. The ACK-time guard also refuses any trigger on `transition_acks`.

All of these stay **near-only** in `evals/bindings/activity.json` until one complete fresh selected-stack run passes them. The eleven `/p95` claims have no check yet: they wait for the outbox's operational times (Shared) and the shared sample helper (Harness).

`packages/backend/src/activity/door.ts` exports `migrateActivity(Sql)` for explicit world creation and `note(Sql,TransitionEvent)` using the canonical `platform/outbox.ts` type. Composition owns the explicit worker call `relay(db, "activity.changes", ["payment_transitioned", "movement_transitioned"], note)`, not eleven unconditional consumer aliases. Source event identity and time are immutable across retry. The relay commits the appender and its consumer ACK in the same transaction, after the source commit. The appender follows all eleven payment transitions and only Movement `record`. Movement removal and restoration are acknowledged without an append. Unsupported events, inconsistent owners or payment identities, and missing payment rows fail without an ACK. No registrar or source emitter is defined here.

Component validation is deliberately separate. With a fresh disposable Postgres 17 `activity_test` database, run `ACTIVITY_TEST_ADMIN_URL=… node --experimental-strip-types --no-warnings --test packages/backend/test/activity/run.test.ts`. Its minimal payment-side fixtures are **not** proof of the public payment lifecycle, ERPNext, Ponder or v4. Nothing from it writes a scoreboard verdict or measures workflow p95.
