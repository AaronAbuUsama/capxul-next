// node --experimental-strip-types tools/plan-tasks.ts           → writes docs/mission/tasks.json and prints counts
// node --experimental-strip-types tools/plan-tasks.ts --check   → exits 1 if docs/mission/tasks.json is stale
//
// The build's task tree, derived from the design book (docs/design/swarm.md, section 5). Nothing here is written by hand
// except the milestones' steps and exit lines, which come from the goal prompt and the tooling and portal designs. Every
// other task is a record of the book, and its done is the book's own eval ids:
//
// - one lane per concept, in the layers of decision system.build-order (the concepts' dependsOn depth, equity last);
// - in each lane: the door (its tables, machines and procedures), one task per durable process, one per operation, and
//   one per rpc or helper flow that no operation of its own lane owns (swarm.rpc-ownership);
// - the integrations, as their own lane before the concepts; the journeys, as their own lane after them;
// - needs from the links: an operation on the tasks that own its flow's rpcs, the doors of the concepts its rpcs read,
//   write and invoke, the integrations they call, and the processes they start or wake (swarm.process-order); never on
//   an event (swarm.events-not-needs), and never on a task in a later layer (swarm.layers).
//
// It fails (exit 1) if the book has problems, an eval is owned twice or not at all, an operation has no task or two, a
// need points at a later layer, or the needs (with each parent waiting on its children) have a cycle.
//
// A task with evals but no paths is a watch task (swarm.watch-tasks): no maker could change anything for it, so it has no
// checkers and no budget, never gets a pair, and is done when its evals pass (the journeys, B3.pilots, B5.week).
//
// The file holds the tasks and nothing aggregated over the book: no record or eval counts, which change with every
// decision record a lane adds. So two lanes that change different tasks regenerate it without a conflict, and a merge of
// both is the file plan-tasks writes at the merged head (swarm.task-tree). The counts are printed instead.

import { readFileSync, writeFileSync } from "node:fs";
import { name, records, stage } from "../books/target/index.ts";
import { CONCEPTS } from "../books/target/shared/foundation.ts";
import { recordsOf } from "../books/target/shared/index.ts";
import { WORLDS } from "../books/target/devnet/worlds.ts";
import { buildBook, keyOf, type AnyRecord, type EvalDef } from "../packages/book/src/index.ts";

const OUT = "docs/mission/tasks.json";
const check = process.argv.includes("--check");
const failures: string[] = [];
const warnings: string[] = [];

// ── the book ────────────────────────────────────────────────────────────────────────────────

const book = buildBook({ name, stage, records });
if (book.problems.length) {
  console.error(`the book has ${book.problems.length} problems; build it to 0 first`);
  process.exit(1);
}
const get = (key: string): AnyRecord => {
  const r = book.records.get(key);
  if (!r) throw new Error(`no record ${key}`);
  return r;
};
const all = [...book.records.values()];
const ofKind = (kind: string) => all.filter((r) => r._kind === kind).sort((a, b) => a.id.localeCompare(b.id));
const linksFrom = (key: string, field?: string) =>
  book.links.filter((l) => l.from === key && (field === undefined || l.field === field)).map((l) => l.to);

/** The concept whose folder exports a record (a machine's transitions come with it). */
const conceptOf = new Map<string, string>();
for (const c of CONCEPTS) {
  const m = (await import(`../books/target/${c.id}/index.ts`)) as { modules: readonly object[] };
  for (const r of recordsOf(m.modules) as AnyRecord[]) {
    conceptOf.set(keyOf(r), c.id);
    if (r._kind === "machine") for (const t of Object.values(r.t as object) as AnyRecord[]) conceptOf.set(keyOf(t), c.id);
  }
}
const concept = (key: string): string => {
  const c = conceptOf.get(key);
  if (!c) throw new Error(`no concept exports ${key}`);
  return c;
};

// The evals, by id. The book derives a few ids twice (a refusal under two worlds; an integration error listed twice):
// swarmD's catalog.sync refuses a duplicate, so they are reported here and fixed in packages/book by D0, whose
// portal.eval-ids makes every id unique and adds the duplicate-eval problem (ms:D0/unique).
const evalsById = new Map<string, EvalDef[]>();
for (const e of book.evals) evalsById.set(e.id, [...(evalsById.get(e.id) ?? []), e]);
const duplicated = [...evalsById].filter(([, v]) => v.length > 1).map(([id]) => id);
if (duplicated.length)
  warnings.push(`${duplicated.length} eval ids occur more than once in the book's evals (catalog.sync refuses them; ms:D0/unique): ${duplicated.slice(0, 4).join(", ")}, …`);
const evalsOf = new Map<string, string[]>(); // subject record key → unique eval ids
for (const [id, [e]] of evalsById) evalsOf.set(e!.subject, [...(evalsOf.get(e!.subject) ?? []), id]);
const evalIdsOf = (subject: string) => evalsOf.get(subject) ?? [];

// ── layers (system.build-order) ─────────────────────────────────────────────────────────────

const depth = new Map<string, number>();
const depthOf = (id: string): number => {
  const known = depth.get(id);
  if (known !== undefined) return known;
  const deps = linksFrom(`concept:${id}`, "dependsOn").map((k) => depthOf(k.slice("concept:".length)));
  const d = deps.length ? Math.max(...deps) + 1 : 0;
  depth.set(id, d);
  return d;
};
for (const c of CONCEPTS) depthOf(c.id);
/** Built last whatever its depth: "Board's director and vote operations and all of equity are built last". */
const LAST = new Set(["equity"]);
const maxDepth = Math.max(...depth.values());
const layerOf = (c: string) => (LAST.has(c) ? maxDepth + 1 : depth.get(c)!);
/** The decision's own list, so that a change to the concept map that moves a layer fails here until the decision moves. */
const BUILD_ORDER: readonly (readonly string[])[] = [
  ["access"], ["media"], ["parties"], ["indexing"], ["approvals"], ["accounts"], ["organizations"],
  ["applications", "board", "contacts", "documents", "projects"], ["agents", "books", "budgets"], ["payments"],
  ["activity", "banking", "payroll"], ["requests"], ["notices"], ["devnet"], ["equity"],
];
const computed: string[][] = [];
for (const c of CONCEPTS) (computed[layerOf(c.id)] ??= []).push(c.id);
for (const l of computed) l.sort();
if (JSON.stringify(computed) !== JSON.stringify(BUILD_ORDER))
  failures.push(`the concept map's layers no longer match system.build-order: ${JSON.stringify(computed)}`);

