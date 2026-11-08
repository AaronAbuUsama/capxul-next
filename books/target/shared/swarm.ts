// The swarm design's records: its decisions (defineDecision) and any component or environment it
// adds. One writer: the swarm designer. Explained in docs/design/swarm.md.
//
// The swarm is how the build runs: one swarmD manager (the master agent, whose instructions are the goal prompt) with its
// workers, turning the task tree that tools/plan-tasks.ts derives from this book green, eval by eval. It adds no component
// or environment record: it is the build's tooling, not part of Capxul.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import { decision_system_build_order, decision_system_layout, decision_system_size } from "./decisions.ts";

const BY = "Claude, swarm design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

const SWARMD = "/home/user/swarmd";
const RETRO = `${SWARMD} docs/planning/swarm-retro-2026-11-06.md`;
const MONEY = [f.concept_payments, f.concept_books, f.concept_banking, f.concept_requests, f.concept_payroll, f.concept_budgets, f.concept_approvals];

// ── topology ────────────────────────────────────────────────────────────────────────────────

export const decision_swarm_start_small = defineDecision({
  id: "swarm.start-small",
  title: "One manager and its workers first; managers of managers later",
  question:
    "Spec 40 drew four managers (lead, design, build, measure) over the build. swarmD's manager has never run a real " +
    "project, and its hierarchy is planned, not built. What topology does the build start on?",
  options: [
    {
      label: "one-manager",
      text:
        "One swarmD manager, capxul/master, on the build template, whose instructions are the goal prompt. Its workers are a " +
        "maker (builder), a checker on another model family (reviewer), a second checker on every money task (adversary), a " +
        "diagnoser and a researcher. Aaron talks to it in its room and on the portal. Lane managers come later, as stage 2, " +
        "once the single manager has the record that swarm.nested-entry asks for (Aaron, 8 November 2026).",
    },
    { label: "four-managers", text: "Spec 40's lead over design, build and measure managers from the start." },
    { label: "lane-managers", text: "One manager per lane under a lead from the start: 22 managers." },
  ],
  chosen: "one-manager",
  why:
    "The manager itself is untested: the retro's two missions ran on a router whose merge rule, round limit and outage " +
    "handling all failed in ways nobody predicted. One manager makes those failures visible in one place and cheap to fix. " +
    "The design manager has no work, since the book is designed and its evals derived; the measure manager has none until " +
    "B5. A lead over 22 lane managers multiplies the untested part 23 times and needs hierarchy, which is planned only.",
  source: "Aaron, 8 November 2026, in the build-preparation conversation: start small, one manager with its workers; nested managers are the next stage",
  affects: [f.system_capxul, decision_system_build_order],
});

export const decision_swarm_stages = defineDecision({
  id: "swarm.stages",
  title: "Three stages: Mission Control, one swarmD manager, then lane managers",
  question:
    "swarmD will be what its documentation describes, but not yet. T0, D0 and B0 may start before its ledger and pair engine " +
    "exist. What runs the build before then, and when does the build move onto swarmD?",
  options: [
    {
      label: "three-stages",
      text:
        "Stage 0: the build session (a Claude session, Mission Control) runs the master's loop by hand with the same schemas: " +
        "docs/mission/tasks.json as the task tree, pull requests on the same branches, makers and checkers as Workflow agents, " +
        "at most 2 pairs at a time (swarm.pacing), and docs/mission/progress.md as the log. Stage 1: capxul/master on swarmD, " +
        "when the entry criteria in docs/design/swarm.md section 1.2 hold (expected at B3): among them the briefs without " +
        "which the master cannot run at all, the plan reconciled in code (SD-2), the brief and paths reaching the gate (SD-3, " +
        "SD-4), des: verdicts posted and carried (SD-21, SD-22), a pair's end waking the master (SD-26), needs met at merge " +
        "(SD-27) and pushes held to the task's branch (SD-28). Stage 2: lane managers under the master as lead " +
        "(swarm.nested-entry).",
    },
    { label: "wait", text: "Start nothing until swarmD's manager runs." },
    { label: "workflows-only", text: "Run the whole build from Claude sessions and workflows; swarmD is not used." },
  ],
  chosen: "three-stages",
  why:
    "Waiting idles the critical path on another project's schedule. Workflows only would not prove swarmD, and the goal " +
    "prompt says building Capxul is how swarmD is proven. One set of schemas across the stages makes the move a change of " +
    "runner, not of plan: the same task keys, evals, branches and gate.",
  source: by("docs/mission/initializer.md (How to work); swarmD STATUS.md (the manager-model rows are all not started); HANDOFF.md (lessons that save usage)"),
  affects: [f.system_capxul],
});

export const decision_swarm_nested_entry = defineDecision({
  id: "swarm.nested-entry",
  title: "Lane managers only after the single manager has a measured record",
  question: "What evidence must exist before the build moves from one manager to a lead over lane managers?",
  options: [
    {
      label: "record-and-bottleneck",
      text:
        "All of: at least 4 lanes done by the single manager, one of them a money lane; every done task within its $5 or over " +
        "it only by a recorded decide; median cost per done task at most $2.50 and the 90th percentile of rounds at most 3; at " +
        "least 80% of signals settled without a person; no merge outside the release gate; integration/build red under 2% of " +
        "hours; the manager's own spend at most 10% of its lanes'. And a bottleneck: over 3 days, a free pair slot with open " +
        "frontier tasks while a signal waited over 15 minutes for the manager, a quarter of the time or more. And swarmD's lead " +
        "template, manages, bubbling and child roll-up built with their acceptance lines passing.",
    },
    { label: "milestone", text: "Move at B4, whatever the record." },
    { label: "never", text: "Keep one manager to the end." },
  ],
  chosen: "record-and-bottleneck",
  why:
    "A hierarchy is worth its cost only when one manager cannot hold the scope (swarmD's Zen, rule 6), and only on a manager " +
    "already shown to converge within budget. The numbers are the ones the retro could not compute and the scoreboard can.",
  source: by(`${SWARMD} apps/docs/content/docs/zen.mdx (rule 6); concepts/managers-and-workers.mdx (managers manage managers, planned); ${RETRO} (health signals)`),
  affects: [f.system_capxul],
});

export const decision_swarm_master_prompt = defineDecision({
  id: "swarm.master-prompt",
  title: "The goal prompt is the master's instructions, with the operating skeleton",
  question: "What does capxul/master's instructions file hold, so that it does not improvise how to run the build?",
  options: [
    {
      label: "goal-plus-skeleton",
      text:
        "docs/mission/initializer.md whole (the goal, the book, the order of work, how to work, what to bring to Aaron), " +
        "followed by the operating skeleton in docs/design/swarm.md section 1b: its durable state, tools, the events that wake " +
        "it and what it does on each, its rules, and the stop and escalation rules. swarmD adds its built-in manager prompt " +
        "and the build template's prompt before them, and they cannot be overridden.",
    },
    { label: "summary", text: "A short prompt of its own, pointing at the goal prompt." },
    { label: "skeleton-only", text: "The operating skeleton only; the goal prompt stays a document the master reads." },
  ],
  chosen: "goal-plus-skeleton",
  why:
    "The goal prompt is the whole basis of the master. A summary drifts from it; a skeleton without it loses the definition " +
    "of done. The skeleton covers what the goal prompt leaves to the runner: which event wakes the master and what it does then.",
  source: by("docs/mission/initializer.md; swarmD reference/manager.md (instructions are added after the built-in and template prompts)"),
  affects: [f.system_capxul],
});

export const decision_swarm_workers = defineDecision({
  id: "swarm.workers",
  title: "Five workers: builder, reviewer, adversary, diagnoser, researcher",
  question: "Which workers does the single manager have, and which of spec 40's roles go?",
  options: [
    {
      label: "five",
      text:
        "builder (maker, strong tier, a sandbox with the repository and a devnet); reviewer (checker, strong tier on another " +
        "model family, posts the des: verdicts); adversary (a second checker on money tasks, strong tier, other family, tries to " +
        "break money paths); diagnoser (fresh context, read-only, on signals); researcher (cheap, no role, answers a question " +
        "from the book, the old system or the web). No verifier, designer, design reviewer or scout until B5.",
    },
    { label: "spec-40", text: "Spec 40's seven: designer, design-reviewer, builder, reviewer, diagnoser, researcher, scout." },
    { label: "with-verifier", text: "Add a verifier worker that re-runs the evals, as swarmD's own team does today." },
  ],
  chosen: "five",
  why:
    "The engine runs machine evals in the sandbox, so a verifier adds cost and no trust (swarmD DOC-3; the retro's verifier " +
    "cost under 1%, but only because it ran nothing it could not run). The book is designed, so there is no design stage to " +
    "staff. The scout reads PostHog, which matters only once staging runs (B5). The adversary exists because a writer " +
    "followed by an adversarial reviewer found real errors in every money file reviewed (HANDOFF lessons).",
  source: by(`${SWARMD} apps/docs/content/docs/decisions.mdx (DOC-3); HANDOFF.md (lessons); docs/spec/40-capxul-team.md`),
  affects: [f.system_capxul, ...MONEY],
});

