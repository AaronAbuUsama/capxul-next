# Organizations and Parties selected-stack checks

`bash run.sh --list` needs no fixture. Normal execution requires the supervisor's private `CAPXUL_WORLD_CONFIG`, the
post-restore `CAPXUL_ACCEPTANCE_FIXTURE` and the harness-owned running `CAPXUL_EVAL_RUN_DIR`. It proves the selected stack
the way Activity's runner does, uses only the restricted tenant and worker connections, saves sanitized evidence under
the run's `organizations/`, and never commits a write: every refused attempt rolls back.

`tables.ts` holds the table checks, for the seven wave-required Organizations tables and Parties' `parties`:

- `schema`: the live columns (names, order, nullability), primary key and indexes equal the blueprint record, read from
  `blueprint/organizations/data.ts` and `blueprint/parties/data.ts` rather than from the migration. A partial index is
  named by its fields (its `for` states the predicate); an expression index fails. No runtime role owns the table.
- `writers`: Core may only read; the worker, which runs the procedures and workflows that list the table in `writes`,
  inserts and updates; nothing deletes or truncates, by grant and by actual attempt.
- `tenancy` (Organizations tables): row security is forced, and at one MVCC cut a member of each Organization reads
  every row of its own Organization and none of another's, and is refused every write. It needs rows of at least two
  Organizations, each with a member who holds a Seat in no other Organization and founded no other setup.

All of these are **near-only** in `evals/bindings/organizations-tables.json` and `evals/bindings/parties.json` until one
complete fresh selected-stack run passes them. That run needs world creation to found its companies through
`organizations.setups.begin` and the setup's process on the target tables (the cut-over), not `/admin/org`.