/** The money concepts: each of their tasks gets the adversarial reviewer as a second checker (swarm.money). */
const MONEY = new Set(["payments", "books", "banking", "requests", "payroll", "budgets", "approvals"]);
const INTEGRATIONS = "integrations";
const JOURNEYS = "journeys";
const laneLayer = (lane: string) => (lane === INTEGRATIONS ? -1 : lane === JOURNEYS ? maxDepth + 2 : layerOf(lane));

// ── the task shape (docs/design/swarm.md, section 4: TaskDef) ──────────────────────────────

type Kind = "root" | "milestone" | "step" | "lane" | "door" | "process" | "rpc" | "flow" | "operation" | "integration" | "journey";
type Priority = "critical" | "normal" | "low";
interface TaskDef {
  key: string;
  kind: Kind;
  title: string;
  goal: string;
  parent?: string;
  lane?: string;
  layer?: number;
  priority: Priority;
  evals: string[];
  needs: string[];
  labels: string[];
  budgetUsd: number;
  checkers: ("reviewer" | "adversary")[];
  paths: string[];
  record?: string;
  exit?: { id: string; claim: string }[];
}
const tasks = new Map<string, TaskDef>();
const need = new Map<string, Set<string>>();
const add = (t: Omit<TaskDef, "needs" | "labels" | "budgetUsd" | "checkers" | "paths"> & Partial<TaskDef>) => {
  if (tasks.has(t.key)) throw new Error(`task ${t.key} twice`);
  const lane = t.lane;
  const money = lane !== undefined && MONEY.has(lane);
  const paths = t.paths ?? (lane && lane !== JOURNEYS && lane !== INTEGRATIONS ? lanePaths(lane) : lane === INTEGRATIONS ? ["packages/runtime/src/integrations/"] : []);
  // A structural task (root, milestone, lane) is done by roll-up; a working task with no paths is a watch task.
  const working = t.kind !== "root" && t.kind !== "milestone" && t.kind !== "lane";
  const watch = working && paths.length === 0;
  const full: TaskDef = {
    ...t,
    needs: [],
    labels: [...(t.labels ?? []), ...(watch ? ["watch"] : [])],
    budgetUsd: watch ? 0 : (t.budgetUsd ?? 5),
    checkers: watch ? [] : (t.checkers ?? (money ? ["reviewer", "adversary"] : ["reviewer"])),
    paths,
  };
  tasks.set(t.key, full);
  need.set(t.key, new Set(t.needs ?? []));
  return full;
};
const needs = (from: string, ...to: string[]) => {
  const s = need.get(from)!;
  for (const k of to) if (k !== from) s.add(k);
};
/** Where a concept's hand-written code lives (system.layout): its book folder and src/<concept>/ in the backend and the
 * SDK; indexing's views are Ponder's (packages/indexer), and devnet's supervisor and world builder are packages/devnet. */
const OWN_PACKAGE: Record<string, string> = { indexing: "packages/indexer/", devnet: "packages/devnet/" };
const lanePaths = (c: string) => [`books/target/${c}/`, `packages/backend/src/${c}/`, `packages/sdk/src/${c}/`, ...(OWN_PACKAGE[c] ? [OWN_PACKAGE[c]!] : [])];
/** What every task may also change, but only to what the generators write at its version (swarm.scope): the gate admits a
 * change here when `pnpm generate:check` and `plan-tasks --check` pass, so a book-first change carries its outputs. */
const REGENERATED = ["docs/mission/tasks.json", "packages/*/src/generated/"];
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const RANK: Record<Priority, number> = { critical: 0, normal: 1, low: 2 };

// ── milestones and their steps (the goal prompt; docs/design/tooling.md; docs/design/portal.md) ──

