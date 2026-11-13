// The tooling design's records: its decisions (defineDecision). One writer: the tooling designer.
// Explained in docs/design/tooling.md, which gives the exact files T0 writes. Ids are tooling.<topic>.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
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
  source: by("archive/docs/mission/initializer.md (B0-B5, no tooling milestone); /home/user/factory/.oxlintrc.json (26 overrides); a Vite Plus 1.5.0 prototype"),
  affects: SHIPPED,
});

export const decision_tooling_layers = defineDecision({
  id: "tooling.layers",
  title: "Each policy is enforced at the cheapest layer that can enforce it fully",
  question:
    "The old system enforced its architecture with 12 Oxlint rules (about 1,500 lines with their helpers) and 8 cross-file checks (4,644 lines) " +
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
  source: by("/home/user/factory/packages/tools/src/modules/lint (README, internal/: 4,644 lines) and oxlint-plugin (12 rules, about 1,500 lines with helpers); oxlint 1.91 JS plugin API"),
  affects: SHIPPED,
});

// ── the toolchain ───────────────────────────────────────────────────────────────────────────

export const decision_tooling_package_manager = defineDecision({
  id: "tooling.package-manager",
  title: "pnpm 12 workspaces with a catalog, not npm (Aaron)",
  question:
    "system.layout said npm workspaces; the old system used pnpm 9 with a catalog. Which package manager does the rebuild " +
    "use, given parallel lanes, a published SDK and CLI, and agents that install packages unattended?",
  options: [
    {
      label: "pnpm-catalogs",
      text:
        "pnpm 12.18.0 workspaces with one version catalog in pnpm-workspace.yaml (packages say catalog: and workspace:*), " +
        "overrides for the vite alias and the vitest pin, minimumReleaseAge 4320 (3 days), onlyBuiltDependencies for the " +
        "install-script policy, engineStrict and devEngines, and packageImportMethod clone-or-copy so effect-tsgo's patch of " +
        "TypeScript and Oxlint never reaches the shared store (enableGlobalVirtualStore off).",
    },
    {
      label: "npm-12",
      text:
        "npm 12.2.2 workspaces: exact pins, min-release-age=3, strict-allow-scripts with an allowScripts policy, engine-strict " +
        "and devEngines, and a workspace check for one exact version per dependency.",
    },
  ],
  chosen: "pnpm-catalogs",
  why:
    "Aaron decided on 8 November 2026: pnpm, not npm. The tooling design had recommended npm 12 for its new release-age window " +
    "and script policy; pnpm has both (minimumReleaseAge, onlyBuiltDependencies), keeps one version per dependency in its " +
    "catalog instead of a check script, and isolates packages strictly. The two pnpm frictions the design found have local " +
    "answers, both proven on the starter kit (pnpm install --frozen-lockfile and the full gate pass from a fresh clone): " +
    "effect-tsgo's patch works with the global virtual store off and packages copied, not hard-linked; a lint plugin that " +
    "imports vite-plus/lint/plugins declares vite-plus in its own manifest.",
  source: "Aaron, 8 November 2026, in the build-preparation conversation",
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
        "@effect/tsgo 0.67.3, typescript 7.0.2, effect 4.1.2, knip 6.44.1, jscpd 5.4.2, @types/node 24.19.2, pnpm 12.18.0, " +
        "gitleaks 8.30.1. The bundle must sit inside @effect/tsgo's supported list; overrides alias vite to vite-plus-core and " +
        "pin vitest to the bundle. Upgrades move the set in one pull request; minimumReleaseAge (3 days) refuses younger versions.",
    },
    { label: "latest", text: "Take the latest of each on the day of install, with caret ranges." },
    { label: "week", text: "As coherent-window, with a 7-day window." },
  ],
  chosen: "coherent-window",
  why:
    "Vite Plus pins Oxlint, Oxfmt, tsgolint and Vitest exactly, and @effect/tsgo names the Oxlint, tsgolint and TypeScript " +
    "versions it supports; a pair outside that list is the failure that broke the old toolchain's patch. On 8 November " +
    "@effect/tsgo 0.67.3 lists exactly Vite Plus 1.5.0's bundle. Without the vite alias and vitest pin (pnpm overrides), the package manager cannot resolve " +
    "Vitest's vite (reproduced). A release-age window stops a compromised release, which is usually pulled within a day or " +
    "two, from reaching agents that install unattended; 7 days would have forced effect below the 4.1.2 the book already " +
    "pins. Every pin here was at least 3 days old on 8 November; pnpm's catalog holds one version of each. The window applies " +
    "when a version enters the lockfile: a frozen install under a 30-day window still installs the locked, " +
    "4-day-old vite-plus. No direct vite devDependency: with the overrides alone vp test runs (measured), and knip reports a " +
    "root vite entry as unused.",
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
    "system's CI and CLI minimum. It is this design's choice, not a tool's floor: Vite Plus 1.5.0 accepts ^22.18.0 or ^24.11.0 " +
    "and pnpm 12.18.0 supports both, and devEngines pins ^24.15.0. Node 26 became LTS eleven days ago and " +
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
        "archive/tools/freeze-flags.ts keeps the compiler API through the alias typescript-5 (npm:typescript@5.9.3). packages/blueprint-engine " +
        "drops its own typescript 5.9.3 and @types/node 22.19.1, so the root's 7.0.2 and 24.19.2 serve it.",
    },
    { label: "two-compilers", text: "TypeScript 5.9 for the book, 7 for product code." },
    { label: "one-program", text: "One root tsconfig that includes every package." },
  ],
  chosen: "ts7-solution",
  why:
    "Measured: tsc 7.0.2 checks blueprint/ clean in 4.8 s against 10.2 s on 5.9.3, and packages/blueprint-engine in 0.4 s. TypeScript 7 " +
    "refuses noEmit in a referenced project (TS6310, reproduced), so packages do not reference each other; a solution of " +
    "independent noEmit projects passed and caught an error in one package. One program would mix browser and Node libs. " +
    "TypeScript 7 has no stable programmatic API, and freeze-flags is the provenance of blueprint/baseline/flags.ts, so it keeps " +
    "the old compiler under an alias. No paths aliases or baseUrl: tsgolint does not support baseUrl. Measured: a package " +
    "importing another by name through exports to src builds under tsc -b with no reference, and an error in either fails " +
    "it; the book also checks clean under the base's stricter flags. Left with @types/node 22.19.1, packages/blueprint-engine would put " +
    "one package at two versions, which pnpm's catalog prevents.",
  source: by("tsc 7.0.2 and 5.9.3 runs on blueprint/ and packages/blueprint-engine; a tsc -b prototype (TS6310); Vite Plus troubleshooting guide"),
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
        "rule id, and fixtures/good to give nothing. The canary sets CAPXUL_LINT_CANARY=1, which drops the fixtures from " +
        "ignorePatterns, and the override globs also match the fixtures' mirrored paths.",
    },
    { label: "oxlintrc", text: "A .oxlintrc.json, read into vite.config.ts by a helper, as the old lintConfig() did." },
  ],
  chosen: "vite-block",
  why:
    "Measured on Vite Plus 1.5.0: with only a .oxlintrc.json, vp lint exited 0 with no output, although that config named " +
    "a plugin the unpatched binary does not have; the lint block was read and failed closed. The old repository met the " +
    "same silent pass and wrote a helper to bridge the two files. A JS config cannot extend a file path, and spreading the " +
    "JSON preset failed typeCheck (TS2322), so the typed preset object is extended. RuleTester proves each rule in " +
    "isolation; only the canary proves the built-in, Effect and capxul layers are all active in the config the gates run. " +
    "Measured: vp lint --no-ignore does not lift a config's ignorePatterns (it found no files and exited 0), and overrides " +
    "written only as packages/<pkg>/src/** did not reach fixtures/bad/packages/backend/src/…, so no-throw and " +
    "global-date-in-effect stayed silent there; with the environment variable and the mirrored globs every expected id fired.",
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
        "on 20 of the effect-native preset's 26 rules (time, randomness, timers, fetch, randomUUID, process.env, console, " +
        "JSON, new Promise, async functions, native Error classes, Node built-ins) in product packages, leaving out " +
        "abort-controller-in-effect (in strict already), schema-sync (strict's schema-sync-in-effect covers Effect code) and " +
        "four suggestions with semantic caveats (instance-of-schema, prefer-effect-array, -record, -string); " +
        "unstable-api-usage off.",
    },
    { label: "recommended", text: "The recommended preset as shipped: 84 of its 97 rules at warn." },
    { label: "hand-list", text: "List every rule by hand, as the old repository did with 85." },
  ],
  chosen: "strict-native",
  why:
    "The strict preset is the old hand-written list plus 15 rules added since, and extending it keeps step with each pinned " +
    "version. With capxul/time and capxul/imports, the Effect-native rules replace the old ambient-time and " +
    "presence-implies-mode checks and half of no-raw-provider-call: environment through the generated Config, HTTP " +
    "through HttpClient. Alone they do not hold the one clock: measured, global-date flags Date.now() and new Date(ms) but " +
    "not Clock.currentTimeMillis, DateTime.now or performance.now(). They stay off in the plugin and the generator, which are plain Node scripts, and in sdk-react. Effect " +
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
        "the 19 type-aware typescript rules the old repository relied on, named so a category change cannot drop them, plus " +
        "no-explicit-any; ban-ts-comment allowing only a described ts-expect-error; " +
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
    "beside extends keep the Effect plugin active, and the three categories with typeAware turn on 26 type-aware rules (the " +
    "19 named and 7 more; consistent-return is turned off). Every correctness and suspicious Effect rule is in the strict " +
    "preset or the four extras, so the categories enable no Effect rule the config does not list.",
  source: by("/home/user/factory/.oxlintrc.json (categories, limits, comments); oxlint 1.91 configuration_schema.json; prototype runs with import/no-cycle"),
  affects: SHIPPED,
});

