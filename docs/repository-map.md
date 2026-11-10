# Repository map

What every entry is, what live thing uses it, and whether it stays. Written 10 November 2026 for the tidy-up
(plan task `m1-tidy`). "Uses" were found by searching the tracked files for each path, not assumed.

**How the verdicts were reached.** A thing is *live* when the book (`books/`), a package, a check, the plan, the
portal or the loop reads it or cites it. Live things stay where they are, or move only together with every
reference to them. The tidy-up runs in two stages because another lane is working in `books/`, `spikes/`, `evals/`
and `packages/` right now:

- **stays**: live, in the right place.
- **archive (done)**: dead, nothing live refers to it; moved to `archive/` at the same path (`demo/` is now
  `archive/demo/`). Nothing is lost.
- **archive, stage two**: dead, but a record in the book cites its path, so it moves in the same change that fixes
  the citation, once `books/` is free to edit.
- **stage two**: live, in the wrong place; it is folded into the package it serves.
- **stale**: generated output that no longer matches its source; named here, fixed in stage two.

Nothing is deleted in stage one: there was no pure duplicate and no generated output that nothing cites.

## The top level

| Entry | What it is | What uses it | Verdict |
|---|---|---|---|
| `README.md` | The front door: this map in short | people | stays (rewritten) |
| `CLAUDE.md` | The rules an agent follows here, and the checks | every agent session | stays (corrected) |
| `START-HERE.md` | The owner's 9 November direction | 6 book files cite it as evidence; 4 plan files | stays, with a banner: a historical record |
| `GROUNDING.md` | The four fixed points of the product, in Aaron's words | 3 book files, 4 plan files | stays |
| `HANDOFF.md` | The hand-over into the build session of 8 November; superseded by the plan | `books/target/shared/swarm.ts` cites it 4 times | archive, stage two |
| `books/` | The design: `target/` (what is being built) and `frozen/` (the old system's behaviour, never edited) | `packages/book` builds it; every check reads it | stays (see "Why `books/` is not a package") |
| `packages/` | The code, one package per component (see below) | pnpm workspace | stays |
| `plan/` | The coordinator's plan: `plan.json`, the log, the owner's answers, one file per task | `pnpm plan`, the portal's Plan page, the loop | stays |
| `evals/` | `bindings/`: which check proves which eval of the book | `pnpm evals` | stays |
| `status/` | The scoreboard: `status.json` and the evidence of each run | written only by `pnpm evals`; read by the portal and the plan | stays |
| `loops/` | The scripts the loop runs (`pair.ts`, `research.ts`) | `pnpm loop start --script <name>` | stays; stage two decides whether they live inside `packages/loop` |
| `spikes/` | `skeleton/`: proven throwaway code (real Frappe v16, a stand-in chain) | the loop's sandbox, the evals bindings, plan task `m2-graduate-spike` | stays until graduated, then deleted |
| `docs/` | Written design, evidence and generated reports (see below) | the book cites most of it | stays |
| `tools/` | Twenty loose scripts and thirty-one old workflow scripts (see below) | `package.json`, packages, the book | stage two: emptied into packages and the archive |
| `runs/` | Loop run folders (not tracked; on the machine that ran them) | `pnpm loop` | moved to `var/runs/` (git-ignored) |
| `demo/` | A clickable mock-up of Capxul on Frappe and its research, 9 November (34 files, 11 MB) | nothing live; one design page cited its research | archive (done) |
| `kit/` | Two git bundles: the starter kit and the abandoned swarmD rebuild (4 MB) | nothing live | archive (done) |
| `.claude/` | `agents/`: the role prompts the loop gives its agents; `launch.json` | `packages/loop` reads `agents/<role>.md` | stays |
| `.github/` | Pull request template and twelve issue forms written for the swarmD ledger | `docs/design/swarm*.md`, 3 book files | stays; the issue forms are stage two (swarmD is not used) |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.gitignore` | The workspace | pnpm, git | stays |

### Proposed top level

| Today | After stage one | After stage two |
|---|---|---|
| `.claude .github books demo docs evals kit loops packages plan runs spikes status tools` | `.claude .github archive books docs evals loops packages plan spikes status tools` (+ `var/`, ignored) | `.claude .github archive books docs evals packages plan spikes status` (+ `var/`); `spikes/` goes when `m2-graduate-spike` is done |
| `CLAUDE.md GROUNDING.md HANDOFF.md README.md START-HERE.md` | the same | `CLAUDE.md GROUNDING.md README.md START-HERE.md` |

### Why `books/` is not a package

`packages/book` is the engine: record types, the builder, the checks. `books/` is the content the engine reads, like
a site's pages next to its generator. It has no `package.json`, exports nothing, and is never imported by product
code. 99 files in it cite repository paths as evidence and the frozen half may never be edited, so moving it changes
every script, both `tsconfig` files, the portal's loader and the frozen check for no gain in clarity. A README in
`books/` now says this. If it is to move anyway, stage two lists every line that changes first.

## `packages/`

| Package | What it is | Verdict |
|---|---|---|
| `book` | The design book's engine: records, build, checks | stays |
| `portal` | Generates and serves the portal from the book, the plan and the scoreboard | stays (README added) |
| `evals` | Runs the checks bound to evals; the only writer of `status/` | stays |
| `loop` | The agent runner on pi-durable; this is where pi-durable is used | stays; stage two makes it readable |
| `contracts` | The product's contracts (Foundry) | stays |
| `sdk` | The product SDK | stays |
| `devnet` | The local chain and worlds | stays |

## `tools/`

| Entry | What it is | What uses it | Verdict |
|---|---|---|---|
| `plan.ts`, `plan/`, `plan-files.ts` | The plan CLI, its module and its file reader | `pnpm plan`, the portal (9 files), the loop | stage two: one package |
| `plan-tasks.ts` | Derives the task tree `docs/mission/tasks.json` from the book and the plan (569 lines) | `pnpm tasks`, `pnpm test`, the loop | stage two |
| `check-frozen.ts` | Proves every one of the 215 old behaviours is kept or classified | the checks in `CLAUDE.md`, the loop's gates | stage two: into `packages/book` |
| `report-cut.ts` | Generates and checks `docs/cut-archive/INDEX.md` | the checks | stage two: into `packages/book` |
| `impact.ts` | What a change to a record touches | the portal (4 files), `docs/design-book.md` | stage two |
| `book-target.ts` | Loads the target book for other tools | `impact.ts`, `record-status.ts`, `packages/evals` | stage two: into `packages/book` |
| `record-status.ts` | The only writer of `status/status.json` | `packages/evals` spawns it | stage two: into `packages/evals` |
| `check-contracts.ts`, `check-contracts/` | Proves the contract records match the contract code | `pnpm contracts:check-book` and its test | stage two: into `packages/contracts` |
| `export-contract-abi.ts` | Exports the ABI the check reads | `pnpm contracts:export-abi` | stage two: into `packages/contracts` |
| `report-judgments.ts` | Generates `docs/decisions/judgments.md` | `pnpm judgments`; the portal now shows the same list | stage two: keep or retire with its page |
| `report-surface.ts` | Checks the command tree against the book and `docs/design/command-surface.md` | run by hand; in no check | stage two: into `packages/book`, or retire with its page |
| `freeze-flags.ts`, `freeze-operations.py` | Generated `books/frozen/` from the old repository; cannot run without it (1,056 lines) | the header of `books/frozen/flags.ts` names it, and frozen files are never edited | archive, stage two (kept as provenance) |
| `portal-prototype.ts` | The first portal generator, replaced by `packages/portal` (763 lines) | `books/target/shared/portal.ts` cites it | archive, stage two |
| `export-explorer.ts`, `explorer/` | A read-only explorer page over the book, replaced by the portal | a comment in `books/target/shared/waiting.ts` | archive, stage two |
| `workflows/` | Thirty-one scripts that drove the agent workflows of 6 to 9 November; none can run here | `books/target/shared/swarm.ts` and `tooling.ts` cite the folder | archive, stage two |

No `package.json` script served only an archived tool, so none was removed in stage one.

## `docs/`

| Entry | What it is | What uses it | Verdict |
|---|---|---|---|
| `design-book.md` | How the design book works, end to end | `CLAUDE.md`, the book, three packages | stays |
| `repository-map.md` | This page | `README.md` | stays |
| `as-is/archive/` | The old system written as records (133 files) | 99 book files, `docs/cut-archive` | stays |
| `as-is/lane-reports/` | Reviews of the old system by lane (46 files) | 4 book files | stays |
| `as-is/payments.md` | The reviewed payments lane, K1 to K18 | 14 book files, `.claude/agents` | stays |
| `cut-archive/` | Every record the cut removed from the book, with its index (142 files) | `tools/report-cut.ts` checks it; the book and the plan cite it | stays |
| `decisions/README.md`, `policy-pack.md`, `open-for-aaron.md`, `assembly-items.md`, `target-architecture.md` | The first decisions, of 7 November | 4 to 13 book files each | stays |
| `decisions/judgments.md` | Generated list of decisions waiting for review | 1 book file | **stale**: differs from its generator's output today; regenerate or retire in stage two |
| `decisions/concept-reports.json`, `target-architecture-review.json` | Reports from the workflow that designed the target | only `tools/workflows` | archive, stage two (with `tools/workflows/`) |
| `design/authority.md`, `escrow.md`, `new-commands.md`, `time.md`, `time-deep-dive.md`, `tooling.md`, `portal.md`, `payroll-jurisdiction.md`, `worlds-platform.md`, `cut-proposal.*`, `frappe/` | The written designs behind the book's records | 1 to 18 book files each; the portal reads `worlds-platform.md` | stays |
| `design/command-surface.md` | The command tree, with tables generated from the book | 4 book files | stays; **stale**: `report-surface.ts --check-md` reports differences |
| `design/swarm.md`, `swarm-templates.md` | The design of the agent team | `.claude/agents`, `.github`, `packages/loop` (5 files) | stays |
| `design/portal-prototype.html` | Output of `tools/portal-prototype.ts` | `books/target/shared/portal.ts` cites it | archive, stage two |
| `design/screens/` | Six screenshots of the portal prototype (2.6 MB) | nothing | archive (done) |
| `mission/tasks.json` | The task tree, generated by `tools/plan-tasks.ts` | `pnpm tasks:check`, the loop, `.github` | stays |
| `mission/critical-path.md`, `cloud.md`, `worlds.md`, `world-cost.md`, `sites-host/` | Current findings and designs for worlds and hosting | 2 to 11 book files each, the plan | stays |
| `mission/findings.md` | Measurements of the old system | `books/target/CONVENTIONS.md` and 8 decisions | stays |
| `mission/progress.md` | One line per finished lane | 1 book file | stays; the plan's log now does this job, so stage two decides |
| `mission/initializer.md` | The goal prompt of the build session of 8 November; superseded by the plan | 4 book files, `.claude/agents/master.md` | archive, stage two |
| `mission/remaining-work.md` | A work list of 8 November, long overtaken | nothing live | archive (done) |
| `spec/` | The six specification pages the book was built from | 9 book files, the portal, `packages/book` | stays |
| `vision/erp.md` | The ERP vision and its checks C1 to C27 | 6 book files | stays |
| `original/` | Three source notes from before the book | only `tools/workflows` | archive (done) |
| `handoff/2026-11-09/` | The 9 November sitrep, 96 screenshots, 39 workflow scripts (139 files, 42 MB) | only `START-HERE.md` | archive (done) |

## Counts

| | Files | Size |
|---|---|---|
| Archived in stage one | 186 | 60 MB |
| Deleted | 0 | |
| Waiting for stage two: to archive | about 45 | |
| Waiting for stage two: to fold into packages | 22 | |
