// The portal design's records: its decisions (defineDecision) and any component or environment it
// adds. One writer: the portal designer. Explained in docs/design/portal.md.
//
// The portal is the documentation site that connects the design book, the derived evals and their
// verdicts, the swarmD ledger, GitHub, PostHog and hand-written prose. It adds no component or
// environment record (portal.no-component).

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import {
  decision_system_build_order,
  decision_system_frozen_behaviour,
  decision_system_layout,
  decision_system_size,
} from "./decisions.ts";

const BY = "Claude, portal design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

// ── when and what ───────────────────────────────────────────────────────────────────────────

export const decision_portal_milestone = defineDecision({
  id: "portal.milestone",
  title: "The portal is built first, at D0, alongside the B0 spike",
  question:
    "The goal prompt generates the docs site's reference pages at B4, as each concept lands. The portal also carries the " +
    "review of the design, the stand of every operation and the new CLI surface, which B1 designs. When is it built?",
  options: [
    {
      label: "d0",
      text:
        "D0, alongside B0: generate it from the records before any product code. It has no runtime risk (a static site " +
        "from the records), it is the review surface for the design and its pending judgments from the first day, the " +
        "CLI surface (commands, --json shapes, the error vocabulary, then B1's flags) is seen there before code, and each " +
        "operation's stand is computed from the first commit. B4 then only has to make doc:<operation> pass.",
    },
    { label: "after-b1", text: "After B1's generators, as one more generator target, once the generator conventions are settled." },
    { label: "b4", text: "At B4, as the goal prompt has it: the reference pages of each concept as it lands." },
  ],
  chosen: "d0",
  why:
    "Everything the portal shows at D0 exists today (8 November 2026: 2,212 records, 4,789 derived evals, 688 decisions " +
    "and 74 gaps). Only " +
    "verdicts wait for B2, and a stand computed without them is still true (specify, decide or build). Built at B4, the " +
    "review of the design and of the CLI surface would happen in Markdown files and terminal output, and the surface B1 " +
    "designs would first be seen as code. After B1 delays it behind work it does not need. D0 runs beside B0, so it costs " +
    "nothing on the critical path; its generator is packages/portal, grown from the starter kit's (portal.stack).",
  source: by("docs/mission/initializer.md (order of work, B4); docs/design-book.md (the docs site row); the old apps/docs read the YAML book and the factory's state.json"),
  affects: [f.system_capxul, decision_system_build_order],
});

export const decision_portal_sitemap = defineDecision({
  id: "portal.sitemap",
  title: "Six sections by what each reader comes to do; one URL per record",
  question:
    "Who is the portal for, how is it navigated, and how does any reader, a person or an agent, find a record's page " +
    "without a lookup?",
  options: [
    {
      label: "by-job",
      text:
        "Six sections, each serving one reader's job: Overview; Review (the judgments waiting for review, open matters, " +
        "milestone acceptances, the CLI surface review); Design (the book by concept, every record); Build (the " +
        "scoreboard, the eval catalogue, milestones, lanes, gaps and problems); Operate (environments, deployed versions, " +
        "live evals, funnels, runbooks); Docs (guides, the CLI surface, SDK methods, errors). Every record has one " +
        "canonical page at /<kind>/<id>/, so a record key (operation:payment.send) is its URL. A child record (a " +
        "transition, an integration call, a contract function or event) is an anchor on its parent's page; an eval is an " +
        "anchor on its subject's page, resolved by /eval/?id=<eval id>. Command and SDK paths (/cli/payment/send/, " +
        "/sdk/client.payments.pay/) redirect to the canonical page.",
    },
    { label: "by-kind", text: "One section per record kind (operations, rpcs, tables and so on), as the book's folders are." },
    { label: "two-sites", text: "A public developer site and a separate internal design and status site." },
  ],
  chosen: "by-job",
  why:
    "Readers come with a job, not a record kind: the reviewer to decide, a lane's agent to find its task's records and " +
    "evals, a developer to use a command, an operator to read staging. Navigation by kind mirrors the book's folders and " +
    "makes every reader learn them. Two sites duplicate the operation page, which is both reference and design, and " +
    "drift; the public developer docs become a filtered build of the same site when the time comes (portal.hosting). " +
    "URLs made from record keys need no lookup table, survive a command rename (the operation id never changes), and let " +
    "the ledger, the managers' boards and pull requests link any record or eval by rule.",
  source: by("old apps/docs CONTEXT.md (seven root sections, published-routes.txt); docs/spec/10 (eval and record ids); swarmD apps/docs layout"),
  affects: [f.system_capxul, f.component_cli, f.component_core_sdk],
});

