# Philosophy

How every person and agent works in capxul-next. Read this first. The rest of the repository builds on it.

**Hill-climb the goal. Spend as little of Aaron's attention as possible, and give as much value as possible.**

Every message, question, page, task and paragraph costs someone's attention. Each must give more value than it costs, or it goes.

## How we climb

- **One goal, a few milestones, a live critical path.** Aaron and the coordinator agree on the goal and the milestones. After that, the order of work is the coordinator's call. The path is recomputed from the facts whenever they change. It is never followed from memory.
- **Optimize for movement: as much in parallel as the limits allow.** At every moment, every free agent slot works on something useful. The limits are Amp's orb limits and the model rate limits, not caution. The critical path goes first, then every other ready task. A blocker is a fact to route around, never a reason to stop: while one task waits, many others run.
- **Split work so it can run in parallel.** Prefer tasks that do not touch the same files, so that lanes do not collide. A task that only one thing can do at a time is a reason to split it.
- **Done means proven.** A task is done when its checks pass in a run, not when an agent says so.
- **The blueprint changes first.** The design is changed and rebuilt to zero problems before the code changes.

## How agents behave

- **Act only on a task or a written rule.** Work that nobody asked for needs a task in the plan.
- **Speak only when a person must act or can use a result.** Confirm once, stay quiet while you work, and speak again with a result, a decision, or a reason you cannot finish.
- **Ask one concrete question at a time**, in a structured form (a decision with options and a recommendation), never buried in a report.
- **Stop by impact, not by effort.** Take a local change as far as a result someone can review. Stop at a design decision, with a clear question.
- **Report honestly.** Mark a draft as unfinished. Report a failure as a failure. Never bypass a limit to avoid asking.

## How work survives

Agents, sessions and machines stop. Work must not be lost or done twice.

- **Store first, then act.** Write the intent (a plan change, a run step, a note) before the action it leads to. After a crash, the stored record says what was meant and what happened.
- **State comes from stored facts.** A task's state is worked out from the plan, its log and the runs. It is never kept in an agent's head, so a restart keeps it.
- **Resume, do not restart.** Work continues from its branch and pull request. Finished steps are not done again.
- **Check before you repeat an outside action.** After a restart, read git, the lane and the remote before you push, merge or post again.
- **Retry what passes, hold what does not.** Retry a passing failure (a network error, a 429 or 5xx response, a timeout) a few times with a growing delay. Anything else stops and waits for a decision, with the error kept.
- **A person's stop holds.** A stopped run or a paused task stays stopped until a person lifts it. Automatic retries never undo a stop.

## How the design stays small

- **Few concepts.** The plan has a goal, milestones, exit lines, tasks, a path, runs and answers. A new need becomes a field on one of them, or a line in a skill, not a new concept.
- **Few settings.** A default replaces a setting when one value suits almost every case.
- **The portal shows what needs a person first.** It lists what waits for Aaron, then what is moving, then history. A healthy state takes no space. A count always equals the length of the list it links to.
- **Documents read in order.** This file, then `AGENTS.md`, then the skills and the design docs. No document needs a concept that a later one introduces.
