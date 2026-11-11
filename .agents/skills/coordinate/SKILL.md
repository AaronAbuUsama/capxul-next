---
name: coordinate
description: The coordinator's sweep on capxul-next, run by the lead Amp thread. Read the facts again, close what finished, triage what is blocked, apply Aaron's answers, recompute the critical path, start an orb thread for every ready task, and leave a note. Use at the start of the lead thread, after a worker thread ends, after an answer, and every 30 minutes while work is open.
---

# Coordinate: one sweep

The coordinator is one Amp thread at a time, in an orb on a checkout of `integration/build`. It owns the plan's goal,
milestones, path and notes, starts the workers, merges, and is the only writer of `plan/`. A sweep never waits: no
`sleep` loops. A worker's result, a pull request or an answer wakes the next sweep.

## 0. After a restart

If this is the first sweep of a thread, read the last five plan notes (`pnpm plan show`), `git log --oneline -10` and the
open pull requests (`gh pr list --base integration/build`). A merge or start a note announced may already be done:
check before you do it again.

## 1. Read the facts

```bash
git fetch origin && git status --short && git log --oneline -5 origin/integration/build
pnpm plan show
pnpm plan answers
pnpm plan check
gh pr list --base integration/build --json number,title,headRefName,statusCheckRollup
amp threads list            # the worker threads and their state
```

Stop and fix first if `plan check` fails, or if tracked files have changes that no one owns.

## 2. Give every open task one stage

The first row that matches wins.

| Stage | Condition | What the sweep does |
|---|---|---|
| **aaron / answer** | Blocked on a decision, or `--who aaron`, and no answer yet | Nothing. It is on the Questions page |
| **aaron / answered** | Its answer is in `pnpm plan answers` | Step 4 |
| **coordinator / merge** | Its pull request has every check green | Step 3 |
| **coordinator / triage** | Blocked on anything else, its checks are red, or its thread ended without a pull request | Step 3 |
| **working** | Its worker thread is running | Nothing |
| **ready** | `todo`, and every need is done | Step 6 |
| **waiting** | `todo`, with needs not done | Nothing. The path routes around it |

## 3. Close and triage

- **merge**: read the diff (a green check is not proof), check that the task's done-when lines and evals hold, write
  `pnpm plan note "merging #<pr>"`, then `gh pr merge <pr> --merge`, and `pnpm plan task done <id> --evidence <commit>`.
- **triage**: put the blocker in exactly one class, and act on it:

| Class | Sign | Action |
|---|---|---|
| plan | The task is too big, wrongly scoped, or needs another task first | Split it, or add the missing task to `--needs`. Then unblock |
| environment | The orb, an install, the network, Docker | Fix it in `.agents/setup` or `packages/devnet/cloud/setup.sh` as its own task, then send the worker on (`amp threads continue <T-…> -ox "…"`) |
| execution | Poor work, and the findings are clear | Send the findings to the same thread, or start a fresh one with them in the task file |
| aaron | A product, architecture, money, credential or irreversible choice | The `ask-aaron` skill |

After triage, no task is blocked on "coordinator". A thread or task that a person stopped stays stopped.

## 4. Apply Aaron's answers

For each answer, write the ruling (a decision record, or a task edit), unblock or add the tasks it frees, then run
`pnpm plan answers apply <id> --evidence <commit>`.

## 5. Recompute the critical path

The path is the shortest chain of tasks that still meets every unmet exit line of the current milestone. List the tasks
each unmet exit line needs, with their `needs` chains; leave out what is done; put parallel work ahead of a task that
waits on Aaron; order by what unblocks the most, then by what takes longest. If the result differs from the plan's
path, run `pnpm plan path set <ids…> --why "<what changed>"`.

## 6. Fill every free slot

Optimize for movement. Start an orb thread for every ready task (the `dispatch` skill): path tasks first, then every
other ready task in the current milestone, then the next milestone. Prefer tasks that touch different concepts, so
pull requests do not collide (one worker per concept at a time). Amp starts a burst of 20 orbs, then one every five
minutes: that, and cost, are the limits, not caution. If there are free slots and no ready tasks, split a big task or
write the next ones (the `plan-tasks` skill). Write a plan note before a batch of starts.

## 7. Leave a note, and stay quiet

Run `pnpm plan note "<time>: merged …; blocked …; path …; asked …"`, commit `plan/` with a message that starts `Plan:`,
push it to `integration/build` (the coordinator's own plan commits are the only direct pushes there; never force), and
rebuild the book (the `portal-ops` skill).

Message Aaron only if he must act or can use a result: a milestone exit met, a new question on the Questions page, or the
climb is stuck. One short message with a link. A sweep with nothing new says nothing. Never hand him a command to run.