export const decision_portal_eval_ids = defineDecision({
  id: "portal.eval-ids",
  title: "Every eval id is unique: one ref: eval per code, one int: eval per error",
  question:
    "The portal anchors each eval by its id, /eval/?id= resolves it, the status document keys verdicts by it, and the " +
    "ledger stores the catalog under (id, commit). On the book of 8 November 2026, 4,789 derived evals have 4,759 " +
    "distinct ids: 19 operations list one refusal code from two or three worlds (ref:org.member.grant/WRONG_STATE " +
    "twice), and 9 integration calls map two failures to one error (int:bridge.submitVerification/PROVIDER_ERROR). " +
    "How are the ids made unique?",
  options: [
    {
      label: "one-per-code",
      text:
        "deriveEvals emits one ref:<operation>/<CODE> per code, whose claim names every world the operation lists for " +
        "it (from each of them it refuses with that code, its exit code and shape, and changes nothing), and one " +
        "int:<integration>.<call>/<ERROR> per error, whose claim covers every failure mapped to it. The grammar of " +
        "docs/spec/30 is unchanged and no id moves. buildBook adds a problem, duplicate-eval, if two evals still share " +
        "an id. Done book first at D0, with a test on the fixture book.",
    },
    { label: "numbered", text: "Keep one eval per refusal and per failure, and number the repeats: ref:<op>/<CODE>/2." },
    { label: "world", text: "Put the world in the id: ref:<op>/<CODE>@<world>; number repeated call failures." },
  ],
  chosen: "one-per-code",
  why:
    "A duplicate id is two claims under one name: the ledger cannot store both, a verdict cannot say which it is " +
    "about, and a link to it lands on either. One eval per code keeps spec 30's grammar (its qualifier is an error " +
    "code) and every existing id; the harness runs each world the claim names, and a failure's detail says which. " +
    "Numbering by list order renumbers when a refusal is added above another, which spec 30 forbids for acceptance " +
    "lines for the same reason; a world in the id moves it whenever a world is renamed. The problem rule keeps the " +
    "ids unique from then on.",
  source: by("buildBook(books/target).evals: 4,789 evals, 4,759 distinct ids, 28 ids repeated; packages/book/src/evals.ts (ref:, int:); docs/spec/10 (evals keyed by id and commit); docs/spec/30 (id grammar)"),
  affects: [f.system_capxul],
});

export const decision_portal_operation_page = defineDecision({
  id: "portal.operation-page",
  title: "One page per operation: the reference first, then the design, then the status",
  question:
    "An operation is at once a CLI command a developer uses, a design an agent builds and a line on the scoreboard. Does " +
    "it get one page or several, and in what order?",
  options: [
    {
      label: "one-page",
      text:
        "One page at /operation/<id>/, in a fixed order. Use: the synopsis and flags, who can run it, what it does, " +
        "examples, the --json shape, each refusal with its code, exit code, message and world, the CLI's own errors, the " +
        "budget and the SDK method. Acceptance: each claim, what an eval observes, kept or rewritten. How it works: the " +
        "implementation diagram from the operation to its flow, rpcs, procedures, tables, transitions and the processes it " +
        "starts, then every record under it. Status: the stand ladder, its own evals with their verdicts, the evals of the " +
        "records under it by kind, its task, pull request and CI, its live evals. Decisions: those on its own records, " +
        "waiting first, and those touching the records under it. Frozen text: the old book's words.",
    },
    { label: "split", text: "A developer page under Docs and a design page under Design, linked to each other." },
  ],
  chosen: "one-page",
  why:
    "doc:<operation> checks that the CLI help, the reference page and the record agree, so the reference must be " +
    "generated from the same record as the design: one page makes that one model. Use comes first because that is what " +
    "the record promises; status comes last because it changes most. The public developer build keeps only Use and " +
    "Acceptance (portal.hosting). Split pages repeat the command, refusals and shape twice and invite the drift the old " +
    "site had between its operations table and its reference pages.",
  source: by("old apps/docs templates/command.mdx and components/page/operation-evals.tsx; the prototype docs/design/portal-prototype.html (#/operation/payment.send)"),
  affects: [f.component_cli, f.component_core_sdk],
});

// ── status ──────────────────────────────────────────────────────────────────────────────────

export const decision_portal_stand = defineDecision({
  id: "portal.stand",
  title: "The stand is computed by one function, from the records under an operation",
  question:
    "Each operation's stand (specify, decide, build, observe, done) shows wherever the operation appears. Which records " +
    "count as under an operation, which judgments hold it at decide, and who computes the stand, so that the portal, the " +
    "scoreboard and the managers never disagree?",
  options: [
    {
      label: "own-decide",
      text:
        "One pure function, standOf, in packages/book beside deriveEvals; every other reader (the pages, swarmD's " +
        "managers, agents) reads the stands it computed from the status document. Under an operation: what implements " +
        "it, its errors and its refusals' errors; a flow's steps; each rpc's and procedure's reads, writes, drives, invokes, calls, contract " +
        "functions and errors; a transition's machine and its table; a call's integration; a function's contract; and, one " +
        "hop, the durable processes its own rpcs and transitions start or resume, with their own records. First match " +
        "wins: specify if it or a record under it has a problem or a gap; decide if a judgment waiting for review affects " +
        "its own records (the operation, what implements it, a flow's step rpcs); build if any L1 eval of it or of a record " +
        "under it has no passing verdict at the head (a person's waiver counts as a pass, as in the ledger's roll-up); " +
        "observe if its live evals do not all hold; else done. A waiting judgment on a record further under it shows as " +
        "touching the operation, not as its stand.",
    },
    { label: "closure-decide", text: "The same, but any waiting judgment on any record under the operation holds it at decide." },
    { label: "decide-last", text: "Move decide after observe: a judgment holds only an operation that is otherwise done." },
  ],
  chosen: "own-decide",
  why:
    "Measured on the book of 8 November 2026: with any record under it, 142 of the 215 operations stand at decide, most " +
    "held by parties.directory-tenancy (138 operations; 134 have the parties table under them) or agents.org-owned (102), and the " +
    "scoreboard would show little else while the build proceeds; recorded choices stand and the build follows them, so " +
    "decide must not hide build progress. With its own records, 41 stand at specify, 40 at decide and 134 at build, and " +
    "each held operation is held by a judgment about what it does. decide-last breaks the order docs/design-book.md " +
    "states. One function in packages/book keeps the stand derived like the gaps and the evals and product-neutral. It " +
    "needs the book, so it runs where the book is (the portal's generator and the status job); the browser and swarmD, a " +
    "separate product-neutral repository, read its results as data and never reimplement it.",
  source: by("tools/portal-prototype.ts over buildBook(books/target): 41 specify, 40 decide, 134 build with no verdicts; docs/design-book.md (the stand table); docs/spec/10 (roll-up)"),
  affects: [f.system_capxul],
});