export const decision_tooling_lint_scope = defineDecision({
  id: "tooling.lint-scope",
  title: "Oxlint covers packages/*/src; the design book stays under its own checks",
  question:
    "Linted with the product standard, blueprint/, packages/blueprint-engine and tools/ raise 757 findings, 456 of them schema-number on " +
    "the records' Schema.Number fields. What does Oxlint cover?",
  options: [
    {
      label: "product-and-tooling",
      text:
        "Every package except packages/blueprint-engine: product packages with the Effect-native rules, tooling packages (generate, " +
        "evals, lint) and sdk-react without them, tests and generated code under their overrides. blueprint/, packages/blueprint-engine, " +
        "tools/, docs/ and spikes/ are outside Oxlint and formatted by Oxfmt; the four book checks govern them.",
    },
    { label: "everything", text: "Lint the book too, and fix its 757 findings at T0." },
    { label: "design-profile", text: "Lint the book with a second, correctness-only config." },
  ],
  chosen: "product-and-tooling",
  why:
    "The book is design data checked by its own build, 21 tests, strict tsc and check-frozen; its Schema.Number fields " +
    "describe columns, and the generator, not the record, is where a runtime schema becomes Schema.Finite. Fixing 757 " +
    "findings across more than 2,200 records changes no behaviour and risks the book. A second config means a second lint run and " +
    "a second standard. Oxlint overrides cannot set categories, so a lighter profile would be a hand-tuned rule list. " +
    "Spikes are throwaway; B0 lints its spike by hand once, as a first real test of capxul/workflow-body.",
  source: by("oxlint over a copy of this repository (757 findings strict, 37 correctness-only); oxlint override schema (no categories)"),
  affects: [f.system_capxul],
});