export const decision_swarm_money = defineDecision({
  id: "swarm.money",
  title: "Every task of the seven money lanes, and B0's once-only step, gets the adversary",
  question: "Which tasks get the adversarial reviewer as a second checker?",
  options: [
    {
      label: "seven-lanes",
      text:
        "Every task in the payments, books, banking, requests, payroll, budgets and approvals lanes, and step B0.once (an " +
        "activity's side effect lands once). tools/plan-tasks.ts sets checkers to [reviewer, adversary] and the label money.",
    },
    { label: "six", text: "The six concepts HANDOFF names, without approvals." },
    { label: "risk-flag", text: "Only operations whose acceptance moves money, chosen per operation." },
  ],
  chosen: "seven-lanes",
  why:
    "The goal prompt's list includes approvals: every money movement is signed through it. A per-operation choice is a " +
    "judgment made 215 times; the lane is the unit the code and the reviewer's checklist share. B0.once proves the property " +
    "every money path rests on.",
  source: by("docs/mission/initializer.md (How to work: the money concepts); HANDOFF.md (lessons); tools/plan-tasks.ts MONEY"),
  affects: MONEY,
});

export const decision_swarm_pacing = defineDecision({
  id: "swarm.pacing",
  title: "At most four pairs in flight, six agents at once, one task per lane",
  question: "How many workers run at once, given the usage lessons and the retro's numbers?",
  options: [
    {
      label: "four-pairs",
      text:
        "Stage 1: at most 4 pairs in flight and 6 worker assignments running at once, plus the manager: a pair runs its maker " +
        "and its checkers in turn, and a money pair's two checkers run together. One task in flight per lane. Start at 2 pairs " +
        "for B3, whose pilot closure is narrow; go to 4 when two pairs in a row converge within budget. Worker concurrency: " +
        "builder 4, reviewer 4, adversary 2, diagnoser 1, researcher 1, under a manager-level cap of 6 (a needed brief). " +
        "Stage 0: at most 2 pairs (3 agents at most), because there the limit is the subscription's usage window, not the " +
        "agent count; Mission Control starts no pair it expects to outlast the window, and moves to 3 pairs only when a window " +
        "has ended with usage left twice in a row.",
    },
    { label: "sixteen", text: "As many as the frontier allows." },
    { label: "one", text: "One pair at a time." },
    { label: "four-at-stage-0", text: "4 pairs and 6 agents at stage 0 too, as the goal prompt's 4-to-6 line says." },
  ],
  chosen: "four-pairs",
  why:
    "Sixteen agents at once spent a five-hour window in 36 minutes: the window holds about 576 agent-minutes, about 2 agents " +
    "busy for all 5 hours. Six agents spend it in about 1.6 hours and then wait 3.4 with nothing running, doing no more work " +
    "and losing what each agent had not written when the window closed; so stage 0 runs 2 pairs. At stage 1 the limits are " +
    "money and the providers': the anthropic key's rate limits, and the gateway, which is a CLIProxy over a subscription " +
    "with its own window, whose exhaustion is a provider signal that pauses the makers. The retro's healthy task took 16 " +
    "active minutes and $0.77, a long one 11 minutes a round: 4 pairs keep about 6 agents busy. After B3 the frontier is 104 " +
    "tasks over 22 lanes, so one task per lane costs no parallelism and keeps lane branches free of conflicts.",
  source: by(`HANDOFF.md (lessons that save usage); ${RETRO} (per mission, per ticket); ${SWARMD} docs/planning/sitrep-2026-11-08.md (gateway: CLIProxy); tools/plan-tasks.ts (frontierAfterB3 104, 22 lanes)`),
  affects: [f.system_capxul, decision_system_layout],
});

// ── the task tree ───────────────────────────────────────────────────────────────────────────

export const decision_swarm_task_tree = defineDecision({
  id: "swarm.task-tree",
  title: "The task tree is derived from the book by tools/plan-tasks.ts",
  question: "Who writes the build's tasks, their evals and their order?",
  options: [
    {
      label: "derived",
      text:
        "tools/plan-tasks.ts derives every task from the records: milestones and their steps, a lane per concept, and in each " +
        "lane its door, processes, operations and the rpcs and helper flows no operation of its lane owns, plus integrations " +
        "and journeys. A task's key is its record's key. Its evals are the book's eval ids. Its needs come from the links. " +
        "docs/mission/tasks.json is regenerated with the book and checked (--check); it holds the tasks and no counts over " +
        "the book, so lanes that change different tasks regenerate it without a conflict. At stage 1 the ledger reconciles its " +
        "tasks from it in code at each move of integration/build (SD-2); the file is about 700 KB, too large for a model to " +
        "reconcile by reading. Nothing else opens a task, except a defect (from a finding, a red head or a person), a review " +
        "task from an answer, and the children a split creates (swarm.hand-tasks).",
    },
    { label: "manager-writes", text: "The manager reads the book and opens tasks as it goes." },
    { label: "hand-plan", text: "A hand-written plan of missions, as swarmD's own team uses issues." },
  ],
  chosen: "derived",
  why:
    "The link graph is the work plan (docs/design-book.md, in the factory). A manager writing tasks is the freestyling this " +
    "design removes, and a hand plan drifts from the book on the first record change. Deriving it gives every operation " +
    "exactly one task and every eval exactly one owner, and the checks fail the moment either stops being true.",
  source: by("docs/design-book.md (in the factory); tools/plan-tasks.ts; docs/mission/tasks.json"),
  affects: [f.system_capxul, decision_system_build_order],
});

export const decision_swarm_task_unit = defineDecision({
  id: "swarm.task-unit",
  title: "The operation is the unit of work; a task is split only on a signal",
  question: "How big is a task, and what does an operation task own?",
  options: [
    {
      label: "operation",
      text:
        "One operation is one task. It owns its own evals (acc, ret, ref, evt, spn, bud, doc, des), the evals of the flow that " +
        "implements it, and those of the rpcs only its lane reaches that no earlier task of the lane owns. The door, each " +
        "process and each shared rpc is its own task. A task too big to converge is split by decide (split) into children " +
        "that each carry part of its evals; it is never split in advance.",
    },
    { label: "area", text: "One task per old area, as missions." },
    { label: "eval", text: "One task per eval." },
  ],
  chosen: "operation",
  why:
    "The retro's root cause was a brief that was several missions in one, and its decision D3 makes the unit an operation " +
    "with its evals. The book is that unit already. Smaller than an operation tangles one behaviour across pairs; the median " +
    "operation task has 16 evals, the largest (payment.send) 38, most of them mechanical.",
  source: by(`${RETRO} (D3, root causes); ${SWARMD} apps/docs/content/docs/zen.mdx (rule 3); docs/mission/tasks.json`),
  affects: [f.system_capxul],
});

export const decision_swarm_rpc_ownership = defineDecision({
  id: "swarm.rpc-ownership",
  title: "An rpc belongs to the first task of its own lane; a shared one is its own task",
  question: "An rpc can be stepped by several operations, some in other lanes. Which task owns its evals?",
  options: [
    {
      label: "own-lane-first",
      text:
        "If only operations or helper flows of the rpc's own concept reach it, the first of them in lane order (critical, " +
        "normal, low, then id; operations before helper flows) owns it, and the others need that task. If another lane reaches " +
        "it, or nothing does, it is its own rpc task in its lane. So a need never runs between two operations of different lanes.",
    },
    { label: "first-anywhere", text: "The first operation anywhere that reaches it." },
    { label: "door", text: "Every rpc belongs to its concept's door." },
  ],
  chosen: "own-lane-first",
  why:
    "An rpc's code lives in its concept's folder, so only its lane may write it. Owned by an operation of another lane, two " +
    "lanes would each wait on the other's operation and the graph could cycle. In the door, every rpc would wait on the " +
    "door, and the door would grow to a lane. On this book 17 rpcs are their own tasks.",
  source: by("tools/plan-tasks.ts; system.layout (src/<concept>/ mirrors the book); docs/mission/tasks.json"),
  affects: [decision_system_layout],
});