export const decision_portal_status_source = defineDecision({
  id: "portal.status-source",
  title: "Status reaches the portal as one document at a commit, read when a page opens",
  question:
    "Pages are generated from the records, but verdicts, tasks, pull requests and live evals change between builds. How " +
    "does that status reach the portal, from which sources, and how does a reader know how fresh it is?",
  options: [
    {
      label: "document",
      text:
        "One status document per tracked ref, status/<ref>.json: the commit it is at; each eval's current verdict there " +
        "(result, measures, evidence link), or the last verdict at an older commit, shown greyed as last seen; each " +
        "operation's tasks, assignees and open matters; each lane's branch, pull requests and CI; the deployed commit " +
        "of each environment; and each operation's stand, which the status job computes with standOf from the book at " +
        "that commit. A status job (a GitHub Actions workflow) writes it to R2: until the swarmD ledger runs, from the " +
        "harness's RunResult[] of each run at the head (B2) and the GitHub API; after, from the ledger's verdicts, tasks, " +
        "matters, work log, the project's refs and score. PostHog reaches it only as verdicts: the scout worker posts the " +
        "live evals (L4) to the ledger, with the funnel's step counts as measures. Pages fetch the document when they open " +
        "and show it; no page bakes status in, and without a document a page shows the stand with no verdicts.",
    },
    { label: "rebuild", text: "Rebuild and redeploy the whole site whenever any status changes, with the status baked into each page." },
    { label: "live", text: "The browser reads the ledger, GitHub and PostHog directly." },
  ],
  chosen: "document",
  why:
    "Status changes far more often than the records (every eval run, every pull request), and baking it in ties a " +
    "rebuild of some 2,700 pages to each change while still going stale between them. Reading every source live puts a " +
    "ledger token, a GitHub token and a PostHog key in the browser, and three failure modes on every page view. One " +
    "document keeps the credentials in the status job, gives every number one commit to cite (the old site's state.json " +
    "did this: state at <sha>), and survives the switch from harness files to the ledger without a change to any page.",
  source: by("old apps/docs components/page/operations-state.ts (public/factory/state.json at a sha); docs/spec/10 (roll-up, last seen, score); docs/spec/30 (L4 through the scout worker)"),
  affects: [f.system_capxul, f.environment_devnet, f.environment_staging],
});

export const decision_portal_read_only = defineDecision({
  id: "portal.read-only",
  title: "The portal holds no secret; its local server only takes the owner's answers",
  question: "Should the portal be able to change anything (a record, a task, a verdict), or hold any credential?",
  options: [
    {
      label: "read-only",
      text:
        "No. It is static pages and the status document behind access control. It holds no GitHub, ledger or PostHog " +
        "credential and no secret value; an environment's page lists secret names only. Amended 10 November 2026 by the " +
        "coordinator, on the owner's words (\"Why do we need to open a GitHub issue?\"): the generated site is still static " +
        "and holds no credential, but the local server that serves it (`pnpm portal:serve`) accepts the owner's answers " +
        "into the repository as lines of plan/answers.jsonl, and nothing else. A hosted portal will need the same " +
        "endpoint behind its sign-in, which is not built; until then a hosted page falls back to a prefilled GitHub issue " +
        "or a swarmD control-plane action on the manager's board.",
    },
    { label: "writes", text: "A small backend that edits records, resolves matters and waives evals on the reader's behalf." },
  ],
  chosen: "read-only",
  why:
    "The book changes first, through a reviewed pull request that rebuilds to zero problems; a portal that edits records " +
    "skips both. swarmD's control plane already checks each action's actor by role in code, and GitHub already knows who " +
    "opened an issue; a portal backend would duplicate both and need their credentials. Read-only, the portal is a static " +
    "deploy with no runtime to break, which is why D0 carries no risk.",
  source: `${by("docs/spec/10 (actions checked by role); docs/spec/20 (the artifact's actions); CLAUDE.md (the book changes first)")}; amended 10 November 2026 by the coordinator, on the owner's words`,
  affects: [f.system_capxul],
});

export const decision_portal_artifact_boundary = defineDecision({
  id: "portal.artifact-boundary",
  title: "The portal links to the managers' live boards; it does not repeat them",
  question:
    "swarmD's managers each show a live board (the artifact: tasks, pairs in flight, failing evals, the timeline) over " +
    "the same ledger. What does the portal show of the work, and what does it leave to the boards?",
  options: [
    {
      label: "link",
      text:
        "The portal shows the work as it bears on a record, at the status document's commit: on an operation, its task, " +
        "state, assignee and pull request; on a concept, its lane; on Build, the score. Live detail (pairs, rounds, spend, " +
        "signals, the timeline) stays on the manager's board, which the portal links to; the boards link each record and " +
        "eval back to its portal URL (portal.sitemap). The status job reads from the ledger only: tasks (id, title, state, " +
        "owner, labels, evals, needs; a task is on an operation when one of its own evals has that operation as subject); " +
        "the work log's assigned, ended, deployed and waiver entries (spec 10 has no assignments resource and no waiver " +
        "entry kind, which the swarm design adds); matters (kind, title, options, recommendation, state, resolution, " +
        "task); the project's refs; verdicts; and score. Their shapes are the swarm design's.",
    },
    { label: "embed", text: "Embed the managers' boards in the portal's pages." },
  ],
  chosen: "link",
  why:
    "The boards are live and multiplayer by construction and already carry the actions; a copy would be staler and would " +
    "need the actions too. The portal's job is the record: what it is, what is under it and where it stands. Linking both " +
    "ways keeps each in its lane, and naming the fields the portal reads lets the swarm design keep them stable.",
  source: by("docs/spec/20 (templates, sections, the artifact's renderers and actions); docs/spec/10 (resources)"),
  affects: [f.system_capxul],
});