export const decision_tooling_plugin = defineDecision({
  id: "tooling.plugin",
  title: "packages/lint: ten capxul rules over facts generated from the book",
  question: "Where do Capxul's own lint rules live, which rules are there, and how do they learn the design?",
  options: [
    {
      label: "facts-plugin",
      text:
        "A tooling package packages/lint (not a component, not in system.size, added beside system.layout's generate and " +
        "evals): ten rules (imports, concept-shape, workflow-body, span-names, generated-intact, no-throw, catch-keeps-cause, " +
        "comments, no-sentinel-tests, time), each with " +
        "valid and invalid RuleTester cases, reading src/generated/facts.ts, which packages/generate writes from " +
        "blueprint. Budgets: 900 non-test lines for the rules, 200 for the cross-file checks, 120 for the facts target.",
    },
    { label: "hand-lists", text: "Rules with hand-written lists of concepts, doors and files, as the old plugin had." },
    { label: "book-import", text: "Rules that import blueprint directly at lint time." },
  ],
  chosen: "facts-plugin",
  why:
    "Facts generated from the records cannot drift from the book, and generated-intact plus generate:check prove it. " +
    "Importing more than 2,200 records into every lint run would load the design system into the linter and slow every editor " +
    "keystroke; the facts file is the few hundred names the rules need. Hand lists are what drifted before. The plugin " +
    "imports vite-plus/lint/plugins, so it always matches the bundled Oxlint. Ten rules replace the old twelve plus most " +
    "of the eight cross-file checks; the prototype of six of them ran in 1.1 s with the Effect rules. The tenth, time, is " +
    "the static half of time.no-direct-reads, which the one-clock design gives to T0.",
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
        "lists; in a concept folder bare modules only effect, effect/* and (backend) @capxul/runtime, and in the SDK its " +
        "own src/platform/; in hand-written product code no Config or ConfigProvider from effect (only the generated " +
        "Config module) and no import of a test or fixture; workspace imports " +
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
    "door.ts needs no re-export bookkeeping, and relative paths need no resolver config. Without the Config clause a " +
    "hand-written Config.option(Config.string(\"X\")) would bring back the presence-as-mode branch the old " +
    "presence-implies-mode check refused; without the platform clause an SDK flow could not reach its signer.",
  source: by("system.layout; A4; blueprint/shared/foundation.ts (component and concept dependsOn); prototype rule"),
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
        "capxul/workflow-body, in src/<c>/processes.ts: outside the implementation passed to a generated step " +
        "(<Name>Steps.<step>(…)), no Date, Math.random, performance, crypto, fetch, process or timers, no Clock, DateTime, " +
        "Random, Schedule, DurableClock or ClusterCron, no Effect.sleep, delay, timeout, retry, repeat, race or promise, " +
        "nothing from the runtime (Now among it) or another concept's door; every yield* is a generated step or wait " +
        "(<Name>Steps, <Name>Waits; a timer wait calls Timers.until), an Activity, DurableDeferred or Workflow member, a " +
        "declared error or a pure Effect combinator over those; every step and wait the book declares is yielded.",
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
    "time.durable-timers chose the wake router's timers table over DurableClock, and time.no-direct-reads forbids " +
    "DurableClock.sleep, ClusterCron, Effect.sleep and Effect.timeout in a body and Now anywhere in it (StepTime inside a " +
    "step), so DurableClock is not allowed here and a body waits on time only through its generated timer wait. T0 writes " +
    "the rule before B1 writes the skeletons, so the skeleton's names are fixed here (docs/design/tooling.md section 7). " +
    "Prototyped: the rule caught Clock and Effect.sleep in a body.",
  source: by("effect 4.1.2 dist/workflow (Workflow.toLayer, Activity.make, DurableDeferred); rules.process-wakeups; A2; time.durable-timers; time.no-direct-reads; prototype rule"),
  affects: [f.component_backend],
});

