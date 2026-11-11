// Build-tooling decisions, including the older swarm design kept below for history.
// The current authority for execution is loop.* at the end of this file: packages/loop,
// the authored plan, isolated run lanes and the coordinator's merge gate, not swarmD.
// These are the build's tooling, not part of Capxul: no component or environment record.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "./foundation.ts";
import { decision_system_build_order, decision_system_layout, decision_system_size } from "./decisions.ts";
import { decision_ops_group_shutdown, decision_ops_owner } from "./ops.ts";

const BY = "Claude, swarm design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

const SWARMD = "/home/user/swarmd";
const RETRO = `${SWARMD} docs/planning/swarm-retro-2026-11-06.md`;
const MONEY = [f.concept_payments, f.concept_books, f.concept_banking, f.concept_requests, f.concept_budgets, f.concept_approvals];

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
  title: "Archived: Three stages: Mission Control, one swarmD manager, then lane managers",
  question:
    "swarmD will be what its documentation describes, but not yet. T0, D0 and B0 may start before its ledger and pair engine exist. What runs the build before then, and when does the build move onto swarmD?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive stages: Archive the three-stage migration and ledger-entry checklist: plan, portal and loop are the current coordination design, with no swarmD stage transition."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.stages is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive stages: Archive the three-stage migration and ledger-entry checklist: plan, portal and loop are the current coordination design, with no swarmD stage transition. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

export const decision_swarm_nested_entry = defineDecision({
  id: "swarm.nested-entry",
  title: "Archived: Lane managers only after the single manager has a measured record",
  question: "What evidence must exist before the build moves from one manager to a lead over lane managers?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive nested-entry: There is no planned migration to nested swarmD managers. Its four-lane/cost/latency entry thresholds do not gate the current loop."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.nested-entry is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive nested-entry: There is no planned migration to nested swarmD managers. Its four-lane/cost/latency entry thresholds do not gate the current loop. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

export const decision_swarm_master_prompt = defineDecision({
  id: "swarm.master-prompt",
  title: "Archived: The goal prompt is the master's instructions, with the operating skele",
  question: "What does capxul/master's instructions file hold, so that it does not improvise how to run the build?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive master-prompt: The loop uses its checked-in operating instructions; it does not concatenate a swarmD built-in manager prompt with the archived initializer."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.master-prompt is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive master-prompt: The loop uses its checked-in operating instructions; it does not concatenate a swarmD built-in manager prompt with the archived initializer. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
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
  source: by(`${SWARMD} apps/docs/content/docs/decisions.mdx (DOC-3); archive/HANDOFF.md (lessons); docs/spec/40-capxul-team.md`),
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
        "activity's side effect lands once). packages/plan/src/tasks.ts sets checkers to [reviewer, adversary] and the label money.",
    },
    { label: "six", text: "The six concepts HANDOFF names, without approvals." },
    { label: "risk-flag", text: "Only operations whose acceptance moves money, chosen per operation." },
  ],
  chosen: "seven-lanes",
  why:
    "The goal prompt's list includes approvals: every money movement is signed through it. A per-operation choice is a " +
    "judgment made 215 times; the lane is the unit the code and the reviewer's checklist share. B0.once proves the property " +
    "every money path rests on.",
  source: by("archive/docs/mission/initializer.md (How to work: the money concepts); archive/HANDOFF.md (lessons); packages/plan/src/tasks.ts MONEY"),
  affects: MONEY,
});

export const decision_swarm_pacing = defineDecision({
  id: "swarm.pacing",
  title: "Archived: At most four pairs in flight, six agents at once, one task per lane",
  question: "How many workers run at once, given the usage lessons and the retro's numbers?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive pacing: Loop concurrency and per-lane isolation are configured for the run; the old stage-0 subscription-window and stage-1 four-pair/six-agent thresholds are not current capacity rules."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.pacing is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive pacing: Loop concurrency and per-lane isolation are configured for the run; the old stage-0 subscription-window and stage-1 four-pair/six-agent thresholds are not current capacity rules. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul, decision_system_layout],
});

// ── the task tree ───────────────────────────────────────────────────────────────────────────