// ── review ──────────────────────────────────────────────────────────────────────────────────

export const decision_portal_review_flow = defineDecision({
  id: "portal.review-flow",
  title: "An answer on the portal is a typed request; an agent changes the record first",
  question:
    "The judgments flagged for review are read on the portal. How does the person who decides accept one, choose another " +
    "option or change it, and how does that answer reach the record before any code changes?",
  options: [
    {
      label: "typed-request",
      text:
        "A waiting decision's page has Accept, Choose another option and Change; every other decision has Change. An " +
        "answer is one typed request: {decision, answer: accept | choose | change, option?, text?, by, at, seenAt: the " +
        "commit the page was built from}; by and at come from the system that carries it, never from a form. Amended " +
        "10 November 2026 by the coordinator, on the owner's words (\"Why do we need to open a GitHub issue?\"): where the " +
        "portal is served by `pnpm portal:serve`, an answer is saved as one validated line of plan/answers.jsonl, undone " +
        "while unapplied, and applied by the coordinator, who writes the ruling and then marks the answer applied in " +
        "plan/log.jsonl; the same list holds the plan's tasks blocked on a need of the owner. Where there is no such " +
        "server (plain files, a static host, a hosted portal not yet built) it is the GitHub issue form prefilled through " +
        "its URL and labelled review, which the build session takes before other work, applying only an issue whose author " +
        "is the decision's reviewer; after the ledger runs, it resolves the decision's matter, once the ledger's matters name " +
        "their record and carry a typed resolution (the swarm design adds both; until then the issue stays the way). An agent then edits the records: " +
        "accept sets the decision's review state; choose sets chosen and puts the reason first in why; change adds the new " +
        "option and chooses it. Every record the change ripples to changes with it; if the answer leaves a judgment open, " +
        "the agent raises a decision pack back instead of guessing. It rebuilds to zero problems, runs check-frozen and " +
        "opens a pull request into integration/build whose portal preview shows the changed pages and stands; a checker " +
        "confirms the records say what the answer says. On merge the decision shows the answer, the operations it held " +
        "move on, and only then does code change.",
    },
    { label: "direct-edit", text: "The portal edits the decision record through the GitHub API (accept and choose only)." },
    { label: "comments", text: "Comment threads on each page, which an agent reads." },
  ],
  chosen: "typed-request",
  why:
    "The record is the only state, so an answer must arrive as a change to it, reviewed like any book change; seenAt lets " +
    "the agent notice a record that changed after the reader saw it. A direct edit is mechanical only for accept: choose " +
    "and change usually ripple to other records, which needs an agent and a rebuild. Free comments are what the old " +
    "system's tickets had; a typed answer cannot be misread. The same request works before and after the ledger, so the " +
    "habit does not change when swarmD arrives.",
  source: `${by("docs/spec/10 (matters: decision packs, resolve with a record); docs/spec/20 (raise a matter only when no other action fits); CLAUDE.md (the book changes first)")}; amended 10 November 2026 by the coordinator, on the owner's words`,
  affects: [f.system_capxul],
});

export const decision_portal_review_state = defineDecision({
  id: "portal.review-state",
  title: "A decision record says whether it waits for review",
  question:
    "Today the judgments waiting for review are found by tools/report-judgments.ts: a hand list of flagged ids plus any " +
    "decision whose text names the owner. The stand's decide step, the Review page and the report need the same answer, " +
    "and it must change when a judgment is answered. Where does that state live?",
  options: [
    {
      label: "field",
      text:
        "Book first, at D0: the decision schema gains an optional review: {state: waiting | accepted | changed, by, at?, " +
        "ref?: the issue or matter}. The decisions on today's list get state waiting; an answer sets accepted or changed " +
        "with its ref. tools/report-judgments.ts, the portal and standOf read the field, and the hand list and the name " +
        "match go.",
    },
    { label: "heuristic", text: "Keep the hand list and the name match, and mark an answered judgment by rewriting its source." },
    { label: "ledger-only", text: "Keep review state only as matters in the swarmD ledger." },
  ],
  chosen: "field",
  why:
    "A name match flags any decision that mentions the owner (a designer citing an earlier ruling, or a design about the " +
    "review itself) and misses any that does not; the report already keeps a CARRIES_OUT list to undo false matches. " +
    "Rewriting source loses the original evidence. The ledger is not running at D0 and is not where the record lives: " +
    "the book must say on its own what is decided and by whom. A field is one small schema change, checked like every " +
    "other.",
  source: by("tools/report-judgments.ts (FLAGGED, CARRIES_OUT, the name match); docs/decisions/judgments.md (17 waiting); packages/book/src/records/outcomes.ts (DecisionSpec)"),
  affects: [f.system_capxul],
});

// ── the CLI surface and the reference ───────────────────────────────────────────────────────

