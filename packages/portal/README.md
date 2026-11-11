# @capxul/portal

Generates the portal, a static site, from the blueprint and the scoreboard, and serves it with the form the
owner answers questions through.

```bash
pnpm portal          # generate into packages/portal/dist (not in git)
pnpm portal:serve    # serve it; the owner's answers are appended to plan/answers.jsonl
pnpm portal:check    # the pages are complete and every link resolves
```

- `src/main.ts`: the entry (`generate`, `check`, `serve`). `src/load.ts` reads the blueprint and status, and the plan only for its tasks blocked on a need of the owner (they join Questions).
- `src/modules/site`: the pages as data; `render`: data to HTML; `check`: the portal's own checks;
  `answers`: the owner's answers; `twins`: the same site as plain text for agents and scripts (`llms.txt`).
- `content/`, `assets/`: fixed text, CSS and the one script.
- The Blueprint page is `docs/blueprint-guide.md` as written; each `<!-- generated: <name> -->` line in it becomes a table made
  from the blueprint (`site/internal/guide.ts`, `guideTables.ts`). `pnpm portal:check` fails on a marker no table answers.

## History

The History page is read from git when the site is generated (`src/load.ts` `historyOf`, `site/internal/history.ts`):
who worked on each concept, a timeline by day with the verdicts recorded, and the latest commits.

## What it does not show

The plan is not a portal page (decision `portal.product-only`); the plan is `pnpm plan show`. The loop and its `/runs/`
pass-through are gone (decision `build.amp`).

Nothing here is a source of truth: change the blueprint and generate again. Its design is
`docs/design/portal.md` and the records in `blueprint/shared/portal.ts`.
