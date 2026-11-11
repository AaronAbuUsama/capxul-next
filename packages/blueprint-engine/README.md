# @capxul/blueprint-engine

The engine of the blueprint. The blueprint itself is the records in `blueprint/`; this package defines what a record
is, builds the blueprint from them and reports every problem. (It was `packages/book` until 10 November 2026; the
content and the engine no longer share a name.)

```bash
pnpm blueprint        # node packages/blueprint-engine/src/main.ts blueprint/index.ts var/blueprint  → must print 0 problems
pnpm --filter @capxul/blueprint-engine test
```

- `src/records/`: the record types (`defineOperation`, `defineDecision`, …) that `blueprint/` is written with.
- `src/build.ts`: reads every record, links them and collects problems.
- `src/evals.ts`, `status.ts`, `stand.ts`: the evals a record derives, the scoreboard format, where each record stands.
- `src/records/site.ts`, `src/site.ts`: `defineDoctype` (a Frappe DocType Capxul defines, or the Custom Fields it adds
  to Frappe's) `defineRole` (a hat and the Frappe roles it gives) and `defineFeature` (a part a site switches), and their rules. `pnpm frappe:check-blueprint`
  compares these records with `packages/frappe-app` and fails the merge on a difference.
- `src/records/telemetry.ts`, `src/signals.ts`: `defineLog` and `defineMetric`, and an event's `purpose` (transition,
  product, failure, operator), `producer`, `pii` and `groups`, with their rules, gaps and evals (`ana:`, `log:`, `met:`).
  The system's `envelope` is what every signal carries. `defineInsight` (a query over them), `defineAlert` (an insight,
  a condition, a route and a runbook) and `defineDashboard` (insights and journeys, in order) derive `ins:`, `alr:` and
  `dsh:` evals.
- `src/records/screen.ts`, `src/screens.ts`: `defineScreen` (what a person sees: its surface, the values it shows and
  their sources, its buttons, the roles that may open it, its states and its part), with `scr:` evals. A journey
  step's `seen` names the screen where the person sees the result.
- Every record may carry `owes`: changes a decision asks of the code that it has not made. The record says what the
  code does now, so the agreement checks pass, and each owed change is an `owed-change` gap.
- `src/ripple.ts`: what a change reaches. `pnpm blueprint:ripple [--base <ref>] [--json]` compares this branch's
  blueprint with the base's (built with the base's own engine, `scripts/at.ts`): records added, removed and changed,
  everything that depends on them, the decisions to read again and the evals whose verdicts go stale.
- `src/impact.ts`, `views.ts`, `examples.ts`, `telemetry.ts`, `budgets.ts`: what the portal and the checks read.

Written by: the coordinator, when the blueprint needs a new kind of record or check. Read by: `packages/portal`,
`packages/evals`, `packages/plan`. How it is used end to end: `docs/blueprint.md`.
