# Repository map

What every entry is, what uses it, and why it is where it is. First written 10 November 2026 for the tidy-up (plan
task `m1-tidy`); the rule behind it is decision `system.repository-layout`. "Uses" were found by searching the tracked
files for each path, not assumed.

**Words.** "The blueprint" is the typed design, in `blueprint/`. Until 10 November 2026 it was called "the design
book" or "the book" and lived in `books/`; older documents and records still say so (ruling `aaron.blueprint`).

**The rules.**

- The top level is closed: `pnpm layout` fails on an entry that `packages/layout/src/main.ts` does not allow.
- A script lives in the package it serves. There is no `tools/` directory.
- Dead material is in `archive/` at its old path: what was `tools/workflows` is `archive/tools/workflows`. An older
  document that names a path which no longer exists means that path under `archive/`.
- Working data (loop runs) is under `var/`, which git ignores.
- A thing the blueprint, a package, a check, the plan or the portal cites moves only together with every citation.

## The top level

| Entry | What it is | What uses it |
|---|---|---|
| `README.md` | The front door: what this is and where things are | people |
| `AGENTS.md` | The rules every agent follows here, the roles (coordinator and workers) and the checks | every agent session |
| `CLAUDE.md` | A link to `AGENTS.md` | Claude sessions |
| `START-HERE.md` | The owner's direction of 9 November, kept as a record | the blueprint cites it as evidence |
| `GROUNDING.md` | The four fixed points of the product, in Aaron's words | the blueprint and the plan cite it |
| `blueprint/` | The design, as typed records: one folder per concept and `shared/`; `baseline/` is the old system's behaviour, never edited | `packages/blueprint-engine` builds it; every check reads it |
| `packages/` | The code, one package per component (below) | pnpm workspace |
| `plan/` | The coordinator's plan: `plan.json`, the log, the owner's answers, one file per task | `pnpm plan`, the portal's Plan page, the loop |
| `evals/` | `bindings/`: which check proves which eval of the blueprint | `pnpm evals` |
| `status/` | The scoreboard: `status.json` and the evidence of each run | written only by `pnpm evals`; read by the portal and the plan |
| `loops/` | The scripts the loop runs (`pair.ts`, `research.ts`) | `pnpm loop run <task id> --script <name>` |
| `spikes/` | `skeleton/`: proven throwaway code (real Frappe v16 on the real v4 contracts; its Frappe app has moved to `packages/frappe-app`) | the loop's sandbox, the evals bindings; deleted when plan task `m2-graduate-spike` is done |
| `docs/` | Written designs, evidence and generated reports (below) | the blueprint cites most of it |
| `archive/` | Dead material at its old path; `archive/README.md` lists each thing | nothing live |
| `var/` | Loop run folders, on the machine that ran them; not in git | `pnpm loop` |
| `.claude/` | `agents/`: the role prompts the loop gives its agents; `skills/`: the coordinator's skills (coordinate, plan-tasks, dispatch, ask-aaron, portal-ops); `launch.json` | `packages/loop` reads `agents/<role>.md` |
| `.github/` | The pull request template and twelve issue forms written for the swarmD ledger | `docs/design/swarm*.md`, three blueprint files |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitignore` | The workspace | pnpm, git |

| | Directories | Documents |
|---|---|---|
| 10 November, before | `books demo docs evals kit loops packages plan runs spikes status tools` | `CLAUDE.md GROUNDING.md HANDOFF.md README.md START-HERE.md` |
| Now | `archive blueprint docs evals loops packages plan spikes status` (+ `var/`, ignored) | `AGENTS.md CLAUDE.md GROUNDING.md README.md START-HERE.md` |

## `packages/`

| Package | What it is | Scripts that live here |
|---|---|---|
| `blueprint` | The blueprint's engine: record types, the builder, its checks | `scripts/`: `check-frozen.ts` (`pnpm frozen`), `report-cut.ts`, `report-surface.ts`, `report-judgments.ts` (`pnpm judgments`), `impact.ts`, `target.ts` (loads the blueprint for the others) |
| `portal` | Generates and serves the portal from the blueprint, the plan and the scoreboard | |
| `plan` | The plan CLI, the plan's checks and the task tree | `src/main.ts` (`pnpm plan`), `src/tasks.ts` (`pnpm tasks`) |
| `evals` | Runs the checks bound to evals; the only writer of `status/` | `src/record-status.ts` |
| `loop` | The agent runner on pi-durable; this is where pi-durable is used | |
| `contracts` | The product's contracts (Foundry) | `abi-check/`: `main.ts` (`pnpm contracts:check-blueprint`), `export-abi.ts` (`pnpm contracts:export-abi`) |
| `sdk` | The product SDK | |
| `devnet` | The local chain and worlds | `cloud/` (the product stack in a Claude cloud container), `src/modules/company/` (a company's life on the real v4 contracts) |
| `frappe-app` | The Capxul app on every hosted Frappe site (moved from the spike) | `capxul/hooks.py`, `capxul/setup.py` |
| `layout` | The layout check | `src/main.ts` (`pnpm layout`), `oversize.json` |

## Where `tools/` went

| Was | Is now |
|---|---|
| `tools/plan.ts`, `tools/plan/`, `tools/plan-files.ts`, `tools/plan-tasks.ts` | `packages/plan/src/main.ts`, `src/modules/plan/`, `src/files.ts`, `src/tasks.ts` |
| `tools/check-frozen.ts`, `report-cut.ts`, `report-surface.ts`, `report-judgments.ts`, `impact.ts` | `packages/blueprint-engine/scripts/` (same names) |
| `tools/book-target.ts` | `packages/blueprint-engine/scripts/target.ts` |
| `tools/record-status.ts` | `packages/evals/src/record-status.ts` |
| `tools/check-contracts.ts`, `tools/check-contracts/`, `tools/export-contract-abi.ts` | `packages/contracts/abi-check/main.ts`, `abi-check/`, `abi-check/export-abi.ts` |
| `tools/check-layout.ts`, `tools/check-layout/` | `packages/layout/src/main.ts`, `src/modules/layout/` |
| `tools/workflows/`, `tools/explorer/`, `tools/export-explorer.ts`, `tools/portal-prototype.ts`, `tools/freeze-flags.ts`, `tools/freeze-operations.py` | `archive/tools/` (dead) |

Every `pnpm` script name is unchanged.

## `docs/`

| Entry | What it is | What uses it |
|---|---|---|
| `philosophy.md` | How every person and agent works here: climb, behave, survive, stay small | `AGENTS.md`, the coordinator's skills |
| `blueprint.md` | How the blueprint works, end to end | `AGENTS.md`, the blueprint, three packages |
| `repository-map.md` | This page | `README.md` |
| `as-is/archive/` | The old system written as records (133 files) | 99 blueprint files, `docs/cut-archive` |
| `as-is/lane-reports/` | Reviews of the old system by lane (46 files) | 4 blueprint files |
| `as-is/payments.md` | The reviewed payments lane, K1 to K18 | 14 blueprint files, `.claude/agents` |
| `cut-archive/` | Every record the cut removed from the blueprint, with its index (142 files) | `packages/blueprint-engine/scripts/report-cut.ts` checks it |
| `decisions/` | The first decisions, of 7 November, and the policy pack | 4 to 13 blueprint files each |
| `design/` | The written designs behind the blueprint's records | 1 to 18 blueprint files each; the portal reads `worlds-platform.md` |
| `design/command-surface.md` | The command tree of 9 November | 4 blueprint files. **Overtaken by the cut**: see its banner |
| `design/swarm.md`, `swarm-templates.md` | The design of the agent team | `.claude/agents`, `.github`, `packages/loop` |
| `mission/tasks.json` | The task tree, generated by `pnpm tasks` | `pnpm tasks:check`, the loop |
| `mission/` (the rest) | Current findings and designs for worlds and hosting; `findings.md` (the old system measured); `progress.md` | 1 to 11 blueprint files each, the plan |
| `spec/` | The six specification pages the blueprint was built from | 9 blueprint files, the portal |
| `vision/erp.md` | The ERP vision and its checks C1 to C27 | 6 blueprint files |

## What is known to be out of date

- `blueprint/shared/surface.ts` (`SURFACE`) and `docs/design/command-surface.md` list the 394 operations of
  9 November; the cut left 169. `packages/blueprint-engine/scripts/report-surface.ts` reports 281 differences. Redoing the tree is
  design work under plan task `m1-old-decisions`.
- `.github/ISSUE_TEMPLATE/` holds issue forms for the swarmD ledger, which is not used. Three blueprint files cite
  them, so they stay until `m1-old-decisions` settles those records.
- `docs/mission/progress.md` is no longer written: the plan's log does that job.

## Counts

| | Files |
|---|---|
| Archived, stage one (the mock-up, the kit, the hand-over of 9 November, original notes, screenshots, an old work list) | 186 |
| Archived, stage two (old workflow scripts, generators of the baseline, the prototype and explorer, `HANDOFF.md`, the goal prompt, three stale reports) | 44 |
| Folded into packages | 33 |
| Deleted | 1 (`tools/README.md`, which described a directory that no longer exists) |