export const decision_swarm_process_order = defineDecision({
  id: "swarm.process-order",
  title: "A durable process comes after its door and before what starts it",
  question:
    "An operation's acceptance often needs the process its rpc starts (a Payment settles), while the process's wake evals " +
    "need something to wake it. Which task needs which?",
  options: [
    {
      label: "door-process-operation",
      text:
        "A process needs its own door, the doors of what it reads, writes and invokes, and its integrations. An operation, rpc " +
        "or flow needs every process of its own or an earlier layer that its rpcs start or wake, directly or through the " +
        "transitions they drive. A process of a later layer that reacts to it (a notice, an activity note) needs the task that " +
        "owns the rpc instead. The harness wakes a process for its own evals through the engine's routing by key, as B0 proves.",
    },
    { label: "process-last", text: "Processes after every operation of their concept." },
    { label: "together", text: "A process and the operations that start it as one task." },
  ],
  chosen: "door-process-operation",
  why:
    "Process last leaves the operations' acceptance failing until the end of the lane. One task for both makes the payment " +
    "lane's largest task larger. Ordering by layer keeps the graph acyclic: a reacting process never holds back the " +
    "operation it reacts to.",
  source: by("rules.process-wakeups; docs/mission/initializer.md (B0: route by keys); tools/plan-tasks.ts"),
  affects: [decision_system_build_order],
});

export const decision_swarm_events_not_needs = defineDecision({
  id: "swarm.events-not-needs",
  title: "An event or chain event is never a need; a later layer's table is",
  question: "Does a task wait for the task that sends an event it reacts to?",
  options: [
    {
      label: "catalogue",
      text:
        "No. Events come from the generated telemetry catalogue (B1), so a task builds against an event before its sender " +
        "exists. A process triggered by an earlier layer's transition needs that layer's door. One that reads a later layer's " +
        "table (notices' equity processes read equity's rounds) is scheduled in that later layer, in its own lane " +
        "(swarm.layers), and plan-tasks labels it after:<lane>.",
    },
    { label: "sender", text: "A reacting task needs the task whose code sends the event." },
  ],
  chosen: "catalogue",
  why:
    "system.build-order lets a lane build against equity's events before equity exists. A need on every sender would make " +
    "notices wait for every concept and pull equity forward. A read of a table is different: it needs the table to exist.",
  source: by("system.build-order (a lane may build against their events); books/target/notices/equity.ts (reads fundraise rounds)"),
  affects: [decision_system_build_order, f.concept_notices, f.concept_equity],
});

export const decision_swarm_layers = defineDecision({
  id: "swarm.layers",
  title: "Layers from the concept map, equity last; a need never points at a later layer",
  question: "How does the task tree keep system.build-order?",
  options: [
    {
      label: "checked",
      text:
        "A task's layer is its concept's dependsOn depth, with equity moved last; integrations come before every concept and " +
        "journeys after. plan-tasks fails if the computed layers differ from the decision's list, or if a task needs a task in " +
        "a later layer, except that a need on the last layer's tasks moves the needing task into that layer (labelled " +
        "after:<lane>). Layers order, they do not gate: a task starts when its own needs are done.",
    },
    { label: "gate", text: "A lane starts only when every lane of the layer below is done." },
  ],
  chosen: "checked",
  why:
    "Gating by layer serialises 14 layers for no reason: each need the links name is already there. Checking the layers " +
    "catches a record change that would make a lane wait on a later one, which is what the decision forbids.",
  source: by("system.build-order; tools/plan-tasks.ts (BUILD_ORDER, the layer check)"),
  affects: [decision_system_build_order],
});

export const decision_swarm_pilots = defineDecision({
  id: "swarm.pilots",
  title: "Pilots: the critical operations, the setup flow, the world builder's commands",
  question: "Which tasks are B3's pilots, and what may run before B3 is done?",
  options: [
    {
      label: "critical-closure",
      text:
        "The pilots are the book's critical operations (auth.login, auth.verify, account.retry, payment.send), the web app's " +
        "setup flow client.account.setup, which starts an Account's setup (accounts.setup-in-web-app), and the devnet " +
        "commands the world builder runs (read by plan-tasks from the worlds' steps, plus the builder's own snapshot save " +
        "and restore: 9 on this book). Their closure, every task they need, needs only the spine and the harness; every " +
        "other lane task needs the whole of B3, including the concepts' line budgets. On this book the closure is 46 tasks. " +
        "A pilot eval whose world's steps run an operation not built yet reads unverifiable, naming the world, and " +
        "ms:B3/pilots excepts it; worlds are not needs.",
    },
    { label: "three-ops", text: "Three operations named by hand, everything else after B3." },
    { label: "world-needs", text: "Make every world a refusal starts from a need, so the pilots' every eval can pass in B3." },
  ],
  chosen: "critical-closure",
  why:
    "The goal prompt names sign in, set up an Account and send a payment; the book marks exactly those critical. The pilots " +
    "cannot pass without their doors, processes and integrations, so the closure is the real pilot, and the line budgets " +
    "measured on it are set before the other tasks start. Without the dev commands no world can be built at all, and " +
    "system.build-order puts devnet's own dev commands alongside the harness; as devnet's layer they would wait for B4's " +
    "layer 13. payment.send's refusals start from org-with-budgets, whose steps create departments: making worlds needs " +
    "would pull organizations' and budgets' operations, most of B4, into B3.",
  source: by("docs/mission/initializer.md (B3); system.build-order; books/target/devnet/worlds.ts (steps, the builder); tools/plan-tasks.ts (WORLD_OPS, pilot-closure)"),
  affects: [decision_system_size],
});

export const decision_swarm_milestone_evals = defineDecision({
  id: "swarm.milestone-evals",
  title: "Milestone exits are ms: evals; only the root has a person eval",
  question:
    "A ledger task is done when its evals pass, and a task with none reads done at once. The milestones' exits are not " +
    "book evals. How are they checked?",
  options: [
    {
      label: "ms-evals",
      text:
        "Each exit line of a milestone step is an eval ms:<milestone>/<slug> with its claim, listed in tasks.json and by the " +
        "runner's catalogue (B2 lists them beside the book's). Steps also own the book's system evals (sys:generated in B1; " +
        "env:devnet and the time invariants in B3; env:staging in B5). The root task carries ok:capxul, decided by the owner. " +
        "A milestone is accepted by its exit evals; it needs no sign-off to let the next start.",
    },
    { label: "ok-each", text: "An ok:<milestone> person eval on every milestone." },
  ],
  chosen: "ms-evals",
  why:
    "A person eval on each milestone blocks the next milestone on a sign-off the goal prompt does not ask for. Exit lines as " +
    "evals are runnable, and the portal shows them where it shows acceptance.",
  source: by("docs/mission/initializer.md (order of work, exits); docs/spec/30-capxul-evals.md (ok:, sys:); swarmD the-record (done)"),
  affects: [f.system_capxul],
});

// ── GitHub, the gate, the merge ─────────────────────────────────────────────────────────────

export const decision_swarm_branches = defineDecision({
  id: "swarm.branches",
  title: "Branch lane/<concept> carries one task at a time into integration/build",
  question: "On which branch does a pair work, and where does its pull request go?",
  options: [
    {
      label: "lane-branch",
      text:
        "The lane's branch lane/<concept> is cut from the head of integration/build when the lane's next pair starts, carries " +
        "that one task, and its pull request goes into integration/build; it is squash-merged and deleted, then cut again for " +
        "the next task. Integrations use lane/integrations and journeys lane/journeys. Milestone steps use ms/<step>, " +
        "for example ms/b1.data. Review answers use review/<decision>.",
    },
    { label: "task-branches", text: "One branch per task under lane/<concept>/<task>, several pairs per lane." },
    { label: "two-level", text: "Task PRs into a long-lived lane branch, and the lane into integration/build later." },
  ],
  chosen: "lane-branch",
  why:
    "system.layout names lanes lane/<concept> merged by pull request into integration/build; git cannot hold lane/x and " +
    "lane/x/y at once. One task per lane matches the pacing and keeps two pairs off one concept's folder. Two levels make " +
    "every downstream lane wait for a whole upstream lane and review each change twice.",
  source: by("system.layout; docs/mission/tasks.json (frontier); the old work contract's lanes (/home/user/factory docs/agents/work-contract.md)"),
  affects: [decision_system_layout],
});