/** A step inherits its milestone's needs, unless it names its own `base` (the spine starts beside the harness). */
interface Step { key: string; title: string; goal: string; exit: [string, string][]; needs?: string[]; base?: string[]; book?: string[]; money?: boolean; paths: string[] }
interface Milestone { key: string; title: string; goal: string; needs: string[]; steps: Step[] }
const MILESTONES: Milestone[] = [
  {
    key: "T0", title: "T0 Tooling", needs: [],
    goal: "The pinned toolchain, one strict lint standard with Capxul's own rules, the formatter, the hooks, CI and the few cross-file checks, exactly as docs/design/tooling.md gives them, before any product code.",
    steps: [
      { key: "T0.files", title: "T0 Toolchain and gate files", paths: ["package.json", ".npmrc", ".node-version", ".gitignore", "tsconfig.base.json", "tsconfig.json", "vite.config.ts", ".vite-hooks/", "knip.jsonc", ".jscpd.json", ".gitleaks.toml"],
        goal: "The toolchain is pinned and every gate's config is the file tooling.md gives, so a fresh clone runs every gate on the whole tree.",
        exit: [["ms:T0/gates", "From a fresh clone every gate passes on the whole tree."], ["ms:T0/book", "The book's counts are unchanged by T0."]] },
      { key: "T0.lint", title: "T0 Capxul lint plugin and its facts", paths: ["packages/lint/", "packages/generate/"], needs: ["step:T0.files"],
        goal: "packages/lint holds the nine capxul/* rules, each with good and bad fixtures, reading facts generate writes from books/target.",
        exit: [["ms:T0/canary", "The lint canary fires every rule on its bad fixtures and none on its good ones."]] },
      { key: "T0.ci", title: "T0 Hooks, CI and the cloud environment", paths: [".github/workflows/", ".vite-hooks/", "docs/mission/progress.md"], needs: ["step:T0.lint"],
        goal: "The hooks and CI hold the gates within their budgets, and the build session's environment installs the pinned toolchain.",
        exit: [["ms:T0/hooks", "The hooks refuse a bad commit and a push to main, within their time budgets."], ["ms:T0/ci", "CI is green on the T0 pull request."], ["ms:T0/baselines", "The gates' baselines are logged in docs/mission/progress.md."]] },
    ],
  },
  {
    key: "D0", title: "D0 The portal", needs: ["milestone:T0"],
    goal: "The portal (docs/design/portal.md) is live behind Access: a page for every record, Review with typed answers, the stands, the scoreboard and the CLI surface, with Markdown and JSON twins.",
    steps: [
      { key: "D0.book", title: "D0 Review field, underOf and standOf in the book", paths: ["packages/book/", "books/target/", "tools/report-judgments.ts", "docs/decisions/judgments.md"],
        goal: "Decisions carry their review state, the judgments report reads it, every eval id is unique, and packages/book computes the records under an operation and its stand.",
        exit: [["ms:D0/book", "The decision schema has its review field, report-judgments reads it, and underOf and standOf pass their tests on the fixture book."],
          ["ms:D0/unique", "Every eval id the book derives is unique (portal.eval-ids), and a duplicate id is the build problem duplicate-eval."]] },
      { key: "D0.site", title: "D0 The portal target and site", paths: ["packages/generate/", "packages/portal/", ".github/workflows/"], needs: ["step:D0.book"],
        goal: "packages/generate's portal target writes the bundle and packages/portal renders every page, twin and the status overlay, checked in CI.",
        exit: [["ms:D0/check", "The portal check passes: every record has its page, every link resolves, two generations are byte-identical, and Review's list equals the judgments report's."], ["ms:D0/stands", "Every operation shows its stand, equal to standOf over the book at that commit."]] },
      { key: "D0.host", title: "D0 Hosting, previews and the status job", paths: ["packages/portal/", ".github/workflows/"], needs: ["step:D0.site"],
        goal: "The portal runs as a private Cloudflare Worker behind Access, with a preview per pull request and a status document per tracked ref.",
        exit: [["ms:D0/live", "The portal is live behind Access with a preview on each pull request, and its link has gone to Aaron."]] },
    ],
  },
  {
    key: "B0", title: "B0 Spike: durable execution", needs: ["milestone:T0"],
    goal: "Effect Workflow and Cluster on Postgres are proven for the book's processes, or a decision chooses the fallback (DBOS on Postgres) and the book follows it.",
    steps: [
      { key: "B0.engine", title: "B0 Resume, signal and timer", paths: ["spikes/durable-execution/"],
        goal: "A process killed mid-run resumes, a signal resumes a waiting instance, and a timer fires, on the throwaway Postgres.",
        exit: [["ms:B0/resume", "A process killed mid-run resumes on Effect Workflow and Cluster over Postgres."], ["ms:B0/signal", "A signal resumes a waiting instance."], ["ms:B0/timer", "A timer fires."]] },
      { key: "B0.once", title: "B0 An activity's side effect lands once", paths: ["spikes/durable-execution/"], needs: ["step:B0.engine"], money: true,
        goal: "An activity retried after a crash has its side effect land exactly once, through an idempotency key or a claim-before-call row, as the book's design does.",
        exit: [["ms:B0/once", "An activity retried after a crash has its side effect land once."]] },
      { key: "B0.wake", title: "B0 Wake routing by keys, and the decisions", paths: ["spikes/durable-execution/", "books/target/"], needs: ["step:B0.engine"],
        goal: "A chain event and a withdraw transition, routed by their keys, wake the same waiting instance, and the runtime's choices are decision records.",
        exit: [["ms:B0/wake", "A chain event and a withdraw transition, routed by their routing keys, reach the same waiting instance."], ["ms:B0/decisions", "How the runtime learns of a new indexed row and where the key-to-instance map lives are decision records; or a decision chooses DBOS and the book is updated."]] },
    ],
  },
  {
    key: "B1", title: "B1 Generators", needs: ["milestone:B0"],
    goal: "packages/generate regenerates every src/generated/ folder from the records with no diff, every package compiles, and the migrations apply to an empty Postgres.",
    steps: [
      { key: "B1.flags", title: "B1 The operations' CLI flags, book first", paths: ["packages/book/", "books/target/"],
        goal: "Every operation's flags are designed in the book as one consistent system and map onto its flow's or rpc's input; books/frozen/flags.ts is reference only.",
        exit: [["ms:B1/flags", "Every operation's CLI flags are designed in the book, with the field's decision, and each maps onto its flow's or rpc's input."]] },
      { key: "B1.admissions", title: "B1 Counterparty admissions, book first", paths: ["books/target/"],
        goal: "The read-only admissions counterparties need on company rows are in the book (rules.counterparty-reads) before the policies are generated.",
        exit: [["ms:B1/counterparty", "Every rpc whose who is a counterparty reads company rows only through a read-only admission clause in the book."]] },
      { key: "B1.data", title: "B1 Migrations and schemas", paths: ["packages/generate/"], needs: ["step:B1.admissions"],
        goal: "SQL migrations with tenant-first keys and row-level security, and the Effect Schema types, are generated from the tables and fields.",
        exit: [["ms:B1/migrations", "The generated migrations apply to an empty Postgres."]] },
      { key: "B1.server", title: "B1 Rpc group, router stubs and catalogues", paths: ["packages/generate/"], needs: ["step:B1.data"],
        goal: "The RpcGroup, the server router stubs, the error catalogue, each machine's transition table and the integrations' timeouts and retries are generated.",
        exit: [["ms:B1/server", "The backend's generated rpc group, errors, transition tables and integration settings compile, typed as tooling.md section 7 requires."]] },
      { key: "B1.client", title: "B1 Core SDK client, flows and CLI wiring", paths: ["packages/generate/"], needs: ["step:B1.flags", "step:B1.server"],
        goal: "The Core SDK client and flow skeletons, and the CLI wiring from each operation's designed command and flags, are generated.",
        exit: [["ms:B1/client", "The generated SDK client, flow skeletons and CLI wiring compile, one SDK method per command."]] },
      { key: "B1.workflows", title: "B1 Workflow skeletons with waits", paths: ["packages/generate/"], needs: ["step:B1.server"],
        goal: "Each durable process has a generated skeleton with its typed steps, its waits and its wake registrations by routing key.",
        exit: [["ms:B1/workflows", "Every workflow's generated skeleton compiles with its typed steps, waits and wake registrations."]] },
      { key: "B1.catalogues", title: "B1 Telemetry and eval catalogues", paths: ["packages/generate/"], needs: ["step:B1.server"],
        goal: "The telemetry catalogue (one event per machine, plus the runtime spans) and the eval catalogue are generated.",
        exit: [["ms:B1/catalogues", "The generated telemetry and eval catalogues equal the book's machines, spans and evals."]] },
      { key: "B1.check", title: "B1 Regenerate with no diff", paths: ["packages/generate/"], needs: ["step:B1.client", "step:B1.workflows", "step:B1.catalogues"],
        goal: "Regenerating gives no diff and every package compiles.", book: ["system:capxul"],
        exit: [["ms:B1/compile", "pnpm exec tsc -b compiles every package."]] },
    ],
  },
  {
    key: "B2", title: "B2 Eval harness", needs: ["milestone:B1"],
    goal: "packages/evals, within 2,000 lines, lists the catalogue and runs any eval by id on a devnet world through the real CLI, as swarmD's runner contract says.",
    steps: [
      { key: "B2.runner", title: "B2 The runner contract", paths: ["packages/evals/"],
        goal: "`eval list --json` and `eval run --json --out <dir> -- <ids>` print exactly the catalogue and one RunResult per id.",
        exit: [["ms:B2/runner", "`eval list --json` prints the catalogue (the book's evals and the milestone evals, each id once) and `eval run --json` prints one RunResult per id asked for."]] },
      { key: "B2.worlds", title: "B2 Worlds as devnet snapshots", paths: ["packages/evals/", "books/target/devnet/"], needs: ["step:B2.runner"],
        goal: "The world builder builds each world a refusal or claim names from its steps, as the devnet concept designs it, and restores it as a named snapshot once the operations its steps run exist.",
        exit: [["ms:B2/worlds", "The world builder builds a world from its steps and restores it by name, and lists every world whose steps run an operation not built yet, with those operations, as not yet buildable."]] },
      { key: "B2.otlp", title: "B2 Spans and measures", paths: ["packages/evals/"], needs: ["step:B2.runner"],
        goal: "A local OTLP collector gives each run its trace, so span, event and budget evals carry measures.",
        exit: [["ms:B2/otlp", "Span, event and budget evals read the run's trace and report p50, p95 and n."]] },
      { key: "B2.coverage", title: "B2 Every eval runnable or listed", paths: ["packages/evals/"], needs: ["step:B2.worlds", "step:B2.otlp"],
        goal: "Every eval id has a runner, or is listed as not yet runnable with the reason, and the harness stays within its line budget.",
        exit: [["ms:B2/coverage", "Every eval id in evals.json has a runner or is listed as not yet runnable."], ["ms:B2/size", "The harness is within 2,000 hand-written lines."]] },
    ],
  },
  {
    key: "B3", title: "B3 Spine and pilots", needs: ["milestone:B2"],
    goal: "The devnet and the runtime run, the pilots (sign in, set up an Account, send a payment) pass every eval within budget, and each concept's line budget is set from what they measure.",
    steps: [
      { key: "B3.spine", title: "B3 The devnet and the runtime", paths: ["packages/devnet/", "packages/runtime/", "packages/backend/src/"], base: ["milestone:B1"],
        goal: "The devnet (anvil with the v4 contracts, Postgres, Ponder, the backend, a mock bundler and paymaster, the mail sink) boots, and the runtime's services run on it under one clock.",
        book: ["environment:devnet", ...ofKind("invariant").filter((i) => !(i.over as unknown[] | undefined)?.length).map(keyOf)],
        exit: [["ms:B3/runtime", "The runtime's services (auth, SQL, chain, integrations, the workflow engine, tracing) start on the devnet."]] },
      { key: "B3.sandbox", title: "B3 The devnet in a swarmD sandbox, and the gate's scope", paths: [".swarmd/", "tools/check-scope.ts"], base: [], needs: ["step:B3.spine"],
        goal: "A swarmD sandbox boots the devnet from a golden snapshot and runs an L1 eval fast enough for pairs, otherwise a decision records the fallback host; and the gate refuses a change outside the task's paths.",
        exit: [["ms:B3/sandbox", "At an integration head newer than its golden snapshot, the devnet boots in a swarmD sandbox in at most 2 minutes and one L1 eval runs in at most 10 seconds, or a decision records the fallback: one long-lived devnet host, a world restored per pair under a lock."],
          ["ms:B3/scope", "With SWARMD_TASK_PATHS set, the project's gate fails on a change outside the task's paths, or to packages/book or packages/evals from a lane task, and admits the regenerated outputs only when generate:check and plan-tasks --check pass."]] },
      { key: "B3.shared-world", title: "B3 A shared world", paths: ["packages/devnet/"], base: [], needs: ["step:B3.spine"], book: ["environment:shared-world"],
        goal: "The devnet stack runs as a shared world behind its world gateway over HTTPS, in seasons (aaron.seasons, devnet.seasons): the owner's grant controls the clock and plans each season, which starts from a saved world, runs at its rate, warps on a real schedule and ends in a reset; joiners reach it with their own grants only while a season they play runs, and nothing leaves it (devnet.season-players).",
        exit: [["ms:B3/shared-world", "A shared world boots on one host and passes its smoke journey; a joiner's grant reads its own mail while a season they play runs and is refused ROLE_PERMISSION_DENIED when it moves the clock."],
          ["ms:B3/seasons", "A season created, started, warped on its schedule and ended on one shared world leaves `<name>-end` saved and the reset world restored, and a player's next call after the reset is NOT_AUTHENTICATED."]] },
      { key: "B3.pilots", title: "B3 The pilots pass", paths: [], needs: [],
        goal: "Sign in, set up an Account and send a payment, and the devnet commands the world builder runs, pass every eval of their tasks at the integration head that a buildable world allows, within budget.",
        exit: [["ms:B3/pilots", "In one run at the integration head, every eval of the pilot closure passes within its budget, except those whose world's steps run an operation not built yet, which read unverifiable and name that world."]] },
      { key: "B3.size", title: "B3 Each concept's line budget", paths: ["books/target/shared/", "books/target/"], needs: ["step:B3.pilots"],
        goal: "Each concept's line budget is set in its record from the pilots' measured lines per operation, and sys:loc evals check it.",
        exit: [["ms:B3/size", "Every concept record carries its line budget from the pilots' measurement (system.size), and sys:loc/<concept> is in the catalogue."]] },
    ],
  },
  {
    key: "B4", title: "B4 Concepts on the critical path", needs: [], steps: [],
    goal: "Every concept's lane is done: each operation the built book keeps (the old 215 less what the cut classified: Frappe's, dropped or parked) has every eval of its record, and of every record under it, passing at the head of integration/build.",
  },
  {
    key: "B5", title: "B5 New staging", needs: ["milestone:B4"],
    goal: "The new staging runs the same suite, and its live evals hold for a week.",
    steps: [
      { key: "B5.deploy", title: "B5 Deploy staging", paths: ["packages/devnet/", ".github/workflows/"], book: ["environment:staging"],
        goal: "Staging is deployed from main and boots and passes its smoke journey.",
        exit: [["ms:B5/suite", "The suite runs against staging and passes what it passed on the devnet."]] },
      { key: "B5.live", title: "B5 Live evals from PostHog", paths: ["packages/evals/"], needs: ["step:B5.deploy"],
        goal: "The live evals (p95 per operation, error rate, journey conversion) are in the catalogue and posted from PostHog by the scout.",
        exit: [["ms:B5/live", "Every live eval (live:bud, live:err, live:fun) is in the catalogue and has a verdict from PostHog."]] },
      { key: "B5.week", title: "B5 A week on staging", paths: [], needs: ["step:B5.live"],
        goal: "The live evals hold on staging for seven days.",
        exit: [["ms:B5/week", "Every live eval holds on staging for seven consecutive days."]] },
    ],
  },
];

