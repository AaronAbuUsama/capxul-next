# @capxul/portal

Generates the portal, a static site, from the blueprint and the scoreboard, and serves it with the form the
owner answers questions through.

```bash
pnpm portal          # generate into packages/portal/dist (not in git)
pnpm portal:serve    # serve it; the owner's answers are appended to plan/answers.jsonl
pnpm portal:serve --live # read-only live landing/evidence preview; no manual rebuilds or answer writes
pnpm portal:check    # the pages are complete and every link resolves
pnpm blueprint:slices [--journey thin_line] [--json]
```

- `src/main.ts`: the entry (`generate`, `check`, `serve`). `src/load.ts` reads the blueprint, immutable run receipts and status, and the plan for Questions and occupied concept lanes.
- `src/modules/site`: the pages as data; `render`: data to HTML; `check`: the portal's own checks;
  `answers`: the owner's answers; `twins`: the same site as plain text for agents and scripts (`llms.txt`).
- `content/`, `assets/`: fixed text, CSS and the one script.
- The Blueprint page is `docs/blueprint-guide.md` as written; each `<!-- generated: <name> -->` line in it becomes a table made
  from the blueprint (`site/internal/guide.ts`, `guideTables.ts`). `pnpm portal:check` fails on a marker no table answers.

## History

The History page is read from git when the site is generated (`src/load.ts` `historyOf`, `site/internal/history.ts`):
who worked on each concept, a timeline by day with the verdicts recorded, and the latest commits.

## Waves, slices and live landings

`/board/`, its per-slice pages and `blueprint:slices` share the engine's deterministic manifest. Wave zero reserves the
unproved foundation; later journeys own new records grouped by source concept. Events and screens follow the same
reach rules as operations. Completed slices stay visible; only fresh, merged Postgres/Ponder proof reduces remaining
work. Repeated concept owners queue, and wave one has at most thirteen concept owners plus one shared lane.

Completion reads `status/runs/<id>/receipt.json` and its sibling immutable `status.json`, not a union of scoreboard
passes. All required claims must pass together on `postgres-ponder-erpnext-v4`, with successful scripts and existing
run-relative source-equality screen captures. Interrupted, stale, JSON-only and receipt-less historical runs cannot
complete a slice. A tested commit must be an ancestor of `origin/integration/wave-0` to display **Landed · proved**.
`sliceZeroRequired(blueprint)` in engine `slices.ts` is the full computed acceptance gate: every claim on slice zero's
records at every level, the invariants over them (or over no record), their concepts' `sys:imports`, `sys:generated` and
the devnet and worlds boot and smoke claims (`portal.slice-zero-measured-gate`). `SLICE_ZERO_REQUIRED` is only
its thirteen explicit screen/alert additions; absent declarations stay missing. Runtime callers use the function or
the CLI's `slice-0.required` array, never only the additions and never a copied ID list.

`--live` checks local blueprint/plan/run inputs every five seconds and fetches `integration/wave-0` every minute. It
renders a newer remote commit in an isolated `var/portal-live` snapshot with that landing's engine and renderer, overlaying newly
started local runs without replacing published runs. It never checks out, merges, dispatches or writes verdicts.
Pages swap only after generation succeeds; an open page polls `/live.json` and reloads itself. Failed refreshes keep
the last good generation and display the error and update time. The initial generation needs no preceding `pnpm portal`.
Start the existing supervised book service with `pnpm portal:serve --live --port "$PORT"`; its owner maintains the
service declaration and allowed portal host. Live mode refuses Questions writes; use the coordinator's answer portal.

## What it does not show

The plan is not a portal page (decision `portal.product-only`); generated product coverage is the narrow exception in
`portal.product-slices`. The plan is `pnpm plan show`. The loop and its `/runs/`
pass-through are gone (decision `build.amp`).

Nothing here is a source of truth: change the blueprint and generate again. Its design is
`docs/design/portal.md` and the records in `blueprint/shared/portal.ts`.
