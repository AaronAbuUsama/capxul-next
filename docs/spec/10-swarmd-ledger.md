# swarmD ledger

One `LedgerDO` per **project**. A project is one repository and one eval
catalog. It is the record of what was claimed, what was checked, who did what,
and what is decided. Managers, workers, people, the artifact, Pi and Slack all
read it through the control plane. It never holds a conversation.

## Types

These go in `@swarmd/protocol`, module `ledger`, with the same
schema-equals-type checks as `tickets`.

```ts
// ── identity ────────────────────────────────────────────────────────────
type ProjectId = string;                 // "capxul-next"
type EvalId = string;                    // "<kind>:<subject>[/<n>]", e.g. "acc:payment.send/3" (grammar in 30)
type TaskId = `K-${number}`;
type AssignmentId = `A-${number}`;
type PairId = `P-${number}`;
type MatterId = `M-${number}`;
type FindingId = `F-${number}`;

type Actor =
  | { kind: "agent"; worker: string /* "builder@3" */; instance: string /* "builder#12" */; model: string }
  | { kind: "person"; member: string /* "aaron" */ }
  | { kind: "manager"; manager: string /* "capxul/build" */ }
  | { kind: "sandbox"; sandbox: string /* SandboxDO id */ }   // the only actor that posts machine verdicts
  | { kind: "system"; name: string /* "ledger", "github" */ };

/** An exact thing a verdict is about. Never a branch name. */
type Version =
  | { kind: "commit"; repo: string; commit: string /* 40-hex */ }
  | { kind: "deploy"; env: "devnet" | "staging" | "production"; deploy: string; commit: string };

/** A named pointer the ledger follows: `integration`, `main`, a PR head. Moves come from connector events. */
interface Ref { name: string; version: Version; movedAt: string; movedBy: Actor }

// ── evals ───────────────────────────────────────────────────────────────
type Level = "L0" | "L1" | "L2" | "L3" | "L4";
type Decider = "machine" | "agent" | "person";

interface EvalDef {
  id: EvalId;
  level: Level;
  /** What the claim is about. Operation and journey ids come from the project. */
  subject: { kind: "operation" | "journey" | "system" | "task"; id: string };
  /** One sentence that must be true. At most 300 characters. */
  claim: string;
  decider: Decider;
  check:
    | { kind: "machine"; timeoutMs: number }                       // run by the project's runner, by id
    | { kind: "agent"; rubric: string; checker: string /* worker name */ }
    | { kind: "person"; who: string[] /* members or groups */ };
  /** Evidence a pass must carry. */
  evidence: EvidenceKind[];
  /** Where it is declared in the repo, so a finding can point at it. */
  source: { path: string; line?: number };
  /** Evals this one assumes, such as a journey's operations. Used for display and ordering, not for roll-up. */
  needs?: EvalId[];
  /** Absent on an L0 eval: such evals are gates, never scored. */
  scored: boolean;
}

/** The catalog at one version: what `eval list` returned for that commit. */
interface Catalog { version: Version; evals: EvalDef[]; syncedAt: string }

type EvidenceKind = "run" | "trace" | "events" | "measure" | "screenshot" | "video" | "review" | "signoff";
interface EvidenceRef { kind: EvidenceKind; r2: string /* blob key */; bytes: number; sha256: string; note?: string }

type Result = "pass" | "fail" | "unverifiable" | "error"; // error: the check itself broke; it says nothing about the claim

interface Verdict {
  id: `V-${number}`;
  eval: EvalId;
  version: Version;
  result: Result;
  by: Actor;                 // machine → sandbox; agent → agent; person → person
  assignment?: AssignmentId; // the assignment that triggered it
  /** Numbers the scoreboard plots, e.g. { p50_ms, p95_ms, n } for a budget eval. */
  measures?: Record<string, number>;
  evidence: EvidenceRef[];
  /** At most 600 characters. On a fail: what was expected and what was seen. */
  detail?: string;
  at: string;
}

// ── work ────────────────────────────────────────────────────────────────
type Priority = "critical" | "normal" | "low";

interface Task {
  id: TaskId;
  parent?: TaskId;
  title: string;             // at most 80 characters
  goal: string;              // the outcome, with no steps; at most 1,000 characters
  /** The task's own evals. Its children's evals count through roll-up, so they are not repeated here. */
  evals: EvalId[];
  /** The ref whose head must pass, e.g. "integration". */
  target: string;
  owner: string;             // the manager that answers for it, e.g. "capxul/build"
  priority: Priority;
  needs?: TaskId[];          // order: these must be done first
  labels?: string[];         // e.g. area:payments
  dropped?: { by: Actor; reason: string; at: string };
  createdBy: Actor;
  createdAt: string;
}

/** Derived, never stored. See "Roll-up". */
type TaskState = "open" | "active" | "blocked" | "passing" | "done" | "dropped";

type Role = "maker" | "checker" | "designer" | "diagnoser" | "researcher" | "person";

interface Assignment {
  id: AssignmentId;
  task: TaskId;
  actor: Actor;
  role: Role;
  pair?: PairId;
  /** The swarmD ticket that runs it, when the actor is an agent. */
  ticket?: string;           // "T-31"
  state: "running" | "waiting" | "ended";
  outcome?: "delivered" | "approved" | "changes" | "failed" | "stopped" | "superseded";
  usage: { usd: number; tokens: number };
  startedAt: string;
  endedAt?: string;
}

type EntryKind =
  | "task.opened" | "task.changed" | "task.dropped"
  | "assigned" | "progress" | "submitted" | "verdict" | "finding" | "finding.fixed"
  | "question" | "answer" | "signal" | "decision"
  | "merged" | "deployed" | "ref.moved" | "catalog.synced"
  | "matter.raised" | "matter.resolved" | "ended" | "note";

/** The work log. Append-only; `seq` is the ledger's single order. */
interface Entry {
  seq: number;
  at: string;
  actor: Actor;
  kind: EntryKind;
  task?: TaskId;
  assignment?: AssignmentId;
  pair?: PairId;
  summary: string;           // at most 200 characters: what a person reads on a timeline
  /** Typed per kind, e.g. a verdict id, a commit, a finding id. */
  ref?: { verdict?: string; finding?: FindingId; matter?: MatterId; version?: Version; pr?: string };
  cost?: { usd: number; tokens: number };
}

interface Matter {
  id: MatterId;
  kind: "decision" | "question" | "risk" | "commitment";
  title: string;
  body?: string;
  options?: { label: string; text: string }[];    // a decision pack: 2 to 4 options
  recommendation?: string;
  state: "open" | "resolved";
  resolution?: { text: string; by: Actor; at: string; record?: string /* repo path, e.g. docs/decisions/… */ };
  task?: TaskId;
  thread?: string;           // where it was raised
  raisedBy: Actor;
  at: string;
}
```