export const decision_swarm_merge = defineDecision({
  id: "swarm.merge",
  title: "Only the manager merges, through the release gate",
  question: "Who merges a pair's pull request, on what condition, and who merges integration/build into main?",
  options: [
    {
      label: "gate",
      text:
        "The manager, in code, when the pair converges: every checker approves and no machine eval failed at the version; " +
        "unverifiable evals are listed under After merge on the pull request and do not block (the retro's D7); GitHub's " +
        "required checks are green. It squash-merges into integration/build. At a milestone's exit it opens and merges the " +
        "pull request from integration/build into main. No worker holds pulls.merge, and the manager's grant allows only the " +
        "bases integration/build and main (swarmD #85). No sandbox can push integration/build or main either: a maker's push " +
        "reaches only its task's branch, and a checker's, the diagnoser's and the researcher's sandboxes carry no write " +
        "credential (SD-28). A production deploy is the owner's step.",
    },
    { label: "builder", text: "The builder merges its own pull request once checks pass, as swarmD's team first did." },
    { label: "person", text: "A person merges every pull request." },
  ],
  chosen: "gate",
  why:
    "The builder merging, and a merge waiting on lines nothing could run, were two of the retro's failures. A person merging " +
    "430 pull requests is the bottleneck the swarm exists to remove. GitHub rulesets need a paid plan on that repository, so " +
    "the connector's base allowlist is what keeps the manager off other branches. #85 guards only the connector's merge: " +
    "every sandbox reaches github.com through an egress that adds the App's installation token, which can write every " +
    "branch, so without branch protection a builder's git push to integration/build is a merge outside the gate, the " +
    "retro's failure by another door. SD-28 closes it in the egress.",
  source: by(`${RETRO} (D7); ${SWARMD} sitrep-2026-11-08.md (#85); the-record.mdx (release gate); connect-github.mdx (git push works); server sandbox/service.ts (no ref check)`),
  affects: [decision_system_layout],
});

export const decision_swarm_head_red = defineDecision({
  id: "swarm.head-red",
  title: "A red integration head freezes merges until a fix or a revert lands",
  question: "What happens when integration/build goes red after a merge, or an eval that passed there fails?",
  options: [
    {
      label: "freeze-and-fix",
      text:
        "The manager stops merging other pairs (they keep working), opens a critical defect task in the lane of the merge " +
        "that broke it, with the failing evals, and starts its pair first. If that pair has not converged after one round, " +
        "its maker reverts the merge instead, and the original task reopens.",
    },
    { label: "ignore", text: "Keep merging; the next run will show it." },
    { label: "revert-first", text: "Revert every red merge at once." },
  ],
  chosen: "freeze-and-fix",
  why:
    "Every pair's checks run against the integration head; a red head makes every later verdict noise. Reverting at once " +
    "throws away a change that is often one line from green; one round bounds the cost.",
  source: by("docs/mission/initializer.md (the build rules hold at every commit); docs/spec/10-swarmd-ledger.md (roll-up at ref moves)"),
  affects: [f.system_capxul],
});

export const decision_swarm_scope = defineDecision({
  id: "swarm.scope",
  title: "A task changes only its paths, and never an eval",
  question: "What may a maker change, and how is a change that weakens an eval stopped?",
  options: [
    {
      label: "paths-and-guard",
      text:
        "Each task lists its paths: for a lane task books/target/<concept>/ and src/<concept>/ in the backend and the SDK, " +
        "plus packages/indexer/ for indexing (Ponder writes its views) and packages/devnet/ for devnet (its supervisor and " +
        "world builder). Every task may also change the regenerated outputs that tasks.json lists (docs/mission/tasks.json " +
        "and every package's src/generated/), but only to what the generators write at its version, which generate:check and " +
        "plan-tasks --check prove; so a book-first change carries its outputs in the same pull request. The gate refuses a " +
        "change outside them, any change to packages/book or packages/evals from a lane task, and a submitted version whose " +
        "catalogue lacks one of the task's eval ids. tools/check-scope.ts, step B3.sandbox (ms:B3/scope), is that part of the " +
        "gate; at stage 0 Mission Control runs git diff --name-only against the paths before any checker starts. A record may " +
        "change only book first, with a decision record. A change needed elsewhere is a finding.",
    },
    { label: "trust", text: "No paths; the reviewer catches it." },
    { label: "concept-folders-only", text: "Only the concept's own folders, with generated files and the plan left to a later task." },
  ],
  chosen: "paths-and-guard",
  why:
    "A reviewer never weakens an eval (goal prompt), and the old factory refused a handback that touched a grader or a path " +
    "outside its ticket; both rules are cheaper as a gate than as a review finding. The concept folders alone would refuse " +
    "every book-first change, which must regenerate src/generated/ and tasks.json, and would leave indexing's and devnet's " +
    "code out of their own lanes. A failed gate costs no round, so a scope that refuses needed work loops until the budget " +
    "signal.",
  source: by("/home/user/factory apps/factory/src/ticket.ts (files, graders); system.layout (indexer, devnet, src/generated/); concept_indexing (Ponder writes it); docs/design/tooling.md (check)"),
  affects: [decision_system_layout],
});

export const decision_swarm_findings = defineDecision({
  id: "swarm.findings",
  title: "A finding outside a task's paths becomes a defect task in its own lane",
  question: "A checker or maker finds a problem the task does not own. What happens to it?",
  options: [
    {
      label: "defect-task",
      text:
        "The checker records it as an advisory finding naming its path. The manager opens a defect task in the lane that owns " +
        "the path (a book change if it is a record), with the evals it threatens, at normal priority, or critical if it is " +
        "red at the integration head. The current task does not grow.",
    },
    { label: "fix-here", text: "The maker fixes it in the current pull request." },
  ],
  chosen: "defect-task",
  why: "Scope added mid-flight was one of the retro's causes of non-convergence; the old work contract routed findings by owned paths.",
  source: by(`${RETRO} (what did not work 5); /home/user/factory docs/agents/work-contract.md (findings)`),
  affects: [f.system_capxul],
});

export const decision_swarm_watch_tasks = defineDecision({
  id: "swarm.watch-tasks",
  title: "A task with evals but no paths is watched, never paired",
  question:
    "The journeys, B3.pilots and B5.week own evals but no code: their work is other tasks'. A pair for one would have a " +
    "maker who may change nothing, and a failed gate costs no round. How are they run?",
  options: [
    {
      label: "watch",
      text:
        "tools/plan-tasks.ts gives a working task with no paths the label watch, no checkers and no budget. The master never " +
        "pairs it: it is done when its evals pass at the integration head, by the machine runs every ref move makes. When its " +
        "needs are all done and one of its evals still fails or errors, the master assigns the diagnoser outside a pair, and " +
        "opens a defect in the lane the diagnosis names. A watch task gets no task card at stage 0.",
    },
    { label: "pair-anyway", text: "Pair them like any task; the reviewer finds nothing to check." },
    { label: "give-paths", text: "Give each journey the paths of every lane its steps touch." },
  ],
  chosen: "watch",
  why:
    "A maker that may change nothing fails its gate on any change and passes it on none, so the pair loops or idles until " +
    "the budget signal: $75 over the 15 such tasks for no work. Giving a journey every lane's paths would let one task " +
    "change 10 concepts at once, which swarm.scope and the one-task-per-lane rule exist to stop. Its failure is a defect " +
    "in the lane that owns the cause.",
  source: by("tools/plan-tasks.ts (watch: 13 journeys, B3.pilots, B5.week); .github/ISSUE_TEMPLATE/task-journey.yml (\"a journey's paths may be empty\", now removed); swarmD reference/pairs.md (a failed code level doesn't count)"),
  affects: [f.system_capxul],
});

export const decision_swarm_merged_tasks = defineDecision({
  id: "swarm.merged-tasks",
  title: "After a merge or a stop a task leaves the frontier; dependents start at merge",
  question:
    "In swarmD's roll-up a task is done only when every own check passes, or is unverifiable and waived by a person at " +
    "that version; until then it reads open, and every task that needs it reads blocked. A merged operation task with an " +
    "eval whose world is not built yet would be paired again at once, and its dependents would wait for a waiver. A " +
    "stopped task would be paired again at once too. What does the master do with each?",
  options: [
    {
      label: "leave-the-frontier",
      text:
        "A task whose last pair merged, and none of whose evals fails or errors at the integration head, is merged: never " +
        "paired again, and its unverifiable evals wait for their worlds, posted by the machine runs at later heads. A need on " +
        "it is met at its merge (SD-27: needs until merged), not at its done. If one of its evals later fails or errors at the " +
        "head, it returns to the frontier with what is left of its budget, or, if it had passed there, the red-head rule. A " +
        "stopped task leaves the frontier until what stopped it is done: its book change or defect task, its matter, or the " +
        "fix its diagnosis names; then it is paired once more with what is left of its budget, and a second stop raises a " +
        "spending matter. The unverifiable evals still open at B4's end go to the waive list as one matter, never one by one.",
    },
    { label: "as-swarmd", text: "Keep swarmD's roll-up as it is: re-pair open tasks, and waive each unverifiable eval as it comes." },
    { label: "never-unverifiable", text: "Hold every merge until every eval of the task can run." },
  ],
  chosen: "leave-the-frontier",
  why:
    "Worlds are built by running operations (devnet.worlds), so an early operation's refusal often has no world until later " +
    "lanes exist: as swarmD's roll-up stands, its task is re-paired for nothing and the lanes after it wait on a person, " +
    "the bottleneck matters-dont-block removes. A stopped task re-paired at once is #46 again with a fresh $5. Holding " +
    "merges for every world serializes the build behind devnet, layer 13 of 14.",
  source: by(`${SWARMD} reference/ledger.md (roll-up); how-to/run-a-pair.mdx (waive, or leave open); books/target/devnet/worlds.ts (steps are capxul commands); ${RETRO} (#46)`),
  affects: [f.system_capxul],
});