export const decision_swarm_task_tree = defineDecision({
  id: "swarm.task-tree",
  title: "The task tree is derived from the book by packages/plan/src/tasks.ts",
  question: "Who writes the build's tasks, their evals and their order?",
  options: [
    {
      label: "derived",
      text:
        "packages/plan/src/tasks.ts derives every task from the records: milestones and their steps, a lane per concept, and in each " +
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
    "The link graph is the work plan (docs/blueprint.md, in the factory). A manager writing tasks is the freestyling this " +
    "design removes, and a hand plan drifts from the book on the first record change. Deriving it gives every operation " +
    "exactly one task and every eval exactly one owner, and the checks fail the moment either stops being true.",
  source: by("docs/blueprint.md (in the factory); packages/plan/src/tasks.ts; docs/mission/tasks.json"),
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
  source: by("packages/plan/src/tasks.ts; system.layout (src/<concept>/ mirrors the book); docs/mission/tasks.json"),
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
  source: by("rules.process-wakeups; archive/docs/mission/initializer.md (B0: route by keys); packages/plan/src/tasks.ts"),
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
  source: by("system.build-order (a lane may build against their events); blueprint/notices/equity.ts (reads fundraise rounds)"),
  affects: [decision_system_build_order, f.concept_notices],
});

export const decision_swarm_layers = defineDecision({
  id: "swarm.layers",
  title: "Archived: Layers from the concept map, equity last; a need never points at a lat",
  question: "How does the task tree keep system.build-order?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive layers: The coordinator authors task dependencies and critical path in the plan. Computed swarmD layers and automatic after:lane promotion no longer schedule work."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.layers is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive layers: The coordinator authors task dependencies and critical path in the plan. Computed swarmD layers and automatic after:lane promotion no longer schedule work. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
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
  source: by("archive/docs/mission/initializer.md (B3); system.build-order; blueprint/devnet/worlds.ts (steps, the builder); packages/plan/src/tasks.ts (WORLD_OPS, pilot-closure)"),
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
  source: by("archive/docs/mission/initializer.md (order of work, exits); docs/spec/30-capxul-evals.md (ok:, sys:); swarmD the-record (done)"),
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
  source: by("archive/docs/mission/initializer.md (the build rules hold at every commit); docs/spec/10-swarmd-ledger.md (roll-up at ref moves)"),
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
        "Each task lists its paths: for a lane task blueprint/<concept>/ and src/<concept>/ in the backend and the SDK, " +
        "plus packages/indexer/ for indexing (Ponder writes its views) and packages/devnet/ for devnet (its supervisor and " +
        "world builder). Every task may also change the regenerated outputs that tasks.json lists (docs/mission/tasks.json " +
        "and every package's src/generated/), but only to what the generators write at its version, which generate:check and " +
        "plan-tasks --check prove; so a book-first change carries its outputs in the same pull request. The gate refuses a " +
        "change outside them, any change to packages/blueprint-engine or packages/evals from a lane task, and a submitted version whose " +
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
        "packages/plan/src/tasks.ts gives a working task with no paths the label watch, no checkers and no budget. The master never " +
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
  source: by("packages/plan/src/tasks.ts (watch: 13 journeys, B3.pilots, B5.week); .github/ISSUE_TEMPLATE/task-journey.yml (\"a journey's paths may be empty\", now removed); swarmD reference/pairs.md (a failed code level doesn't count)"),
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
  source: by(`${SWARMD} reference/ledger.md (roll-up); how-to/run-a-pair.mdx (waive, or leave open); blueprint/devnet/worlds.ts (steps are capxul commands); ${RETRO} (#46)`),
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
  title: "Archived: The ledger and the repository hold the state, not the manager's conver",
  question: "Where does the master's durable state live, so that a reset or an upgrade loses nothing?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive state: Durable coordination state is the authored plan, loop run evidence and repository, not the swarmD ledger or a manager conversation. The portal is a view, not another task authority."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.state is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive state: Durable coordination state is the authored plan, loop run evidence and repository, not the swarmD ledger or a manager conversation. The portal is a view, not another task authority. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

export const decision_swarm_artifact = defineDecision({
  id: "swarm.artifact",
  title: "Archived: The master's board: lanes by layer, pairs, blocked, matters, spend, he",
  question: "What does the master's artifact show, and in what order?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive artifact: The portal renders the authored plan and loop state; the old swarmD master board and its ledger queries are not an additional state store."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.artifact is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive artifact: The portal renders the authored plan and loop state; the old swarmD master board and its ledger queries are not an additional state store. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
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
  source: by(`archive/docs/mission/initializer.md (Bring list); ${RETRO} (D2); swarmD domains/software-factory.mdx (scenario 7)`),
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
  source: by("archive/docs/mission/initializer.md (Bring list: each recorded choice stands); swarmD reference/ledger.md (blocked)"),
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
  title: "Archived: One golden sandbox with the repository, the old system and a devnet sn",
  question: "What does a Capxul worker's sandbox hold, and how is a dead one kept from costing money?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive sandbox: The repository loop uses isolated worktrees and explicit gates, not golden swarmD sandbox boots or App-token egress. Keep old-system reference read-only and do not reuse an incompatible world snapshot."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.sandbox is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive sandbox: The repository loop uses isolated worktrees and explicit gates, not golden swarmD sandbox boots or App-token egress. Keep old-system reference read-only and do not reuse an incompatible world snapshot. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.component_devnet, f.environment_devnet],
});

export const decision_swarm_skills = defineDecision({
  id: "swarm.skills",
  title: "Archived: Repository knowledge goes in skills, passed through to Pi",
  question: "Where does the knowledge every worker needs (the book, the evals, the layout, money paths) live?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive skills: Repository instructions and the brief supply required context. The old .swarmd skills pass-through and pi-agent loader are not required runtime components."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.skills is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive skills: Repository instructions and the brief supply required context. The old .swarmd skills pass-through and pi-agent loader are not required runtime components. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

// ── for Aaron ───────────────────────────────────────────────────────────────────────────────

export const decision_swarm_superset = defineDecision({
  id: "swarm.superset",
  title: "Archived: swarmD passes skills through now, and the rest of pi-durable later",
  question:
    "Aaron asks whether swarmD should pass through everything pi-durable gives an agent (a superset: skills, extension sections, hooks), rather than choosing pieces. What should the build ask swarmD for?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive superset: No pi-durable extension-section passthrough is required. Any future extension that changes worker instructions needs its own reviewed boundary."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.superset is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive superset: No pi-durable extension-section passthrough is required. Any future extension that changes worker instructions needs its own reviewed boundary. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

export const decision_swarm_checker_family = defineDecision({
  id: "swarm.checker-family",
  title: "Archived: Everything runs on OpenAI for now; models are set when the build runs",
  question: "Which provider and model does each role use (maker, checker, adversary, manager, researcher)?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive checker-family: The current loop configures models per run. The historical OpenAI-only/provider-credit instruction is not a current model-routing restriction."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.checker-family is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive checker-family: The current loop configures models per run. The historical OpenAI-only/provider-credit instruction is not a current model-routing restriction. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

export const decision_swarm_spend_envelope = defineDecision({
  id: "swarm.spend-envelope",
  title: "Archived: Up to $4,000 for this project's rollout, then reassess",
  question:
    "The task tree's ceiling is $5 for each of its 390 paired tasks (its 15 watch tasks get no pair). How much may the build spend on models before it asks Aaron again?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive spend-envelope: The authored plan/run sets budgets; the historical $4,000 rollout and 75-percent swarmD matter threshold do not authorize current spend."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.spend-envelope is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive spend-envelope: The authored plan/run sets budgets; the historical $4,000 rollout and 75-percent swarmD matter threshold do not authorize current spend. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul],
});

export const decision_swarm_accounts = defineDecision({
  id: "swarm.accounts",
  title: "Archived: A capxul namespace, the GitHub App on both repositories, a room",
  question:
    "What must Aaron set up for stage 1, since only he can provide accounts and access?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive accounts: No swarmD namespace, App installation or provider-account setup is required by the current plan/portal/repository loop; protected-branch policy remains a repository obligation."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.accounts is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive accounts: No swarmD namespace, App installation or provider-account setup is required by the current plan/portal/repository loop; protected-branch policy remains a repository obligation. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
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
  title: "Archived: Task cards: an issue per task in flight at stage 0, none at stage 1",
  question:
    "Every task comes from the plan, yet a task needs a thread where a person can steer it and see why it waits. What is a GitHub issue form for a derived task for, and who opens one?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive task-cards: Tasks live in the authored plan and their checked-in explanation files. There is no stage-1 ledger/room replacement of a stage-0 GitHub issue-per-task requirement."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.task-cards is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive task-cards: Tasks live in the authored plan and their checked-in explanation files. There is no stage-1 ledger/room replacement of a stage-0 GitHub issue-per-task requirement. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
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
  title: "Archived: The pair's rounds show on its pull request as marked comments posted b",
  question: "Besides the body the builder writes, who writes what on a task's pull request, so that it alone shows every round?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive pr-mirror: The current run and plan retain maker/reviewer evidence. The old swarmD marked-comment event mirror is not a second required ledger or permission to post comments outside the runner protocol."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.pr-mirror is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive pr-mirror: The current run and plan retain maker/reviewer evidence. The old swarmD marked-comment event mirror is not a second required ledger or permission to post comments outside the runner protocol. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
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
  title: "Archived: At stage 0 the roles run as Claude Code profiles with the swarmD promp",
  question:
    "Before swarmD runs, Mission Control's makers and checkers are Claude subagents. How are they defined, and on which models, when only one model family is available there?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive stage0-profiles: The repository loop is the coordinator, not a temporary Claude-profile stage before swarmD. Historical opus/sonnet/haiku profiles are not a current role contract."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.stage0-profiles is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive stage0-profiles: The repository loop is the coordinator, not a temporary Claude-profile stage before swarmD. Historical opus/sonnet/haiku profiles are not a current role contract. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul, decision_swarm_stages],
});

export const decision_swarm_team_definition = defineDecision({
  id: "swarm.team-definition",
  title: "Archived: The team on swarmD: one manager and five workers, in both APIs",
  question: "How is the team declared in .swarmd/, so that stage 1 needs no new design and a dry run can happen on today's code?",
  options: [
  {
    "label": "current-scope",
    "text": "Archive team-definition: The current loop owns worker orchestration; archive defineManager/defineRouter swarmD declarations and their API migration. They are not a dependency of lane work."
  },
  {
    "label": "historical",
    "text": "The former answer to swarm.team-definition is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Archive team-definition: The current loop owns worker orchestration; archive defineManager/defineRouter swarmD declarations and their API migration. They are not a dependency of lane work. Authority: portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; portal.plan-page",
  affects: [f.system_capxul, decision_swarm_workers, decision_swarm_pacing],
});


// ── the current build loop (11 November 2026) ──────────────────────────────────────────────
// These decisions supersede or narrow the named older records for today's build only.
// Owner rulings, including model/spend rulings, are unchanged.
const LOOP_BY = "Builder, m1-loop-decision, round 1, 11 November 2026";

export const decision_loop_pair = defineDecision({
  id: "loop.pair",
  title: "The build runs the repository pair script, not swarmD",
  question: "What executes a build task today?",
  options: [
    { label: "repository-loop", text: "packages/loop runs loops/pair.ts: a builder submits a version, the runner runs gates, then a fresh reviewer approves or refuses it. Configured additional checkers, including the adversary for money tasks, also review. Failed gates and blocking findings feed the next builder round; only passing gates, no open blocking findings and every checker approving make the run ready. Exhausted rounds or a real fork block it. Ready is not merged and is not a worker declaring the task done." },
    { label: "swarmd", text: "Run a swarmD manager, pair engine and worker team." },
  ],
  chosen: "repository-loop",
  why: "Use the checked-in script and durable run evidence already running this build. Replaces swarm.start-small and swarm.workers as runtime topology; confirms the retirement in swarm.stages, swarm.nested-entry, swarm.master-prompt, swarm.team-definition and swarm.stage0-profiles. Narrows swarm.pair-limits to the configured loop round/budget limits, not swarmD defaults; swarm.review-evals and swarm.agent-verdicts do not imply swarmD verdict posting or automatic carry-forward. swarm.money still supplies additional review requirements. swarm.handback and swarm.templates retain structured reports, not a swarmD runtime dependency.",
  source: LOOP_BY + "; packages/loop/README.md (pair script); AGENTS.md",
  affects: [decision_swarm_start_small, decision_swarm_workers, decision_swarm_stages, decision_swarm_nested_entry, decision_swarm_master_prompt, decision_swarm_team_definition, decision_swarm_stage0_profiles, decision_swarm_pair_limits, decision_swarm_review_evals, decision_swarm_agent_verdicts, decision_swarm_money, decision_swarm_handback, decision_swarm_templates],
});

export const decision_loop_lanes = defineDecision({
  id: "loop.lanes",
  title: "Each run has an isolated git lane cut from integration/build",
  question: "Where does a builder work without changing the coordinator's checkout?",
  options: [
    { label: "run-lane", text: "Each run gets its own git worktree on lane/<task>, cut from integration/build. Work and build output stay inside that lane, with output under var/. Workers commit only on their own branch; they never push, merge or change another branch. The runner handles publication. No two runs share a working copy." },
    { label: "concept-lane", text: "Reuse one lane/<concept> branch for successive concept tasks and route milestone/review work to separate branch classes." },
  ],
  chosen: "run-lane",
  why: "Replaces swarm.branches' concept branch, PR and deletion lifecycle with per-run isolation; confirms swarm.sandbox's worktree replacement of golden swarmD sandboxes. Narrows swarm.scope: task paths and protected files control edits; workers do not gain permission to edit generated files or evals from the older text. swarm.review-answers and swarm.hand-tasks no longer prescribe review/<decision> or defect concept branches for loop runs.",
  source: LOOP_BY + "; AGENTS.md; packages/loop/README.md (lane step)",
  affects: [decision_swarm_branches, decision_swarm_sandbox, decision_swarm_scope, decision_swarm_review_answers, decision_swarm_hand_tasks],
});

export const decision_loop_merge_gate = defineDecision({
  id: "loop.merge-gate",
  title: "Only the coordinator merges, after gates on the lane plus current base",
  question: "Does a ready pair authorize a merge against a base that may have moved?",
  options: [
    { label: "regate", text: "Only the coordinator invokes pnpm loop merge <run>. The command gates again on the lane plus the current integration/build base before merging and pushing. A ready run's earlier checks are insufficient: a failing merge gate refuses the merge. Builders and reviewers cannot merge themselves. The coordinator closes tasks from checked evidence in the plan, not from a worker's claim." },
    { label: "ready-only", text: "Merge on the pair's earlier approval and lane checks without retesting against the current base." },
  ],
  chosen: "regate",
  why: "Replaces swarm.merge's swarmD manager/GitHub release-gate machinery with the repository coordinator command. Narrows swarm.merged-tasks: a merged run is evidence for the coordinator, not an automatic swarmD frontier or waiver transition. Confirms swarm.pr-mirror is historical; neither PR comments nor old GitHub checks substitute for this gate. swarm.head-red's principle of not merging onto a failing integration head remains, not its automatic swarmD defect/revert machinery.",
  source: LOOP_BY + "; AGENTS.md (coordinator); packages/loop/README.md (merge)",
  affects: [decision_swarm_merge, decision_swarm_merged_tasks, decision_swarm_pr_mirror, decision_swarm_head_red],
});

export const decision_loop_plan = defineDecision({
  id: "loop.plan",
  title: "The authored plan is the build's one task list",
  question: "Which list controls work and survives a coordinator restart?",
  options: [
    { label: "one-plan", text: "The coordinator authors the goal, milestones, dependencies, critical path and tasks through pnpm plan. plan/plan.json, its log and task explanation files are the one task list. packages/loop takes tasks from it; run ledgers retain execution evidence; the portal renders those facts. The blueprint supplies design and evals. The derived docs/mission/tasks.json tree is subordinate reference, not a second queue. Defects, splits and review work enter the same plan, not a separate swarmD ledger." },
    { label: "derived-queue", text: "Let the derived blueprint task tree and swarmD ledger schedule work independently of the authored plan." },
  ],
  chosen: "one-plan",
  why: "Replaces swarm.task-tree as task-list authority and swarm.hand-tasks' permission to open work outside it. Narrows swarm.task-unit, swarm.rpc-ownership, swarm.process-order, swarm.events-not-needs, swarm.pilots, swarm.milestone-evals and swarm.watch-tasks to design/dependency guidance, not automatic task creation, scheduling or completion. Confirms the archival boundaries in swarm.layers, swarm.state, swarm.artifact and swarm.task-cards. swarm.findings routes outside-scope needs to the coordinator for this same plan.",
  source: LOOP_BY + "; AGENTS.md; docs/blueprint.md (The plan); portal.plan-page",
  affects: [decision_swarm_task_tree, decision_swarm_hand_tasks, decision_swarm_task_unit, decision_swarm_rpc_ownership, decision_swarm_process_order, decision_swarm_events_not_needs, decision_swarm_pilots, decision_swarm_milestone_evals, decision_swarm_watch_tasks, decision_swarm_layers, decision_swarm_state, decision_swarm_artifact, decision_swarm_task_cards, decision_swarm_findings],
});

export const decision_loop_gateway = defineDecision({
  id: "loop.gateway",
  title: "The loop uses the CLI proxy on the Mac, not LiteLLM",
  question: "Through which gateway do the build's model calls run?",
  options: [
    { label: "mac-cli-proxy", text: "The loop host and model gateway stay on Aaron's Mac. Model calls use the local CLI proxy (CLIProxyAPI through VibeProxy), 127.0.0.1:8317, with the OpenAI-compatible endpoint http://127.0.0.1:8317/v1. No LiteLLM router is in the loop's path. Gateway choice is build tooling, not a Capxul integration, component or environment." },
    { label: "litellm", text: "Route loop traffic through the remote LiteLLM router at llm.capxul.com." },
  ],
  chosen: "mac-cli-proxy",
  why: "Implements Aaron's ruling of 10 November 2026 to use the CLI proxy, not LiteLLM. Narrows swarm.checker-family to role/model selection, not gateway selection; does not change its owner ruling or swarm.spend-envelope. Confirms swarm.accounts no longer requires swarmD provider setup. Neither swarm.start-small nor swarm.team-definition makes swarmD a gateway dependency.",
  source: LOOP_BY + "; Aaron's ruling, 10 November 2026; packages/loop/README.md (Model gateway); AGENTS.md (Where it runs)",
  affects: [decision_swarm_checker_family, decision_swarm_accounts, decision_swarm_start_small, decision_swarm_team_definition],
});

// ── Amp replaces the home-made loop (11 November 2026) ─────────────────────────────────────
// Aaron moved agent orchestration to Amp (ampcode.com). The loop.* records above are kept as
// history; this record says which of their parts no longer hold.

export const decision_build_amp = defineDecision({
  id: "build.amp",
  title: "Agents run in Amp orbs; the home-made loop, sandbox and Mac services are removed",
  question: "What runs the build's agents now that the loop host, the sandbox Worker and the Mac sessions cost a day of permission and hang problems?",
  options: [
    { label: "amp", text: "Agent work runs in Amp threads, each in its own orb (a cloud sandbox with Docker, Node, pnpm and gh), on its own branch with a pull request into integration/build. The coordinator is the lead Amp thread: it hill-climbs plan/ with the skills in .agents/skills and starts one orb thread per task. The evals and the CI merge gate decide whether work is done; the coordinator or Aaron merges. AGENTS.md is the one rule file every agent reads. packages/loop, packages/loop-ui, packages/sandbox (and its never-deployed Cloudflare Worker), packages/ops and loops/ are deleted; git history keeps them." },
    { label: "keep-loop", text: "Keep packages/loop with the pair script, deploy the capxul-loop-sandbox Worker and keep the loop host on the Mac." },
  ],
  chosen: "amp",
  why:
    "Aaron, 11 November 2026, 21:57 UTC: \"We're moving over to AMP now ... because AMP has built in orbs, inbuilt sandboxing. It has like a bunch of different providers.\" " +
    "Replaces loop.pair (no repository pair script: an Amp thread is the builder, the PR review and the evals are the checker), loop.lanes (an orb plus a branch is the isolation), " +
    "loop.merge-gate (the merge gate is the CI workflow on the pull request; `pnpm loop merge` no longer exists) and loop.gateway (Amp routes the models; no Mac proxy). " +
    "Narrows loop.plan: the plan stays the one task list (Aaron, 22:05 UTC: the plan is how the coordinator and he communicate), and the coordinator, not packages/loop, starts its tasks. " +
    "Retires tooling.ops-owner and tooling.ops-group-shutdown: an orb starts its own services, so the Mac supervisor (pnpm ops) is gone.",
  source: "Aaron's message in the project thread \"Clean up and hand off to Amp\", 11 November 2026; https://ampcode.com/docs/orbs",
  affects: [decision_loop_pair, decision_loop_lanes, decision_loop_merge_gate, decision_loop_gateway, decision_loop_plan, decision_ops_owner, decision_ops_group_shutdown],
});
