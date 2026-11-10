# @capxul/loop

A minimal runner: durable agents driven by scripts a person can read. A script in `loops/` says, top to bottom, which
task, which lane, which sandbox, who makes, which gates, who checks, how many rounds, what happens on a pass and on a
failure. The agents are [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable) conversations
(`@earendil-works/pi-durable` 1.5.0): committed to a SQLite file before anything is shown, resumed after a kill,
watchable from another process, and open to being steered later.

```bash
pnpm loop run m1-dev-commands --script pair --sandbox none   # one run: maker, gates, checker, up to 3 rounds
pnpm loop serve [--port 4392]                                # the host: a page or a terminal attaches and sees runs as they change
pnpm loop status                                             # run, task, status, step, round, elapsed, spend
pnpm loop status --json [--since-hours 24]                   # the same as data: counts, models, last events (src/modules/inspect)
pnpm loop show <run id> --json                               # one run with its last twenty events
pnpm loop show <run id> --json --full                        # the run in full: every step's result and every agent's conversation
pnpm loop watch <run id>                                     # attach: what the agent is doing now, live (read-only)
pnpm loop watch                                              # every run: a line when one starts, is refused, fails a model request, turns unhealthy, ends or is superseded
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

`var/runs/<run id>/run.sqlite` (git-ignored working data) is the pi-durable storage and the only source of truth: the root conversation is the **ledger**
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

A bash command is read as the shell reads it (`agents/internal/shell.ts`): text in quotes or a here-document is the
program's, and only the cuts between commands, redirections and substitutions are judged. A maker may send output to a
file inside its lane (not into a protected path); a checker may not. Every refusal says what to do instead, so a refused
agent does not try the same thing another way. The 226 calls refused on 10 November are replayed against the policy in
`capxul/refused.test.ts`: 203 are allowed now, and 23 stay refused with a reason (outside the lane, an install, python).

| | maker (`builder`) | checker (`reviewer`, `adversary`) | researcher |
|---|---|---|---|
| read files | inside its lane only | inside its lane only | inside its lane only |
| write / edit files | inside its lane; not the frozen baseline (`books/frozen/`, `blueprint/baseline/`), `src/generated/`, `.git/`, `.claude/`, `var/` | no (no write or edit tool) | no |
| shell | `pnpm exec/test/run/…` and the root scripts (`pnpm frozen`, `pnpm layout`, …), `node`, `git add/commit/mv/rm`, `rm <its own files>` (no `-r`), `mkdir`, `cd <inside>`, and everything a checker may run | only what reads: `git diff/log/show/status/rev-parse/ls-files/merge-base/blame`, `rg`, `sed -n '<lines>p'`, `find` (no `-exec`, `-delete`), `ls cat head tail wc nl grep sort diff echo pwd` | same as checker |
| shell refused | `git push`, `curl`, `pnpm install`, redirects (`>` `<`), `$(…)`, backticks, `..` paths, absolute paths outside the lane and `/tmp/`, a quote left open | same, and `node` and every `pnpm` | same |
| environment of its commands | `PATH HOME USER LOGNAME SHELL TERM LANG LC_ALL TMPDIR` and the sandbox's `CAPXUL_*`; nothing inherited | same | same |
| network | none by policy, but see below | same | same |
| show its work (`record_terminal`) | any command its shell may run, recorded as a GIF | the lane's checks and `node` (what a maker's shell runs, without `git add/commit`, `rm`, `mkdir`): only on camera, and what it leaves in the lane is undone | same as checker |
| browser (`browser`, `screenshot`, `record_screen`) | this machine only (`127.0.0.1`, `localhost`, `*.localhost`): the sandbox and a lane's own server | same | same |

### A person's note

While a run is played, a person can write to its builder from the Runs app: `steer` (the builder reads the note after
its current tool call) or `queue` (it reads it when its turn ends, then goes on; its last answer is the hand-back). The
page calls the host, the host hands the note through the door of the process that plays the run (`src/modules/door`),
and that process puts it into the conversation, where it stays as part of the record. A checker takes no note, so its
check stays independent; an agent that is not working takes none either. A queued note is held in the playing process:
if that process dies before the agent's turn ends, the note is still in the conversation, but the run that resumes
takes the agent's first answer.

### Evidence

An agent shows what it says (`src/modules/evidence`, whose README has the tools). A capture is made by a tool, into
`var/runs/<id>/evidence/`, with a record of the command and its exit code or the page's address; the agent then claims
it in its final json: `"evidence": [{ "capture": "make.1.pay-refuses", "shows": "…", "eval": "…" }]` on the hand-back
and on the check. The loop judges every claim against the captures (a claim that names none is thrown out, and the
checker is told), tells the checker what each of the maker's captures really recorded, and shows both in
`loop show <run> --json --full` (`captures`, and `evidence` on an agent's step). The host serves a capture's file at
`/runs/evidence/<run>/<file>`. A machine without asciinema, agent-browser or ffmpeg still runs: the tool says what it cannot record.
`LOOP_BROWSER=off` takes the browser tools away. Nothing yet says an eval *needs* a capture: that is the blueprint's rule to make.

The model key (`LLM_ROUTER_API_KEY`) lives only in the runner's process, is read when a request is made, and is not in
any command's environment (tests prove a secret in the runner's environment does not reach `bash`), file or log.

**A worktree is isolation of files, not a security boundary, and this policy is a filter on what the model asks for, not a
sandbox.** `node` and `pnpm exec` can run any program as the user: a model that wanted to could reach the network, read
files outside the lane or call `git push` through them. The list narrows what a well-behaved or confused agent does, and
the runner never pushes anything but `lane/<task>` and never merges by itself; it does not contain a hostile one. Real
containment needs an OS-level sandbox around the whole runner.

## What the gateway is told about a conversation

Every model request carries `x-session-id`: pi-durable's own id of the conversation (one per agent of a run, the same
after a retry, a resume or a restart). A gateway that binds a session to one upstream account, as CLIProxyAPI's
`routing.session-affinity` does, then keeps an agent on that account and its prompt cache holds. The id is pi's, not
`<run id>/<agent>`: pi-ai 1.5.0 sends its session id when a model's `compat.sendSessionAffinityHeaders` is set
(`internal/config.ts`) and offers no per-conversation header of our own choosing.

## When the gateway struggles

- **A model that fails.** pi retries a request three times. If it still fails, the loop waits 20 s, then 60 s, then
  3 min, and each time continues the same conversation, so nothing the agent did is lost. If it never answers, the
  step throws and the run ends `failed` at that step with the gateway's message in a line: no check runs, no reviewer
  reads an unchanged lane, no round is spent. `pnpm loop resume <run>` continues the same agent later.
- **How many agents work at once.** `LOOP_MAX_AGENTS` (default 3) is shared by every run and process of the checkout:
  an agent takes a slot (a file under `var/runs/.agents/`) and waits when none is free. It bounds agents, not single
  model calls: an agent keeps its slot while its tools run.
- **The worker.** A run that is stopped tells `loop work` to start nothing more and to end when its runs are over,
  `--wait` or not. A task named with `--task` whose newest run was stopped or failed has that run resumed, once.
- **Cleaning.** `loop clean` removes a lane's worktree and frees the name `lane/<task>`: a merged branch is deleted,
  unmerged work is kept as `kept/<run id>`, so the next run of the task starts from the base.

## Sandboxes

`none`; `light`: a local chain from the seeded state (`packages/contracts/bin/chain-up.sh core`, run in the lane) on a free
port asked of the system, its address handed to the agent as `CAPXUL_CHAIN_RPC`, stopped at the end; `heavy`: a world with a
company site through the spike's CLI (`world create <name> --as operator`, `org create acme … --world <name>`, removed with
`world delete`), against the Docker stack of the checkout named by `LOOP_STACK_DIR` (default: this one). Heavy is written
but was not exercised: it needs the Frappe stack up, `spikes/skeleton/.env`, the spike's `viem` installed, and the spike
picks its own ports (`8545 + 100n`), so "free ports are found" holds for light only.

## Models

One OpenAI-compatible gateway, by name (`internal/config.ts`, `GATEWAYS`). `LOOP_GATEWAY` picks it:

| Name | Where | Key |
|---|---|---|
| `local` (default) | `http://127.0.0.1:8317/v1`: the CLI proxy on this Mac (CLIProxyAPI, through VibeProxy) | none |
| `router` | `https://llm.capxul.com/v1`: the LiteLLM router, out of the loop's path by the owner's ruling of 10 November | `LLM_ROUTER_API_KEY` |