Pairs, findings and signals are defined in
[20](20-swarmd-managers-and-pairs.md). They are stored here too.

## Roll-up: one rule set, all queries

The **current verdict** of eval `e` at ref `r` is the latest verdict for `e`
whose version is `r`'s head commit. If there is none, the eval is `unknown`
at that head. The last verdict at an older commit is shown greyed out, as
"last seen".

There is no staleness hashing. Instead, every move of a tracked ref triggers
one run of the machine evals at the new head. That run is itself a task the
build manager owns. The L3 eval `sys:suite-time` keeps that run cheap.

A **task's state** at its `target`, first match wins:

| State | When |
|---|---|
| `dropped` | `dropped` is set |
| `done` | every own eval is `pass`, or `unverifiable` with a person's waiver entry; and every child is `done` or `dropped` |
| `passing` | the same as `done`, but at an assignment's submitted version instead of the target head (not merged yet) |
| `blocked` | an open `question` matter or attention names the task, or a `needs` task is not done, or a signal is unanswered |
| `active` | it has a running assignment |
| `open` | otherwise |

The **score** of a subtree is these counts over every scored eval in it:
`pass`, `fail`, `unverifiable`, `unknown`, and `error`. It also carries the
`measures` of the current verdicts, for example each operation's p95 against
its budget. The scoreboard and every artifact section are queries of this kind.

**Who worked on what** is a query over the entries, by task and actor. The
timeline is the same entries in `seq` order. Cost per task is the sum of
`cost` over the subtree.

## Storage (SQLite in the DO)

```sql
evals(id TEXT, catalog_commit TEXT, def JSON, PRIMARY KEY(id, catalog_commit))
catalogs(commit TEXT PRIMARY KEY, synced_at TEXT)
verdicts(id TEXT PRIMARY KEY, eval TEXT, commit TEXT, result TEXT, by JSON, assignment TEXT, measures JSON, evidence JSON, detail TEXT, at TEXT)
  -- index (eval, commit, at DESC)
refs(name TEXT PRIMARY KEY, version JSON, moved_at TEXT, moved_by JSON)
tasks(id TEXT PRIMARY KEY, parent TEXT, row JSON)           -- index (parent)
task_evals(task TEXT, eval TEXT, PRIMARY KEY(task, eval))
assignments(id TEXT PRIMARY KEY, task TEXT, row JSON)        -- index (task)
entries(seq INTEGER PRIMARY KEY, at TEXT, actor TEXT, kind TEXT, task TEXT, row JSON)  -- index (task, seq), (actor, seq)
matters(id TEXT PRIMARY KEY, state TEXT, row JSON)
pairs(id TEXT PRIMARY KEY, task TEXT, row JSON)
pair_messages(pair TEXT, n INTEGER, row JSON, PRIMARY KEY(pair, n))
findings(id TEXT PRIMARY KEY, pair TEXT, eval TEXT, row JSON)
```