export const decision_portal_cli_surface = defineDecision({
  id: "portal.cli-surface",
  title: "The CLI surface is designed and reviewed as one system on the portal",
  question:
    "system.frozen-behaviour frees the spelling: flags, --json shapes, refusal codes and wording are the target's to " +
    "design as one system, and B1 designs the flags book first. Where is that system seen whole, before code?",
  options: [
    {
      label: "surface-page",
      text:
        "A Docs page generated from the records: the command tree by noun; the global flags; a flag index (each flag name " +
        "with the commands that take it, its value type and short form, once B1 adds the operations' flags field); every " +
        "--json shape with an index of field names; the error vocabulary (code, class, who acts, exit code, retryable, " +
        "message, how many operations refuse with it) and an exit-code-by-class table; the verbs. Each table marks what a " +
        "consistent system would not have, such as one class with two exit codes or one flag name with two value types. " +
        "Until B1 the old CLI's flags show on each operation page, marked reference. Review lists what changed in the " +
        "surface since the last accepted one, to accept like a judgment: the accepted surface is a committed snapshot, " +
        "docs/decisions/accepted-surface.json, which the agent applying an Accept of the surface writes from the generated " +
        "surface.json at its seenAt commit, in the same pull request. Before the first acceptance the whole surface is listed.",
    },
    { label: "per-command", text: "Show each command's surface only on its own page." },
  ],
  chosen: "surface-page",
  why:
    "Consistency is a property of the whole surface, invisible one page at a time. The prototype's exit-code-by-class " +
    "table already raises the kind of question this page exists for: in the 47 errors of 8 November 2026, input-class " +
    "errors exit 2, 6 or 130 (CANCELLED, the shell's interrupt code) and state-class errors exit 2, 5 or 6. Deliberate or " +
    "not, each is a call the surface makes once, for every command. Accepting the surface as a diff since the last " +
    "accepted one keeps each later review small.",
  source: by("decision system.frozen-behaviour; books/frozen/flags.ts (reference); the prototype's #/cli page over the target's 47 errors"),
  affects: [f.component_cli, decision_system_frozen_behaviour],
});

export const decision_portal_doc_eval = defineDecision({
  id: "portal.doc-eval",
  title: "doc:<operation> compares the CLI's manifest, the page model and the record",
  question:
    "The book derives one doc:<operation> eval per operation: its CLI help, reference page and record agree. What exactly " +
    "does a machine check, so that it passes or fails without judgment?",
  options: [
    {
      label: "three-way",
      text:
        "At one commit, all hold. 1: the CLI built at that commit, asked for its machine manifest of the command (the " +
        "target's schema command with --json), shows the operation's command, its title as the summary, and exactly its " +
        "designed flags (name, short form, value type, required, default, choices, repeatable) and the global flags. 2: " +
        "the page served for that commit (the preview, or the deploy of integration/build) carries, in its JSON twin and " +
        "in its HTML, the hash of the record fields it renders that a fresh generation from the record computes, so a " +
        "stale build or deploy fails. 3: a prose slot file holds only its named sections (Example, Notes), and names no " +
        "error code, exit code, flag or --json field as literal text outside an example's code block: it cites them " +
        "through directives. 4: every example command parses against the designed flags (until B1 adds them, against " +
        "the command only), every example --json output validates against the returns schema, and every record the " +
        "prose cites exists. 5: every link on the page resolves. A failure names its first disagreement. Until the CLI " +
        "exists part 1 is not runnable and the eval is listed so; parts 2 to 5 run in the portal's own check from D0, " +
        "against the built output.",
    },
    { label: "help-text", text: "Diff the human --help text against the page's text." },
  ],
  chosen: "three-way",
  why:
    "Help text is formatted for people and changes wording without changing meaning; the flags freeze found the old " +
    "docs pages capitalising and punctuating every help line (rules.frozen-flags-source). A manifest is data and compares " +
    "exactly. Checking examples against the flags and the shape catches the commonest stale prose, which generation " +
    "cannot prevent; the old site's rule was that consumer examples compile.",
  source: by("packages/book/src/evals.ts (doc:<op>); docs/spec/30 (the doc kind); decision rules.frozen-flags-source; old apps/docs CONTRIBUTING.md (examples compile)"),
  affects: [f.component_cli, f.component_core_sdk],
});

export const decision_portal_prose = defineDecision({
  id: "portal.prose",
  title: "Hand-written prose goes in named slots and cites records, never restates them",
  question:
    "Guides, explanations, runbooks and each command's examples are written by hand. Where do they live, and how do they " +
    "stay true as the records change?",
  options: [
    {
      label: "slots",
      text:
        "packages/portal/content/: guides, explanations and runbooks as Markdown pages, and per-record slot files " +
        "(content/operation/<id>.md) whose named sections (Example, Notes) the page places in fixed positions. Prose " +
        "embeds facts through directives the generator fills from the record (`::synopsis{op=payment.send}`, " +
        "`::error{code=INSUFFICIENT_BALANCE}`, a budget), so a fact is never retyped; doc:<operation> checks the examples. " +
        "A slot for a record that no longer exists fails the portal's check.",
    },
    { label: "free", text: "Free Markdown pages beside the generated ones, linking to them." },
  ],
  chosen: "slots",
  why:
    "The old site's contributing guide called existing prose the weakest source and still found pages derived from " +
    "pages. Prose that cites records through directives cannot go stale, and prose that names a missing record fails a " +
    "check instead of lingering. Fixed slots keep every operation page in one shape. Markdown with directives, not MDX, " +
    "because the generator renders it (portal.stack).",
  source: by("old apps/docs CONTRIBUTING.md (evidence hierarchy, a template per page type); docs/design-book.md (prose next to the generated reference)"),
  affects: [f.system_capxul],
});