add({ key: "capxul", kind: "root", title: "Capxul rebuilt", priority: "critical", evals: ["ok:capxul"], checkers: [], paths: [],
  goal: "Capxul runs on the new stack and does everything the built book's operations promise (the old 215 less what the cut classified, plus the plugs and the door): every eval passes at the head of integration/build on a devnet, the system evals and the size budget hold, and staging's live evals hold for a week.",
  exit: [{ id: "ok:capxul", claim: "Aaron accepts the rebuild." }] });
const owned = new Map<string, string>(); // eval id → task key
const own = (task: string, ids: string[]) => {
  for (const id of ids) {
    const prior = owned.get(id);
    if (prior) failures.push(`eval ${id} owned by ${prior} and ${task}`);
    owned.set(id, task);
  }
  tasks.get(task)!.evals.push(...ids);
};
for (const m of MILESTONES) {
  const key = `milestone:${m.key}`;
  add({ key, kind: "milestone", title: m.title, goal: m.goal, parent: "capxul", priority: "critical", evals: [], checkers: [], paths: [], needs: m.needs });
  for (const s of m.steps) {
    const sk = `step:${s.key}`;
    add({ key: sk, kind: "step", title: s.title, goal: s.goal, parent: key, priority: "critical", evals: [], paths: s.paths,
      checkers: s.money ? ["reviewer", "adversary"] : ["reviewer"], needs: [...(s.base ?? m.needs), ...(s.needs ?? [])], exit: s.exit.map(([id, claim]) => ({ id, claim })) });
    own(sk, s.exit.map(([id]) => id));
    for (const r of s.book ?? []) own(sk, evalIdsOf(r));
  }
}