export const decision_tooling_time = defineDecision({
  id: "tooling.time",
  title: "capxul/time enforces time.no-direct-reads in every package",
  question:
    "time.no-direct-reads gives T0's lint the one-clock rules, at zero from the first commit, in every package. Effect's " +
    "global-date rules cover only part of them, and only in product packages. How does T0 enforce the rest?",
  options: [
    {
      label: "capxul-time",
      text:
        "A tenth plugin rule, capxul/time, on every linted file: outside packages/runtime/src/time/, no Date.now(), argumentless " +
        "new Date(), performance.now() or process.hrtime, and no Clock.currentTimeMillis, currentTimeNanos or clockWith or " +
        "DateTime.now, nowAsDate or nowUnsafe (names resolved through the file's imports); Now only in packages/runtime and " +
        "generated code (handlers and procedures read RequestTime, steps StepTime); RealTime only in " +
        "packages/runtime/src/integrations/; no Postgres time function in an sql tagged template or sql.unsafe string. Real " +
        "elapsed time (Clock.monotonicTimeNanos, Effect.timed, timeouts and Schedule in a step or a call) stays allowed. " +
        "Workflow bodies are capxul/workflow-body's; generated migrations are refused a time default by the migration " +
        "writer, so generate:check holds them; the clients and the indexer import no runtime, which leaves them client.now() " +
        "and the block timestamp.",
    },
    { label: "effect-only", text: "Rely on Effect's global-date rules in product packages, as a first draft did." },
    {
      label: "restricted",
      text: "no-restricted-syntax and no-restricted-imports entries per folder in vite.config.ts.",
    },
  ],
  chosen: "capxul-time",
  why:
    "Measured on Oxlint 1.91 with @effect/tsgo 0.67.3: global-date and global-date-in-effect flag Date.now() and new " +
    "Date(ms), but pass Clock.currentTimeMillis, DateTime.now and performance.now(), the reads the one clock forbids " +
    "outside its module; and they are on only in product packages, while the decision says every package. A first draft " +
    "also let workflow bodies use DurableClock, which time.durable-timers rejected. Restricted-syntax entries cannot " +
    "follow an import's local name, and one rule keeps the time list in one file with its fixtures. The devnet's time " +
    "authority must read the real clock to stamp realAt (docs/design/time.md section 2); until the time design names that " +
    "module, its one read takes a reasoned, counted disable.",
  source: by("time.no-direct-reads and docs/design/time.md section 4 (T0's lint rules); oxlint 1.91 runs of global-date on Clock, DateTime and performance reads"),
  affects: [...SHIPPED, f.component_postgres],
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
        "The shared writer in packages/generate writes 'Generated from blueprint by packages/generate. Do not edit. " +
        "sha256:<hex>' over the rest of the file; capxul/generated-intact checks the hash and refuses the header outside " +
        "src/generated/. generate:check stays the full proof. Generated files are not formatted.",
    },
    { label: "regen-only", text: "Only regenerate and diff, in CI and at pre-push." },
  ],
  chosen: "hashed-header",
  why:
    "A per-file hash shows a hand edit in the editor and at pre-commit in milliseconds, where regeneration takes the whole generator; regeneration still runs at pre-push and in CI, because a hash cannot show that a record changed and the files were not regenerated. The formatter must not touch generated files, or every hash would break; the generator emits finished code, and lint holds it to the standard. Prototyped: the rule caught an edited header-hashed file. Review, 11 November 2026: Confirmed tooling.generated-header; original choice retained.",
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
        "one; capxul/no-throw refuses throw in product code and the React SDK (absurd from effect/Function for " +
        "exhaustiveness; a React misuse guard takes a reasoned disable); " +
        "capxul/catch-keeps-cause requires a handler that fails again to read what it caught, and requires handlers to be " +
        "written inline; effect-try-without-catch maps every try to a declared error.",
    },
    { label: "call-graph", text: "Port operation-errors: a static call graph per operation row." },
  ],
  chosen: "types-and-two-rules",
  why:
    "The type does in zero lines what operation-errors did with a static call graph, and rpc:<id>/errors proves it at run " +
    "time. A throw escapes the error channel and becomes a defect, so it is refused everywhere in shipped code, not only " +
    "in recipes as before. The React SDK is hand-written and outside the Effect-native rules, and the old sdk-public-surface " +
    "check let it throw only owned misuse guards, so no-throw covers it too. The old catch-keeps-cause followed named " +
    "handlers across files in 549 lines; requiring inline " +
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
        "New packages test with Vitest 5.1.0 through vp test, importing its API from vite-plus/test (with @effect/vitest for " +
        "Effect code, whose package also lists vitest 5.1.0, its required peer); capxul/no-sentinel-tests " +
        "and vitest's no-focused, no-disabled and todo rules are errors in tests; packages/blueprint-engine keeps its 21 node:test " +
        "tests, run by pnpm book.",
    },
    { label: "migrate", text: "Move the book's tests to Vitest at T0." },
  ],
  chosen: "vitest-new",
  why:
    "Vitest is bundled with Vite Plus and pinned by overrides, so it costs no extra dependency, and the RuleTester runs " +
    "under it. A test that cannot fail proves nothing, and agents write sentinel tests when hurried, so the plugin keeps " +
    "the old rule. The book's suite works and is outside Oxlint; migrating it changes nothing that matters. Measured with " +
    "knip 6.44.1: a test importing from vitest leaves vitest unlisted, because vite-plus carries it; Vite Plus's test " +
    "guide says to import from vite-plus/test.",
  source: by("/home/user/factory oxlint-plugin no-sentinel-tests.ts; packages/blueprint-engine/test; vite-plus 1.5.0 dependencies"),
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
        "(by handler types), presence-implies-mode (by process-env rules, the generated Config and capxul/imports' Config " +
        "clause), tech-debt (by capxul/comments) and ambient-time (by capxul/time, the Effect-native rules and " +
        "workflow-body). The two parts of sdk-public-surface that still guard hand-written code move to rules: the React " +
        "SDK's throws (capxul/no-throw) and the test boundary (capxul/imports). Keep four: generate:check " +
        "(sys:generated), loc (system.size, sys:loc), workspace (pins, overrides, references), and the lint canary.",
    },
    { label: "keep", text: "Keep the eight, adapted to the new layout." },
  ],
  chosen: "four",
  why:
    "Five of the old checks guarded hand-written surfaces or catalogues that are now generated, or a Convex runtime that is " +
    "gone; the error-count ratchet existed to pay down legacy, and new code starts at zero. What remains needs more than one " +
    "file: whether generated files match the records, how many lines each concept has, whether the manifests and the " +
    "toolchain agree, and whether the config loads every rule. Each is under 200 lines; the old eight were 4,644. A first " +
    "draft said Effect's rules replaced ambient-time; measured, they pass Clock.currentTimeMillis, DateTime.now and " +
    "performance.now(), so capxul/time does that part.",
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
        "Markdown, src/generated, blueprint/baseline, docs/as-is/archive, archive/tools/workflows and the lockfile. T0 formats the tree " +
        "once in a commit with nothing else, then shows the book's counts unchanged.",
    },
    { label: "w100", text: "The old repository's width of 100, Markdown included." },
  ],
  chosen: "w120",
  why:
    "Measured: the book's lines run to p90 124 characters; Oxfmt would rewrite 226 of 293 files at 100 and 201 at 120, so " +
    "one formatting commit is needed at any width, and 120 wraps fewer pipe chains. Sorted imports remove a class of merge " +
    "conflicts between lanes. Oxfmt pads every Markdown table column to its widest cell (a 100-character row of " +
    "blueprint.md became 400), which makes prose unreadable as source. Generated files keep the bytes their hash covers. " +
    "Formatting the whole tree once keeps every later diff about content.",
  source: by("oxfmt 0.76.0 --check over a copy of this repository at widths 100, 120 and 130; oxfmt on docs/blueprint.md"),
  affects: [f.system_capxul],
});