export const decision_portal_agent_reads = defineDecision({
  id: "portal.agent-reads",
  title: "Every page has a Markdown and a JSON twin; agents read those",
  question:
    "Lane managers, makers and checkers need their task's records, evals and status. Do they read the portal, and in " +
    "what form?",
  options: [
    {
      label: "twins",
      text:
        "Every page is also served as Markdown (<page>.md, for reading) and JSON (/data/<kind>/<id>.json: the page model, " +
        "for tools), with /llms.txt listing the sections. Both twins are files the generator writes beside each page, " +
        "in the same generation. Status is not in the twins: an agent reads /status/<ref>.json, which carries " +
        "every verdict and every operation's stand at its commit. An agent cites a record by its URL and an eval by its " +
        "anchor. An agent with the repository can run the generator locally (`pnpm portal`) and read the same JSON. Agents never " +
        "scrape HTML.",
    },
    { label: "repo-only", text: "Agents read the records in the repository and ignore the portal." },
  ],
  chosen: "twins",
  why:
    "The records say what the design is, but not what is under an operation, what waits on it or where it stands: that " +
    "is computed, and the portal computes it once. HTML is for people; the old site already served Markdown per page " +
    "and llms.txt because agents read it. JSON twins make an agent's view and a person's view the same facts.",
  source: by("old apps/docs README (llms.txt, llms-full.txt, Markdown per page); swarmD apps/docs proxy.ts (Markdown by Accept)"),
  affects: [f.system_capxul],
});

// ── how it is built and hosted ──────────────────────────────────────────────────────────────

export const decision_portal_generated_content = defineDecision({
  id: "portal.generated-content",
  title: "The portal's content is regenerated on every build and never committed",
  question:
    "The portal's generator writes every page and its model from the records. Is that output committed, like the " +
    "product's src/generated/ folders that sys:generated diffs, or rebuilt each time?",
  options: [
    {
      label: "uncommitted",
      text:
        "Rebuilt on every portal build into packages/portal/dist/, which is gitignored: the site, as the starter kit " +
        "writes it, not generated code. It is not under src/generated/ (whose files are committed, carry the hashed " +
        "do-not-edit header and are compared by generate:check and sys:generated), and it is not a generate:check " +
        "target: HTML, JSON and Markdown carry no header, and a fresh clone has no site to compare. The output is " +
        "deterministic (sorted keys, no timestamps, the commit passed in), so two runs are byte-identical, which the " +
        "portal check holds.",
    },
    { label: "committed", text: "Committed like the product's generated code, and diffed by sys:generated." },
    { label: "import", text: "No generated content: a site framework imports books/target directly at its build." },
  ],
  chosen: "uncommitted",
  why:
    "Every book change touches the portal's aggregates (the navigation, the search index, the counts), so committed " +
    "output would conflict between every pair of lane pull requests. The old repository lived this (CAP-1081): it ended " +
    "up refusing generated files in lane pull requests and regenerating them by bot. A page model's diff tells a " +
    "reviewer nothing the record's diff does not. The generator imports the book at generation time (it is TypeScript " +
    "beside it), and the browser gets only files; the JSON twins are the page models, so a later renderer (Fumadocs, if " +
    "it is revisited) could read them unchanged (portal.stack).",
  source: by("old packages/tools docs module README (generated-diff, the book-regenerate bot, CAP-1081); decision system.layout (src/generated, sys:generated); docs/design/tooling.md (generate:check, capxul/generated-intact)"),
  affects: [f.system_capxul, decision_system_layout],
});

export const decision_portal_stack = defineDecision({
  id: "portal.stack",
  title: "The book's own generator renders the portal; Fumadocs is set aside",
  question: "What renders the portal: a documentation framework, or the book's own static generator?",
  options: [
    {
      label: "own-generator",
      text:
        "The book's own generator, as the starter kit's packages/portal and the prototype are: plain TypeScript and Effect, " +
        "no framework. One generation writes every page as HTML, its Markdown twin and its JSON twin (the page model), " +
        "llms.txt, one stylesheet, one small script and inline SVG diagrams, with relative links, so the site works from " +
        "file:// and any static host. packages/portal starts as a copy of the kit's (its src/project.ts names Capxul's " +
        "book, CLI and output) and gains what Capxul's design adds: Review, the status overlay, prose slots and search.",
    },
    {
      label: "fumadocs",
      text:
        "Fumadocs on Next.js with output: export, as the old apps/docs is: generated pages through a custom source, MDX " +
        "prose, Orama search, client components for the status. Set aside for now, to revisit later.",
    },
    {
      label: "starlight",
      text: "Astro Starlight with a content loader over the page models, Pagefind search and React islands for the status overlay.",
    },
  ],
  chosen: "own-generator",
  why:
    "Aaron's ruling (aaron.portal-generator, 8 November 2026): 'let's forget Fumadocs for now and just run the generate; " +
    "whatever we get generated from that generator, we'll stick with that for now.' This record had chosen Fumadocs " +
    "(graded A-, the generator B- for the search, navigation, theming, accessibility and prose it leaves to write), and " +
    "now follows the ruling. The gap has narrowed since that grading: the starter kit's generator exists and is checked " +
    "(3,292 lines: a page per record with both twins, diagrams, the scoreboard, the eval catalogue, the CLI surface and " +
    "the portal check's five parts, each tested), so what is left to write is Review, the status overlay (a client " +
    "script reading /status/<ref>.json), Markdown prose slots with directives, and search (the kit's table filters and " +
    "eval finder now; a site-wide index over search.json when it is wanted). Everything else in the design stands: the " +
    "sitemap, the page types, the stand, the status document, the review flow, doc:<operation>, the twins and the " +
    "hosting. The JSON twins keep a switch to a framework possible later without changing the generator's views.",
  source: by("books/target/shared/rulings.ts (aaron.portal-generator); /home/user/hillclimb-kit/packages/portal (README, src/, 3,292 lines); tools/portal-prototype.ts"),
  affects: [f.system_capxul],
});