// ── lanes, doors, processes, rpcs, flows and operations ────────────────────────────────────

const lanes = [INTEGRATIONS, ...CONCEPTS.map((c) => c.id), JOURNEYS];
for (const lane of lanes) {
  const isConcept = lane !== INTEGRATIONS && lane !== JOURNEYS;
  add({ key: `lane:${lane}`, kind: "lane", lane, layer: laneLayer(lane), parent: "milestone:B4", priority: lane === "equity" ? "low" : "normal", evals: [],
    title: isConcept ? `Lane: ${lane}` : lane === INTEGRATIONS ? "Lane: integrations" : "Lane: journeys", checkers: [], paths: [],
    goal: isConcept
      ? `The ${lane} concept is built as its records say: its door, durable processes and operations pass every eval at the integration head, and its code imports other concepts only through their doors.`
      : lane === INTEGRATIONS
        ? "Every outside service is reached through its Effect service in packages/runtime, with its fake, its timeouts, retries and error mapping as its integration record says."
        : "Every journey runs end to end on a devnet, and each of its steps sends its proving event once, in order." });
  if (isConcept) own(`lane:${lane}`, evalIdsOf(`concept:${lane}`));
}

// The door: tables, machines (their transitions) and procedures, and the invariants over its tables.
const tablesOf = (c: string) => ofKind("table").filter((t) => concept(keyOf(t)) === c);
for (const c of CONCEPTS.map((x) => x.id)) {
  const key = `door:${c}`;
  add({ key, kind: "door", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: c === "equity" ? "low" : "normal", evals: [],
    title: `Door: ${c} tables, machines and procedures`,
    goal: `The ${c} concept's tables, state machines and door procedures exist as its records say: tenant-first keys and row-level security, only declared transitions, one event per machine, each procedure atomic.` });
  for (const t of tablesOf(c)) own(key, evalIdsOf(keyOf(t)));
  for (const m of ofKind("machine").filter((m) => concept(keyOf(m)) === c))
    for (const t of Object.values(m.t as object) as AnyRecord[]) own(key, evalIdsOf(keyOf(t)));
  for (const p of ofKind("procedure").filter((p) => concept(keyOf(p)) === c)) own(key, evalIdsOf(keyOf(p)));
}
for (const inv of ofKind("invariant")) {
  const over = linksFrom(keyOf(inv), "over");
  if (!over.length) continue; // owned by step:B3.spine
  own(`door:${concept(over[0]!)}`, evalIdsOf(keyOf(inv)));
  for (const t of over) needs(`door:${concept(over[0]!)}`, `door:${concept(t)}`);
}
// A door needs the doors of the tables its tables admit through, and of the procedures and tables its procedures reach.
for (const t of ofKind("table")) for (const a of linksFrom(keyOf(t), "admits")) needs(`door:${concept(keyOf(t))}`, `door:${concept(a)}`);
for (const p of ofKind("procedure")) {
  const from = `door:${concept(keyOf(p))}`;
  for (const k of [...linksFrom(keyOf(p), "invokes"), ...linksFrom(keyOf(p), "reads"), ...linksFrom(keyOf(p), "writes")]) needs(from, `door:${concept(k)}`);
}

// The integrations.
const integrationOfCall = (callKey: string) => `integration:${(get(callKey) as unknown as { integration: string }).integration}`;
for (const i of ofKind("integration")) {
  const key = keyOf(i);
  add({ key, kind: "integration", lane: INTEGRATIONS, layer: -1, parent: `lane:${INTEGRATIONS}`, priority: "normal", evals: [], record: key,
    title: clip(`Integration: ${i.id}, ${String(i.title)}`, 80),
    goal: clip(`The ${i.id} integration is an Effect service with its fake, and every call keeps its timeout, retries and error mapping as the record says.`, 1000) });
  own(key, evalIdsOf(key));
}

