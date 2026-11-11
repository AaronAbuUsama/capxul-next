---
name: coordinate
description: The coordinator's sweep on capxul-next. Read the facts again, give every open task its stage, close what finished, triage what is blocked, apply Aaron's answers, recompute the critical path, fill free capacity, and leave a note. Use at session start, after a run ends, after an answer, and every 30 minutes while work is open.
---

# Coordinate: one sweep

Run every command in `~/projects/capxul-next` on `integration/build`. Do the steps in order. A sweep never waits: no `sleep`, and no blocking on a run. Runs and answers wake the next sweep.

## 0. After a restart

If this is the first sweep of a session, read the last five plan notes (`pnpm plan show`) and `git log --oneline -10` first. A merge, push or start that a note announced may already be done. Check git and `pnpm loop status` before you do it again.

## 1. Read the facts

```bash
git status --short && git log --oneline -5
pnpm plan show
pnpm loop status --json --since-hours 24
pnpm plan answers
pnpm plan check
```

Stop and fix first if `plan check` fails, or if tracked files have changes that no one owns.

## 2. Give every open task one stage

Read the table from top to bottom. The first row that matches wins. Every open task has exactly one stage.

| Stage | Condition | What the sweep does |
|---|---|---|
| **aaron / answer** | Blocked on a decision, or `--who aaron`, and no answer yet | Nothing. It is on the Questions page |
| **aaron / answered** | Its answer is in `pnpm plan answers` | Step 4 |
| **coordinator / merge** | Its newest run is `ready` | Step 3 |
| **coordinator / triage** | Blocked on anything else, or its newest run `failed` | Step 3 |
| **working** | A run or a registered thread works on it, and is alive | Nothing |
| **dead** | Its run says `running`, but the process is gone | `pnpm loop resume <run>` |
| **ready** | `todo`, and every need is done | Step 6 |
| **waiting** | `todo`, with needs not done | Nothing. The path routes around it |

## 3. Close and triage

- **merge**: write `pnpm plan note "merging <run>"`, then run `pnpm loop merge <run>`. It brings in the base, runs the gates again, merges, pushes and marks the task done. If it refuses, triage the reason.
- **answered run** (research): copy the answer into the task's evidence or a decision record.
- **triage**: put the blocker in exactly one class, and act on it:

| Class | Sign | Action |
|---|---|---|
| plan | The task is too big, wrongly scoped, or needs another task first | Split it, or add the missing task and put it in `--needs`. Then unblock |
| engine or tooling | A rule forbids the fix inside this task | Add a task allowed to make the fix, put it in `--needs`, then unblock |
| environment | A model error, the sandbox, an install, the proxy | A passing failure: `loop resume` (up to three times per run). Otherwise fix it, or add a task |
| execution | Poor work, and the findings are clear | Run again with the findings in the task file, or with another model |
| aaron | A product, architecture, money, credential or irreversible choice | The `ask-aaron` skill |

After triage, no task is blocked on "coordinator". Every blocked task waits on another task or on Aaron.

A run or task that a person stopped stays stopped. Do not resume it.

## 4. Apply Aaron's answers

For each answer, write the ruling (a decision record, or a task edit), unblock or add the tasks it frees, then run `pnpm plan answers apply <id> --evidence <commit>`.

## 5. Recompute the critical path

The path is the shortest chain of tasks that still meets every unmet exit line of the current milestone, given what is done, working and blocked.

1. For each unmet exit line, list the tasks it needs, including their `needs` chains.
2. Leave out what is done. Put work that can run in parallel ahead of a task that waits on Aaron.
3. Order by what unblocks the most, then by what takes the longest.
4. If the result differs from the plan's path, run `pnpm plan path set <ids…> --why "<what changed>"`.

## 6. Fill every free slot

Optimize for movement: run as much in parallel as the limits allow. The limits are `LOOP_MAX_AGENTS` (default 3) and the gateway's rate limits; when the gateway carries more, raise the cap. Fill every free slot, every sweep: path tasks first, then every other ready task in the current milestone, then ready tasks of the next milestone. Add research runs and cloud threads for questions that would block later tasks. An empty slot with a ready task is a fault of the sweep. The cap is earned by measurement, not set by hope: raise it one step only after the runs at the current level were healthy (under one refused command in twenty, no model failures, ready in one or two rounds). Read inside the runs (`pnpm loop show <run> --json`) to know, not only their status. If there are free slots and no ready tasks, split a big task or write the next tasks (the `plan-tasks` skill). Write a plan note before a batch of starts. Use the `dispatch` skill. Fix a task's needs and done-when lines first if they are weak (the `plan-tasks` skill).

## 7. Leave a note, and stay quiet

Run `pnpm plan note "<time>: merged …; blocked …; path …; asked …"`, commit `plan/` with a message that starts `Plan:`, and run `pnpm portal`.

Message Aaron only if he must act or can use a result: a milestone exit met, a new question on the portal, or the climb is stuck. Keep it to one short message with a link. A sweep with nothing new says nothing.

## Long-running processes

Every service this project runs on the Mac (portal, loop host, alerts, test chain, Core stub) is started, stopped and checked with `pnpm ops` (see the portal-ops skill). Never stop a process with kill or pkill, and never ask Aaron to run a command: if a session cannot do something, find why and fix it.