// ── gates ───────────────────────────────────────────────────────────────────────────────────

export const decision_tooling_hooks = defineDecision({
  id: "tooling.hooks",
  title: "Hooks: staged fmt, lint and secrets; pre-push runs every gate on the tree",
  question: "What do pre-commit and pre-push run, within what time, and which lessons of the old hooks do they keep?",
  options: [
  {
    "label": "current-scope",
    "text": "Pre-commit checks staged formatting, lint and secret leakage; pre-push checks the current tree and refuses protected-branch updates. Use the current CLAUDE.md gates (test, blueprint, frozen, layout and contract reconciliation), not the old pnpm book spelling or a swarmD merge gate. Hook timing targets do not authorize skipping a gate."
  },
  {
    "label": "historical",
    "text": "The former answer to tooling.hooks is preserved in docs/cut-archive/decision-review-history.json as historical evidence, not implementation authority."
  }
],
  chosen: "current-scope",
  why:
    "Review, 11 November 2026: Pre-commit checks staged formatting, lint and secret leakage; pre-push checks the current tree and refuses protected-branch updates. Use the current CLAUDE.md gates (test, blueprint, frozen, layout and contract reconciliation), not the old pnpm book spelling or a swarmD merge gate. Hook timing targets do not authorize skipping a gate. Authority: system.layout; sites.door; portal.plan-page.",
  source: "The coordinator, round 2, m1-old-decisions; system.layout; sites.door; portal.plan-page",
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
  source: by("archive/docs/mission/initializer.md (lanes merge by pull request into integration/build); the old CAP-155 merge gate"),
  affects: [f.system_capxul],
});

