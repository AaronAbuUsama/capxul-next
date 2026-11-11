# swarmD managers, templates, artifacts and pairs

## Manager

A **manager** replaces the router. It is more opinionated: a router decides what
counts as work, but a manager **answers for outcomes**. It owns a scope of
tasks in one project's ledger, keeps their evals moving to `pass`, mediates the
pairs on them, records matters, and shows all of it through its artifact. It
never does the work itself.

- **`ManagerDO` is one Durable Object per manager instance.** It keeps today's
  `RouterDO` machinery: the gate and policy, sources, workers as durable
  conversations, the deliver task and crash recovery. On top of that it adds
  the template, the pair engine and the artifact connections.
- **The manager's model sees only what needs judgement:**
  - new triggers, as today
  - **signals** from the pair engine and the sweep
  - questions it can answer from the ledger

  Relaying between maker and checker is code.
- **Managers can manage managers.** A lead manager's tasks have children owned
  by other managers in the same project. Signals and questions it cannot settle
  bubble up to it unchanged. This is swarmD's planned hierarchy, done through
  the task tree rather than a separate `swarm` source.

```ts
export default defineManager({
  name: "build",
  description: "Builds Capxul operations to green: one pair per operation task.",
  template: "build",                     // see Templates
  project: "capxul-next",
  scope: { labels: ["kind:operation"] }, // the tasks it owns: those it opens, plus those assigned to it
  model: { provider: "openai", modelId: "gpt-6.1-sol", thinking: "medium" },
  instructions: "./prompts/build.md",
  workers: [
    { worker: "builder", role: "maker", models: ["openai/gpt-6.1-sol"] },
    { worker: "reviewer", role: "checker" },
    { worker: "verifier", role: "checker" },
    { worker: "diagnoser", role: "diagnoser" },
  ],
  pairs: { maxRounds: 5, budgetUsd: 5, freshMakerEachRound: true, deltaReview: true },
  sources: [slack({ channels: ["C0CAPXUL"] }), github({ repo: "Xelmar-tech/capxul-next" }), api()],
  policy: "./policy.ts",
});
```

## Templates

A template is code in swarmD that sets three things:

1. **The sections of the artifact.** Each section is a ledger query plus a
   renderer.
2. **What the manager attends to**, through extra prompt and tools.
3. **The default pair settings.**

Projects pick a template and may add sections.

| Template | For | Sections | Extra behaviour |
|---|---|---|---|
| **chat** | a room: a Slack channel, a Pi chat | header, tasks (Doing, Waiting on people, Next, Done in the last 24 hours), matters, timeline | each task gets a thread with a status card edited in place; steering by reply in the thread; quiet by default; it records matters from conversation; a sweep of waiting and stale tasks (the behaviour of `slack-router` and its §4) |
| **build** | turning tasks with evals green | header, scoreboard (by label, e.g. area), pairs in flight (round, spend, signals), failing evals, timeline | the pair engine; a full run of the machine evals on every ref move; merges into the target ref when a task is `passing` and its checkers approve |
| **lead** | managing managers | header, the critical path (top-level tasks in `needs` order), each child manager's score and blockers, matters that need a person | rolls up child scores; receives signals that bubbled up; opens and reorders top-level tasks |

**Every template has the chat behaviour too.** A manager always lives in at
least one room, so people can talk to any manager and see its board. The
chat template is therefore the base: build and lead extend it.

```ts
interface Template {
  name: string;
  sections: Section[];
  prompt: string;            // appended to the built-in manager prompt, before the project's instructions
  tools: string[];           // the manager tools it adds
  pairs?: PairSettings;
}

type Section =
  | { kind: "header" }                                               // goal, now, needs-a-person count, updated
  | { kind: "tasks"; group: "state" | "label" | "owner"; root?: TaskId }
  | { kind: "tree"; root?: TaskId; columns: ("state" | "score" | "owner" | "cost" | "updated")[] }
  | { kind: "scoreboard"; group: string /* "label:area" */; measures?: string[] /* "p95_ms" */ }
  | { kind: "pairs"; state?: "live" | "all" }
  | { kind: "failing"; limit: number }
  | { kind: "matters"; state: "open" | "all" }
  | { kind: "timeline"; task?: TaskId; actor?: string; limit: number };
```

