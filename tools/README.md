# tools

Checks and scripts that are not yet part of a package. This directory is being emptied: each live script moves into
the package it serves and the dead ones move to `archive/` (`docs/repository-map.md`, section `tools/`). **Do not add
a script here**; put it in the package it serves.

| Script | Run as | What it does |
|---|---|---|
| `plan.ts`, `plan/`, `plan-files.ts` | `pnpm plan` | the plan CLI and its module |
| `plan-tasks.ts` | `pnpm tasks` | derives the task tree `docs/mission/tasks.json` |
| `check-frozen.ts` | `pnpm frozen` | every old behaviour is kept or classified |
| `check-layout.ts`, `check-layout/` | `pnpm layout` | the top level, file sizes, package READMEs |
| `check-contracts.ts`, `check-contracts/`, `export-contract-abi.ts` | `pnpm contracts:check-book`, `contracts:export-abi` | the contract records match the code |
| `report-cut.ts` | by path | generates and checks `docs/cut-archive/INDEX.md` |
| `impact.ts`, `book-target.ts`, `record-status.ts` | by the portal and `pnpm evals` | what a change touches; loading the book; writing the scoreboard |
| `report-judgments.ts`, `report-surface.ts` | `pnpm judgments`, by path | reports generated from the book |

Dead, waiting for stage two because the book cites their paths: `workflows/`, `explorer/`, `export-explorer.ts`,
`portal-prototype.ts`, `freeze-flags.ts`, `freeze-operations.py`.
