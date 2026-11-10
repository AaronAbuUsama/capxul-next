---
name: plan-tasks
description: Write or fix a capxul-next plan task so that an agent can claim it, finish it in one run, and prove it. Use when you add a task, split one, or find a task with no needs, no exit line or a vague done-when.
---

# Plan tasks

A good task is one run of work (about one to three rounds of `pair`), with a result that a check can prove.

## Add a task

```bash
pnpm plan task add <milestone>-<short-name> \
  --milestone <id> --title "<what is true when done, in plain words>" \
  --why "<which exit line or blocker this moves>" \
  --what "<the change, and which files or concepts it may touch>" \
  --done-when "<a check that passes>" --done-when "<another>" \
  --needs <task,task> --records <record keys>
```

## The rules

- **One outcome.** If a title needs "and", split the task.
- **Needs are real.** List every task whose result this one uses. The path is computed from them. A task with no needs must truly be able to start now.
- **It serves an exit line.** `--why` names the exit line (for example `g2`) or the task it unblocks. A task that serves neither is dropped, or parked in a later milestone.
- **Done-when is checkable.** Each line is something an agent can run and a reviewer can confirm: an eval id, a `pnpm` command that passes, or a count from the blueprint build. "Looks right" is not a line.
- **Scope is stated.** Say what the task may change, especially when it must cross a boundary that the builder rules close (for example the engine package).
- **Size.** Split any task that a builder cannot finish in three rounds.
- **Parallel by design.** Split work so tasks touch different files and can run at the same time. Give a task `--needs` only for a real dependency, never for order.

## Fix a task

Use `pnpm plan task edit <id> --needs … --evals … --title …`, and edit `plan/tasks/<id>.md` for the prose. Never edit `plan/plan.json` by hand.

## Block a task

A blocker is a structured fact. It is never left as free text for someone to work out later:
- it waits on another task: add that task to `--needs`, and the task stays `todo`;
- it waits on a decision: `--decision <id>`;
- it waits on a person: `--need "<the exact thing>" --who aaron`.

`--who coordinator` is only for the loop's own report of a failed run. The next sweep turns it into one of the three above.
