# AGENTS.md

`CLAUDE.md` is a link to this file. Every agent (Amp, Claude, Codex) reads the same rules.

## This branch is `master`: the rebuild line (read this first)

`master` is a separate line of work from `main` and `integration/build`. It was cut from `main` at `f12a831` on
13 November 2026, at Aaron's request, to rethink the blueprint and the build pipeline without
disturbing the product work in flight on those two branches.

- Rebuild work goes by pull request into `master`. Where the rules below say `integration/build`, read `master`.
- Never merge `master` into `main` or `integration/build`, and never open a pull request from this line into them,
  unless Aaron asks for it in writing.
- Work that belongs to the in-flight product line stays on `main` and `integration/build`. Do not base it on `master`.
- `main` is merged into `master` only on purpose, by whoever leads this line, never as a routine catch-up.

If your task was written for `main` or `integration/build` and you are on this branch, stop and switch branches.

This repository holds the Capxul rebuild: a typed **blueprint** (`blueprint/`, built by `packages/blueprint-engine`) and
the product code it describes. Capxul is hosted, re-skinned Frappe with Capxul Core's on-chain authority, budgets,
payments and banking built in ([GROUNDING.md](GROUNDING.md)).

**Picking the work up cold? Read [docs/handoff-amp.md](docs/handoff-amp.md).** It says where the product stands, how to
bring the stack up in an orb, what is waiting on Aaron and what to do next. Then [docs/philosophy.md](docs/philosophy.md)
(how we work) and [README.md](README.md) (the map).

## Roles

- **The coordinator** is one Amp thread at a time (the lead). It hill-climbs the plan with the `coordinate` skill:
  keeps the critical path true, starts one orb thread per ready task (`dispatch`), merges green pull requests, and
  batches what only Aaron can answer (`ask-aaron`). Skills are in `.agents/skills/` (`.claude/skills` links there).
- **A worker** is an Amp orb thread (or a Claude cloud thread) on one task. It never merges, never marks its own task
  done and never writes the path.

## How work flows

- **One task, one Amp thread, one branch, one pull request** into `integration/build`. Branch from the latest
  `integration/build`. Never push to `main` and never force-push anywhere.
- **Do not use Amp's default "Ship"**: it pushes to the base branch. Use "Push to Branch" and open a pull request
  (`gh pr create --base integration/build`).
- **CI decides merge-readiness** (`.github/workflows/blueprint.yml` runs the checks below on every pull request). The
  coordinator or Aaron merges; a worker never merges its own pull request and never says its own task is done.
- **Done means evals pass in a run** (below), not an agent's claim.
- `main` moves only by a pull request from `integration/build` that Aaron approves.

## Rules for every change

- **The blueprint changes first.** When code needs to differ from the blueprint: change the record and add a decision
  record; rebuild to zero problems; then change the code. Read `docs/blueprint.md` before you add or change a record.
  Never edit `blueprint/baseline/` or any file under a `src/generated/` folder. For the contracts in
  `packages/contracts`, the code is the truth for what exists: change a contract's source, run
  `pnpm contracts:export-abi`, and reconcile the contract records until `pnpm contracts:check-blueprint` passes.
- **What is fixed is behaviour, not spelling** (`system.frozen-behaviour`). Each of the 215 old operations is either
  booked in the blueprint or classified by the cut (`blueprint/shared/cut.ts`), never both and never neither. A booked
  operation's acceptance claims are the evals. Commands, flags, `--json` shapes, refusal codes and wording are the
  blueprint's to design; a change to them goes into the blueprint first, with a decision.
- **Every change passes these checks before it merges** (CI runs them too):

  ```bash
  pnpm exec tsc -p packages/blueprint-engine && pnpm test
  pnpm exec tsc -p blueprint
  pnpm blueprint                  # 0 problems
  pnpm frozen                     # 0 breaches
  pnpm contracts:check-blueprint  # 0 undeclared differences
  pnpm frappe:check-blueprint     # the Frappe app agrees with the blueprint
  pnpm portal:check
  pnpm layout                     # the top level, file sizes and package READMEs
  ```

- **Done means evals pass in a run.** `pnpm evals -- <ids | all | --journey id | --milestone id>` is the only thing that
  writes `status/status.json`. Never edit that file or a verdict by hand. A claim with no check is `not_run`.
- **Where things go.** The top level is closed (`packages/layout/src/main.ts` lists what may be there, each with a
  reason). Dead material is deleted; git history keeps it. Working data goes under the git-ignored `var/`. A new
  script belongs in the package it serves. Code layout follows decision `system.layout`: one package per component;
  `src/<concept>/` mirrors `blueprint/<concept>/`; another concept's code is imported only through its `door.ts`.
- **The plan.** `pnpm plan show` gives the goal, the milestones, the critical path and each task. `plan/plan.json`
  changes only through `pnpm plan …`, never by hand, and every change is logged in `plan/log.jsonl`. Only the
  coordinator writes the goal, milestones, path and notes, adds or drops tasks, and applies Aaron's answers
  (`plan/answers.jsonl`, from the book's Questions page). A worker reports with `pnpm plan task start|block`.
- **Decisions.** Every judgment is a decision record. Bring Aaron only what is truly his: product or architecture
  choices, money, credentials and accounts, irreversible steps, and accepting a milestone. Ask as one decision with two
  to four options and a recommendation, in plain words. Never hand him a terminal command to run.
- **Old system.** `Xelmar-tech/infrastructure` is a reference for behaviour only: read its code for edge cases (contract
  reverts, money paths, permissions), never port it, and never run the evals against it. Its Linear workflow,
  `docs/rules` and skills do not apply here.
- **Never** touch production, deploy anything, or create cloud credentials without Aaron's explicit go-ahead in writing.