- **Evidence blobs** live in R2 under `ledger/<project>/<verdict>/<n>`, and the
  table keeps only refs to them.
- **Every write is one transaction** and appends at least one entry. A write
  that appends no entry is refused, so the work log is complete by
  construction.
- **Changes are published** on the control plane's feed for this ledger. The
  artifact, Pi and Slack all subscribe to that feed.

## Control plane

**Resources:**

```
swarmd://<ns>/projects/<project>                      the project: repo, refs, runner config
swarmd://<ns>/projects/<project>/evals[/<id>]         the catalog at a ref's head (?ref=integration)
swarmd://<ns>/projects/<project>/verdicts?eval=&ref=&commit=
swarmd://<ns>/projects/<project>/tasks[/<id>]         ?state=&owner=&label=&parent=
swarmd://<ns>/projects/<project>/score?task=&ref=&group=label:area
swarmd://<ns>/projects/<project>/log?task=&actor=&kind=&after=<seq>
swarmd://<ns>/projects/<project>/matters[/<id>]       ?state=open
swarmd://<ns>/projects/<project>/pairs[/<id>]
```

**Actions.** Each one checks the actor's role in code.

| Action | Who | Effect |
|---|---|---|
| `task.open {parent?, title, goal, evals, target, priority, needs?, labels?}` | a manager, a maintainer | opens a task; refuses an eval id the catalog at the target head lacks |
| `task.update {id, title?, goal?, evals?, priority?, needs?}` | the owner, a maintainer | changes it; the entry records the change |
| `task.drop {id, reason}` | the owner, a maintainer | marks it dropped |
| `verdict.post {eval, version, result, measures?, evidence, detail?}` | a **sandbox** for machine evals; the named checker's agent for agent evals; a listed person for person evals | appends a verdict; refuses a decider mismatch |
| `verdict.waive {eval, version, reason}` | a person on the eval's owner's `waive` list | lets an `unverifiable` count toward `done` |
| `matter.raise {kind, title, body?, options?, recommendation?, task?, thread?}` | anyone on the project | |
| `matter.resolve {id, text, record?}` | a decision: the matter's decider (default a maintainer); others: the raiser or the owner | |
| `entry.note {task, summary}` | anyone on the project | a free note on the timeline |
| `catalog.sync {version}` | the system, on a ref move; a maintainer | asks a sandbox to run `eval list` at that commit and stores the catalog |

Assignment and pair actions belong to the manager, in 20.

## How a machine verdict is produced

1. A worker or the manager asks for evals to run: the `run_evals` tool or
   action, with `{ ids: EvalId[] | { task: TaskId }, version }`.
2. **Code**, not the model, has the worker's `SandboxDO` check out the version
   and run the project's runner (below).
3. The sandbox reads the runner's JSON from stdout. It uploads the evidence
   files the runner wrote to R2, and calls `verdict.post` as
   `{ kind: "sandbox" }`, once per result.
4. The worker gets back a summary, for example "3 pass, 1 fail:
   ref:payment.send/INSUFFICIENT_FUNDS expected exit 4, saw 1". It never sees a
   way to post a verdict itself.

## Project config

The project config lives in the project repository's `.swarmd/project.ts`.

```ts
export default defineProject({
  name: "capxul-next",
  repo: "github:Xelmar-tech/capxul-next",       // or "swarmd:capxul-next" if swarmD hosts git
  refs: { integration: "integration", main: "main" },
  runner: {
    list: "pnpm eval list --json",              // → EvalDef[] (without source rewriting)
    run:  "pnpm eval run --json --out $EVIDENCE_DIR -- {ids}",  // → RunResult[]
    setup: "pnpm devnet up --snapshot base",    // once per sandbox boot
  },
  waive: ["aaron"],
});
```

The runner's output contract (the same in every project):

```ts
interface RunResult {
  eval: EvalId;
  result: Result;
  measures?: Record<string, number>;
  evidence: { kind: EvidenceKind; path: string /* inside EVIDENCE_DIR */ }[];
  detail?: string;
  durationMs: number;
}
```

## Mapping from swarmD today

- `Ticket`, `Report` and `Attention` stay as they are. They are the runtime of
  one agent conversation.
- An `Assignment` with an agent actor names its `ticket`.
- A ticket's `report` of `progress` or `blocked` appends an entry. Its
  `attention` becomes a `question` matter, with the task set.
- `checks` (ticket to ticket) becomes the pair. `children` becomes the task
  tree.

## Proof for S1

All of these are tests through the control plane, with no model:

- The catalog syncs from a fake runner.
- A sandbox-posted verdict is accepted, and an agent-posted machine verdict is
  refused.
- Roll-up matches the state table for an example tree of 3 levels.
- A ref move triggers a catalog sync and marks the head `unknown`.
- Every write appends an entry, and a write without one is refused.
- The score query returns counts and measures.
- The feed delivers changes to a WebSocket subscriber.
