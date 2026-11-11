---
name: dispatch
description: Start one capxul-next plan task as its own Amp orb thread, with a brief it can work from cold, so its result comes back as a pull request into integration/build. Use whenever the coordinator starts work.
---

# Dispatch

One task, one orb thread, one branch, one pull request into `integration/build`.

## Start it

```bash
pnpm plan task start <id> --thread <name>
amp -ox "$(cat <<'BRIEF'
Task <id> on capxul-next. Read AGENTS.md, then plan/tasks/<id>.md (What, Why, Done when).
Branch claude/<id> from origin/integration/build. Change the blueprint first if the code must differ from it.
Done when: <the task's done-when lines and eval ids>.
Run the checks in AGENTS.md and `pnpm evals -- <eval ids>`, push the branch and open a pull request into
integration/build (gh pr create --base integration/build). Do not use Ship. Do not merge.
If you are blocked, say exactly on what in your last message and stop.
BRIEF
)" --title "<id>" --orb-size a1.medium
```

`amp -ox` prints the thread URL and returns at once. Keep the URL in the plan note.

## Choose the size and the mode

- `a1.medium` (4 CPU, 8 GB) for blueprint, engine, docs and portal work.
- `a1.large` (8 CPU, 16 GB) when the task runs the Frappe test sites, the chain or the bench image
  (`spikes/skeleton/run.sh`, `pnpm contracts:prove`, `packages/bench-image`).
- On money paths (payments, books, banking, payroll, budgets, approvals), start a second thread on the pull request
  once it is up, in another mode, whose only job is to try to break the money path and report what lands.

## Follow up

- A worker's question or a red check: `amp threads continue <T-…> -ox "<the answer or the failing check>"`.
- A worker never marks its task done and never merges. The coordinator does, after reading the diff (the `coordinate` skill).
- A worker cannot write `plan/`. It reports in its thread and its pull request; the coordinator writes the plan.
