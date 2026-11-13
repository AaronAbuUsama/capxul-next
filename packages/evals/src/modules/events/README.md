# events

One blueprint-driven check per `evt:<operation>/<event>` claim in the slice-zero gate, named
`EVENTS.<operation>.<event>` and bound in `evals/bindings/events.json` (`system.eval-event-checks`).
`bash run.sh --list` needs no world.

**What a lane does:** whenever your module or preparation calls a public operation during a run, append one line per call
to your own `$CAPXUL_EVAL_RUN_DIR/<module>/operations.jsonl`:

```json
{"operation":"payment.send","trace_id":"<the W3C trace id the call sent>","ok":true}
```

`trace_id` is the trace the call sent: a W3C trace id (32 lowercase hex digits) minted for this run, whose first 16 digits
are `runTracePrefix(runId)` (the first 16 hex digits of sha256 of the receipt's `id`, the last segment of
`$CAPXUL_EVAL_RUN_DIR`) and whose last 16 are random per call. Any other trace is a log error, and one trace logged by two
calls proves neither.

Preparation writes `<run>/preparation/operations.jsonl`. Only regular, non-empty files written during this run count; a
link, an old file, a malformed line or a trace not minted for this run is a log error, and any log error fails every check.

**What a check proves:** at least one successful logged call of the operation sent the event to `app.transition_outbox`
under its own trace (read as the restricted `capxul_worker` role on this run's world), and every such envelope is well
formed: id, entity_id, the machine whose transitions emit the event, a non-negative integer `at`, owner kind and id together. Its props must also decode
exactly, with no excess keys, against the event record (engine `eventPropsErrors`). No log, no call, no event or an
invalid envelope is an explicit `fail` with the reason. Every requested check is always reported, so the plan completes.
Evidence for each check is in `<run>/events/<operation>-<event>.json`.