// The durable processes: after the door, before the operations of their own and later layers that start or wake them
// (swarm.process-order). A process that reacts to an earlier layer's transition or event needs that layer's door; one
// that reacts to a later layer's (notices to equity) builds against the generated event catalogue (swarm.events-not-needs).
const doorsOfKeys = (keys: string[]) => keys.filter((k) => conceptOf.has(k)).map((k) => `door:${concept(k)}`);
const wakes = new Map<string, Set<string>>(); // rpc or transition key → the processes it starts or wakes
const wake = (k: string, w: string) => wakes.set(k, new Set([...(wakes.get(k) ?? []), w]));
const namedRpcs = new Map<string, string[]>(); // process key → the rpcs its trigger, signals and waits name
for (const w of ofKind("workflow")) {
  const key = keyOf(w);
  const c = concept(key);
  add({ key, kind: "process", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: w.priority as Priority, evals: [], record: key,
    title: clip(`Process: ${w.id}`, 80),
    goal: clip(`The durable process ${w.id} (${String(w.title)}) runs as its record says: it resumes after a crash, each activity's side effect lands once, and every keyed wait is woken by what its key names.`, 1000) });
  own(key, evalIdsOf(key));
  needs(key, `door:${c}`, ...doorsOfKeys(["reads", "writes", "drives", "invokes"].flatMap((f) => linksFrom(key, f))));
  for (const call of linksFrom(key, "calls")) needs(key, integrationOfCall(call));
  const named = [...linksFrom(key, "trigger"), ...linksFrom(key, "signals"), ...linksFrom(key, "waits")];
  for (const k of named) {
    if (k.startsWith("rpc:") || k.startsWith("transition:")) wake(k, key);
    if (k.startsWith("transition:") || k.startsWith("event:") || k.startsWith("table:")) {
      const d = concept(k);
      if (layerOf(d) <= layerOf(c)) needs(key, `door:${d}`);
      else tasks.get(key)!.labels.push(`builds-on-events:${d}`);
    }
  }
  namedRpcs.set(key, named.filter((k) => k.startsWith("rpc:")));
}
/** The transitions an rpc drives, itself or through the procedures it invokes. */
const drivenBy = (key: string, seen = new Set<string>()): string[] => {
  if (seen.has(key)) return [];
  seen.add(key);
  return [...linksFrom(key, "drives"), ...linksFrom(key, "invokes").flatMap((p) => drivenBy(p, seen))];
};
/** What a task owning this rpc needs, besides the rpcs' owners: its doors, its integrations, and the processes of its own
 * or earlier layers that it starts or wakes. A later layer's process that reacts to it needs it instead (below). */
const rpcNeeds = (rpc: string): string[] => {
  const c = concept(rpc);
  const reach = ["reads", "writes", "invokes"].flatMap((f) => linksFrom(rpc, f));
  const procs = [rpc, ...drivenBy(rpc)].flatMap((k) => [...(wakes.get(k) ?? [])]).filter((w) => layerOf(concept(w)) <= layerOf(c));
  return [`door:${c}`, ...doorsOfKeys(reach), ...linksFrom(rpc, "calls").map(integrationOfCall), ...procs];
};

// Operations and helper flows: who reaches each rpc, in lane order (critical first, operations before helper flows).
const ops = ofKind("operation");
const flows = ofKind("flow");
const implementers = new Map<string, string[]>(); // flow or rpc key → operation keys
for (const o of ops) {
  const impl = linksFrom(keyOf(o), "implementedBy")[0]!;
  implementers.set(impl, [...(implementers.get(impl) ?? []), keyOf(o)]);
}
/** The devnet commands the world builder's steps run (dev approve, dev time warp, dev fund, …): system.build-order builds
 * "devnet's own dev commands alongside the harness", and no world, so no pilot refusal or claim that starts from one, can
 * be built without them. Read from the worlds' steps, so a new step command joins the pilots by itself. */
const worldCommands = new Set([
  // the builder's own: restore `from`, run the steps, then `dev snapshot save <name> --replace` (books/target/devnet/worlds.ts)
  "dev snapshot save",
  "dev snapshot restore",
  ...WORLDS.flatMap((w) => w.steps.flatMap((s) => [...s.run.matchAll(/capxul (dev [a-z-]+(?: [a-z-]+)?)/g)].map((m) => m[1]!))),
]);
/** Each world command's operation: the one whose command is its longest prefix ("dev time warp 2h" is dev.time.warp). */
const commandOf = (c: string) =>
  ops.filter((o) => c === String(o.command) || c.startsWith(`${String(o.command)} `)).sort((a, b) => String(b.command).length - String(a.command).length)[0];
const WORLD_OPS = [...new Set([...worldCommands].map(commandOf).filter((o) => o !== undefined).map((o) => keyOf(o!)))].sort();
/** Pilots: the book's critical operations, the web app's setup flow, which starts an Account's setup
 * (accounts.setup-in-web-app), and the world builder's devnet commands. */
const PILOTS = [...ops.filter((o) => o.priority === "critical").map(keyOf), "flow:client.account.setup", ...WORLD_OPS];
const helperFlows = flows.filter((f) => !implementers.has(keyOf(f)));
const stepRpcs = (flowKey: string) => linksFrom(flowKey, "steps");
const rpcsOfTask = (key: string): string[] => {
  if (key.startsWith("flow:")) return stepRpcs(key);
  const impl = linksFrom(key, "implementedBy")[0]!;
  return impl.startsWith("rpc:") ? [impl] : stepRpcs(impl);
};
interface Reacher { key: string; lane: string; rank: number; kindRank: number }
const reachers: Reacher[] = [
  ...ops.map((o) => ({ key: keyOf(o), lane: concept(keyOf(o)), rank: RANK[o.priority as Priority], kindRank: 0 })),
  ...helperFlows.map((f) => ({ key: keyOf(f), lane: concept(keyOf(f)), rank: PILOTS.includes(keyOf(f)) ? 0 : 1, kindRank: 1 })),
].sort((a, b) => a.rank - b.rank || a.kindRank - b.kindRank || a.key.localeCompare(b.key));
const reachedBy = new Map<string, Reacher[]>();
for (const r of reachers) for (const rpc of rpcsOfTask(r.key)) reachedBy.set(rpc, [...(reachedBy.get(rpc) ?? []), r]);