export const decision_portal_hosting = defineDecision({
  id: "portal.hosting",
  title: "A private Cloudflare Worker behind Access, with a preview per pull request",
  question:
    "Where is the portal hosted, and who may see it? It shows the design, the pending judgments and the money paths, and " +
    "it must be up from D0. Hosting it needs Aaron's Cloudflare account: a deploy token and an Access policy that only " +
    "he can create.",
  options: [
    {
      label: "worker-access",
      text:
        "One Cloudflare Worker, capxul-portal, serving the generated site (dist/) as Workers static assets, plus one route that " +
        "serves status/<ref>.json from an R2 bucket. Cloudflare Access in front: an email allowlist (Aaron, and whoever " +
        "he adds) and a service token for swarmD's managers and agents. CI deploys on every push to integration/build and " +
        "uploads a preview version for every pull request that changes books/ or the portal, linked from the pull " +
        "request. A public developer build (Docs only, from main) is a separate later step, Aaron's to take.",
    },
    { label: "pages", text: "Cloudflare Pages, as the old site was, with Access in front." },
    { label: "github-pages", text: "GitHub Pages from the repository." },
  ],
  chosen: "worker-access",
  why:
    "swarmD already runs as Workers on Aaron's Cloudflare account, and its docs app is one, so the account, the deploy " +
    "pattern and the CI secrets exist; Workers static assets is where Cloudflare now puts static sites, and one Worker " +
    "can also serve the status document from R2 without a second service. GitHub Pages for a private repository is " +
    "public or needs an enterprise plan, and the portal must not be public while it shows pending judgments and " +
    "internals. Preview versions let a reviewer see a book change as pages before it merges. Needed from Aaron: a " +
    "Cloudflare API token for CI, allowed to deploy Workers and write the status bucket in R2 (through the credential " +
    "form, never in chat), the Access allowlist, and later the word to publish the developer docs.",
  source: by("/home/user/swarmd/apps/docs/wrangler.jsonc and .github/workflows/docs.yml; swarmD STATUS.md (Deployed); old apps/docs README (Cloudflare Pages)"),
  affects: [f.system_capxul],
});

export const decision_portal_no_component = defineDecision({
  id: "portal.no-component",
  title: "The portal is a tool, not a component of the system",
  question:
    "Does the portal get a component record (and so an environment that runs it), like the backend, or is it a tool " +
    "like packages/generate and packages/evals?",
  options: [
    {
      label: "tool",
      text:
        "A tool: packages/portal, with no component or environment record. Its proof is its own check and the " +
        "doc:<operation> evals, and it has its own line budget (portal.size). When the developer docs are published as a " +
        "product surface, a component and its environment are added then, with a decision.",
    },
    {
      label: "component",
      text: "A component with its own environment record (the Cloudflare Worker), deriving env:portal/boot and env:portal/smoke.",
    },
  ],
  chosen: "tool",
  why:
    "The components and environments describe the product the evals prove, and the system's surfaces are the CLI, the " +
    "SDKs, MCP and HTTP. The portal reads records, not components, and nothing in Capxul calls it. As a component it " +
    "would derive env:portal/smoke, a product smoke journey it has none of, and an unhosted-component gap until staging " +
    "ran it. The tools most like it, the generators and the harness, have no component record either.",
  source: by("books/target/shared/foundation.ts (system surfaces, components, environments); packages/book/src/build.ts (unhosted-component); decision system.layout"),
  affects: [f.system_capxul, decision_system_layout],
});

export const decision_portal_size = defineDecision({
  id: "portal.size",
  title: "The portal is at most 5,000 hand-written lines",
  question:
    "The rebuild keeps its code small (system.size), and the harness has its own budget of 2,000 lines. How large may the " +
    "portal's own code be?",
  options: [
    {
      label: "5000",
      text:
        "At most 5,000 non-test lines of hand-written code in packages/portal, leaving out the generated site (dist/) and " +
        "the prose in content/. The portal's check counts them. Raising it takes a decision.",
    },
    { label: "4000", text: "At most 4,000, as set while Fumadocs was to supply the shell." },
    { label: "none", text: "No budget: it is a tool." },
  ],
  chosen: "5000",
  why:
    "The old site's page components alone were 1,812 lines, beside a docs generator in packages/tools. The limit was " +
    "4,000 while Fumadocs was to supply navigation, search and the shell; the generator writes those too (portal.stack). " +
    "The starter kit's generator is 3,292 lines with its shell, page views, diagrams, scoreboard, surface page and check; " +
    "Review, the status overlay, prose slots and search add about a thousand, so 5,000 leaves room for that and not for " +
    "a framework of its own. It sits outside system.size because it is not product code, as the harness does.",
  source: by("old apps/docs components/page (1,812 lines); decision system.size; docs/spec/30 (the harness's 2,000 lines)"),
  affects: [decision_system_size],
});

// ── the designed screens (Aaron, 9 November 2026) ───────────────────────────────────────────