// ── the pair ────────────────────────────────────────────────────────────────────────────────

export const decision_swarm_pair_limits = defineDecision({
  id: "swarm.pair-limits",
  title: "Five rounds at most, $5 a task, a fresh maker and a delta review each round",
  question: "What are the pair settings for every Capxul task?",
  options: [
    {
      label: "retro-settings",
      text:
        "maxRounds 5 (a hard stop; the round signal fires at 3), budgetUsd 5 (the budget signal at $2.50, and at $5 the pair " +
        "stops spending until decide), freshMakerEachRound true, deltaReview true (the adversary also reads the whole of each " +
        "money-path file the delta touches), staleAfterMinutes 30. The gate (L0) runs before any checker, and a failed gate " +
        "costs no round but does cost money, so the budget signal bounds a gate that keeps failing. The limits are the task's, " +
        "not one pair's: a later pair on the same task starts with the task's spend and rounds so far (its budgetUsd is what " +
        "is left), and a stopped task leaves the frontier until what stopped it is done (swarm.merged-tasks).",
    },
    { label: "unbounded", text: "No round limit; the reviewer decides when it is done." },
    { label: "three-and-ask", text: "Three rounds, then ask a person." },
  ],
  chosen: "retro-settings",
  why:
    "These are the retro's D1, D5 and D6 and swarmD's build template defaults. #46 ran four rounds for $4.92 without " +
    "converging, its builder's context grew to 130k tokens a step and its reviewers re-read 2,900 lines each round.",
  source: by(`${RETRO} (D1, D5, D6; #46 round by round); ${SWARMD} reference/templates.md (build defaults)`),
  affects: [f.system_capxul],
});

export const decision_swarm_signals = defineDecision({
  id: "swarm.signals",
  title: "Each signal has a default decision; diagnose before spending more",
  question: "How does the master answer each signal, so that decide is not improvised?",
  options: [
    {
      label: "table",
      text:
        "round 3, regression, defect_in_fix, or budget at half: diagnose. A diagnosis of execution: fresh_maker, with the " +
        "diagnosis as the note, on the strong model. Of plan: split into children by the diagnosis if the evals divide, else " +
        "open a book change task in the owning lane and stop the pair. budget at all of it: split, or stop with a reason. " +
        "stalled: read the sandbox and the assignment, then continue or fresh_maker. provider: nothing (code paused it). " +
        "question: answer it from the book or the ledger, or raise a matter only for what the goal prompt brings to a person.",
    },
    { label: "free", text: "The master judges each signal freely." },
  ],
  chosen: "table",
  why:
    "The retro's D1 and D2: diagnose on signals, the manager decides, and nobody hears 'we tried three times'. A table " +
    "makes the master's one decision repeatable and testable against the swarmD software-factory scenarios.",
  source: by(`${RETRO} (D1, D2); ${SWARMD} concepts/pairs.mdx (signals, decide); domains/software-factory.mdx (scenarios 3, 4)`),
  affects: [f.system_capxul],
});

export const decision_swarm_handback = defineDecision({
  id: "swarm.handback",
  title: "A maker's handback is swarmD's submit and handover, never a free report",
  question: "What does a maker return when it finishes a round?",
  options: [
    {
      label: "submit-handover",
      text:
        "The Handback in docs/design/swarm.md section 4: submit (the version, the findings it addresses, a note of at most 600 " +
        "characters) and, when the engine asks, a handover of at most 1,500 characters in four fixed parts: done, left, " +
        "decisions, where to look. The pull request body follows the same parts. A maker never reports done; verdicts do.",
    },
    { label: "report", text: "Today's report ready with a result schema per worker." },
  ],
  chosen: "submit-handover",
  why: "swarmD's planned pair messages replace report ready for makers; the retro's brief 02 asks for the same four parts.",
  source: by(`${SWARMD} reference/pairs.md (messages); docs/planning/swarm-retro-briefs/02-fresh-rounds.md`),
  affects: [f.system_capxul],
});

export const decision_swarm_review_evals = defineDecision({
  id: "swarm.review-evals",
  title: "No rev: evals; the reviewer posts the des: verdicts",
  question: "Spec 40 gave each build task an agent eval rev:<task>. Does a task carry one?",
  options: [
    {
      label: "convergence",
      text:
        "No. The checkers' approval is the pair's convergence condition in swarmD's engine, so a rev: eval would record it " +
        "twice. The book's agent eval des:<operation> (its text and its behaviour agree) is the reviewer's to post, as the " +
        "named checker of that eval.",
    },
    { label: "rev", text: "Keep rev:<task> on every task." },
  ],
  chosen: "convergence",
  why: "One fact in one place: the engine counts approvals; the ledger's agent evals are those the book derives.",
  source: by("docs/spec/40-capxul-team.md (rev:K-41); swarmD concepts/pairs.mdx (converged)"),
  affects: [f.system_capxul],
});

// ── the master's state, view and escalation ─────────────────────────────────────────────────

export const decision_swarm_state = defineDecision({
  id: "swarm.state",
  title: "The ledger and the repository hold the state, not the manager's conversation",
  question: "Where does the master's durable state live, so that a reset or an upgrade loses nothing?",
  options: [
    {
      label: "ledger-and-repo",
      text:
        "The ledger holds tasks, assignments, pairs, messages, findings, verdicts, matters, entries and refs. The repository " +
        "holds the book, its decisions, tasks.json, the code and the pull requests. The manager's conversation holds only the " +
        "current wake: it rereads its board each time, and it is rotated daily (a needed brief). Before the ledger runs, " +
        "tasks.json, progress.md and GitHub hold it.",
    },
    { label: "conversation", text: "The manager remembers what it decided in its conversation." },
  ],
  chosen: "ledger-and-repo",
  why:
    "swarmD's manager is always on for months; a conversation that grows with every signal is the builder's 130k-token step " +
    "again, at the top. The ledger was designed so that the conversation does not have to hold the record.",
  source: by(`${SWARMD} concepts/managers-and-workers.mdx (context small on purpose); concepts/the-record.mdx; ${RETRO} (context)`),
  affects: [f.system_capxul],
});

export const decision_swarm_artifact = defineDecision({
  id: "swarm.artifact",
  title: "The master's board: lanes by layer, pairs, blocked, matters, spend, heads",
  question: "What does the master's artifact show, and in what order?",
  options: [
    {
      label: "board",
      text:
        "Header; heads (integration/build and main: commit, last machine run, CI); lanes by layer (tasks by state, score, " +
        "stands, spend against the lane budget); pairs in flight (round, state, spend, last signal); blocked tasks and why; " +
        "the frontier; matters waiting for a person; spend against the envelope; timeline. Section 3 of docs/design/swarm.md " +
        "gives each section's query. The portal links to it and does not repeat it.",
    },
    { label: "build-default", text: "The build template's default sections only." },
  ],
  chosen: "board",
  why:
    "The default lacks why a task is blocked, the budget and the heads, the three things the retro had to assemble by hand " +
    "from 16 ticket reads. The portal is the design's view; the board is the run's.",
  source: by(`${SWARMD} reference/templates.md (sections); ${RETRO} (health signals); docs/design/portal.md (portal.artifact-boundary)`),
  affects: [f.system_capxul],
});

export const decision_swarm_escalation = defineDecision({
  id: "swarm.escalation",
  title: "Only the goal prompt's four kinds reach a person, each as a decision pack",
  question: "What does the master bring to a person, and in what shape?",
  options: [
    {
      label: "four-kinds",
      text:
        "An open product or architecture decision the book does not settle; a judgment the book flags for review; an " +
        "irreversible step (old staging off, a production deploy, real money); what only the owner can provide (accounts, " +
        "keys, spending, including the build's spend envelope). Each is a matter in the decision-pack shape: the question, two " +
        "to four graded options, a recommendation and what stands meanwhile. Everything else the master decides and records.",
    },
    { label: "ask-when-stuck", text: "Ask a person whenever a pair does not converge." },
  ],
  chosen: "four-kinds",
  why:
    "The goal prompt's Bring list, and the retro's D2: the manager asks only when it needs the person. A stuck pair is a " +
    "diagnosis, not a question.",
  source: by(`docs/mission/initializer.md (Bring list); ${RETRO} (D2); swarmD domains/software-factory.mdx (scenario 7)`),
  affects: [f.system_capxul],
});