`LOOP_MODEL_BASE_URL` and `LOOP_MODEL_KEY_ENV` still override the two parts. A run records which gateway it used.
Any model the gateway serves may be named (Aaron's ruling of 10 November 2026; before that only two were): the loop asks
the gateway what it serves when an agent starts and refuses a model it does not list. Defaults: maker `gpt-6.1-sol`
(Aaron's ruling: Sol 6.1 for coding), checker `gpt-6.1-terra`, a different model so the review is independent.
Override with `--model` / `--checker-model` or `LOOP_MODEL` / `LOOP_CHECKER_MODEL`. The gateway reports no prices, so pi
reports tokens and the budget is enforced by turn and time limits and checked between steps, not in dollars.

## Which parts are generic

`src/modules/agents`, `runs`, `lanes`, `evidence`, `door`, `inspect` and `host` (and `index.ts`'s first lines) know nothing about Capxul: open a pi-durable
storage, register tools with a confinement policy and MCP servers, pick a model from an OpenAI-compatible config, ask an
agent a question durably and get its last message, keep a step ledger, play a script, list/stop/watch/work runs, make a
git worktree and find a free port. **That is what would be extracted into a library for swarmD.** `src/modules/capxul` is
Capxul's: the plan's CLI, the repository's checks, `.claude/agents/` roles, the hand-back and check shapes of
`docs/design/swarm-templates.md`, the policy values, the sandbox scripts, merge rules. The package imports nothing from the
rest of the repository and nothing in the product imports it; it reaches the repository through commands (the root scripts
`pnpm plan`, `pnpm book` or `pnpm blueprint`, `pnpm frozen` and `pnpm test`, never a file's path; `git`; the sandbox scripts) and files (`plan/tasks/*.md`, `docs/mission/tasks.json`, `.claude/agents/*.md`). Only
`loops/*.ts`, the scripts it plays, import it (and one test imports `loops/pair.ts`).

## The plan stays the source of truth

Starting a run claims the task (`plan task start <id> --thread <run id>`), blocking records why (`plan task block … --need … --who
coordinator`), a merged run marks it done with the merge commit. All through `pnpm plan`, so each change is logged
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
