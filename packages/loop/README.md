# @capxul/loop

A minimal runner: durable agents driven by scripts a person can read. A script in `loops/` says, top to bottom, which
task, which lane, which sandbox, who makes, which gates, who checks, how many rounds, what happens on a pass and on a
failure. The agents are [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable) conversations
(`@earendil-works/pi-durable` 1.5.0): committed to a SQLite file before anything is shown, resumed after a kill,
watchable from another process, and open to being steered later.

```bash
pnpm loop run m1-dev-commands --script pair --sandbox none   # one run: maker, gates, checker, up to 3 rounds
pnpm loop status                                             # run, task, status, step, round, elapsed, spend
pnpm loop watch <run id>                                     # attach: what the agent is doing now, live (read-only)
pnpm loop logs <run id>                                      # the ledger: each step, the conversation it used, how it ended
pnpm loop stop <run id>                                      # the agent is aborted within a second or two
pnpm loop resume <run id>                                    # after a kill: done steps are skipped, the agent continues
pnpm loop work --concurrency 2 [--task a,b] [--wait]         # take ready tasks from the plan, a run each
pnpm loop merge <run id>                                     # gates again on the lane + current base, then merge and push
pnpm loop clean [<run id>]                                   # remove finished runs' worktrees
```

Flags of `run` (and of every run `work` starts): `--script pair|research`, `--model`, `--checker-model` (`provider/id`; a
bare id is the gateway's), `--sandbox none|light|heavy`, `--rounds 3`, `--budget-usd 5`, `--timeout-min 30`,
`--checkers reviewer,adversary`. Tests: `pnpm loop:test`.

## One script, annotated (`loops/pair.ts`)

```ts
export default async function pair(job: Job): Promise<void> {
  await lane(job);                                     // a worktree on lane/<task>, cut from integration/build
  await sandbox(job);                                  // none, light or heavy, as --sandbox says
  const checkers = job.opts.checkers ?? job.task.checkers;
  let open: Finding[] = [], last: Handback | undefined, from: string | undefined;

  for (let round = 1; round <= job.opts.rounds; round++) {
    const made = await agent(job, `make.${round}`, { role: "builder", prompt: makerPrompt(job, round, open, last) });
    last = handback(made);
    if (last?.ask) return blocked(job, [`the maker asked: ${last.ask.text}`]);    // a real fork: the coordinator answers

    const gates = await gate(job, `gates.${round}`);                              // the repository's checks, run by the runner
    const checks = await Promise.all(checkers.map((role) =>                       // each checker: fresh context, read-only tools
      review(job, `${role}.${round}`, { role, round, made, gates, open, ...(from ? { from } : {}) })));

    open = settle(round, open, gates, checks);                                    // failed gates and blocking findings go back
    if (!made.ok) open.push({ id: `F-${round}.0`, severity: "blocking", text: `The maker did not finish: ${made.error}` });
    if (open.length === 0 && checks.every((c) => c.verdict === "approve")) return ready(job);   // push lane/<task>
    from = made.head;                                                             // the next review reads only the delta
  }
  return blocked(job, open.map((f) => `${f.id} ${f.check ?? ""}: ${f.text}`.slice(0, 300)));    // out of rounds: stop, with reasons
}
```

A new workflow is a new file like this (`loops/research.ts` is 11 lines). Each vocabulary function is a **step**: its
result goes into the run's ledger, so when a run is resumed the script replays from its top, finished steps answer from the
ledger, and the agent step that was in flight continues in its own stored conversation (same key, same question).

## How a run is stored

`runs/<run id>/run.sqlite` is the pi-durable storage and the only source of truth: the root conversation is the **ledger**
(`loop.start`, `loop.done` with the result, `loop.conversation`, `loop.end`), and every agent is another conversation in it.
`status.json` beside it is a small index derived from the ledger so `status` never opens a database; it is the one file
of a run that is not git-ignored. `STOP` appears when `loop stop` is asked. `lane/` is the run's git worktree.

**Attaching.** `pnpm loop watch <run id>` opens the storage read-only from another process (it recovers nothing, writes
nothing) and prints what the newest agent said and did, following it until the run ends. Steering is not built, but
nothing stands in its way: the agent is an ordinary pi-durable conversation, so `conversation.submit({ type: "input",
content, whenBusy: "steer" })` from an attached process that owns the storage is the call (README of pi-durable, "Busy
Conversations").

## What an agent can and cannot do

Agents are pi-durable conversations with the coding tools `read`, `write`, `edit`, `bash`, plus whatever MCP tools a script
registers (`mcpTools`). Every call passes a `beforeTool` hook (`agents/internal/policy.ts`).

| | maker (`builder`) | checker (`reviewer`, `adversary`) | researcher |
|---|---|---|---|
| read files | inside its lane only | inside its lane only | inside its lane only |
| write / edit files | inside its lane; not `books/frozen/`, `src/generated/`, `.git/`, `.claude/`, `runs/` | no (no write or edit tool) | no |
| shell | `pnpm exec/test/run/…`, `node`, `git status/diff/log/show/add/commit/mv/rm`, `ls cat head tail wc grep sort diff mkdir echo pwd`, `cd <inside>` | `git diff/log/show/status`, `ls cat head tail wc grep` | same as checker |
| shell refused | `git push`, `curl`, redirects (`>` `<`), `$(…)`, backticks, `..` paths, absolute paths outside the lane and `/tmp/` | same | same |
| environment of its commands | `PATH HOME USER LOGNAME SHELL TERM LANG LC_ALL TMPDIR` and the sandbox's `CAPXUL_*`; nothing inherited | same | same |
| network | none by policy, but see below | same | same |

The model key (`LLM_ROUTER_API_KEY`) lives only in the runner's process, is read when a request is made, and is not in
any command's environment (tests prove a secret in the runner's environment does not reach `bash`), file or log.

**A worktree is isolation of files, not a security boundary, and this policy is a filter on what the model asks for, not a
sandbox.** `node` and `pnpm exec` can run any program as the user: a model that wanted to could reach the network, read
files outside the lane or call `git push` through them. The list narrows what a well-behaved or confused agent does, and
the runner never pushes anything but `lane/<task>` and never merges by itself; it does not contain a hostile one. Real
containment needs an OS-level sandbox around the whole runner.

## Sandboxes

`none`; `light`: a local chain from the seeded state (`packages/contracts/bin/chain-up.sh core`, run in the lane) on a free
port asked of the system, its address handed to the agent as `CAPXUL_CHAIN_RPC`, stopped at the end; `heavy`: a world with a
company site through the spike's CLI (`world create <name> --as operator`, `org create acme … --world <name>`, removed with
`world delete`), against the Docker stack of the checkout named by `LOOP_STACK_DIR` (default: this one). Heavy is written
but was not exercised: it needs the Frappe stack up, `spikes/skeleton/.env`, the spike's `viem` installed, and the spike
picks its own ports (`8545 + 100n`), so "free ports are found" holds for light only.