for (const o of ops) {
  const key = keyOf(o);
  const c = concept(key);
  const acc = (o.acceptance as unknown[] | undefined)?.length ?? 0;
  const ref = (o.refusals as unknown[] | undefined)?.length ?? 0;
  add({ key, kind: "operation", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: o.priority as Priority, evals: [], record: key,
    title: clip(`${String(o.command)}: ${String(o.title)}`, 80),
    labels: [`area:${String(o.area)}`, ...(PILOTS.includes(key) ? ["pilot"] : [])],
    goal: clip(`\`capxul ${String(o.command)}\` does what operation ${o.id} promises: its ${acc} acceptance claims and ${ref} refusals hold, its --json shape, events, spans and budget pass on a devnet at the head of integration/build, and its reference page agrees with it. ${String(o.about)}`, 1000) });
  own(key, evalIdsOf(key));
}
for (const f of helperFlows) {
  const key = keyOf(f);
  const c = concept(key);
  add({ key, kind: "flow", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: PILOTS.includes(key) ? "critical" : "normal", evals: [], record: key,
    title: clip(`Flow: ${String(f.sdk ?? f.id)}`, 80), labels: PILOTS.includes(key) ? ["pilot"] : [],
    goal: clip(`The Core SDK flow ${String(f.sdk ?? f.id)} (${String(f.title)}) runs its steps as its record says, within its budget and with its spans; no operation implements it, so its surfaces call it.`, 1000) });
  own(key, evalIdsOf(key));
}
// A flow's evals belong to the first operation that it implements; a later one needs that task.
for (const [impl, byOps] of implementers) {
  if (!impl.startsWith("flow:")) continue;
  const [first, ...rest] = byOps.map((k) => reachers.find((r) => r.key === k)!).sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  own(first!.key, evalIdsOf(impl));
  for (const r of rest) needs(r.key, first!.key);
  for (const call of linksFrom(impl, "calls")) needs(first!.key, integrationOfCall(call));
}
for (const f of helperFlows) for (const call of linksFrom(keyOf(f), "calls")) needs(keyOf(f), integrationOfCall(call));

// Each rpc: owned by the first task of its own lane that reaches it, when only its own lane reaches it; otherwise it is
// its own task in its lane, so a need never crosses lanes between two operations (swarm.rpc-ownership).
const rpcOwner = new Map<string, string>();
for (const rpc of ofKind("rpc")) {
  const key = keyOf(rpc);
  const c = concept(key);
  const by = reachedBy.get(key) ?? [];
  let owner: string;
  if (by.length && by.every((r) => r.lane === c)) owner = by[0]!.key;
  else {
    owner = key;
    add({ key, kind: "rpc", lane: c, layer: layerOf(c), parent: `lane:${c}`, priority: by.length ? (["critical", "normal", "low"] as Priority[])[Math.min(...by.map((r) => r.rank))]! : "normal",
      evals: [], record: key, title: clip(`Rpc: ${rpc.id}`, 80), labels: by.some((r) => PILOTS.includes(r.key)) ? ["pilot"] : [],
      goal: clip(`The server endpoint ${rpc.id} (${String(rpc.title)}) answers as its record says: its declared errors only, its spans and its budget. ${by.length ? `Other lanes reach it: ${by.map((r) => r.key).slice(0, 4).join(", ")}.` : "No operation steps it; a durable process or another surface does."}`, 1000) });
    if (by.some((r) => PILOTS.includes(r.key))) PILOTS.push(key);
  }
  rpcOwner.set(key, owner);
  own(owner, evalIdsOf(key));
  needs(owner, ...rpcNeeds(key));
  for (const r of by) needs(r.key, owner);
}

// A process of a later layer that an rpc starts or wakes needs the task that owns the rpc.
for (const [w, rpcs] of namedRpcs) for (const rpc of rpcs) if (layerOf(concept(rpc)) < layerOf(concept(w))) needs(w, rpcOwner.get(rpc)!);

// The journeys.
for (const j of ofKind("journey")) {
  const key = keyOf(j);
  add({ key, kind: "journey", lane: JOURNEYS, layer: laneLayer(JOURNEYS), parent: `lane:${JOURNEYS}`, priority: "normal", evals: [], record: key,
    title: clip(`Journey: ${j.id}`, 80), goal: clip(`The journey ${j.id} (${String(j.title)}) runs end to end on a devnet, and each step sends its proving event once, in order.`, 1000) });
  own(key, evalIdsOf(key));
  needs(key, ...linksFrom(key, "steps").filter((k) => k.startsWith("operation:")));
}

// ── base needs: the pilots' closure waits for the spine; everything else for the whole of B3 ────

const closure = new Set<string>();
const visit = (k: string) => {
  if (closure.has(k) || !tasks.has(k)) return;
  const t = tasks.get(k)!;
  if (!t.lane) return;
  closure.add(k);
  for (const n of need.get(k)!) visit(n);
};
for (const p of PILOTS) visit(p);
for (const t of tasks.values()) {
  if (!t.lane || t.kind === "lane") continue;
  if (closure.has(t.key)) {
    needs(t.key, "step:B3.spine", "milestone:B2");
    t.labels.push("pilot-closure");
  } else needs(t.key, "milestone:B3");
}
for (const p of PILOTS) needs("step:B3.pilots", p);

// ── checks: every eval owned once, every operation one task, layers, cycles ────────────────

for (const id of evalsById.keys()) if (!owned.has(id)) failures.push(`eval ${id} (${evalsById.get(id)![0]!.subject}) has no task`);
for (const o of ops) if (!tasks.has(keyOf(o))) failures.push(`operation ${o.id} has no task`);
for (const [from, to] of need) for (const k of to) if (!tasks.has(k)) failures.push(`${from} needs ${k}, which is no task`);
for (const t of tasks.values())
  if (!t.evals.length && ![...tasks.values()].some((c) => c.parent === t.key)) failures.push(`${t.key} has no eval and no child: it would read done at once`);