export const decision_swarm_matters_dont_block = defineDecision({
  id: "swarm.matters-dont-block",
  title: "A decision matter does not block; its recommendation stands until answered",
  question: "Does the build wait while a decision pack is open?",
  options: [
    {
      label: "recommendation-stands",
      text:
        "A decision matter on a reversible choice records the recommendation in the book as the chosen option, with the matter " +
        "as its review, and the build goes on. Only an irreversible step, a missing key or account, or spending past the " +
        "envelope is raised as a question matter, which blocks its task (and only its task) until answered.",
    },
    { label: "block", text: "Every matter blocks its task until answered." },
  ],
  chosen: "recommendation-stands",
  why:
    "The goal prompt: each recorded choice stands, and the build follows it, until changed, and the change goes into the " +
    "record first. In swarmD's ledger only a question matter blocks a task, which fits.",
  source: by("docs/mission/initializer.md (Bring list: each recorded choice stands); swarmD reference/ledger.md (blocked)"),
  affects: [f.system_capxul],
});

export const decision_swarm_review_answers = defineDecision({
  id: "swarm.review-answers",
  title: "An answer from the portal's Review is a task taken before any other",
  question: "When the owner answers a judgment on the portal, how does it reach the book?",
  options: [
    {
      label: "review-task",
      text:
        "The answer (an issue labelled review, then a resolved matter) becomes a task of kind review on branch " +
        "review/<decision>, critical priority, taken at the next free slot: a builder applies it to the decision and every " +
        "record it ripples to, book first, and a reviewer confirms the records say what the answer says. plan-tasks then " +
        "updates the tasks that change.",
    },
    { label: "batch", text: "Collect answers and apply them at the next milestone." },
  ],
  chosen: "review-task",
  why: "The portal design takes review issues before any other work; an answer left unapplied leaves lanes building to the old choice.",
  source: by("docs/design/portal.md (Aaron's review flow, step 3)"),
  affects: [f.system_capxul],
});

export const decision_swarm_budget = defineDecision({
  id: "swarm.budget",
  title: "Budgets: $5 a task, a lane's is the sum of its tasks', and one envelope",
  question: "How is spend bounded and watched?",
  options: [
    {
      label: "task-lane-envelope",
      text:
        "Each task has $5 (D6), across every pair it ever gets: a re-paired task's pair gets what is left, and one past it " +
        "re-opens only by a raise of the task's budget recorded as a decide or a matter. A watch task has none: it never gets " +
        "a pair. A lane's budget is the sum of its tasks' budgets; the board shows spend against it and cost per done task. " +
        "The whole build has one envelope, set by the owner; at 75% of it the master raises a spending matter, and at 100% it " +
        "starts no new pair until answered. The manager's own spend is shown apart and kept under 10% of its pairs'. No daily " +
        "ceiling (D8).",
    },
    { label: "daily", text: "A daily ceiling for the namespace." },
    { label: "per-pair", text: "$5 for each pair, so a task re-paired after a stop starts again at $5." },
  ],
  chosen: "task-lane-envelope",
  why:
    "The retro's D6 and D8, and its finding that the router's own $0.44 belonged to no mission. A budget per pair would let " +
    "a stopped task, back on the frontier, spend $5 again on every new pair: #46 unbounded by another name. A lane sum " +
    "makes the plan's ceiling known before work starts: $1,950 over the 390 paired tasks on this book.",
  source: by(`${RETRO} (D6, D8, router cost); docs/mission/tasks.json (budgetUsd)`),
  affects: [f.system_capxul],
});

export const decision_swarm_sandbox = defineDecision({
  id: "swarm.sandbox",
  title: "One golden sandbox with the repository, the old system and a devnet snapshot",
  question: "What does a Capxul worker's sandbox hold, and how is a dead one kept from costing money?",
  options: [
    {
      label: "golden-devnet",
      text:
        "sandbox.repo of capxul-next on standard-3. prepare runs npm ci, clones the old system read-only for reference, and " +
        "from B3 builds the devnet's base snapshot; runner.setup restores it on each boot. Egress: the npm registry, " +
        "github.com with the App's token (for a maker, a push only to its task's branch; for the read-only roles, no write " +
        "credential: SD-28), and the chain RPC the devnet forks. A sandbox that fails to boot twice is a signal that pauses " +
        "the pair's spend (a needed brief), never a model's blocked report. A world saved with other backend code refuses to " +
        "restore, so a snapshot older than the integration head is rebuilt at boot; B3.sandbox measures the boot at a head " +
        "newer than the snapshot, and the golden snapshot is rebuilt (swarmd up) at each promotion to main.",
    },
    { label: "outside-devnet", text: "One long-lived devnet host per project, outside the sandboxes." },
  ],
  chosen: "golden-devnet",
  why:
    "The retro's first builder spent 3 hours blocked on dead sandboxes before 10 minutes of work. The devnet inside the " +
    "sandbox keeps each pair's world its own; step B3.sandbox measures it and keeps the outside host as the fallback.",
  source: by(`${RETRO} (#53: T-4, T-5); ${SWARMD} docs/planning/swarm-postmortem-2026-11-06.md (P7, O3); docs/spec/40-capxul-team.md (devnet)`),
  affects: [f.component_devnet, f.environment_devnet],
});

export const decision_swarm_skills = defineDecision({
  id: "swarm.skills",
  title: "Repository knowledge goes in skills, passed through to Pi",
  question: "Where does the knowledge every worker needs (the book, the evals, the layout, money paths) live?",
  options: [
    {
      label: "skills",
      text:
        "In skills folders in the repository's .swarmd/skills/ (book, evals, lane, money, old-system), each a SKILL.md a " +
        "worker loads when it needs it, through swarmD's planned skills field passed to pi-coding-agent's skill loader and " +
        "pi-agent-core's skills section. Prompts stay short and say only the role.",
    },
    { label: "prompts", text: "Put all of it in each worker's prompt." },
  ],
  chosen: "skills",
  why:
    "A prompt re-sends everything on every step; a skill is read when needed. swarmD's docs plan the field but nothing passes " +
    "skills through yet, though Pi supports them, so it is a needed brief.",
  source: by(`${SWARMD} concepts/managers-and-workers.mdx (skills); node_modules/@earendil-works/pi-coding-agent dist/core/skills.d.ts`),
  affects: [f.system_capxul],
});

// ── for Aaron ───────────────────────────────────────────────────────────────────────────────

export const decision_swarm_superset = defineDecision({
  id: "swarm.superset",
  title: "swarmD passes skills through now, and the rest of pi-durable later",
  question:
    "Aaron asks whether swarmD should pass through everything pi-durable gives an agent (a superset: skills, extension " +
    "sections, hooks), rather than choosing pieces. What should the build ask swarmD for?",
  options: [
    {
      label: "skills-now",
      text:
        "Skills now (the build needs them), and a general pass-through of pi-durable's extension sections later, each section " +
        "kind admitted with a review of what it can change, since an extension can alter a worker's prompt and tools.",
    },
    { label: "superset", text: "Pass through every pi-durable extension section and hook as it is, now." },
    { label: "none", text: "Neither; repository knowledge goes in the prompts." },
  ],
  chosen: "skills-now",
  why:
    "Skills are read-only knowledge and the build needs them at stage 1. A full superset is attractive but lets a definition " +
    "change what swarmD's built-in prompt and tool checks guarantee, so it deserves its own design in swarmD. This is " +
    "Aaron's call; the recommendation stands until he answers.",
  source: by(`the swarm design's brief, 8 November 2026; ${SWARMD} node_modules/@earendil-works/pi-durable dist/harness/prompt.d.ts (sections)`),
  affects: [f.system_capxul],
});

export const decision_swarm_checker_family = defineDecision({
  id: "swarm.checker-family",
  title: "Models are configured per role; OpenAI by default, Anthropic only when guarded",
  question:
    "Checkers run on another model family than makers. Aaron has a $10,000 OpenAI credit, pays DeepSeek per token up to $40 " +
    "a month, and has $200 a month of Anthropic. Which provider and model does each role use?",
  options: [
    {
      label: "configured-openai-first",
      text:
        "Routing is configuration, not code: each role names a provider and model in the project's swarm config, and each " +
        "provider has a monthly cap. Defaults: makers, the manager and the researcher on OpenAI (the credit); checkers and " +
        "the adversary on DeepSeek (another family, per token, capped at $40 a month); Anthropic only in guarded, " +
        "context-aware cases (a named escalation such as a stuck money task's diagnosis, opened by the manager with the " +
        "task's full context, logged, and capped at $200 a month), never on the build's ordinary path.",
    },
    {
      label: "gateway-and-anthropic",
      text:
        "Makers on gateway/gpt-6.1-sol, checkers and the adversary on anthropic/claude-sonnet-5-5, the manager and " +
        "researcher on anthropic/claude-haiku-5-5.",
    },
  ],
  chosen: "configured-openai-first",
  why:
    "Aaron, 8 November 2026: budgets are configurable; Anthropic is not used on the production path outside very well " +
    "guarded, context-aware situations ($200 a month); the $10,000 OpenAI credit carries the work; DeepSeek is cheap per " +
    "token but capped at $40 a month. A checker still runs on another family than its maker (swarmD's Zen, rule 5): " +
    "DeepSeek against OpenAI. Which model of each provider fills each role is configuration the master can tune within the caps.",
  source: "Aaron, 8 November 2026, in the build-preparation conversation",
  affects: [f.system_capxul],
});

