# @capxul/portal

Generates the portal, a static site, from the blueprint, the plan and the scoreboard, and serves it with the form the
owner answers questions through.

```bash
pnpm portal          # generate into packages/portal/dist (not in git)
pnpm portal:serve    # serve it; the owner's answers are appended to plan/answers.jsonl
pnpm portal:check    # the pages are complete and every link resolves
```

- `src/main.ts`: the entry (`generate`, `check`, `serve`). `src/load.ts` reads the blueprint, plan and status.
- `src/modules/site`: the pages as data; `render`: data to HTML; `check`: the portal's own checks;
  `answers`: the owner's answers; `twins`: the same site as plain text for agents and scripts (`llms.txt`).
- `content/`, `assets/`: fixed text, CSS and the one script.
- The Blueprint page is `docs/blueprint-guide.md` as written; each `<!-- generated: <name> -->` line in it becomes a table made
  from the blueprint (`site/internal/guide.ts`, `guideTables.ts`). `pnpm portal:check` fails on a marker no table answers.

## Board verification

`pnpm --filter @capxul/portal test` covers the Overview board's path, blockers,
Questions inbox, UTC-day completion evidence and merge commits, plus live host
refresh and clearing stale work when the host fails. `pnpm portal:check` checks
that the generated pages and links agree with their source data.

Round 3 rechecked the reported pending-promise cancellations in `main.test.ts`
and `render-status.test.ts`: the required `pnpm exec tsc -p packages/blueprint-engine && pnpm test`
exited 0, and a separate portal test run reported 102 pass, 0 fail, 0 cancelled.
The cancellation was not reproduced; no test or runtime behavior was changed to
mask it.

Nothing here is a source of truth: change the blueprint or the plan and generate again. Its design is
`docs/design/portal.md` and the records in `blueprint/shared/portal.ts`.