## The artifact

**One state, three renderers,** all served by the `ManagerDO`:

| Renderer | Where | How it updates |
|---|---|---|
| **web** | `https://<swarmd>/a/<ns>/<manager>`, with members-only auth through the control plane token or a sign-in | live over WebSocket, from the ledger feed |
| **slack** | a pinned board message in each room, edited in place; task cards in threads | re-rendered by the channel loop on change, with no model calls |
| **pi** | a view in pi-swarmd | the existing change feed |

A person clicks or types to act: answer, waive, stop, reprioritize. Those go
through the same control plane actions, and are checked by role in code.

**The artifact is multiplayer by construction.** Everyone sees the same query
results, and every action shows on the timeline under the actor who took it.

## Pairs

A **pair** is a task with one maker assignment and one or more checker
assignments. The manager's **pair engine** (code) carries typed messages
between them.

```ts
interface PairSettings {
  maxRounds: number;           // a signal fires at round 3 whatever this is (D1)
  budgetUsd: number;           // the $5 per task (D6); a signal fires at half of it
  freshMakerEachRound: boolean;// D5: each round is a new maker assignment from the head, the findings and a handover
  deltaReview: boolean;        // D5: from round 2 a reviewer reads only the diff since the last reviewed head
  mergeOn: "approve+no-fail";  // D7: reviewer approve and no failed machine eval; unverifiable is listed, not blocking
}

interface Pair {
  id: PairId;
  task: TaskId;
  maker: AssignmentId;          // the current one; earlier makers are superseded
  checkers: AssignmentId[];
  round: number;
  head?: Version;               // the version last submitted
  state: "making" | "checking" | "converged" | "signalled" | "diagnosing" | "merged" | "stopped";
  spentUsd: number;
  settings: PairSettings;
}

type PairMessage =
  | { kind: "submit"; from: AssignmentId; version: Version; addresses: FindingId[]; note: string /* ≤600 */ }
  | { kind: "check"; from: AssignmentId; version: Version;
      verdict: "approve" | "changes";
      findings: FindingInput[];               // new findings
      fixed: FindingId[];                     // earlier findings now fixed at this version
      ran?: { pass: number; fail: number; unverifiable: number } }  // machine evals it triggered
  | { kind: "handover"; from: AssignmentId; to: AssignmentId; text: string /* ≤1,500: what is done, what is not, why */ }
  | { kind: "question"; from: AssignmentId; to: "pair" | "manager" | "person"; text: string; options?: string[] };

interface Finding {
  id: FindingId;
  pair: PairId;
  eval?: EvalId;                // a finding against an eval names it; a style finding may not
  severity: "blocking" | "advisory";
  where?: { path: string; line?: number };
  text: string;                 // ≤600
  raisedAt: Version;
  fixedAt?: Version;
  reopenedAt?: Version[];       // an earlier fix regressed: this feeds a signal
}
type FindingInput = Omit<Finding, "id" | "pair" | "raisedAt" | "fixedAt" | "reopenedAt">;
```

### The engine's loop (code)

1. **Start.** `pair_start {task, maker, checkers}` opens the maker assignment.
   Its input is the task's goal, the eval ids with their claims, the target
   ref, and the findings still open.
2. **Submit.** The maker submits a version. The engine checks that L0 passes:
   the project's `runner.gate`, run by the sandbox. If it fails, the
   submission goes back to the maker at once and no round is counted.
3. **Check.** The engine runs the task's machine evals at that version, which
   posts verdicts. It then opens or resumes each checker with the version, the
   diff (a delta diff after round 1), the open findings and the verdicts.
4. **Collect.** It collects each `check` message, then:
   - every checker approves and no machine eval failed: the pair is
     `converged`, the manager merges into the target, and the pair becomes
     `merged`
   - otherwise: the next round begins. A fresh maker gets a `handover` from the
     last maker, plus the findings, and the engine goes back to step 2.
