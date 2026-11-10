# loops

The scripts the agent loop runs. Each is a short, readable sequence of steps: which agents work on a task, in what
order, and when it stops.

- `pair.ts`: a maker and a checker work a plan task in rounds, then the gates run (the default).
- `research.ts`: one agent answers a question and changes nothing.

Run one with `pnpm loop run <task id> --script <name>`; see runs with `pnpm loop status`. The runner, and the
pi-durable code under it, is `packages/loop` (its README explains a run). Run folders are written to `var/runs/`.
