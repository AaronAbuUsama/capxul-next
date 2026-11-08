// The tooling design's records: its decisions (defineDecision). One writer: the tooling designer.
// Explained in docs/design/tooling.md, which gives the exact files T0 writes. Ids are tooling.<topic>.

import { defineDecision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";

const BY = "Claude, tooling design, 8 November 2026";
export const by = (evidence: string) => `${BY}; evidence: ${evidence}`;

/** Everything that ships code: the components whose packages the gates hold to the standard. */
const SHIPPED = [
  f.system_capxul,
  f.component_backend,
  f.component_core_sdk,
  f.component_cli,
  f.component_react_sdk,
  f.component_mcp_server,
  f.component_ponder,
  f.component_devnet,
];

// ── the milestone and the principle ─────────────────────────────────────────────────────────

export const decision_tooling_milestone = defineDecision({
  id: "tooling.milestone",
  title: "T0, the tooling milestone, runs before B0 with its own exit check",
  question:
    "The goal prompt's milestones start at the B0 spike and leave the toolchain, the lint rules, the hooks and CI to be " +
    "improvised by whoever writes the first code. When is the tooling built, and what proves it is done?",
  options: [
    {
      label: "t0-first",
      text:
        "A milestone T0 before B0: pin the toolchain, write vite.config.ts, the hooks, knip, jscpd, gitleaks and CI exactly as " +
        "docs/design/tooling.md gives them, build packages/lint and the facts target of packages/generate, format the tree " +
        "once. Exit: every gate passes on the whole tree from a fresh clone, the canary fires every rule on its bad fixtures " +
        "and none on its good ones, the hooks refuse a bad commit and a push to main within budget, CI is green, the book's " +
        "counts are unchanged, and the baselines are logged.",
    },
    { label: "with-b1", text: "Build the tooling inside B1, alongside the generators." },
    { label: "as-needed", text: "Add each tool when a lane first needs it." },
  ],
  chosen: "t0-first",
  why:
    "Lint rules and gates that arrive after code arrive with a backlog: the old system grew 26 overrides and an error-count " +
    "ratchet to pay one down. Built first, every line of product code is held to the standard from its first commit, and the " +
    "B0 spike's workflow code is the first real test of the replay rule. Inside B1 the generator work and the gate work would " +
    "block each other, and the generated code needs the gates to judge it. As-needed is what the old system did. The exit is " +
    "observable, not a claim: a canary proves the three rule layers are loaded, which a green but empty lint cannot show " +
    "(measured: Vite Plus 1.5.0 ignored a bare .oxlintrc.json and exited 0 with no output).",
  source: by("docs/mission/initializer.md (B0-B5, no tooling milestone); /home/user/factory/.oxlintrc.json (26 overrides); a Vite Plus 1.5.0 prototype"),
  affects: SHIPPED,
});

export const decision_tooling_layers = defineDecision({
  id: "tooling.layers",
  title: "Each policy is enforced at the cheapest layer that can enforce it fully",
  question:
    "The old system enforced its architecture with 11 Oxlint rules (1,269 lines) and 8 cross-file checks (4,644 lines) " +
    "that rebuilt a TypeScript program to follow call graphs and catalogues. Where does the target enforce each policy?",
  options: [
    {
      label: "ladder",
      text:
        "In order of preference: generated types (the compiler refuses the mistake), Oxlint's built-in and Effect rules " +
        "(configuration only), the capxul plugin (per-file syntactic rules that read facts generated from the book), " +
        "cross-file checks (only where no single file shows the mistake), evals (what only a run proves).",
    },
    { label: "port", text: "Port the old plugin and cross-file checks, adapted to the new layout." },
    { label: "review", text: "Hold the architecture by review and evals only." },
  ],
  chosen: "ladder",
  why:
    "Most old checks existed because catalogues and surfaces were hand-written and could drift: the SDK barrel, the " +
    "telemetry catalogue, the error rows. The book now generates them, so drift cannot happen, and a generated handler typed " +
    "Effect<Output, DeclaredErrors, DeclaredServices> does in zero lines what operation-errors did with a static call graph. " +
    "Oxlint JS plugins see syntax, not types, so a plugin rule is for what a file's text shows: imports, file names, " +
    "comments, a throw, a literal span name, a time read in a workflow body. Porting keeps checks for problems the design " +
    "removed; review alone does not scale to parallel lanes.",
  source: by("/home/user/factory/packages/tools/src/modules/lint (README, internal/: 4,644 lines) and oxlint-plugin (1,269 lines); oxlint 1.91 JS plugin API"),
  affects: SHIPPED,
});

// ── the toolchain ───────────────────────────────────────────────────────────────────────────

export const decision_tooling_package_manager = defineDecision({
  id: "tooling.package-manager",
  title: "npm 12 workspaces, not pnpm with catalogs (Aaron to confirm)",
  question:
    "system.layout says npm workspaces; the old system used pnpm 9 with a catalog. Which package manager does the rebuild " +
    "use, given parallel lanes, a published SDK and CLI, and agents that install packages unattended?",
  options: [
    {
      label: "npm-12",
      text:
        "npm 12.2.2 workspaces: the dev toolchain in the root manifest, exact pins (save-exact), min-release-age=3, " +
        "strict-allow-scripts with an allowScripts policy, engine-strict and devEngines; npm run workspace checks one exact " +
        "version per dependency across packages; knip holds unlisted (phantom) dependencies at zero.",
    },
    {
      label: "pnpm-catalogs",
      text:
        "pnpm 12 with a catalog in pnpm-workspace.yaml, minimumReleaseAge, onlyBuiltDependencies and strict isolation.",
    },
  ],
  chosen: "npm-12",
  why:
    "This is Aaron's to confirm. npm 12 now has the two pnpm features that mattered for supply chain: a release-age window " +
    "and an install-script policy that fails an unreviewed script. A catalog's job is done by keeping the toolchain in one " +
    "root manifest and checking that shared runtime dependencies have one exact version. pnpm's strict layout hides " +
    "vite-plus/lint/plugins from a plugin file unless every holder declares it, and its global virtual store blocks " +
    "effect-tsgo patch; npm needs neither workaround, and system.layout and the four book checks (npm test -w, npx) already " +
    "assume npm. pnpm installs faster and isolates strictly; switching is local to the manifest and lockfile.",
  source: by("npm 12.2.2 docs (min-release-age, allowScripts, strict-allow-scripts); Vite Plus 1.5.0 lint guide; @effect/tsgo 0.67 README; system.layout"),
  affects: [f.system_capxul],
});

export const decision_tooling_pins = defineDecision({
  id: "tooling.pins",
  title: "One coherent pin set, each version at least 3 days old",
  question: "Which versions does T0 pin, how are they kept consistent, and how does a version enter the set later?",
  options: [
    {
      label: "coherent-window",
      text:
        "Pin exactly: vite-plus 1.5.0 (bundling oxlint 1.91.0, oxfmt 0.76.0, oxlint-tsgolint 7.0.2005, vitest 5.1.0), " +
        "@effect/tsgo 0.67.3, typescript 7.0.2, effect 4.1.2, knip 6.44.1, jscpd 5.4.2, @types/node 24.19.2, npm 12.2.2, " +
        "gitleaks 8.30.1. The bundle must sit inside @effect/tsgo's supported list; overrides alias vite to vite-plus-core and " +
        "pin vitest to the bundle. Upgrades move the set in one pull request; min-release-age=3 refuses younger versions.",
    },
    { label: "latest", text: "Take the latest of each on the day of install, with caret ranges." },
    { label: "week", text: "As coherent-window, with a 7-day window." },
  ],
  chosen: "coherent-window",
  why:
    "Vite Plus pins Oxlint, Oxfmt, tsgolint and Vitest exactly, and @effect/tsgo names the Oxlint, tsgolint and TypeScript " +
    "versions it supports; a pair outside that list is the failure that broke the old toolchain's patch. On 8 November " +
    "@effect/tsgo 0.67.3 lists exactly Vite Plus 1.5.0's bundle. Without the vite alias and vitest pin, npm cannot resolve " +
    "Vitest's vite (reproduced). A release-age window stops a compromised release, which is usually pulled within a day or " +
    "two, from reaching agents that install unattended; 7 days would have forced effect below the 4.1.2 the book already " +
    "pins. Every pin here was at least 3 days old on 8 November; npm run workspace checks the coherence.",
  source: by("npm view <pkg> time (8 Nov 2026); vite-plus@1.5.0 dependencies; @effect/tsgo@0.67.3 README supported-components; reproduced ERR_MODULE_NOT_FOUND"),
  affects: [f.system_capxul],
});

export const decision_tooling_node = defineDecision({
  id: "tooling.node",
  title: "Node 24.22.2 LTS everywhere, installed by the environment's setup script",
  question: "Which Node runs the toolchain, the tests, CI and the product, and how does a cloud session get it?",
  options: [
    { label: "node-24", text: "Node 24.22.2 (LTS Krypton) in .node-version, devEngines and CI; the session's setup script installs it, sha256-checked." },
    { label: "node-22", text: "Stay on the image's Node 22.23.4." },
    { label: "node-26", text: "Node 26.13.0, LTS since 28 October 2026." },
  ],
  chosen: "node-24",
  why:
    "The old CI moved its tests to Node 24 because Node 22.23.4's type stripper crashed a CLI child with a WASM trap (#3748), " +
    "and 22.23.4 is exactly what the cloud image runs. Node 24 is LTS until April 2028, past B5, and was proven on the old " +
    "system's CI and CLI minimum; Vite Plus accepts ^24.11.0 and npm 12 ^24.15.0. Node 26 became LTS eleven days ago and " +
    "nothing of ours has run on it. engine-strict and devEngines make a session that skipped the setup fail at install.",
  source: by("/home/user/factory/.github/workflows/ci.yml (Node 24, #3748); nodejs.org/dist/index.json; vite-plus and npm engines"),
  affects: [f.system_capxul, f.component_backend, f.component_cli, f.component_mcp_server, f.component_devnet],
});

export const decision_tooling_typescript = defineDecision({
  id: "tooling.typescript",
  title: "TypeScript 7.0.2 is the only compiler; tsc -b over independent projects",
  question:
    "The book builds with TypeScript 5.9.3; @effect/tsgo and Oxlint's type-aware path need TypeScript 7. Which compiler, and " +
    "how is the workspace type-checked?",
  options: [
    {
      label: "ts7-solution",
      text:
        "typescript 7.0.2 everywhere. Each package is an independent composite, noEmit project importing the others by " +
        "package name; the root tsconfig.json is a solution file, so tsc -b checks every package incrementally. " +
        "tools/freeze-flags.ts keeps the compiler API through the alias typescript-5 (npm:typescript@5.9.3).",
    },
    { label: "two-compilers", text: "TypeScript 5.9 for the book, 7 for product code." },
    { label: "one-program", text: "One root tsconfig that includes every package." },
  ],
  chosen: "ts7-solution",
  why:
    "Measured: tsc 7.0.2 checks books/ clean in 4.8 s against 10.2 s on 5.9.3, and packages/book in 0.4 s. TypeScript 7 " +
    "refuses noEmit in a referenced project (TS6310, reproduced), so packages do not reference each other; a solution of " +
    "independent noEmit projects passed and caught an error in one package. One program would mix browser and Node libs. " +
    "TypeScript 7 has no stable programmatic API, and freeze-flags is the provenance of books/frozen/flags.ts, so it keeps " +
    "the old compiler under an alias. No paths aliases or baseUrl: tsgolint does not support baseUrl.",
  source: by("tsc 7.0.2 and 5.9.3 runs on books/ and packages/book; a tsc -b prototype (TS6310); Vite Plus troubleshooting guide"),
  affects: [f.system_capxul],
});

export const decision_tooling_entry = defineDecision({
  id: "tooling.entry",
  title: "Vite Plus is the one entry: lint, fmt, test, staged and hooks; no lefthook",
  question: "Which tool runs lint, formatting, tests, the pre-commit checks and the git hooks, and is there a task graph?",
  options: [
    {
      label: "vite-plus",
      text:
        "vite-plus: vp check, vp lint, vp fmt, vp test, vp staged, and vp hooks for the git hook dispatcher (.vite-hooks/). " +
        "Gates are plain commands in two hook scripts and one workflow; no vp run task graph at T0.",
    },
    { label: "separate", text: "oxlint, oxfmt, vitest and lefthook as separate dependencies, as before." },
    { label: "task-graph", text: "Vite Plus with a vp run task graph for every gate, as the old gate module had." },
  ],
  chosen: "vite-plus",
  why:
    "One devDependency carries the linter, formatter, test runner and staged runner at mutually tested versions, and the " +
    "editor extension reads the same config. Vite Plus 1.5.0 ships a husky-style dispatcher that passes stdin and " +
    "arguments through and puts node_modules/.bin on PATH; a prototype push read its refs from stdin and a push to main was " +
    "refused through it, so lefthook adds nothing. The old task graph took thousands of lines (the gate module, PR " +
    "selectors, receipts) to keep slow gates fast; the target's gates fit their budgets on the whole tree, and a graph is a " +
    "later decision made with measurements.",
  source: by("vite-plus 1.5.0 docs (commit-hooks, staged, lint); a prototype repository with vp hooks; /home/user/factory/packages/tools/src/modules/gate"),
  affects: [f.system_capxul],
});

// ── lint ────────────────────────────────────────────────────────────────────────────────────

export const decision_tooling_lint_config = defineDecision({
  id: "tooling.lint-config",
  title: "The lint config lives in vite.config.ts; a canary proves it is loaded",
  question: "Where does the Oxlint configuration live, and how is a config that loads but checks nothing caught?",
  options: [
    {
      label: "vite-block",
      text:
        "The lint block of vite.config.ts, extending the typed strict preset imported from @effect/tsgo/oxlint-presets; no " +
        ".oxlintrc.json. A canary test lints packages/lint/fixtures/bad through the real config and requires every expected " +
        "rule id, and fixtures/good to give nothing.",
    },
    { label: "oxlintrc", text: "A .oxlintrc.json, read into vite.config.ts by a helper, as the old lintConfig() did." },
  ],
  chosen: "vite-block",
  why:
    "Measured on Vite Plus 1.5.0: with only a .oxlintrc.json, vp lint exited 0 with no output, although that config named " +
    "a plugin the unpatched binary does not have; the lint block was read and failed closed. The old repository met the " +
    "same silent pass and wrote a helper to bridge the two files. A JS config cannot extend a file path, and spreading the " +
    "JSON preset failed typeCheck (TS2322), so the typed preset object is extended. RuleTester proves each rule in " +
    "isolation; only the canary proves the built-in, Effect and capxul layers are all active in the config the gates run.",
  source: by("a Vite Plus 1.5.0 prototype (.oxlintrc.json ignored; vite.config.ts lint block loaded); /home/user/factory/vite.config.ts lintConfig()"),
  affects: [f.system_capxul],
});

export const decision_tooling_effect_rules = defineDecision({
  id: "tooling.effect-rules",
  title: "Effect's strict preset everywhere, its native-API rules in product code",
  question:
    "@effect/tsgo ships 147 diagnostics as Oxlint rules in seven presets. Which are on, where, and what about the unstable " +
    "APIs the stack is built on?",
  options: [
    {
      label: "strict-native",
      text:
        "Extend the strict preset (97 rules, all errors) through effect-tsgo patch --oxlint in prepare; add " +
        "any-unknown-in-error-context, unsafe-effect-type-assertion, strict-effect-provide and effect-try-without-catch; turn " +
        "on the 20 Effect-native rules (time, randomness, timers, fetch, randomUUID, process.env, console, JSON, new Promise, " +
        "async functions, native Error classes, Node built-ins) in product packages; unstable-api-usage off.",
    },
    { label: "recommended", text: "The recommended preset as shipped: 84 of its 97 rules at warn." },
    { label: "hand-list", text: "List every rule by hand, as the old repository did with 85." },
  ],
  chosen: "strict-native",
  why:
    "The strict preset is the old hand-written list plus 15 rules added since, and extending it keeps step with each pinned " +
    "version. The Effect-native rules replace the old ambient-time and presence-implies-mode checks and half of " +
    "no-raw-provider-call with configuration only: time through Clock, environment through Config, HTTP through " +
    "HttpClient. They stay off in the plugin and the generator, which are plain Node scripts, and in sdk-react. Effect " +
    "4.1.2 marks workflow, cluster, rpc, sql, http, cli and observability unstable (5,046 markers), so unstable-api-usage " +
    "would fire on the whole stack; the exact pin is the guard, and experimental-api-usage stays on. Unpatched, Oxlint " +
    "refuses the config (Unknown plugin effecttsgo), so a missed patch fails closed.",
  source: by("@effect/tsgo 0.67.3 README and oxlint-presets/*.json; effect 4.1.2 dist (@stability markers); prototype runs"),
  affects: SHIPPED,
});

export const decision_tooling_lint_standard = defineDecision({
  id: "tooling.lint-standard",
  title: "One strict standard: three categories and named rules, all errors",
  question: "Which built-in rule groups and named rules are on, at what level, and when may an override relax one?",
  options: [
    {
      label: "one-standard",
      text:
        "correctness, suspicious and perf as errors; plugins eslint, typescript, unicorn, oxc and import (vitest in tests); " +
        "20 type-aware typescript rules including no-explicit-any; ban-ts-comment allowing only a described ts-expect-error; " +
        "complexity 25, 250 lines a file, depth 5, 4 nested callbacks; import/no-cycle; denyWarnings and unused disables " +
        "denied. Overrides only scope a rule or turn it off for tests, composition roots and generated lists.",
    },
    { label: "graded", text: "Grade rules as warn and error, and fix warnings over time." },
  ],
  chosen: "one-standard",
  why:
    "A warning is a backlog item nobody owns; with every rule an error, a finding fails the gate and is never deferred. " +
    "The categories and size limits held on the old 400,000-line repository; its two evidenced exceptions stay " +
    "(consistent-return off because noImplicitReturns understands absurd, no-map-spread off because it pushed code to " +
    "mutation). no-explicit-any is new: the generated types are how the book is enforced, and any switches them off. " +
    "import/no-cycle covers files inside a concept, where the acyclic concept map says nothing. Measured: plugins set " +
    "beside extends keep the Effect plugin active.",
  source: by("/home/user/factory/.oxlintrc.json (categories, limits, comments); oxlint 1.91 configuration_schema.json; prototype runs with import/no-cycle"),
  affects: SHIPPED,
});

export const decision_tooling_lint_scope = defineDecision({
  id: "tooling.lint-scope",
  title: "Oxlint covers packages/*/src; the design book stays under its own checks",
  question:
    "Linted with the product standard, books/, packages/book and tools/ raise 757 findings, 456 of them schema-number on " +
    "the records' Schema.Number fields. What does Oxlint cover?",
  options: [
    {
      label: "product-and-tooling",
      text:
        "Every package except packages/book: product packages with the Effect-native rules, tooling packages (generate, " +
        "evals, lint) and sdk-react without them, tests and generated code under their overrides. books/, packages/book, " +
        "tools/, docs/ and spikes/ are outside Oxlint and formatted by Oxfmt; the four book checks govern them.",
    },
    { label: "everything", text: "Lint the book too, and fix its 757 findings at T0." },
    { label: "design-profile", text: "Lint the book with a second, correctness-only config." },
  ],
  chosen: "product-and-tooling",
  why:
    "The book is design data checked by its own build, 21 tests, strict tsc and check-frozen; its Schema.Number fields " +
    "describe columns, and the generator, not the record, is where a runtime schema becomes Schema.Finite. Fixing 757 " +
    "findings across 2,132 records changes no behaviour and risks the book. A second config means a second lint run and " +
    "a second standard. Oxlint overrides cannot set categories, so a lighter profile would be a hand-tuned rule list. " +
    "Spikes are throwaway; B0 lints its spike by hand once, as a first real test of capxul/workflow-body.",
  source: by("oxlint over a copy of this repository (757 findings strict, 37 correctness-only); oxlint override schema (no categories)"),
  affects: [f.system_capxul],
});

export const decision_tooling_plugin = defineDecision({
  id: "tooling.plugin",
  title: "packages/lint: nine capxul rules over facts generated from the book",
  question: "Where do Capxul's own lint rules live, which rules are there, and how do they learn the design?",
  options: [
    {
      label: "facts-plugin",
      text:
        "A tooling package packages/lint (not a component, not in system.size): nine rules (imports, concept-shape, " +
        "workflow-body, span-names, generated-intact, no-throw, catch-keeps-cause, comments, no-sentinel-tests), each with " +
        "valid and invalid RuleTester cases, reading src/generated/facts.ts, which packages/generate writes from " +
        "books/target. Budgets: 900 non-test lines for the rules, 200 for the cross-file checks, 120 for the facts target.",
    },
    { label: "hand-lists", text: "Rules with hand-written lists of concepts, doors and files, as the old plugin had." },
    { label: "book-import", text: "Rules that import books/target directly at lint time." },
  ],
  chosen: "facts-plugin",
  why:
    "Facts generated from the records cannot drift from the book, and generated-intact plus generate:check prove it. " +
    "Importing 2,132 records into every lint run would load the design system into the linter and slow every editor " +
    "keystroke; the facts file is the few hundred names the rules need. Hand lists are what drifted before. The plugin " +
    "imports vite-plus/lint/plugins, so it always matches the bundled Oxlint. Nine rules replace the old eleven plus most " +
    "of the eight cross-file checks; the prototype of six of them ran in 1.1 s with the Effect rules.",
  source: by("a prototype plugin under Oxlint 1.91.0 (TypeScript plugin on Node 22.23.4); /home/user/factory/packages/tools/src/modules/oxlint-plugin"),
  affects: SHIPPED,
});

export const decision_tooling_imports = defineDecision({
  id: "tooling.imports",
  title: "Imports: doors per dependsOn, a short allow-list in concepts, relative paths",
  question:
    "How does code reach another concept, another package and the outside world, and how are imports written so a rule " +
    "can check them?",
  options: [
    {
      label: "doors-allow-list",
      text:
        "capxul/imports: another concept only through src/<d>/door.ts, only if dependsOn allows it, only names its door " +
        "lists; in a concept folder bare modules only effect, effect/* and (backend) @capxul/runtime; workspace imports " +
        "per a fixed table (backend may import runtime; cli, mcp and sdk-react may import sdk; generate and evals may import " +
        "book; nothing else); no path into another package's src or src/generated. Relative imports with .ts inside a " +
        "package, package names across packages, no aliases.",
    },
    { label: "aliases", text: "#<concept> subpath aliases with a door index re-exporting files, as the old backend had." },
    { label: "restricted", text: "no-restricted-imports overrides per folder, written by hand." },
  ],
  chosen: "doors-allow-list",
  why:
    "One rule replaces four old ones (concept-import-door, no-foreign-internal-import, " +
    "no-relative-parent-import-out-of-concept, the import half of no-raw-provider-call) and the hand-written " +
    "no-restricted-imports overrides. An allow-list needs no list of vendor packages: a concept can reach an outside " +
    "service only through its Effect service in packages/runtime. The workspace table follows A4 (the CLI calls one SDK " +
    "method; the SDK calls only the backend through the generated client) and makes sys:imports a lint result. A single " +
    "door.ts needs no re-export bookkeeping, and relative paths need no resolver config.",
  source: by("system.layout; A4; books/target/shared/foundation.ts (component and concept dependsOn); prototype rule"),
  affects: [...f.CONCEPTS, f.component_backend, f.component_core_sdk, f.component_cli, f.component_react_sdk, f.component_mcp_server],
});

export const decision_tooling_workflow_body = defineDecision({
  id: "tooling.workflow-body",
  title: "A workflow body is replay-safe: steps, waits and durable time only",
  question:
    "Effect Workflow re-runs a workflow body on resume and replays recorded activity results. What may a body do, and how " +
    "is that checked before a replay goes wrong in production?",
  options: [
    {
      label: "rule",
      text:
        "capxul/workflow-body, in src/<c>/processes.ts: outside an Activity's execute, no Date, Math.random, performance, " +
        "crypto, fetch, process or timers, no Clock, DateTime, Random or Schedule, no Effect.sleep, delay, timeout, retry, " +
        "repeat, race or promise, nothing from the runtime or another concept's door; every yield* is a generated step or " +
        "wait, Activity, DurableClock, DurableDeferred, Workflow, a declared error or a pure Effect combinator over those; " +
        "every step and wait the book declares is yielded.",
    },
    { label: "evals-only", text: "Rely on wfl:<id>/resume evals to catch a body that misbehaves on replay." },
  ],
  chosen: "rule",
  why:
    "A body that reads the clock or calls a service directly takes another branch on replay than on its first run, and " +
    "only a kill at the wrong moment shows it; the resume evals cannot kill every workflow at every point. Effect's own " +
    "Clock is correct in ordinary code and wrong in a body, so the Effect-native rules cannot make this distinction; only " +
    "a rule that knows what a body is can. Activities run at least once, which B0 proves with an idempotency key. The " +
    "book declares 81 workflows with 341 steps and 94 waits, so 'every declared step runs' ties the code to the design. " +
    "Prototyped: the rule caught Clock and Effect.sleep in a body and passed Date inside an activity.",
  source: by("effect 4.1.2 dist/workflow (Workflow.toLayer, Activity.make, DurableClock); rules.process-wakeups; A2; prototype rule"),
  affects: [f.component_backend],
});

export const decision_tooling_span_names = defineDecision({
  id: "tooling.span-names",
  title: "Span names come only from the generated catalogue",
  question: "Hand-written code can name spans with Effect.fn(\"…\") and Effect.withSpan(\"…\"). Which names may it use?",
  options: [
    {
      label: "catalogue",
      text:
        "capxul/span-names: the name argument of Effect.fn, withSpan, makeSpan, makeSpanScoped, useSpan and Layer.span is a " +
        "member of the generated Spans; never a string or template literal; helpers that should not trace use " +
        "Effect.fnUntraced. Autofix rewrites a literal that equals a catalogue name.",
    },
    { label: "free", text: "Let handlers name spans freely; the span evals report what they find." },
  ],
  chosen: "catalogue",
  why:
    "P6 fixes the span tree (cli, sdk, rpc, db.tx, call, workflow, wait) and the generated wrappers open all of it; the " +
    "book declares exactly one child span a hand-written step opens (sdk.step.browser-install). A free name is a span no " +
    "eval expects, and a typo is a missing span the evals then report as absent. With names from one constant, a span a " +
    "handler needs is added to its record first, and a renamed span is a compile error. This replaces the span half of " +
    "the old telemetry-spine check; event names need no rule, because only the generated transition code sends events " +
    "(P7). Prototyped, including the autofix.",
  source: by("P6 in docs/decisions/policy-pack.md; the target book's rpc and flow spans (1 declared); prototype rule and --fix"),
  affects: [f.component_backend, f.component_core_sdk, f.component_cli],
});

export const decision_tooling_generated_header = defineDecision({
  id: "tooling.generated-header",
  title: "The generated header carries a sha256 that a lint rule checks per file",
  question: "system.layout heads each generated file 'Do not edit'. How is a hand edit caught before CI regenerates everything?",
  options: [
    {
      label: "hashed-header",
      text:
        "The shared writer in packages/generate writes 'Generated from books/target by packages/generate. Do not edit. " +
        "sha256:<hex>' over the rest of the file; capxul/generated-intact checks the hash and refuses the header outside " +
        "src/generated/. generate:check stays the full proof. Generated files are not formatted.",
    },
    { label: "regen-only", text: "Only regenerate and diff, in CI and at pre-push." },
  ],
  chosen: "hashed-header",
  why:
    "A per-file hash shows a hand edit in the editor and at pre-commit in milliseconds, where regeneration takes the whole " +
    "generator; regeneration still runs at pre-push and in CI, because a hash cannot show that a record changed and the " +
    "files were not regenerated. The formatter must not touch generated files, or every hash would break; the generator " +
    "emits finished code, and lint holds it to the standard. Prototyped: the rule caught an edited header-hashed file.",
  source: by("system.layout (header text); sys:generated; prototype rule"),
  affects: SHIPPED,
});

export const decision_tooling_errors = defineDecision({
  id: "tooling.errors",
  title: "Typed failures by generated types; no throw; a failing catch keeps its cause",
  question: "How is 'fail only with declared errors, and keep the cause' enforced without the old call-graph check?",
  options: [
    {
      label: "types-and-two-rules",
      text:
        "B1's handler types put exactly the declared errors in the error channel, so the compiler refuses an undeclared " +
        "one; capxul/no-throw refuses throw in product code (absurd from effect/Function for exhaustiveness); " +
        "capxul/catch-keeps-cause requires a handler that fails again to read what it caught, and requires handlers to be " +
        "written inline; effect-try-without-catch maps every try to a declared error.",
    },
    { label: "call-graph", text: "Port operation-errors: a static call graph per operation row." },
  ],
  chosen: "types-and-two-rules",
  why:
    "The type does in zero lines what operation-errors did with a static call graph, and rpc:<id>/errors proves it at run " +
    "time. A throw escapes the error channel and becomes a defect, so it is refused everywhere in shipped code, not only " +
    "in recipes as before. The old catch-keeps-cause followed named handlers across files in 549 lines; requiring inline " +
    "handlers makes it a single-file rule of under 100. The generated error classes carry an optional cause, which Error " +
    "Tracking reads.",
  source: by("/home/user/factory oxlint-plugin rules catch-keeps-cause.ts and handler-source.ts; lint/internal/operation-errors; vocabulary.ts"),
  affects: SHIPPED,
});

export const decision_tooling_comments = defineDecision({
  id: "tooling.comments",
  title: "Debt markers name an issue; disable directives name a rule and a reason",
  question: "How are TODOs and lint disables kept from becoming untracked debt?",
  options: [
    {
      label: "comments-rule",
      text:
        "capxul/comments: TODO, FIXME, HACK and XXX are written TODO(#123): …, naming a GitHub issue of capxul-next (the " +
        "swarmD ledger's task id is added by changing one constant when it runs); every oxlint-disable or eslint-disable " +
        "names its rules and gives a reason after ' -- '. reportUnusedDisableDirectives denies stale ones; disables are " +
        "counted in the baselines.",
    },
    { label: "repo-walk", text: "Port the old tech-debt check, a walk over the repository." },
  ],
  chosen: "comments-rule",
  why:
    "A per-file rule shows the problem in the editor and at pre-commit, at no cost to the gates; the old walk ran only in " +
    "lint all. A disable without a reason is an unexplained exception to a strict standard; with one, a reviewer can " +
    "judge it, and the count shows whether exceptions are growing. One rule scans comments once for both.",
  source: by("/home/user/factory/packages/tools/src/modules/lint/internal/tech-debt.ts; CLAUDE.md (tracking work)"),
  affects: [f.system_capxul],
});

export const decision_tooling_tests = defineDecision({
  id: "tooling.tests",
  title: "Vitest through vp test; no sentinel tests; the book keeps node:test",
  question: "Which test runner do new packages use, what does lint require of tests, and does the book's suite move?",
  options: [
    {
      label: "vitest-new",
      text:
        "New packages test with Vitest 5.1.0 through vp test (with @effect/vitest for Effect code); capxul/no-sentinel-tests " +
        "and vitest's no-focused, no-disabled and todo rules are errors in tests; packages/book keeps its 21 node:test " +
        "tests, run by npm run book.",
    },
    { label: "migrate", text: "Move the book's tests to Vitest at T0." },
  ],
  chosen: "vitest-new",
  why:
    "Vitest is bundled with Vite Plus and pinned by overrides, so it costs no extra dependency, and the RuleTester runs " +
    "under it. A test that cannot fail proves nothing, and agents write sentinel tests when hurried, so the plugin keeps " +
    "the old rule. The book's suite works and is outside Oxlint; migrating it changes nothing that matters.",
  source: by("/home/user/factory oxlint-plugin no-sentinel-tests.ts; packages/book/test; vite-plus 1.5.0 dependencies"),
  affects: [f.system_capxul],
});

export const decision_tooling_cross_file = defineDecision({
  id: "tooling.cross-file",
  title: "The old cross-file checks are cut or replaced; four checks remain",
  question: "Which of the old system's eight cross-file checks survive, and which new ones does the design need?",
  options: [
    {
      label: "four",
      text:
        "Cut sdk-public-surface, telemetry-spine, v8-boundary, error-contract and error-catalog; replace operation-errors " +
        "(by handler types), presence-implies-mode (by process-env rules and generated Config), tech-debt (by " +
        "capxul/comments) and ambient-time (by the Effect-native rules and workflow-body). Keep four: generate:check " +
        "(sys:generated), loc (system.size, sys:loc), workspace (pins, overrides, references), and the lint canary.",
    },
    { label: "keep", text: "Keep the eight, adapted to the new layout." },
  ],
  chosen: "four",
  why:
    "Five of the old checks guarded hand-written surfaces or catalogues that are now generated, or a Convex runtime that is " +
    "gone; the error-count ratchet existed to pay down legacy, and new code starts at zero. What remains needs more than one " +
    "file: whether generated files match the records, how many lines each concept has, whether the manifests and the " +
    "toolchain agree, and whether the config loads every rule. Each is under 200 lines; the old eight were 4,644.",
  source: by("/home/user/factory/packages/tools/src/modules/lint/README.md and internal/ (line counts)"),
  affects: SHIPPED,
});

export const decision_tooling_fmt = defineDecision({
  id: "tooling.fmt",
  title: "Oxfmt at width 120 with sorted imports; Markdown and generated files untouched",
  question: "How does Oxfmt format the tree, what does it leave alone, and how is the first formatting done?",
  options: [
    {
      label: "w120",
      text:
        "printWidth 120, two spaces, semicolons, double quotes, trailing commas, LF, sortImports and sortPackageJson; ignore " +
        "Markdown, src/generated, books/frozen, docs/as-is/archive, tools/workflows and the lockfile. T0 formats the tree " +
        "once in a commit with nothing else, then shows the book's counts unchanged.",
    },
    { label: "w100", text: "The old repository's width of 100, Markdown included." },
  ],
  chosen: "w120",
  why:
    "Measured: the book's lines run to p90 124 characters; Oxfmt would rewrite 226 of 293 files at 100 and 201 at 120, so " +
    "one formatting commit is needed at any width, and 120 wraps fewer pipe chains. Sorted imports remove a class of merge " +
    "conflicts between lanes. Oxfmt pads every Markdown table column to its widest cell (a 100-character row of " +
    "design-book.md became 400), which makes prose unreadable as source. Generated files keep the bytes their hash covers. " +
    "Formatting the whole tree once keeps every later diff about content.",
  source: by("oxfmt 0.76.0 --check over a copy of this repository at widths 100, 120 and 130; oxfmt on docs/design-book.md"),
  affects: [f.system_capxul],
});

// ── gates ───────────────────────────────────────────────────────────────────────────────────

export const decision_tooling_hooks = defineDecision({
  id: "tooling.hooks",
  title: "Hooks: staged fmt, lint and secrets; pre-push runs every gate on the tree",
  question: "What do pre-commit and pre-push run, within what time, and which lessons of the old hooks do they keep?",
  options: [
    {
      label: "two-scripts",
      text:
        "pre-commit: CI=1 vp staged (fmt and lint on staged files, gitleaks on the staged diff), at most 5 s for 30 files. " +
        "pre-push: refuse a push to main or integration/build and a ref that is not HEAD, then vp fmt --check, vp lint, " +
        "tsc -b, generate:check, npm run book and vp test run on the whole tree, at most 90 s until B3.",
    },
    { label: "staged-only", text: "Only the staged checks; leave everything else to CI." },
    { label: "scoped", text: "Scope pre-push to the files the push changes, as the old check.sh did." },
  ],
  chosen: "two-scripts",
  why:
    "The old hooks recorded the lessons: every vp call needs CI=1 (vp opened /dev/tty and a pre-push 'hung' for nine " +
    "minutes); a pushed ref that is not HEAD must be refused because gates read the working tree; vp staged appends paths, " +
    "so tsc cannot run there; no --fix at commit, because the Effect fixes rewrite code; hooks call direct verbs, never the " +
    "task graph, after vp was SIGKILLed in a macOS worktree. Staged-only lets a red tree reach the remote and costs a CI " +
    "round trip per mistake. Scoping by changed files took a 100-line script; the whole tree fits 90 s now (book checks " +
    "about 15 s, lint and types seconds), and scoping is the first remedy when it stops fitting.",
  source: by("/home/user/factory/lefthook.yml and .lefthook/pre-push/check.sh; /home/user/factory/vite.config.ts staged block; prototype hook timings"),
  affects: [f.system_capxul],
});

export const decision_tooling_branch_protection = defineDecision({
  id: "tooling.branch-protection",
  title: "Branch protection on main and integration/build is the real merge guard",
  question: "A hook can be skipped with --no-verify or VP_GIT_HOOKS=0. What actually stops an unchecked merge?",
  options: [
    {
      label: "protect",
      text:
        "GitHub branch protection on main and integration/build in AaronAbuUsama/capxul-next: no direct pushes, the CI " +
        "check and secrets jobs required. Turned on by the repository's owner, Aaron; the pre-push refusal stays as the " +
        "local guard.",
    },
    { label: "hooks-only", text: "Rely on the pre-push refusal." },
  ],
  chosen: "protect",
  why:
    "This is Aaron's step: only the repository's owner can change its settings, and on a private repository protection " +
    "may need a paid plan, which is spending. Lanes are run by agents, and a hook is a convenience they can bypass; the " +
    "remote is the only place the rule cannot be skipped. Until it is on, the build session treats a direct push to either " +
    "branch as a defect and reports it.",
  source: by("docs/mission/initializer.md (lanes merge by pull request into integration/build); the old CAP-155 merge gate"),
  affects: [f.system_capxul],
});

export const decision_tooling_ci = defineDecision({
  id: "tooling.ci",
  title: "CI: one check job and one secrets job, each step a measured gate",
  question: "What does CI run, on which events, within what time, and what becomes of the old CI's other jobs?",
  options: [
    {
      label: "two-jobs",
      text:
        "On every pull request and on pushes to main and integration/build: check (workspace, book, generate:check, fmt, " +
        "lint, tsc -b, tests and canary, knip, jscpd, loc to the job summary; at most 10 minutes) and secrets (gitleaks over " +
        "the whole history; at most 2 minutes), on ubuntu-24.04 with the old repository's pinned action SHAs. B2 adds evals " +
        "and B5 staging.",
    },
    { label: "tiers", text: "The old tiers: a fast tier on every push, a full tier when a pull request is ready." },
  ],
  chosen: "two-jobs",
  why:
    "One install per job keeps the wall time low, and the steps are the same commands as the hooks, so a green hook " +
    "predicts a green CI. The old tiers existed because the full gate took 13 to 20 minutes; the target's fits 10. The " +
    "old bundle and start-up budgets become evals of the component budgets the book declares (the CLI's startMs), the " +
    "book-regeneration bot pull requests go because generated files are committed and checked, and the change-scoped " +
    "selector goes because whole-tree gates fit. GitHub records each step's duration; T0 logs the first green run as the " +
    "baseline.",
  source: by("/home/user/factory/.github/workflows/ci.yml (tiers, 8-vCPU runners, 13-20 min); books/target/shared/foundation.ts (component budgets)"),
  affects: [f.system_capxul],
});

export const decision_tooling_secrets = defineDecision({
  id: "tooling.secrets",
  title: "gitleaks 8.30.1, installed through the Go module proxy",
  question: "Which secret scanner runs, where, and how is it installed in CI and in a cloud session?",
  options: [
    {
      label: "gitleaks-go",
      text:
        "gitleaks 8.30.1 on the staged diff at pre-commit and over the whole history in CI, with the default rules and no " +
        "allowlist at T0; installed with go install github.com/zricethezav/gitleaks/v8@v8.30.1, verified by Go's checksum " +
        "database, in CI and in the environment's setup script.",
    },
    { label: "secretlint", text: "secretlint from npm at pre-commit, gitleaks in CI." },
    { label: "ci-only", text: "gitleaks in CI only, as the old system ran it." },
  ],
  chosen: "gitleaks-go",
  why:
    "A secret that reaches a pushed branch is already exposed, so the scan belongs before the commit, not only in CI. One " +
    "scanner means one rule set and one allowlist. In this session GitHub release downloads returned 504 while " +
    "proxy.golang.org answered, Go 1.24 is in the image, and go install took 32 s; the module checksum database is a " +
    "stronger check than a checksums file fetched from the same release. Measured: the whole history (90 commits, 13 MB) " +
    "scans in 5.9 s with no leaks, and a staged fake AWS key and GitHub token are both caught in 40 ms.",
  source: by("proxy.golang.org (v8.30.1 latest, 21 Feb 2026); go install and gitleaks runs in this session; /home/user/factory/.github/workflows/ci.yml"),
  affects: [f.system_capxul],
});

export const decision_tooling_dead_code = defineDecision({
  id: "tooling.dead-code",
  title: "knip on hand-written code; jscpd at 2% in CI",
  question: "How are unused dependencies, files and exports, phantom dependencies and duplication measured?",
  options: [
    {
      label: "knip-jscpd",
      text:
        "knip 6.44.1 for unused dependencies, files and exports and unlisted dependencies, over hand-written code " +
        "(src/generated and the book excluded), run with KNIP_DISABLE_RAW_TRANSFER=1; jscpd 5.4.2 at a 2% threshold over " +
        "packages/*/src, run directly in CI, never under vp run.",
    },
    { label: "deps-only", text: "knip --dependencies only, as the old gate ran it." },
  ],
  chosen: "knip-jscpd",
  why:
    "Every dead file is lines that count against system.size, and an unlisted dependency is a phantom that hoisting hides " +
    "until the SDK or CLI is packed, so both axes are on; the old repository kept files and exports off only because its " +
    "published barrels had no in-repo callers, which generated code no longer has. Duplication is a measure of avoidable " +
    "lines; new code starts below the old 3.2%, and the threshold only moves down. The old lessons stay: knip's raw-transfer " +
    "parser reserved a 6 GiB buffer some runtimes refuse, and jscpd's stdout broke under the task runner.",
  source: by("/home/user/factory/knip.jsonc, .jscpd.json and packages/tools/src/modules/lint/tasks.ts"),
  affects: [f.system_capxul],
});

export const decision_tooling_lane_gate = defineDecision({
  id: "tooling.lane-gate",
  title: "From day one, B1 and every lane pass the same gates",
  question: "What must the generators and every lane meet from their first commit, so the standard never has a backlog?",
  options: [
    {
      label: "day-one",
      text:
        "B1: generated code passes the standard under only the generated override, goes through the shared hashed writer, " +
        "is byte-identical across runs, emits the types that replace the old checks (handler error and service channels, " +
        "typed workflow steps and waits, error classes with a cause, Spans, Config, transition tables), and maps " +
        "Schema.Number to Schema.Finite. Every lane: hooks and CI green without bypass, zero findings, reasoned and counted " +
        "disables, generate:check clean, new dependencies exact, aged and reviewed, lines counted.",
    },
    { label: "per-milestone", text: "Let each milestone choose its own bar and tighten it later." },
  ],
  chosen: "day-one",
  why:
    "A bar raised later meets code written to the old bar, which is the backlog this design exists to avoid. The " +
    "generated types are not an option for B1: they are what lets five old checks go, so a generator that skips them " +
    "brings the old checks back. Measured: linted as runtime code, the book's schemas raise 456 schema-number findings, " +
    "so the mapping belongs in the generator, and the book's 97 Schema.Number fields stay as written.",
  source: by("the cross-file table in docs/design/tooling.md; oxlint over a copy of the book (456 schema-number)"),
  affects: SHIPPED,
});
