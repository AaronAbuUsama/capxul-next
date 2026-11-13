# events

One blueprint-driven check per `evt:<operation>/<event>` claim in the slice-zero gate, named
`EVENTS.<operation>.<event>` and bound in `evals/bindings/events.json` (`system.eval-event-checks`).
`bash run.sh --list` needs no world.

**What a lane does:** whenever your module or preparation calls a public operation during a run, append one line per call
to your own `$CAPXUL_EVAL_RUN_DIR/<module>/operations.jsonl`:

```json
{"operation":"payment.send","trace_id":"<the trace id the call sent>","ok":true}
```

Preparation writes `<run>/preparation/operations.jsonl`. Only regular, non-empty files written during this run count; a
link, an old file or a malformed line is reported, never used.

**What a check proves:** at least one successful logged call of the operation sent the event to `app.transition_outbox`
under its own trace (read as the restricted `capxul_worker` role on this run's world), and every such envelope is well
formed: id, machine, entity_id, a non-negative integer `at`, owner kind and id together. Its props must also decode
exactly, with no excess keys, against the event record (engine `eventPropsErrors`). No log, no call, no event or an
invalid envelope is an explicit `fail` with the reason. Every requested check is always reported, so the plan completes.
Evidence for each check is in `<run>/events/<operation>-<event>.json`.