## Models

One OpenAI-compatible gateway: `LOOP_MODEL_BASE_URL` (default `https://llm.capxul.com/v1`), key from the variable named by
`LOOP_MODEL_KEY_ENV` (default `LLM_ROUTER_API_KEY`; `source ~/.zshenv` if unset). Only `gpt-6.1-sol` and `gpt-6.1-terra` are accepted (Aaron's ruling); any other id is refused before a call is made. Defaults: maker `gpt-6.1-sol` (Aaron's ruling: Sol 6.1 for coding),
checker `gpt-6.1-terra`: a strong coding model, and a different family so the review is independent. They were picked from
what the gateway lists and answers (the newer Claude ids, kimi and deepseek returned 401 from the gateway on 10 November).
Override with `--model` / `--checker-model` or `LOOP_MODEL` / `LOOP_CHECKER_MODEL`. The gateway reports no prices, so pi
reports tokens and the budget is enforced by turn and time limits and checked between steps, not in dollars.

## Which parts are generic

`src/modules/agents`, `runs` and `lanes` (and `index.ts`'s first lines) know nothing about Capxul: open a pi-durable
storage, register tools with a confinement policy and MCP servers, pick a model from an OpenAI-compatible config, ask an
agent a question durably and get its last message, keep a step ledger, play a script, list/stop/watch/work runs, make a
git worktree and find a free port. **That is what would be extracted into a library for swarmD.** `src/modules/capxul` is
Capxul's: the plan's CLI, the repository's checks, `.claude/agents/` roles, the hand-back and check shapes of
`docs/design/swarm-templates.md`, the policy values, the sandbox scripts, merge rules. The package imports nothing from the
rest of the repository and nothing in the product imports it; it reaches the repository through commands (`tools/plan.ts`,
`pnpm`, `git`, the sandbox scripts) and files (`plan/tasks/*.md`, `docs/mission/tasks.json`, `.claude/agents/*.md`). Only
`loops/*.ts`, the scripts it plays, import it (and one test imports `loops/pair.ts`).

## The plan stays the source of truth

Starting a run claims the task (`plan task start <id> --thread <run id>`), blocking records why (`plan task block … --need … --who
coordinator`), a merged run marks it done with the merge commit. All through `tools/plan.ts`, so each change is logged
in `plan/log.jsonl`; the runner never touches the critical path or creates a task. A derived task (an entry of
`docs/mission/tasks.json`) can be run too; it has no plan entry, so no plan calls are made. The commands change the plan
files of the checkout the runner is started from (normally the coordinator's, on `integration/build`).

`pnpm evals` joins the gates when the lane has that script and the task has evals (`pnpm evals -- <eval ids>`: the
interface is assumed, because another lane is building the command).

## Dependencies

`@earendil-works/pi-durable`, `pi-ai`, `chord`, `pi-schema`, `pi-mcp`, all exactly `1.5.0`, published 2 November 2026 (older
than the three days `minimumReleaseAge` asks; `1.5.1` is from 9 November and is not used). Two transitive packages
(`@google/genai`, `protobufjs`) have install scripts; `pnpm-workspace.yaml` now lists them under `allowBuilds` as `false`:
known, and not run.
