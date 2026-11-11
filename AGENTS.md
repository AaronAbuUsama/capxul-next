# AGENTS.md

`CLAUDE.md` is a link to this file. Every agent (Claude, Codex, a loop builder or checker) reads the same rules.

1. Read **[docs/philosophy.md](docs/philosophy.md)** first: how we climb, how agents behave, how work survives.
2. **The map of this repository is [README.md](README.md).** What is current is the plan (`pnpm plan show`) and the rulings in the blueprint. [START-HERE.md](START-HERE.md) is the one-page entry: the goal, the milestone and the portal. The owner's direction of 9 November 2026 is kept whole in [archive/START-HERE.md](archive/START-HERE.md). Where an older document disagrees with the plan or a ruling, the plan and the ruling win.

This repository holds the Capxul rebuild: a typed blueprint (`blueprint/`, built by `packages/blueprint-engine`) and the product code it describes.

## Roles

- **The coordinator** is one session at a time. It owns the plan's goal, milestones, path and notes, and the merges. It runs the `coordinate` skill. The section "The coordinator" below is its contract.
- **A worker** is a loop run (builder, checker or researcher), a cloud thread, or a Remote Control session. It works one task and reports through `pnpm plan task start|block --by <name>`. It never marks its own task done, never merges and never writes the path.

## Rules for every change

- **Start here.** Run `pnpm plan show`. It gives the goal, the critical path and the task you are on. Read `docs/blueprint.md` before you add or change a record.
- **The blueprint changes first.** When code needs to differ from the blueprint: change the record and add a decision record; rebuild to zero problems; then change the code. Never edit `blueprint/baseline/` or any file under a `src/generated/` folder. For the contracts in `packages/contracts`, the code is the truth for what exists: change a contract's source, run `pnpm contracts:export-abi`, and reconcile the contract records until `pnpm contracts:check-blueprint` passes.
- **What is fixed is behaviour, not spelling** (`system.frozen-behaviour`). Each of the 215 old operations is either booked in the blueprint or classified by the cut (`blueprint/shared/cut.ts`), never both and never neither. A booked operation's acceptance claims are the evals. Commands, flags, `--json` shapes, refusal codes and wording are the blueprint's to design, and a change to them goes into the blueprint first, with a decision.
- **Every change passes these checks before it merges:**

  ```bash
  pnpm exec tsc -p packages/blueprint-engine && pnpm test
  pnpm exec tsc -p blueprint
  pnpm blueprint                  # 0 problems
  pnpm frozen                     # 0 breaches
  pnpm contracts:check-blueprint  # 0 undeclared differences
  pnpm layout                     # the top level, file sizes and package READMEs
  ```

- **Where things go.** The top level is closed (`packages/layout/src/main.ts` lists what may be there, each with a reason). Dead material moves to `archive/` at its old path. Working data goes under the git-ignored `var/`. A new script belongs in the package it serves. `docs/repository-map.md` says what every entry is. Code layout follows decision `system.layout`: one package per component; `src/<concept>/` mirrors `blueprint/<concept>/`; another concept's code is imported only through its `door.ts`; lanes `lane/<name>` merge into `integration/build`.
- **The plan.** `plan/plan.json` changes only through `pnpm plan …`, never by hand, and every change is logged in `plan/log.jsonl`. A task has `plan/tasks/<id>.md` (What, Why, Done when). The owner's answers arrive in `plan/answers.jsonl` through the portal. `pnpm test` runs `plan check`.
- **Done means evals pass in a run.** `pnpm evals -- <ids | all | --journey id | --milestone id>` is the only thing that writes `status/status.json`. Never edit that file or a verdict by hand. A claim with no check is `not_run`.
- **Decisions.** Every judgment is a decision record. Bring Aaron only what is truly his, as a question on the portal (the `ask-aaron` skill).
- **Old system.** `Xelmar-tech/infrastructure` is a reference for behaviour only: read its code for edge cases, never port it, and never run the evals against it. Its Linear workflow, `docs/rules` and skills do not apply here.

## The coordinator

**The job: hill-climb the current goal.** Agree the goal and the milestones with Aaron. Then break each milestone into tasks, keep the critical path true at every moment, keep as much work running in parallel as the rate limits allow, get around every blocker, and batch what only Aaron can unblock in the shape that is fastest for him to answer.

**Only the coordinator writes** the goal, milestones, exit lines, path (`pnpm plan path set`) and notes. It also adds and drops tasks, merges into `integration/build` (`pnpm loop merge <run>`), and applies Aaron's answers (`pnpm plan answers apply`).

**Where it runs.** In the checkout on Aaron's Mac, `~/projects/capxul-next`. The plan, the portal, the loop host and the model proxy stay there. No cloud clone writes `plan/`. One coordinator at a time: a new one starts only after the last one leaves a handoff note and stops.

**The sweep** (the `coordinate` skill). Run it at session start, after every run ends, after every answer, and at least every 30 minutes while work is open. Each sweep reads the facts again, then: closes what finished, triages every blocked task, applies answers, recomputes the path, fills every free slot, and leaves a note.

**Survive a restart.** Write a plan note before a merge or a batch of starts. When a session starts, read the last notes and `git log` before repeating any merge, push or start.

**Where work runs** (the `dispatch` skill): loop runs on the Mac for plan tasks; cloud threads for research and long design work that needs no Mac; Remote Control for work that needs the Mac's tools.

**Keep the portal up** (the `portal-ops` skill). It is how Aaron sees the climb. If it is down, fix that first.