export const decision_tooling_ci = defineDecision({
  id: "tooling.ci",
  title: "Run the repository gate on pull requests and every integration or trunk push",
  question: "What does CI run, on which events, within what time, and what becomes of the old CI's other jobs?",
  options: [
    {
      label: "current-gate",
      text:
        "The existing blueprint workflow runs on every pull request, including PRs into main, integration/build and " +
        "integration/wave-0, and on pushes to all three branches. Keep its existing install, typecheck, blueprint, " +
        "Frappe, contracts, frozen and test steps unchanged; the ripple report remains pull-request-only.",
    },
    { label: "build-only", text: "Run the gate on every pull request but only integration/build pushes." },
  ],
  chosen: "current-gate",
  why:
    "Aaron authorized main as the current trunk and integration/wave-0 as its reviewed integration gate on 12 November " +
    "2026, then explicitly approved push CI on both. PR checks alone do not validate the final merged tree. Checking " +
    "each pushed head records that evidence before main advances, without adding a different gate or deploying anything.",
  source: "Aaron through the Amp Space, 12 November 2026; .github/workflows/blueprint.yml; wave-zero integration thread",
  affects: [f.system_capxul],
});

export const decision_tooling_ci_evals_typecheck = defineDecision({
  id: "tooling.ci-evals-typecheck",
  title: "CI type-checks the eval harness and the product code it imports",
  question: "Should the CI gate type-check packages/evals, which compiles the backend and SDK code its modules import?",
  options: [
    { label: "add-step", text: "Add one step to the blueprint workflow, after the blueprint typecheck: pnpm --filter @capxul/evals check (tsc -p packages/evals). Every other tooling.ci step stays as it is." },
    { label: "local-only", text: "Leave it to each lane's local gates. A change outside packages/evals can then turn this typecheck red without any check noticing." },
  ],
  chosen: "add-step",
  why: "PR55 landed packages/backend/src/approvals/http.ts:77 with an optional property set to undefined, which fails packages/evals' exactOptionalPropertyTypes typecheck. CI stayed green because no step compiled packages/evals, and the eval modules that run in an acceptance attempt import that code. One added step widens the gate and removes none.",
  source: "Wave Zero integrator request after #147's re-review, 13 November 2026; extends tooling.ci",
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
        "(src/generated and the book excluded), run with KNIP_DISABLE_RAW_TRANSFER=1, with typescript-5 the one ignored " +
        "dependency (archive/tools/freeze-flags.ts, outside knip); jscpd 5.4.2 at a 2% threshold over packages/*/src, run directly " +
        "in CI, never under vp run.",
    },
    { label: "deps-only", text: "knip --dependencies only, as the old gate ran it." },
  ],
  chosen: "knip-jscpd",
  why:
    "Every dead file is lines that count against system.size, and an unlisted dependency is a phantom that hoisting hides " +
    "until the SDK or CLI is packed, so both axes are on; the old repository kept files and exports off only because its " +
    "published barrels had no in-repo callers, which generated code no longer has. Duplication is a measure of avoidable " +
    "lines; new code starts below the old 3.2%, and the threshold only moves down. The old lessons stay: knip's raw-transfer " +
    "parser reserved a 6 GiB buffer some runtimes refuse, and jscpd's stdout broke under the task runner. Measured on a " +
    "scratch workspace: knip's vite-plus plugin makes test files entries; it reported a root vite devDependency and " +
    "typescript-5 as unused, so the root lists no vite and ignores typescript-5 with its reason. jscpd 5.4.2 with the " +
    "config skipped src/generated and exited 1 over the threshold.",
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
        "workflow skeletons with <Name>Steps and <Name>Waits as section 7 fixes them, error classes with a cause, Spans, " +
        "a required-only Config, transition tables, RequestTime and StepTime, migrations with no time default), and maps " +
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