// The runner lists each exit line as a catalogue check, whose claim swarmD's ledger holds to 300 characters.
for (const t of tasks.values()) for (const e of t.exit ?? []) if (e.claim.length > 300) failures.push(`${e.id}: its claim is ${e.claim.length} characters; a check's claim is at most 300`);
// A task is never scheduled before its lane's layer. One that needs a later layer's task (notices' equity processes
// read equity's tables) is scheduled in that later layer, in its own lane, and only a layer that system.build-order puts
// last may pull a task later like this; any other need on a later layer is against the build order (swarm.layers).
const lastLayers = new Set([...LAST].map(layerOf));
for (let changed = true, round = 0; changed && round < 100; round++) {
  changed = false;
  for (const t of tasks.values()) {
    if (t.layer === undefined || t.kind === "lane") continue;
    for (const k of need.get(t.key)!) {
      const n = tasks.get(k);
      if (n?.layer === undefined || n.layer <= t.layer) continue;
      if (!lastLayers.has(n.layer) && !t.labels.some((l) => l.startsWith("after:"))) {
        failures.push(`${t.key} (layer ${t.layer}) needs ${k} (layer ${n.layer}): against system.build-order`);
        continue;
      }
      t.layer = n.layer;
      t.labels = [...t.labels.filter((l) => !l.startsWith("after:")), `after:${n.lane}`];
      changed = true;
    }
  }
}
// A parent is done only when its children are, so it waits on each child as on a need.
const edges = new Map<string, string[]>();
for (const t of tasks.values()) edges.set(t.key, [...need.get(t.key)!]);
for (const t of tasks.values()) if (t.parent) edges.get(t.parent)!.push(t.key);
const state = new Map<string, 1 | 2>();
const stack: string[] = [];
const dfs = (k: string): boolean => {
  if (state.get(k) === 2) return false;
  if (state.get(k) === 1) {
    failures.push(`cycle: ${[...stack.slice(stack.indexOf(k)), k].join(" → ")}`);
    return true;
  }
  state.set(k, 1);
  stack.push(k);
  for (const n of edges.get(k)!) if (dfs(n)) return true;
  stack.pop();
  state.set(k, 2);
  return false;
};
for (const k of [...tasks.keys()].sort()) if (dfs(k)) break;

// ── output ──────────────────────────────────────────────────────────────────────────────────

const KIND_ORDER: Kind[] = ["root", "milestone", "step", "lane", "integration", "door", "process", "rpc", "flow", "operation", "journey"];
const order = (t: TaskDef) => [laneLayer(t.lane ?? INTEGRATIONS) + (t.lane ? 0 : -10), t.lane ?? "", KIND_ORDER.indexOf(t.kind), RANK[t.priority], t.key] as const;
const cmp = (a: TaskDef, b: TaskDef) => {
  const x = order(a), y = order(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
};
const out = [...tasks.values()].sort(cmp).map((t) => ({
  ...t,
  needs: [...need.get(t.key)!].sort(),
  labels: [...new Set([`kind:${t.kind}`, ...(t.lane ? [`lane:${t.lane}`, `layer:${t.layer}`] : []), ...(t.checkers.includes("adversary") ? ["money"] : []), ...t.labels])].sort(),
  evals: [...t.evals].sort(),
}));
const count = (f: (t: TaskDef) => boolean) => out.filter(f).length;
const isWorking = (t: TaskDef) => t.kind !== "root" && t.kind !== "milestone" && t.kind !== "lane";
/** The frontier once B3 is done: the working tasks with checkers, outside the pilot closure, whose needs are all met by
 * the milestones T0 to B3, their steps and the closure (the loop's step 3 takes from it, one task per lane). */
const doneByB3 = new Set(out.filter((t) => (t.kind === "milestone" || t.kind === "step") && /^(milestone|step):(T0|D0|B0|B1|B2|B3)\b/.test(t.key)).map((t) => t.key));
for (const k of closure) doneByB3.add(k);
const frontierAfterB3 = out.filter((t) => isWorking(t) && t.checkers.length && !doneByB3.has(t.key) && t.needs.every((n) => doneByB3.has(n)));
const counts = {
  tasks: out.length,
  working: count(isWorking),
  paired: count((t) => isWorking(t) && t.checkers.length > 0),
  watch: count((t) => t.labels.includes("watch")),
  milestones: count((t) => t.kind === "milestone"),
  steps: count((t) => t.kind === "step"),
  lanes: count((t) => t.kind === "lane"),
  doors: count((t) => t.kind === "door"),
  processes: count((t) => t.kind === "process"),
  operations: count((t) => t.kind === "operation"),
  rpcs: count((t) => t.kind === "rpc"),
  flows: count((t) => t.kind === "flow"),
  integrations: count((t) => t.kind === "integration"),
  journeys: count((t) => t.kind === "journey"),
  pilotClosure: closure.size,
  money: count((t) => t.checkers.includes("adversary")),
  bookEvals: book.evals.length,
  uniqueBookEvals: evalsById.size,
  duplicateEvalIds: duplicated.length,
  milestoneEvals: [...owned.keys()].filter((id) => !evalsById.has(id)).length,
  needs: out.reduce((n, t) => n + t.needs.length, 0),
  budgetUsd: out.reduce((n, t) => n + (isWorking(t) ? t.budgetUsd : 0), 0),
  worldPilots: WORLD_OPS.length,
  frontierAfterB3: frontierAfterB3.length,
  frontierLanesAfterB3: new Set(frontierAfterB3.map((t) => t.lane)).size,
  bookRecords: book.records.size,
};
const doc = {
  about: "The build's task tree, derived from books/target by tools/plan-tasks.ts (docs/design/swarm.md, section 5). Do not edit: change the book or the script, then regenerate. It holds no counts over the book, so lanes that change different tasks never conflict here.",
  regenerated: REGENERATED,
  layers: [[INTEGRATIONS], ...computed, [JOURNEYS]],
  tasks: out,
};
const text = `${JSON.stringify(doc, null, 2)}\n`;

for (const w of warnings) console.warn(`warning: ${w}`);
if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error(f);
  console.error(`${failures.length} failures`);
  process.exit(1);
}
if (check) {
  let prior = "";
  try { prior = readFileSync(OUT, "utf8"); } catch { /* missing counts as stale */ }
  if (prior !== text) {
    console.error(`${OUT} is stale: run node --experimental-strip-types tools/plan-tasks.ts`);
    process.exit(1);
  }
  console.log(`${OUT} is current`);
} else writeFileSync(OUT, text);
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · "));