export const decision_swarm_spend_envelope = defineDecision({
  id: "swarm.spend-envelope",
  title: "Budgets are configurable: per task, per lane, per provider per month",
  question:
    "The task tree's ceiling is $5 for each of its 390 paired tasks (its 15 watch tasks get no pair). How is the build's " +
    "spending bounded, and who sets the numbers?",
  options: [
    {
      label: "configured",
      text:
        "Every budget is configuration the master reads and the board shows: a per-task cap (default $5), a lane's budget " +
        "(the sum of its tasks'), an envelope for the whole build (default the plan's $1,950 ceiling plus a quarter for the " +
        "manager, diagnoses and defects, drawn from the OpenAI credit), and a monthly cap per provider (DeepSeek $40, " +
        "Anthropic $200, OpenAI set by Aaron within the $10,000 credit). Reaching 75% of any cap raises a matter; reaching " +
        "100% stops new work on that budget until Aaron raises it.",
    },
    { label: "fixed-2500", text: "A fixed $2,500 envelope for the build." },
  ],
  chosen: "configured",
  why:
    "Aaron, 8 November 2026: budgets should be configurable, and the providers have different limits ($10,000 OpenAI credit; " +
    "DeepSeek per token up to $40 a month; Anthropic $200 a month). The retro measured $0.77 for a small healthy task and " +
    "$4.92 for one that never converged, so about $1,000 is expected; the defaults stand until Aaron changes them.",
  source: "Aaron, 8 November 2026, in the build-preparation conversation",
  affects: [f.system_capxul],
});

export const decision_swarm_accounts = defineDecision({
  id: "swarm.accounts",
  title: "A capxul namespace, the GitHub App on both repositories, a room",
  question:
    "What must Aaron set up for stage 1, since only he can provide accounts and access?",
  options: [
    {
      label: "namespace-app-room",
      text:
        "A swarmD namespace capxul with Aaron as admin; the swarmd-agent GitHub App installed on AaronAbuUsama/capxul-next " +
        "(contents, issues, pull requests, checks) and on Xelmar-tech/infrastructure (contents read); branch protection on " +
        "main and integration/build (tooling.branch-protection), which on a private repository needs GitHub Pro (GitHub " +
        "refused it on swarmD's, #85): recommended, because without it nothing stops a sandbox's git push to either branch " +
        "until swarmD builds SD-28, and the release gate's CI check (SD-5) and #85 guard only the merge call; the provider " +
        "keys of swarm.checker-family; and the master's room: Pi at once, and a Slack channel once the app is connected.",
    },
    { label: "reuse-swarmd", text: "Run the build in the existing namespace swarmd beside swarmD's own team." },
  ],
  chosen: "namespace-app-room",
  why:
    "A namespace of its own keeps the build's spend, members and catalog apart from swarmD's team, and its metrics clean " +
    "for the stage 2 evidence. The App on the old repository lets a sandbox clone it for reference without a token in it.",
  source: by(`${SWARMD} apps/docs/content/docs/how-to/connect-github.mdx; docs/planning/sitrep-2026-11-08.md (team, namespaces)`),
  affects: [f.system_capxul],
});

// ── the templates (docs/design/swarm-templates.md) ───────────────────────────────────────────

const TEMPLATES_BY = "Claude, swarm templates, 8 November 2026";
const tby = (evidence: string) => `${TEMPLATES_BY}; evidence: ${evidence}`;

export const decision_swarm_templates = defineDecision({
  id: "swarm.templates",
  title: "Every artifact an agent produces has one template, field for field its schema",
  question:
    "Pull request bodies, handovers, reviews and briefs were prose each agent worded afresh in the old system and in " +
    "swarmD's first missions. How is each artifact written so that nothing is freestyled and code can read it back?",
  options: [
    {
      label: "one-template",
      text:
        "docs/design/swarm-templates.md gives each artifact one template whose fields are its schema's fields in " +
        "docs/design/swarm.md section 4, in the same order and with the same names. A GitHub body renders each field under " +
        "a fixed heading (### <Label>), a list one item per line, an empty field as _none_, so an issue form and a body " +
        "written through the API parse alike. A worker's answer is one typed message: at stage 0 its last message is one " +
        "fenced json block, at stage 1 the same object is its tool call. The schemas' limits hold (note 600, handover " +
        "1,500, finding 600, title 80). A worker's input is built from the plan, the book and the pair, never from memory. " +
        "A worker asks the manager, never a person: only the master raises a matter.",
    },
    { label: "guidance", text: "Say what each artifact should contain and let each agent word it." },
    { label: "json-only", text: "Every artifact is JSON only, with no rendered form for people." },
  ],
  chosen: "one-template",
  why:
    "On #46 the router merged on a condition it read from free-text verdicts, and missed the unverifiable lines (the " +
    "retro's D7). A fixed field order lets code (the mirror comments, the reconcile, the portal) read what an agent wrote, " +
    "and makes a missing part visible to a person. JSON alone is unreadable to whoever reviews a pull request on GitHub. A " +
    "worker that asks a person directly bypasses the four kinds that may reach the owner (swarm.escalation).",
  source: tby(`${RETRO} (D7, #46); ${SWARMD} dogfood/prompts/builder.md, reviewer.md; /home/user/factory/docs/agents/work-contract.md (comment markers)`),
  affects: [f.system_capxul, decision_swarm_handback, decision_swarm_escalation],
});

export const decision_swarm_task_cards = defineDecision({
  id: "swarm.task-cards",
  title: "Task cards: an issue per task in flight at stage 0, none at stage 1",
  question:
    "Every task comes from the plan, yet a task needs a thread where a person can steer it and see why it waits. What is " +
    "a GitHub issue form for a derived task for, and who opens one?",
  options: [
    {
      label: "cards-in-flight",
      text:
        "One issue form per kind that gets a pair (step, integration, door, process, rpc, flow, operation, review, defect) " +
        "renders TaskDef and its brief field for field. At stage 0 Mission Control opens a card from tasks.json when the " +
        "task's pair starts: it is the task's thread and holds the status card, edited in place, and it closes at the merge " +
        "or the drop. At stage 1 the ledger's task and the room thread replace it and no card is opened. The root, the " +
        "milestones and the lanes have no form: they are done by roll-up and never get a pair; nor do the watch tasks " +
        "(swarm.watch-tasks), the journeys among them. People open three forms only: a review answer, a decision pack and " +
        "a defect.",
    },
    { label: "pull-request-only", text: "No issue per task; the pull request is the task's only thread." },
    { label: "every-task", text: "An issue for each of the 438 tasks, opened at once from the plan." },
  ],
  chosen: "cards-in-flight",
  why:
    "At stage 0 there is no ledger task and no room thread, and a pull request exists only from the first submit, so a " +
    "pair waiting on a gate or a question has nowhere to show it. Cards for tasks in flight keep about six open at once; " +
    "438 issues would bury the three forms people use. At stage 1 a card would duplicate the ledger. Every working task in " +
    "tasks.json renders into its kind's form and parses back with no field lost (checked on all 405 before the journeys " +
    "became watch tasks; 390 get a pair, and so a card).",
  source: tby("docs/mission/tasks.json (390 paired tasks); .github/ISSUE_TEMPLATE/task-*.yml; swarmD concepts/rooms-and-roles.mdx (a thread per task, its status card)"),
  affects: [f.system_capxul, decision_swarm_task_tree],
});

