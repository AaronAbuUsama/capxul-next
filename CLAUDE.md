# CLAUDE.md

> **The map of this repository is [README.md](README.md).** What is current is the plan (`pnpm plan show`) and the
> rulings in the blueprint. [START-HERE.md](START-HERE.md) is the owner's direction of 9 November 2026, kept as a record:
> capxul-next is the rebuild of Capxul Core, Frappe-native, coordinated through the plan, the portal and the loop (no
> swarmD). Where an older document disagrees with the plan or a ruling, the plan and the ruling win.

This repository holds the Capxul rebuild: a typed blueprint (`blueprint/`, built by `packages/blueprint-engine`) and,
from the build session on, the product code it describes.

- **Start here.** Run `pnpm plan show`: it gives the goal, the critical path and the task you are on. Read
  `docs/blueprint.md` before you add or change a record.
- **The blueprint changes first.** When code needs to differ from the blueprint:
  1. change the record and add a decision record;
  2. rebuild to zero problems;
  3. change the code.

  Never edit `blueprint/baseline/` or any file under a `src/generated/` folder. For the contracts in `packages/contracts` the code
  is the truth for what exists: change a contract's source, run `pnpm contracts:export-abi`, and reconcile the contract records
  until `pnpm contracts:check-blueprint` passes (`docs/blueprint.md`, "Contract records and the contract code").
- **What is fixed is behaviour, not spelling** (`system.frozen-behaviour`). Each of the 215 old
  operations is either booked in the blueprint or classified by the cut (reached, dropped or parked: `blueprint/shared/cut.ts`,
  `docs/cut-archive/INDEX.md`), never both and never neither. A booked operation's acceptance claims are the evals. Commands, flags,
  `--json` shapes, refusal codes and wording are the blueprint's to design as one system. A
  change to any of them goes into the blueprint first, with a decision.
- **Every change passes these checks before it merges:**

  ```bash
  pnpm exec tsc -p packages/blueprint-engine && pnpm test
  pnpm exec tsc -p blueprint
  node --experimental-strip-types packages/blueprint-engine/src/main.ts blueprint/index.ts var/blueprint   # 0 problems
  node --experimental-strip-types packages/blueprint-engine/scripts/check-frozen.ts                                           # 0 breaches: every behaviour kept
  pnpm contracts:check-blueprint                                                                       # 0 undeclared differences: the contract records match the code
  pnpm layout                                                                                     # the top level, file sizes and package READMEs (also in pnpm test)
  ```

- **Where things go.** The top level is closed: `packages/layout/src/main.ts` holds the list of what may be there, with a
  reason each. Dead material moves to `archive/` at its old path (`archive/README.md`); working data goes under the
  git-ignored `var/`; a new script belongs in the package it serves (there is no `tools/` directory). `docs/repository-map.md` says
  what every entry is.

- **The plan.** `plan/plan.json` is the coordinator's plan, shown at `/plan/` in the portal (decision `portal.plan-page`).
  Every session starts with `pnpm plan show` and ends by updating the plan. Agents report through `pnpm plan task …` (`start <id>
  --thread <name>`, `block`, `unblock`, `done <id> --evidence <ref>`, each with `--by <name>`), never by editing the JSON; every
  change is logged in `plan/log.jsonl`. A task has a file `plan/tasks/<id>.md` (What, Why, Done when): `task add` needs `--what`,
  `--why` and `--done-when`. The owner's answers arrive in `plan/answers.jsonl` through `pnpm portal:serve`; `pnpm plan answers`
  lists them, and after writing the ruling or unblocking the task you run `pnpm plan answers apply <id> --evidence <ref>`. Only the coordinator writes `path set` and `note`: the critical path is written, never
  computed. `pnpm test` runs `plan check` and `plan-tasks --check` too.
- **Where code goes:** decision `system.layout` in `blueprint/shared/decisions.ts`. In short:
  - one package per component;
  - `src/<concept>/` mirrors `blueprint/<concept>/`;
  - another concept's code is imported only through its `door.ts`;
  - lanes `lane/<concept>` merge into `integration/build`.
- **Tracking work.** Work is tracked in the plan (above) and proven on the scoreboard (below). This old Capxul
  repository's Linear workflow and `docs/rules` do not apply here.
- **Done means evals pass in a run.** A task is done when its evals pass in a run, not when an agent
  says so. `pnpm evals -- <eval ids | all | --journey id | --milestone id>` runs the checks bound to
  evals (`evals/bindings/`) and is the only thing that writes `status/status.json`; never edit that
  file or an eval's verdict by hand. A claim with no check is `not_run` until a check proves all of
  it (`pnpm evals -- gaps` lists what has none). `docs/blueprint.md`, "Evals run", has the rules.
- **Decisions.** Every judgment is a decision record. Bring Aaron only what is truly his: a question goes to him
  as a blocked plan task, and his answer arrives through `pnpm plan answers`.
- **Old system.** `Xelmar-tech/infrastructure` (branch `integration/factory`) is a reference for
  behaviour, not a baseline. Read its code for edge cases (contract reverts, money paths,
  permissions). Never port it, and never run the evals against it. The as-is book is closed and
  archived in `docs/as-is/archive/`.