5. **Signals.** At each step the engine checks the signals below. When one
   fires, the pair becomes `signalled`, and the manager's model is woken with
   the signal and the pair's summary.

```ts
type Signal =
  | { kind: "regression"; finding: FindingId }       // a fixed finding reopened, or an eval passing earlier now fails
  | { kind: "defect_in_fix"; finding: FindingId }    // a blocking finding inside lines changed to address another finding
  | { kind: "round"; round: number }                 // round 3, and every round after it
  | { kind: "budget"; spentUsd: number; budgetUsd: number }  // half, and all of it
  | { kind: "stalled"; minutes: number }             // no message for staleAfterMinutes
  | { kind: "provider"; provider: string; error: string }   // D9: quota, credit or auth; pauses every pair on that provider
  | { kind: "question"; text: string };              // a question to "manager" or "person"
```

### The manager's decision on a signal (model, one tool)

```ts
decide({ pair, action:
  | { kind: "continue" }
  | { kind: "fresh_maker"; model?: string; note?: string }
  | { kind: "add_checker"; worker: string }
  | { kind: "diagnose" }                   // D1: a diagnoser with fresh context; returns cause, ripple effects, options
  | { kind: "split"; tasks: { title: string; goal: string; evals: EvalId[] }[] }  // the task was too big
  | { kind: "raise"; matter: { kind: "decision" | "question"; title: string; options?: …; recommendation?: string } }
  | { kind: "stop"; reason: string } })
```

**The manager raises a matter for a person only when no other action fits**
(D2). The diagnoser's result is a typed `{ cause, kind: "plan" | "execution",
ripple: string[], options: {label, text}[], recommendation }`. The manager acts
on it.

## Manager tools (beyond today's router tools)

| Tool | Args | Does |
|---|---|---|
| `task_open` | `{parent?, title, goal, evals, priority, needs?, labels?}` | the ledger's `task.open`, owned by this manager |
| `task_update` / `task_drop` | as in the ledger | |
| `assign` | `{task, worker, role, model?, input?}` | opens a single assignment (a researcher, a designer) |
| `pair_start` | `{task, maker: {worker, model?}, checkers: {worker, model?}[], settings?}` | starts the engine |
| `decide` | above | answers a signal |
| `merge` | `{pair}` | merges the converged head into the task's target, through the git connector; refused unless the pair is `converged` |
| `deploy` | `{env, version}` | runs the project's deploy for that environment; appends `deployed` |
| `matter_raise` / `matter_resolve` | as in the ledger | |
| `score` / `read` | `{query}` | reads the ledger |
| `post` | `{thread?, text}` | speaks in a room; sparingly |

## Worker tools (beyond today's)

| Tool | Who | Does |
|---|---|---|
| `progress {now, done, next}` | any | updates the status card and appends a `progress` entry; no ticket stage change |
| `run_evals {ids?, task?}` | maker, checker | the sandbox runs them at the worker's current commit; the worker gets back a summary; verdicts post themselves |
| `submit {addresses, note}` | maker | commits and pushes its head, then sends `submit`; this replaces `report ready` for a maker in a pair |
| `check {verdict, findings, fixed}` | checker | sends `check`; this replaces `report ready` for a checker |
| `handover {text}` | an outgoing maker | asked for by the engine before a fresh maker starts |
| `ask {to, text, options?}` | any | a question to the pair, the manager or a person; to a person it becomes a matter and posts in the task's thread |

## Proof for S2 and S3

- **S2: the chat template passes `slack-router`'s 8 scenarios,** with
  `FakeSlack` and a fake model:
  1. a request becomes a task
  2. a question and its answer
  3. two people steering
  4. stop
  5. a decision becomes a matter
  6. a crash mid-task
  7. permissions
  8. the card fallback

  The build template's web artifact renders a 3-level tree with live updates.
- **S3, with no model:** the engine runs submit, gate, check, round and merge
  with fake workers. Each signal fires on its condition. A provider error pauses
  the pairs on that provider.
- **S3, live on the deployed swarm:** one task with 5 evals converges with no
  person. Its rounds, cost and timeline show on the artifact. The test passes 5
  times out of 5 on `openai/gpt-6.1-sol`.
