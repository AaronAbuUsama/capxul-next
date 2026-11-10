---
name: dispatch
description: Choose where one capxul-next task runs (a loop run on the Mac, a cloud thread, or Remote Control) and start it, so that its result reports into the plan. Use whenever the coordinator starts work.
---

# Dispatch

## Choose the runtime

| The work | Runtime | Start it with |
|---|---|---|
| A plan task that changes the repository and has checkable done-when lines | **Loop, `pair`** on the Mac | `pnpm loop run <task> --script pair`, or `pnpm loop work --task <a,b>` |
| A question about the blueprint, the old system or a library | **Loop, `research`** | `pnpm loop run <task> --script research` |
| Long design or research that needs the web, many files, or a conversation with Aaron, and no Mac tools | **Cloud thread** in this project | Ask the project coordinator for a thread, with the task id in the brief |
| Work that needs the Mac's tools (AWS credentials, the proxy, a local app) and is not a loop task | **Remote Control** on the Mac | A Remote Control session in `~/projects/capxul-next` |

Prefer the loop: it reports into the plan, saves its work, and shows in the portal.

## Loop options

- Defaults: builder `gpt-6.1-sol`, checker `gpt-6.1-terra`, 3 rounds, `--sandbox none`.
- Use `--sandbox light` or `--sandbox heavy` when the task needs the test sites or the chain.
- Add `--checkers reviewer,adversary` on money paths (payments, books, banking, payroll, budgets, approvals).
- Use another model only for a reason. Write that reason in the plan note.

## Every worker reports into the plan

- Before it starts: `pnpm plan task start <id> --thread <name> --by <name>`. The loop does this itself.
- When it finishes: the coordinator merges and marks it done. A worker never marks its own task done.
- When it is stuck: `pnpm plan task block <id> --need "<what>" --who <coordinator|aaron> --by <name>`.

A cloud thread cannot run `pnpm plan`. It reports to the coordinator, and the coordinator writes the plan on the Mac.