export const decision_tooling_amp_orbs = defineDecision({
  id: "tooling.amp-orbs",
  title: "One independent development stack per Amp orb, without a nested worker box",
  question: "How does an Amp agent run the current Frappe and Core stack without provisioning another agent sandbox?",
  options: [
    { label: "orb", text: "Amp owns the worker checkout and lifecycle. Setup caches the pinned bench image, Node, pnpm, native Solidity compilers, Foundry, contract artifacts and the native PostgreSQL 17 client. The host psql entrypoint selects major 17 for recovery, accepting maintenance credentials through PG environment variables rather than argv. Runtime provides local Postgres, MariaDB, Redis, Frappe and a seeded v4 chain; Frappe HTTP and Socket.IO are published only on loopback. The Core/Ponder package owns its schema, migrations, restricted roles and readiness; its running services do not inherit migration/admin credentials. Amp supervises the processes. No Cloudflare worker, loop host or model proxy is started inside the orb." },
    { label: "nested-box", text: "Keep creating a Cloudflare worker box from every Amp orb." },
  ],
  chosen: "orb",
  why: "Aaron asked for one full stack per agent orb and, on 12 November, one Postgres/Ponder design everywhere. The built-in orb supports a systemd-owned Docker daemon: bench containers need not be rewritten as native services, nor does Docker need a world-writable socket. build.amp already removed the home-made worker provisioner. Product tenant boundaries, HMAC checks, test-only keys, world clocks, snapshots and cleanup remain. Setup contains no running company sites or runtime authentication. A legacy Core smoke check is not wave-zero acceptance: real Postgres/Ponder, a reconciled supplier payment and recovery must be proven together. This decision does not change the project's base branch, provision a paid wave or claim a measured fifteen-stack capacity.",
  source: "Aaron through the Amp Space, 11–12 November 2026; aaron.postgres-and-ponder; build.amp; ampcode.com/docs/orbs/customizing; evals/thin-line.md",
  affects: [f.system_capxul, f.component_devnet],
});