export const decision_portal_designed_screens = defineDecision({
  id: "portal.designed-screens",
  title: "The portal is built to the five designed screens, by a fresh generator",
  question:
    "The portal's first slice needs a shape and a generator. The starter kit's generator renders generic blocks and imports " +
    "packages this repository does not have; five screens were designed on the canvas 'Capxul Portal' (Overview, Questions, " +
    "Concept, Operation, Architecture). What is built first, and from what?",
  options: [
    {
      label: "designed-screens",
      text:
        "Build the real generated portal to the five designed screens. The navigation reads Overview, Questions, Concepts, " +
        "Architecture, Build and Docs over the portal.sitemap URLs (/review/ is labelled Questions, /design/ is labelled " +
        "Architecture). The first slice is a fresh generator in packages/portal on @capxul/book: it takes the kit's rules " +
        "(one URL per record, a Markdown and a JSON twin beside every page, a deterministic generation, relative links) " +
        "and not its code wholesale, which amends portal.stack. Hosting (portal.hosting), the status overlay " +
        "(portal.status-source) and D0's book-first items (the review field, unique eval ids, underOf and standOf in " +
        "packages/book) stay as designed and come after this slice.",
    },
    {
      label: "copy-the-kit",
      text:
        "Start packages/portal as a copy of the starter kit's generator, as portal.stack had it, and restyle its generic " +
        "blocks towards the design afterwards.",
    },
    { label: "design-only", text: "Keep the design on the canvas and the explorer artifact, and build the generator later." },
  ],
  chosen: "designed-screens",
  why:
    "Aaron's ruling of 9 November 2026: asked 'Build the real generated portal to this design?', he answered 'Yes, build it'. " +
    "He had set the explorer artifact aside and asked for the portal to be designed properly first; the five screens are " +
    "that design. The kit's generator imports @kit/book, @kit/evals, @kit/runtime and effect/cli, none of which exist here, " +
    "and its pages are generic blocks, not the approved screens, so a copy would be rewritten twice. The kit's rules are " +
    "what keep the portal from going stale, and they are kept: every page is generated from the records, with both twins, " +
    "and the portal's own check fails the build when a record has no page, a link does not resolve, two generations " +
    "differ, or the Questions list differs from the judgments report.",
  source: "Aaron, 9 November 2026, in the portal conversation: 'Yes, build it' to 'Build the real generated portal to this design?'; evidence: the design canvas 'Capxul Portal' (Overview, Questions, Concept, Operation, Architecture); decisions portal.sitemap, portal.stack, portal.hosting, portal.status-source",
  affects: [f.system_capxul, decision_portal_stack, decision_portal_sitemap],
});

// ── the plan page (10 November 2026) ──────────────────────────────────────────────────────

export const decision_portal_plan_page = defineDecision({
  id: "portal.plan-page",
  title: "The coordinator writes the plan; its critical path is written, never computed",
  question:
    "How do the owner and the agents see the overall goal, the milestones, the tasks, the threads working on them, what is " +
    "blocked and the critical path to the goal, so that everyone stays aligned on the longer term?",
  options: [
    {
      label: "authored-plan",
      text:
        "The coordinating model writes the plan as data in plan/plan.json (goal, milestones, tasks, the critical path as its own " +
        "ordered list and words, dated notes). It changes the plan only through `pnpm plan …` (tools/plan.ts), which validates " +
        "each change, appends it to plan/log.jsonl with who made it and the commit, and prints the result. `plan check` keeps " +
        "the plan honest against the book (ids, needs without a cycle, a blocked task's decision, every record and eval id " +
        "named, exactly one current milestone, a path of live tasks, evidence for what is met) and never reorders or rewrites it. " +
        "The portal shows it at /plan/, with Markdown and JSON twins, the last note first, and for a task blocked on a decision " +
        "that decision's question, options and recommendation inline.",
    },
    {
      label: "computed-path",
      text:
        "Compute the critical path from the tasks' dependencies. Rejected: the owner: the path is not mathematical, it is the " +
        "coordinator's judgment of what unblocks the next milestone, and it changes as new tickets arrive.",
    },
    {
      label: "new-record-kinds",
      text: "Make tasks and milestones record kinds of the book. Rejected: they change daily and are not a design; the book would churn and every change would need a decision record.",
    },
    {
      label: "outside-tracker",
      text: "Keep the plan in an outside tracker. Rejected: the agents, the owner and the portal would then each read a copy; the plan is checked against the book and must sit beside it.",
    },
  ],
  chosen: "authored-plan",
  why:
    "The owner, 10 November 2026: \"A new page in the book/portal for project management. What is the overall goal, what are the " +
    "current milestones, what are the tasks, what threads are they being worked on, and what's the current critical path " +
    "through the milestones to the goal. This makes a meta hill climb so we can stay aligned on the longer term goal.\" " +
    "Correcting a first proposal that computed the path from dependencies: \"The critical path is not something that's computed " +
    "mathematically … it's driven by a model, a smart model like yourself … it's responsible for creating all of the tasks and " +
    "making sure all the tasks are getting done. And when things get blocked, unblocking them … When it gets blocked, the user " +
    "can see what the decisions it needs to make or unblock, with the context. Ultimately it's a way of sharing understanding " +
    "where we are on the hill climb.\" So the plan is authored; the machinery adds a place to write it, checks against the book, " +
    "a record of every change, and a page that shows it to a person and to other agents.",
  source:
    "The coordinator, 10 November 2026, on the owner's delegation of the book; the owner's words quoted in why; evidence: " +
    "tools/plan.ts, tools/plan/, plan/plan.json, plan/log.jsonl and packages/portal (the Plan page)",
  affects: [f.system_capxul, decision_system_build_order],
});