export const decision_swarm_hand_tasks = defineDecision({
  id: "swarm.hand-tasks",
  title: "Keys and evals of the defect, review and split tasks opened outside the plan",
  question:
    "Only defects, review tasks and a split's children are opened outside the plan. The ledger derives done from a task's " +
    "checks, and refuses a check its catalogue lacks, so a task with no eval reads done at once. What are their keys and " +
    "their evals?",
  options: [
    {
      label: "keys-and-evals",
      text:
        "A defect is defect:<lane>/<slug> in the lane that owns the path, on that lane's branch; a red-head defect is " +
        "defect:<lane>/head-<7 hex>, critical. Its evals are existing ids that fail, error or are unknown at the integration " +
        "head, or that its finding names; they may also belong to a derived task, since one owner binds only the plan. A " +
        "finding that names no eval is advisory and opens nothing. A book change after a plan diagnosis is a defect labelled " +
        "book-change, whose evals are the stopped task's evals the record governs. A review task is review:<decision> on " +
        "review/<decision>; its eval is dec:<decision>/review, derived by the book from the review field D0 adds (it passes " +
        "when the review is accepted or changed) and owned by no derived task; until it exists, Mission Control counts a " +
        "review task done at its merge. A split's children (decide split, which drops the parent's own checks onto them and " +
        "keeps the parent open until they pass) are <parent key>/split-<n>, labelled from:split, with the parent's lane, " +
        "paths, checkers and what is left of its budget divided among them; every parent check goes to exactly one child, " +
        "and the reconcile keeps a split parent's checks on its children rather than restoring them from the plan.",
    },
    { label: "free-keys", text: "The master names each task it opens as it sees fit." },
    { label: "done-at-merge", text: "Hand-opened tasks carry no eval and are done when their pull request merges." },
  ],
  chosen: "keys-and-evals",
  why:
    "Fixed prefixes let the reconcile tell a hand-opened task from a derived one, so it never drops a defect as a key the " +
    "book no longer has. Evals that exist and do not pass are the only way the ledger keeps such a task open until its fix " +
    "lands; done at merge would make the ledger's roll-up and the board disagree. A style note is not a defect. A split " +
    "child without a key would be dropped by the next reconcile, and a reconcile that restored the parent's checks would " +
    "own each of them twice.",
  source: tby(`${SWARMD} apps/docs/content/docs/reference/ledger.md (roll-up; task.open refuses unknown checks); reference/pairs.md (split drops the task's own checks onto its new children); docs/design/portal.md (the review field)`),
  affects: [f.system_capxul, decision_swarm_findings, decision_swarm_review_answers],
});

export const decision_swarm_pr_mirror = defineDecision({
  id: "swarm.pr-mirror",
  title: "The pair's rounds show on its pull request as marked comments posted by code",
  question: "Besides the body the builder writes, who writes what on a task's pull request, so that it alone shows every round?",
  options: [
    {
      label: "marker-comments",
      text:
        "The builder writes the body, the Handback template, and nothing else. Every other event is one comment whose first " +
        "line is a marker (SUBMIT, GATE, CI, EVALS, CHECK, SIGNAL, DECIDE, DIAGNOSIS, MERGED, STOPPED) with the round, the " +
        "version and the actor, and a fixed body below. Code posts them under each actor's name at stage 1 (SD-13); Mission " +
        "Control posts them from each worker's returned message at stage 0. Checkers post no review of their own, and the " +
        "status card is edited in place, never reposted.",
    },
    { label: "workers-post", text: "Each worker posts its own review or comment, as swarmD's own team does today." },
    { label: "body-only", text: "Everything goes into the pull request body, rewritten each round." },
  ],
  chosen: "marker-comments",
  why:
    "swarmD's reviewer today posts a COMMENT review because the app cannot approve its own pull request, and the verifier " +
    "a comment of its own wording; the router then judged them. A comment posted by code from the typed message cannot " +
    "drift from it. A first-line marker is what the old work contract used, so people and scripts read the same line.",
  source: tby(`${SWARMD} dogfood/prompts/reviewer.md (step 6); /home/user/factory/docs/agents/work-contract.md (comment markers); docs/design/swarm.md (SD-13)`),
  affects: [f.system_capxul, decision_swarm_merge],
});

export const decision_swarm_agent_verdicts = defineDecision({
  id: "swarm.agent-verdicts",
  title: "The reviewer posts des: in its check, and it counts until its paths change",
  question:
    "des:<operation> is an agent eval its named checker decides. swarmD's checkers have no tool that posts an agent " +
    "verdict, and a verdict counts only at the exact head, so after a squash merge or any later merge every des: is " +
    "unknown at integration/build and no operation task could be done. How is it posted, and how long does it count?",
  options: [
    {
      label: "check-and-carry",
      text:
        "The reviewer's check carries a verdicts list for the agent evals it is the named checker of (needed: SD-21), which " +
        "the engine posts under its actor. The merge carries each agent and person verdict of the converged version to the " +
        "merge commit, and it stays current at later heads until a commit changes one of its task's paths, or its check's " +
        "definition changes (needed: SD-22). The rubric is the book's claim (its record is complete and consistent with the " +
        "old book and the old behaviour) plus: the code does what the record says and nothing more.",
    },
    { label: "re-judge", text: "Re-run every des: at each move of integration/build." },
    { label: "machine-only", text: "Count only machine evals toward done; des: is advisory." },
  ],
  chosen: "check-and-carry",
  why:
    "Re-judging would be some 215 agent calls a merge. Dropping des: from done drops the one eval that checks a record " +
    "against the old behaviour. Carrying a verdict while the files it covered are unchanged is the old factory's carried " +
    "rule for proofs, and the task's paths are exactly the files a des: covers.",
  source: tby(`${SWARMD} apps/docs/content/docs/reference/ledger.md (current verdict), reference/tools.md (pair tools); /home/user/factory/docs/agents/work-contract.md (carried steps)`),
  affects: [f.system_capxul, decision_swarm_review_evals],
});

export const decision_swarm_stage0_profiles = defineDecision({
  id: "swarm.stage0-profiles",
  title: "At stage 0 the roles run as Claude Code profiles with the swarmD prompts",
  question:
    "Before swarmD runs, Mission Control's makers and checkers are Claude subagents. How are they defined, and on which " +
    "models, when only one model family is available there?",
  options: [
    {
      label: "profiles",
      text:
        ".claude/agents/ holds one profile per role (master, builder, reviewer, adversary, diagnoser, researcher). Each body " +
        "is the role's swarmD prompt with what it reads, does, may not do and returns, and the same typed message as its " +
        "final json block. The builder runs on opus; the reviewer, the adversary and the diagnoser on sonnet, another model " +
        "of the same family; the researcher on haiku; the master is the session itself. Another family for checkers arrives " +
        "at stage 1 (swarm.checker-family).",
    },
    { label: "workflow-prompts", text: "Write each worker's prompt inside each Workflow script, as the book's workflows did." },
    { label: "codex-checkers", text: "Run the checkers through Codex at stage 0, for another family." },
  ],
  chosen: "profiles",
  why:
    "One text per role at both stages makes the move to swarmD a change of runner, not of behaviour (swarm.stages). A " +
    "different model is the nearest one family allows, and the book's own lesson is that a same-subscription adversarial " +
    "reviewer still found real errors in every money file it read. Codex would add a second subscription and its tooling " +
    "for stage 0 alone.",
  source: tby("HANDOFF.md (lessons that save usage); tools/workflows/; .claude/agents/; the old system's .claude/agents/ (profiles with name, description, tools, model)"),
  affects: [f.system_capxul, decision_swarm_stages],
});

export const decision_swarm_team_definition = defineDecision({
  id: "swarm.team-definition",
  title: "The team on swarmD: one manager and five workers, in both APIs",
  question: "How is the team declared in .swarmd/, so that stage 1 needs no new design and a dry run can happen on today's code?",
  options: [
    {
      label: "both-apis",
      text:
        "docs/design/swarm-templates.md section 10 declares it. In swarmD's documented API: defineManager master on the " +
        "build template with its workers imported and their roles; builder (sol, concurrency 4, a writable sandbox, " +
        "pulls.create, pulls.get, pulls.update, issues.createComment); reviewer (sonnet, 4) and adversary (sonnet, 2) on " +
        "read-only sandboxes with pulls.get and pulls.listFiles; diagnoser (sonnet, 1, read-only, no tools); researcher " +
        "(haiku, 1, its own input and result); the skills book, evals, lane, money and old-system. In today's API: " +
        "defineRouter and defineWorker with the typed messages as each worker's input and result JSON Schema " +
        "(.swarmd/schemas.ts), and CI driving the rounds as swarmD's own team does, for the dry run only.",
    },
    { label: "documented-only", text: "Declare only the documented API, and wait for it." },
    { label: "today-only", text: "Declare only today's API, and redo it when the documented API lands." },
  ],
  chosen: "both-apis",
  why:
    "The dry run (post-mortem O1) can run on today's code; the build runs on the documented API. The diagnoser on the " +
    "checkers' family keeps it off the maker's framing (retro brief 04). Read-only sandboxes are planned in the docs and " +
    "keep a checker from changing what it judges. The today form typechecks against packages/agent's types, and the " +
    "templates' examples validate against its schemas with swarmD's own validator.",
  source: tby(`${SWARMD} packages/agent/src/modules/define/types.ts; examples/api-team; dogfood/; how-to/define-a-manager.mdx; reference/manager.md, worker.md`),
  affects: [f.system_capxul, decision_swarm_workers, decision_swarm_pacing],
});
