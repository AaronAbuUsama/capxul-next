# T0: the tooling milestone

T0 sets up the tooling before any product code is written: the pinned toolchain, one lint
standard with Capxul's own rules, the formatter, the git hooks, CI and the few checks that span
files. Every judgment here is a decision record in `books/target/shared/tooling.ts` (ids
`tooling.<topic>`). This page gives the exact files T0 writes, so the build session copies them
and does not improvise them.

T0 runs before B0. The B0 spike is the first code the gates see.

| # | Milestone | Exit |
|---|---|---|
| T0 | **Tooling** (`docs/design/tooling.md`). Pin the toolchain: Node 24.22.2, npm 12.2.2 workspaces, Vite Plus 1.5.0 (Oxlint 1.91.0, Oxfmt 0.76.0, Vitest 5.1.0), @effect/tsgo 0.67.3, TypeScript 7.0.2, gitleaks 8.30.1. Write `vite.config.ts` (lint, fmt, staged, test), the hooks, the knip, jscpd and gitleaks configs and the CI workflow, exactly as given here. Build `packages/lint` (nine `capxul/*` rules, each with good and bad fixtures) and the first target of `packages/generate` (the lint facts, from `books/target`). Format the tree once. | From a fresh clone every gate passes on the whole tree. The lint canary fires every rule on its bad fixtures and none on its good ones. The hooks refuse a bad commit and a push to `main`, within budget. CI is green on the T0 pull request. The book's counts are unchanged. The baselines are logged in `docs/mission/progress.md`. |

## Contents

0. [The principle: the cheapest layer that can enforce a rule](#0-the-principle)
1. [The toolchain](#1-the-toolchain)
2. [The files T0 writes](#2-the-files-t0-writes)
3. [The Capxul lint plugin](#3-the-capxul-lint-plugin)
4. [Cross-file checks: kept, cut, replaced](#4-cross-file-checks-kept-cut-replaced)
5. [The gates and their time budgets](#5-the-gates-and-their-time-budgets)
6. [How T0 proves itself](#6-how-t0-proves-itself)
7. [What B1 and every lane must pass from day one](#7-what-b1-and-every-lane-must-pass-from-day-one)
8. [The decisions](#8-the-decisions)

## 0. The principle

The old system enforced its architecture with about 5,900 lines of hand-written checks: 11 Oxlint
rules (1,269 lines) and 8 cross-file checks (4,644 lines) that rebuilt a TypeScript program to
follow call graphs and catalogues. Most of those checks existed because the catalogues and
surfaces were written by hand and could drift. In the target, the book generates those surfaces,
so they cannot drift.

Each policy is enforced at the cheapest layer that can enforce it fully (decision `tooling.layers`):

1. **Generated types (B1).** The compiler refuses the mistake. Examples: an rpc handler typed
   `Effect<Output, DeclaredErrors, DeclaredServices>`; a workflow whose steps are typed
   Activities; a `Spans` constant for every span name.
2. **Oxlint's built-in and Effect rules.** Configuration only, no code of ours.
3. **The `capxul/*` plugin.** Per-file rules that read facts generated from the book. Oxlint JS
   plugins see the syntax tree only, with no type information, so every rule here is syntactic. A
   rule finds names through the file's own import declarations, not by spelling alone.
4. **Cross-file checks.** Only where no single file can show the mistake.
5. **Evals.** What only a run can prove.

What follows from this:

- **One strict standard.** Every rule that is on is an error, in every folder it covers. Warnings
  fail (`denyWarnings`), and a disable directive that suppresses nothing fails
  (`reportUnusedDisableDirectives: "deny"`). An override only scopes a rule, or turns it off where
  the code is a different kind of thing (a test, a composition root, generated lists).
- **Fail closed.** Without the Effect patch, Oxlint refuses to load the config (`Unknown plugin:
  'effecttsgo'`). The canary proves that every rule layer is loaded (section 6). A config that
  loads but checks nothing is the one failure mode a green gate cannot show. Measured on Vite Plus
  1.5.0: a bare `.oxlintrc.json` was ignored, and `vp lint` exited 0 with no output.
- **Everything measured.** Each gate has a time budget. Lines are counted per concept. Disables
  are counted. The tooling's own code has a line budget.

## 1. The toolchain

### Pins

These are the versions on 8 November 2026. Each is at least 3 days old, and they are mutually
supported (decision `tooling.pins`). The coherence rule: Vite Plus bundles Oxlint, Oxfmt,
oxlint-tsgolint and Vitest at exact versions, and @effect/tsgo lists the Oxlint, oxlint-tsgolint
and TypeScript versions it supports. The bundle must fall inside that list.

| Tool | Version | Released | Role | Why this one |
|---|---|---|---|---|
| Node.js | 24.22.2 (LTS "Krypton") | 27 Oct 2026 | Runtime for everything | The old CI moved its tests to Node 24 after Node 22.23.4's type stripper crashed a CLI child (#3748). This session runs exactly 22.23.4. Node 24 is LTS until April 2028, past B5. Vite Plus needs `^24.11.0`, and npm 12 needs `^24.15.0`. linux-x64 tarball sha256 `48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`. |
| npm | 12.2.2 | 4 Nov 2026 | Package manager, workspaces | See [package manager](#the-package-manager). |
| vite-plus | 1.5.0 | 4 Nov 2026 | The one entry: `vp lint`, `vp fmt`, `vp check`, `vp test`, `vp staged`, `vp hooks` | It bundles the versions below, so they are not separate dependencies. |
| ↳ oxlint | 1.91.0 (bundled) | 3 Nov 2026 | Linter | Inside @effect/tsgo 0.67.3's supported 1.88.0–1.91.0. |
| ↳ oxlint-tsgolint | 7.0.2005 (bundled) | 22 Oct 2026 | Type-aware lint and `typeCheck` | Inside the supported 7.0.2004–7.0.2005. |
| ↳ oxfmt | 0.76.0 (bundled) | 3 Nov 2026 | Formatter | |
| ↳ vitest | 5.1.0 (bundled; pinned by `overrides`) | 2 Nov 2026 | Tests | Vite Plus's docs require the `vite` alias and the `vitest` pin under npm. Without them, a top-level `vitest` cannot find `vite` (reproduced: `ERR_MODULE_NOT_FOUND`). |
| @effect/tsgo | 0.67.3 | 5 Nov 2026 | Effect's Oxlint rules (`effect-tsgo patch --oxlint`) | Supports TypeScript 7.0.2, Oxlint 1.91.0 and tsgolint 7.0.2005. 0.67.5 also exists but is under 3 days old. |
| typescript | 7.0.2 | 8 Jul 2026 | The only compiler (`tsc`, `tsc -b`) | Measured: `tsc -p books` passes clean in 4.8 s, against 10.2 s on 5.9.3, and `packages/book` passes in 0.4 s. @effect/tsgo needs a native TypeScript 7. |
| typescript-5 | `npm:typescript@5.9.3` | | Only `tools/freeze-flags.ts`, which uses the compiler API | TypeScript 7 has no stable programmatic API. The alias keeps `books/frozen/flags.ts` reproducible. |
| effect, @effect/platform-node, @effect/vitest | 4.1.2 | 2 Nov 2026 | Runtime and Effect tests | Already pinned by `packages/book`. |
| @types/node | 24.19.2 | 9 Oct 2026 | Node 24 types | |
| knip | 6.44.1 | 31 Oct 2026 | Unused dependencies, files, exports; unlisted dependencies | 6.44.2 is under 3 days old. |
| jscpd | 5.4.2 | 20 Oct 2026 | Duplication (CI only) | 5.4.3 is from today. |
| gitleaks | 8.30.1 | 21 Feb 2026 | Secret scanning: staged at pre-commit, full history in CI | The latest release. Installed with `go install github.com/zricethezav/gitleaks/v8@v8.30.1`, which Go's checksum database verifies. In this session, GitHub release downloads returned 504 while proxy.golang.org answered. Go 1.24 is in the image, and the install took 32 s. |

Removed from the old toolchain: lefthook (replaced by `vp hooks`), pnpm (see below), changesets
(nothing is published before B5), varlock, `@typescript/native` aliases, and a separately pinned
`oxlint`. Vite Plus's docs say not to add `oxlint` or `@oxlint/plugins` directly, because a second
copy drifts from the linter that loads the plugin. The plugin imports `vite-plus/lint/plugins`, and
its tests import `vite-plus/lint/plugins-dev`.

**Upgrades.** Upgrades happen as one pull request that changes the pin set together. A version
enters the set only when it is at least 3 days old: `.npmrc` sets `min-release-age=3`, so npm
refuses anything younger. The new set must meet the coherence rule, which `npm run workspace`
checks. If npm refuses a pin as too young, the window is working: wait, or take the pin's
predecessor. Never lower the window.

### The package manager

Choice: **npm 12 workspaces** (decision `tooling.package-manager`, Aaron's to confirm).
`system.layout` already says npm workspaces, and the four book checks use `npm test -w` and `npx`.
pnpm with catalogs, as before, is the alternative. The case for npm:

- **npm 12 now has the two pnpm features that mattered for supply chain.**
  - `min-release-age`: a cooldown on new versions.
  - The `allowScripts` policy with `strict-allow-scripts`: a dependency's install script runs only
    when the manifest approves it, and an unreviewed one fails the install.
- **A catalog's job is done by two things.**
  - The dev toolchain lives in one root manifest.
  - `npm run workspace` checks that any dependency shared by packages has one exact version.
- **Phantom dependencies are caught.** Hoisting lets a package use a dependency it does not
  declare. knip reports these as unlisted dependencies, and the gate holds them at zero.
- **No pnpm-specific workarounds.** The pnpm global virtual store blocks `effect-tsgo patch`. pnpm's
  strict layout also hides `vite-plus/lint/plugins` from a plugin file unless every holder declares
  it (Vite Plus's lint guide warns about this).

pnpm would give faster installs and strict isolation. If Aaron prefers it, the change is local:
`pnpm-workspace.yaml` with a catalog, `minimumReleaseAge: 4320` and `onlyBuiltDependencies`. The
rest of this page stays the same.

### Vite Plus is the one entry

`vp` is the only tool a person or agent needs to remember (decision `tooling.entry`):

- `vp check` runs fmt, lint and the type check in one pass.
- `vp lint` and `vp fmt` run separately.
- `vp test` runs the tests.
- `vp staged` runs the pre-commit checks.
- `vp hooks` installs the git hook dispatcher, which replaces lefthook. The dispatcher is a
  husky-style shell shim that passes stdin and arguments through and puts `node_modules/.bin` on
  `PATH`. Measured: the pre-push stdin and the refusal of a push to `main` work through it.

T0 builds no `vp run` task graph. In the old system that graph took a gate module of thousands of
lines. Gates are plain commands in two hook scripts and one workflow file. If a gate grows past its
budget, the first fix is to scope it. A task graph is a decision for later, made with measurements.

## 2. The files T0 writes

Exactly these files, plus the plugin package (section 3) and the facts target of
`packages/generate`. Remove anything an install tool scaffolds that is not listed here, such as
`vp config` agent edits (prevented by `--no-agent`).

### `package.json` (root)

```json
{
  "name": "capxul-next",
  "private": true,
  "type": "module",
  "packageManager": "npm@12.2.2",
  "devEngines": {
    "runtime": { "name": "node", "version": "^24.15.0", "onFail": "error" },
    "packageManager": { "name": "npm", "version": "^12.2.2", "onFail": "error" }
  },
  "workspaces": ["packages/*"],
  "scripts": {
    "prepare": "effect-tsgo patch --oxlint && vp config --no-agent",
    "book": "tsc -p packages/book && npm test -w @capxul/book && tsc -p books && node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target && node --experimental-strip-types tools/check-frozen.ts",
    "generate": "node --experimental-strip-types packages/generate/src/main.ts",
    "generate:check": "node --experimental-strip-types packages/generate/src/main.ts --check",
    "check": "vp check && tsc -b && npm run generate:check && npm run book && vp test run",
    "workspace": "node --experimental-strip-types packages/lint/src/main.ts workspace",
    "loc": "node --experimental-strip-types packages/lint/src/main.ts loc"
  },
  "devDependencies": {
    "@effect/tsgo": "0.67.3",
    "@types/node": "24.19.2",
    "jscpd": "5.4.2",
    "knip": "6.44.1",
    "typescript": "7.0.2",
    "typescript-5": "npm:typescript@5.9.3",
    "vite": "npm:@voidzero-dev/vite-plus-core@1.5.0",
    "vite-plus": "1.5.0"
  },
  "overrides": {
    "vite": "npm:@voidzero-dev/vite-plus-core@1.5.0",
    "vitest": "5.1.0"
  },
  "allowScripts": {}
}
```

`prepare` runs on every `npm install` and `npm ci`:

- `effect-tsgo patch --oxlint` patches the Oxlint binding, tsgolint and `tsc` that Vite Plus
  resolves. Measured: it patches the copy nested under `vite-plus/node_modules`.
- `vp config --no-agent` installs the hook dispatcher without editing `CLAUDE.md` or `AGENTS.md`.
- CI sets `VP_GIT_HOOKS=0`.

`allowScripts` starts empty. T0 runs `npm approve-scripts --allow-scripts-pending` and records
every entry it must add, each with a reason in its pull request. The expected answer is none: the
toolchain's binaries are optional platform packages, not install scripts.

`packages/book` drops its own `typescript` 5.9.3 devDependency, so there is one compiler.
`tools/freeze-flags.ts` changes `import ts from "typescript"` to `"typescript-5"`.

### `.npmrc`, `.node-version`, `.gitignore`

```ini
# .npmrc — decisions tooling.pins and tooling.package-manager
save-exact=true
engine-strict=true
min-release-age=3
strict-allow-scripts=true
```

```text
# .node-version
24.22.2
```

```text
# .gitignore (added to node_modules and *.zip)
*.tsbuildinfo
.vite-hooks/_
coverage/
dist/
```

### TypeScript: `tsconfig.base.json`, `tsconfig.json`, one per package

TypeScript 7 refuses `noEmit` in a project that another project references (TS6310, reproduced).
So packages do not reference each other. Each is an independent composite project that imports the
others by package name, through an `exports` that points at `src`. The root is a solution file, so
`tsc -b` checks every package incrementally (decision `tooling.typescript`).

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "skipLibCheck": true,
    "composite": true,
    "noEmit": true
  }
}
```

```json
// tsconfig.json — every package except packages/book, which `npm run book` checks
{ "files": [], "references": [{ "path": "packages/lint" }, { "path": "packages/generate" }] }
```

```json
// packages/<name>/tsconfig.json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Import form (decision `tooling.imports`):

- Inside a package, relative paths with the `.ts` extension, as the book already does.
- Across packages, the package name (`@capxul/sdk`).
- No `paths` aliases and no `baseUrl`. The tsgolint type path does not support `baseUrl` (Vite
  Plus troubleshooting guide), and one form keeps the import rule simple.

`packages/sdk-react` adds `"lib": ["ES2023", "DOM"]`, `"types": []` and `"jsx": "react-jsx"`. A
package joins the root `references` when it is created; `npm run workspace` fails a package that is
missing from them.

### `vite.config.ts`: lint, fmt, staged, test

All lint configuration lives here, with no `.oxlintrc.json` (decision `tooling.lint-config`).
Vite Plus reads only this block. A `.oxlintrc.json` beside it was silently ignored in the
measurement. A JS config cannot `extends` a file path, so the Effect preset is imported as an
object: `@effect/tsgo/oxlint-presets` exports it typed. Spreading the JSON preset instead failed
`typeCheck` with TS2322.

```ts
// vite.config.ts: the one tooling config Vite Plus reads (decision tooling.entry). Every line is
// explained in docs/design/tooling.md; a change here is a change to a tooling decision.
import { strict as effectStrict } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "vite-plus";

/** Code that ships: the Effect-native rules and capxul/no-throw apply (tooling.effect-rules). */
const PRODUCT = ["packages/{runtime,backend,sdk,cli,mcp,indexer,devnet}/src/**"];
const TESTS = ["**/*.test.{ts,tsx}", "**/test/**"];
const GENERATED = ["**/src/generated/**"];
/** A process's entry point builds its layer and provides it once. */
const ROOTS = ["packages/*/src/main.ts"];

const all = (level: "error" | "off", ...rules: string[]) =>
  Object.fromEntries(rules.map((rule) => [rule, level] as const));

export default defineConfig({
  lint: {
    // The 97 rules of @effect/tsgo's strict preset, every one an error.
    extends: [effectStrict],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    jsPlugins: ["./packages/lint/src/plugin.ts"],
    options: { typeAware: true, typeCheck: true, denyWarnings: true, reportUnusedDisableDirectives: "deny" },
    categories: { correctness: "error", suspicious: "error", perf: "error" },
    ignorePatterns: [
      // Outside Oxlint (tooling.lint-scope): the design book and its tools are checked by `npm run book`.
      "books/**", "packages/book/**", "tools/**", "docs/**",
      // Throwaway spikes, linted by hand; the canary's fixtures, linted only by the canary.
      "spikes/**", "packages/lint/fixtures/**",
      "**/dist/**", "**/coverage/**",
    ],
    rules: {
      // Effect, beyond the strict preset.
      ...all("error",
        "effecttsgo/any-unknown-in-error-context", "effecttsgo/unsafe-effect-type-assertion",
        "effecttsgo/strict-effect-provide", "effecttsgo/effect-try-without-catch"),
      "effecttsgo/unstable-api-usage": "off",
      // Type-aware TypeScript.
      ...all("error",
        "typescript/await-thenable", "typescript/no-base-to-string", "typescript/no-duplicate-type-constituents",
        "typescript/no-floating-promises", "typescript/no-implied-eval", "typescript/no-misused-spread",
        "typescript/no-redundant-type-constituents", "typescript/no-unnecessary-boolean-literal-compare",
        "typescript/no-unnecessary-template-expression", "typescript/no-unnecessary-type-arguments",
        "typescript/no-unnecessary-type-assertion", "typescript/no-unnecessary-type-conversion",
        "typescript/no-unnecessary-type-parameters", "typescript/no-unsafe-enum-comparison",
        "typescript/no-unsafe-type-assertion", "typescript/no-useless-default-assignment",
        "typescript/require-array-sort-compare", "typescript/restrict-template-expressions",
        "typescript/unbound-method", "typescript/no-explicit-any"),
      "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true }],
      "typescript/consistent-return": "off",
      // Size and shape.
      complexity: ["error", 25],
      "max-lines": ["error", { max: 250, skipBlankLines: true, skipComments: true }],
      "max-depth": ["error", 5],
      "max-nested-callbacks": ["error", 4],
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "no-underscore-dangle": ["error", { allow: ["_tag", "_kind"] }],
      ...all("error", "import/no-cycle", "import/no-self-import"),
      "oxc/no-map-spread": "off",
      // Capxul (section 3).
      ...all("error",
        "capxul/imports", "capxul/concept-shape", "capxul/workflow-body", "capxul/span-names",
        "capxul/generated-intact", "capxul/catch-keeps-cause", "capxul/comments"),
    },
    overrides: [
      {
        files: PRODUCT,
        rules: all("error",
          "effecttsgo/global-date", "effecttsgo/global-date-in-effect",
          "effecttsgo/global-random", "effecttsgo/global-random-in-effect",
          "effecttsgo/global-timers", "effecttsgo/global-timers-in-effect",
          "effecttsgo/global-fetch", "effecttsgo/global-fetch-in-effect",
          "effecttsgo/crypto-random-uuid", "effecttsgo/crypto-random-uuid-in-effect",
          "effecttsgo/process-env", "effecttsgo/process-env-in-effect",
          "effecttsgo/global-console", "effecttsgo/global-console-in-effect",
          "effecttsgo/global-json", "effecttsgo/global-json-in-effect",
          "effecttsgo/new-promise", "effecttsgo/async-function",
          "effecttsgo/extends-native-error", "effecttsgo/node-builtin-import",
          "capxul/no-throw"),
      },
      { files: ROOTS, rules: all("off", "effecttsgo/strict-effect-provide") },
      {
        files: TESTS,
        plugins: ["vitest"],
        rules: {
          ...all("error", "vitest/no-focused-tests", "vitest/no-disabled-tests", "vitest/warn-todo", "capxul/no-sentinel-tests"),
          ...all("off",
            "effecttsgo/strict-effect-provide", "complexity", "max-lines", "max-nested-callbacks",
            "no-await-in-loop", "unicorn/consistent-function-scoping", "typescript/unbound-method"),
        },
      },
      { files: GENERATED, rules: all("off", "complexity", "max-lines", "max-depth", "capxul/span-names") },
    ],
  },

  fmt: {
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    endOfLine: "lf",
    sortImports: true,
    sortPackageJson: true,
    ignorePatterns: [
      "**/*.md",
      "**/src/generated/**",
      "books/frozen/**",
      "docs/as-is/archive/**",
      "tools/workflows/**",
      "package-lock.json",
    ],
  },

  staged: {
    // No --fix: the Effect preset's fixes rewrite Effect code; run `vp lint --fix` by hand and read the diff.
    "*.{ts,tsx,js,mjs,cjs,json,jsonc,yml,yaml}": "vp fmt --write --no-error-on-unmatched-pattern",
    "*.{ts,tsx,js,mjs,cjs}": "vp lint --no-error-on-unmatched-pattern",
    // Runs once per commit, without file arguments.
    "*": () => "gitleaks git --pre-commit --staged --redact --no-banner",
  },

  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.{ts,tsx}"],
    exclude: ["packages/book/**", "**/node_modules/**"],
  },
});
```

#### Why each lint group is there

| Group | Setting | Why |
|---|---|---|
| Categories | correctness, suspicious, perf: error | The old standard, proven on 400,000 lines. pedantic, style, restriction and nursery stay off as categories; single rules from them are named below. |
| Plugins | eslint, typescript, unicorn, oxc, import (+ vitest in tests) | Oxlint's defaults plus `import`, for `import/no-cycle` inside a concept: the concept map is acyclic by construction, but files inside a concept are not. Setting `plugins` with `extends` keeps `effecttsgo` active (measured). |
| Effect strict preset | 97 `effecttsgo/*` rules, all error | The same set the old repository listed by hand (85 rules), plus 15 style rules the preset has since added. Extending the preset keeps it in step with each pinned version. |
| Effect extras | `any-unknown-in-error-context`, `unsafe-effect-type-assertion`, `strict-effect-provide`, `effect-try-without-catch` | The first three were in the old set but are not in the strict preset. `effect-try-without-catch` makes every `Effect.try`/`tryPromise` map its failure to a declared error, instead of an `UnknownError`. |
| `unstable-api-usage` | off | Effect 4.1.2 marks `effect/workflow`, `effect/cluster`, `effect/rpc`, `effect/sql`, `effect/http`, `effect/cli` and `effect/observability` as `@stability unstable`: 5,046 module-level markers (counted). The whole stack is built on them. The exact pin is the guard, because an API change fails the typecheck when the pin moves. `experimental-api-usage` stays an error. |
| Effect-native (product only) | the 20 rules in the `PRODUCT` override | Time, randomness, timers, `fetch`, `crypto.randomUUID`, `process.env`, `console`, `JSON`, `new Promise`, `async` functions, native `Error` classes and Node built-ins only through Effect's services: `Clock`, `Random`, `HttpClient`, `Config`, `Logger`, `Schema`, `SecureRandom` and the platform layers. These replace the old `ambient-time`, `presence-implies-mode` and half of `no-raw-provider-call` (section 4). They are off for the tooling packages (the plugin and the generator are plain Node scripts) and for `sdk-react`. |
| Type-aware TypeScript | the 20 named `typescript/*` rules | The old list, plus `no-explicit-any`: the generated types are how the book is enforced, and `any` turns them off. `ban-ts-comment` allows `@ts-expect-error` with a description, and nothing else. |
| `consistent-return` | off | `noImplicitReturns` catches the same thing and understands `absurd()`. The rule pushed code toward `return undefined;` boilerplate (old lesson). |
| `oxc/no-map-spread` | off | It pushed code toward `Object.assign` and mutation, which is worse code (old lesson). |
| Size and shape | complexity 25, 250 lines per file, depth 5, 4 nested callbacks | Small files are what an agent can read whole. These limits held on the old repository; changing them is a decision. |
| `no-underscore-dangle` | allows `_tag` (Effect) and `_kind` (book records) | The old allow-list was mostly Convex fields, which are gone. |
| Tests override | vitest's no-focused, no-disabled and todo rules plus `capxul/no-sentinel-tests`; size limits, `strict-effect-provide` and `unbound-method` off | A test is its own composition root. `unbound-method` misreads `expect(mock.fn)` (old lesson). |
| Generated override | size limits and `capxul/span-names` off | A generated catalogue is one list by nature, and it is where span names are defined. Every other rule holds generated code to the standard, so a lint finding in generated code is a generator bug. |

#### Why the formatter is set this way (decision `tooling.fmt`)

- **`printWidth: 120`.** The book's lines run to p90 = 124 characters (measured over `payments` and
  `packages/book`). Oxfmt would reformat 226 of 293 files at width 100 and 201 at 120. Every width
  needs one formatting commit, and 120 wraps fewer of the Effect pipe chains.
- **`sortImports: true`.** One deterministic import order. Lanes that add imports to the same file
  then rarely conflict.
- **Markdown is not formatted.** Oxfmt pads every table column to its widest cell. On
  `docs/design-book.md`, that turned 100-character rows into 400-character rows. Prose is reviewed
  by reading.
- **Generated files are not formatted.** The header hash covers exactly what the generator wrote.
  The generator emits finished code.
- **`books/frozen/**` is not formatted.** It is never edited.

T0 formats the whole tree once, in a commit that contains nothing else. It then proves the book is
unchanged:

- the build reports the same 2,132 records, 4,752 evals, 0 problems and 74 gaps;
- `check-frozen` reports 0 breaches.

### The hooks: `.vite-hooks/pre-commit` and `.vite-hooks/pre-push`

```sh
# .vite-hooks/pre-commit — decision tooling.hooks.
# CI=1 is load-bearing: without it vp may open /dev/tty for a prompt nobody answers.
export CI=1 VP_NO_UPDATE_CHECK=1
vp staged
```

```sh
# .vite-hooks/pre-push — decision tooling.hooks. Git passes "<local ref> <local sha> <remote ref>
# <remote sha>" lines on stdin. Refuse a direct push to a merge-only branch; refuse a ref that is
# not HEAD, because the gates read the working tree; then run the gates over the whole tree.
export CI=1 VP_NO_UPDATE_CHECK=1
head=$(git rev-parse HEAD)
check=no
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$local_sha" in *[!0]*) ;; *) continue ;; esac   # a deletion pushes nothing
  case "$remote_ref" in
    refs/heads/main | refs/heads/integration/build)
      echo "pre-push: $remote_ref takes pull-request merges only." >&2
      exit 1 ;;
  esac
  if [ "$(git rev-parse "$local_sha^{commit}")" != "$head" ]; then
    echo "pre-push: $local_ref is not HEAD; check it out and push it from there." >&2
    exit 1
  fi
  check=yes
done
[ "$check" = yes ] || exit 0
vp fmt --check
vp lint
tsc -b
npm run --silent generate:check
npm run --silent book
vp test run
```

GitHub branch protection on `main` and `integration/build` is the real guard: a hook can be
skipped. It requires the `check` and `secrets` jobs to pass and allows no direct pushes, and only
the repository's owner can turn it on (decision `tooling.branch-protection`).

### `knip.jsonc`

```jsonc
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  // Decision tooling.dead-code: dependencies, unlisted dependencies, files and exports, in
  // hand-written code. Generated files and the design book are out of scope.
  "ignore": ["**/src/generated/**", "packages/lint/fixtures/**"],
  "ignoreWorkspaces": ["packages/book"],
  "workspaces": {
    ".": { "entry": ["vite.config.ts"], "project": ["vite.config.ts"] },
    "packages/*": { "entry": ["src/index.ts", "src/main.ts"], "project": ["src/**/*.{ts,tsx}"] },
    "packages/lint": { "entry": ["src/plugin.ts", "src/main.ts"], "project": ["src/**/*.ts"] }
  }
}
```

Run it as `KNIP_DISABLE_RAW_TRANSFER=1 knip --no-progress --no-config-hints`. Knip's raw-transfer
parser reserves one 6 GiB `ArrayBuffer`, which some Node runtimes reject (old lesson). An entry in
`ignoreDependencies` names the consuming code in a comment; without that, the dependency is removed.

### `.jscpd.json`

```json
{
  "threshold": 2,
  "minTokens": 60,
  "minLines": 12,
  "reporters": ["consoleFull"],
  "gitignore": true,
  "absolute": true,
  "format": ["typescript", "tsx"],
  "pattern": "packages/*/src/**/*.{ts,tsx}",
  "ignore": ["**/src/generated/**", "**/*.test.{ts,tsx}", "**/test/**", "**/fixtures/**", "packages/book/**"]
}
```

The threshold is 2% of hand-written lines. The old repository ratcheted down to 3.2% on legacy
code; new code starts lower, and the threshold only ever moves down. Run jscpd directly, never under
`vp run`: under the task runner its stdout became non-blocking (old lesson CAP-732).

### `.gitleaks.toml`

```toml
# Decision tooling.secrets: one scanner, gitleaks 8.30.1, on staged files at pre-commit and over the
# whole history in CI. An allowlist entry names one path and one exact value, and says why.
[extend]
useDefault = true
```

Measured on 8 November 2026:

- the full history (90 commits, 13 MB) scans in 5.9 s with no leaks;
- a staged file with a fake AWS key and a fake GitHub token scans in 40 ms, and both are caught.

### `.github/workflows/ci.yml`

```yaml
# Decision tooling.ci. Two jobs on every pull request and on pushes to the merge branches; each
# step's duration is the gate's measurement (section 5). B2 adds the evals job; B5 adds staging.
name: CI
on:
  pull_request:
  push:
    branches: [main, integration/build]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env: { CI: "1", VP_NO_UPDATE_CHECK: "1", VP_GIT_HOOKS: "0" }
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with: { node-version-file: .node-version, cache: npm }
      - run: npm install --global npm@12.2.2
      - run: npm ci
      - run: echo "$PWD/node_modules/.bin" >> "$GITHUB_PATH"
      - name: Workspace pins and references
        run: npm run workspace
      - name: Book (four checks)
        run: npm run book
      - name: Generated files (sys:generated)
        run: npm run generate:check
      - name: Format
        run: vp fmt --check
      - name: Lint
        run: vp lint --format github
      - name: Types
        run: tsc -b
      - name: Tests and lint canary
        run: vp test run
      - name: Unused code and dependencies
        run: KNIP_DISABLE_RAW_TRANSFER=1 knip --no-progress --no-config-hints
      - name: Duplication
        run: jscpd --config .jscpd.json
      - name: Lines (sys:loc, system.size)
        run: npm run --silent loc >> "$GITHUB_STEP_SUMMARY"
  secrets:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
        with: { fetch-depth: 0, persist-credentials: false }
      - name: Install gitleaks 8.30.1 (verified by Go's checksum database)
        run: GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1
      - name: Scan the whole history
        run: gitleaks git --redact --no-banner .
```

The action SHAs are the ones the old repository pinned. The old CI's other jobs move elsewhere:

- The bundle and CLI start-up budgets become evals of the component budgets in the book (the CLI's
  `startMs: 300`), at B2/B3.
- The book-regeneration bot pull requests go away: generated files are committed, and
  `generate:check` refuses a stale one.
- The change-scoped PR selector goes away: whole-tree gates fit their budgets.
- Changesets and pack tests come back with publishing, at B5.

### The cloud environment

The build session runs in a cloud container, which has Node 22.23.4, npm 10.9.9 and Go 1.24.7.
T0 proposes this setup script for the environment, through the environment tools, after running
each line itself:

```sh
curl -fsSLO https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz
echo "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75  node-v24.22.2-linux-x64.tar.xz" | sha256sum -c -
tar -xJf node-v24.22.2-linux-x64.tar.xz -C /usr/local --strip-components=1 && rm node-v24.22.2-linux-x64.tar.xz
npm install --global npm@12.2.2
GOBIN=/usr/local/bin go install github.com/zricethezav/gitleaks/v8@v8.30.1
if [ -d capxul-next ]; then (cd capxul-next && npm ci); fi
```

`engine-strict` and `devEngines` make npm refuse to install under the wrong Node or npm. A session
that skipped the setup fails at its first install, not at a confusing lint error.

## 3. The Capxul lint plugin

`packages/lint` is a tooling package (decision `tooling.plugin`). It is not a component, it is not
counted in `system.size`, and it has its own budget: at most 900 non-test lines for the rules, and
200 for the two checks in `main.ts`. The old plugin and checks took about 5,900 lines.

```
packages/lint/
  package.json            @capxul/lint; devDependency vite-plus 1.5.0 (the plugin API); no other dependency
  tsconfig.json
  README.md               the rule table below, and how to add a rule
  src/plugin.ts           definePlugin({ meta: { name: "capxul" }, rules }) from "vite-plus/lint/plugins"
  src/paths.ts            which package, concept and kind of file a path is: it matches the last
                          `packages/<pkg>/src/` in the path, so fixtures can mirror real paths
  src/rules/<rule>.ts     one rule per file
  src/rules/<rule>.test.ts   RuleTester ("vite-plus/lint/plugins-dev") valid and invalid cases
  src/config.test.ts      the config test and the canary (section 6)
  src/generated/facts.ts  generated from books/target by packages/generate
  src/main.ts             `workspace` and `loc`, the two cross-file checks (section 4)
  fixtures/good/…, fixtures/bad/…   trees that mirror packages/backend/src/<concept>/ and packages/sdk/src/<concept>/
```

### The facts and how they are generated

`packages/generate` gets its first target at T0, and B1 adds the rest:
`packages/lint/src/generated/facts.ts`. It is written by the shared writer that every generated
file goes through. The writer's header line is:

```ts
// Generated from books/target by packages/generate. Do not edit. sha256:<hex of everything after this line>
export const facts = {
  concepts: {
    payments: {
      dependsOn: ["access", "accounts", "approvals", "board", "books", "budgets", "documents", "indexing", "organizations", "parties"],
      door: ["prepareCommand"],
      backend: ["door.ts", "commands.ts", "changes.ts", "ledger.ts", "processes.ts"],
      sdk: ["flows.ts"],
      lines: undefined,
    },
    // … one entry per concept
  },
  workflows: {
    "payments.lifecycle.payment": {
      concept: "payments",
      name: "PaymentsLifecyclePayment",
      steps: ["come-due", "confirm", "escrow", "execute", "follow-carrier", "release", "reserve", "rest", "route", "settle"],
      waits: ["carrier", "confirm", "day-ahead", "escrowed", "pay-day", "payment-sent", "released", "reserved", "retry"],
    },
    // … 81 workflows, 341 steps, 94 waits
  },
  spans: { "sdk.step.browser-install": "Spans.sdk.step.browserInstall" /* … the P6 tree's names */ },
} as const;
```

The payments entry is the real one, with sorted lists. Every fact is derived from the records. The generator reads each concept's module list
(`books/target/<concept>/index.ts`), because a flow record does not name its concept:

| Fact | From | Rule of derivation |
|---|---|---|
| `concepts.<c>.dependsOn` | concept records | the ids of `dependsOn` |
| `concepts.<c>.door` | procedure records of `<c>` | the export name: the id's last segment in camelCase (`parties.resolve-recipient` gives `resolveRecipient`). B1's door types use the same function. |
| `concepts.<c>.backend` | rpc, procedure and workflow records of `<c>` | `<area>.ts` for each area (the middle segment of every rpc id: all 223 are `<concept>.<area>.<name>`), `door.ts` if it has procedures, `processes.ts` if it has workflows |
| `concepts.<c>.sdk` | flow records in `<c>`'s modules | `flows.ts` if it has flows |
| `concepts.<c>.lines` | the concept's `lines` | `sys:loc/<c>`'s budget, once B3 sets it |
| `workflows` | workflow records | the PascalCase export name of the id, and each step's and wait's `name` |
| `spans` | the P6 span tree over rpcs, flows, flow steps, integration calls and workflows, plus each rpc's and flow's `spans` | name, and the expression of its constant in the generated `Spans` |

Two runs write the same bytes: keys are sorted by id, files end with a newline, and line endings
are LF. `npm run generate:check` renders every target in memory and compares it with the file on
disk. It fails and names each file that differs.

### The rules

Every rule is an error, as the table in section 2 configures it. A rule with no data needs no
facts.

| Rule | Forbids or requires | Policy or decision behind it | Data it reads | Fixtures (good / bad) | Autofix |
|---|---|---|---|---|---|
| `capxul/imports` | **Across packages:** imports only the workspace packages in the table below. Never a path into another package's `src`, and never another package's `src/generated/`. **From a concept folder** (`packages/{backend,sdk}/src/<c>/`): another concept only through `src/<d>/door.ts`, only if `<d>` is in `<c>`'s `dependsOn`, and only names the door lists. Bare modules only `effect` and `effect/*`, plus `@capxul/runtime` in the backend. Otherwise its own files and its own package's `src/generated/`. No vendor SDK, no `node:*` and no other concept's internals. | `system.layout` (doors, `sys:imports/<c>`); P4's write boundary and `invoke-boundary`; A4 (the CLI calls one SDK method; the SDK calls only the backend, through the generated client); integrations (an outside service only through its Effect service in `packages/runtime`); `tooling.imports`. Replaces the old `concept-import-door`, `no-foreign-internal-import`, `no-relative-parent-import-out-of-concept` and `no-raw-provider-call`. | `concepts.*.dependsOn`, `concepts.*.door`; the workspace table is the rule's own constant | good: `payments/commands.ts` imports `{ open }` from `../approvals/door.ts` (payments depends on approvals, whose door lists `open` and `withdraw`). bad: `../approvals/internal.ts`; a concept outside `dependsOn`; a name the door does not list; `import { Resend } from "resend"`; `node:fs` in a concept; `@capxul/backend` from the SDK; `../../sdk/src/x.ts` | none |
| `capxul/concept-shape` | A file under `packages/backend/src/<c>/` is one of `concepts.<c>.backend`, a file inside a folder named after one of those stems (`commands/prepare.ts`), a test beside one, or `internal.ts`/`internal/` (private to `<c>`). The SDK is the same with `concepts.<c>.sdk`. `src/` holds only concept folders, `generated/`, `main.ts`/`index.ts` and, in the SDK, `platform/` (signers and transport). `door.ts` exports only the book's procedures, plus types. A new top-level folder is a tooling decision and a change to this rule. | `system.layout` (`src/<concept>/` mirrors the book, so a record and its code share a name and a place); procedures are the door (P4). Replaces the old `concept-file-shape`. | `concepts.*.backend`, `.sdk`, `.door` | good: `src/payments/commands.ts`, `src/payments/commands/prepare.ts`. bad: `src/payments/helpers.ts`, `src/paymnts/x.ts`, a `door.ts` exporting `secret` | none |
| `capxul/workflow-body` | Inside a workflow body (the function passed to `<Workflow>.toLayer(…)` in `src/<c>/processes.ts` or `processes/*.ts`), outside the `execute` of an `Activity.make(…)`: **no** `Date`, `Math.random`, `performance`, `crypto`, `fetch`, `process`, `setTimeout`/`setInterval`/`setImmediate`; no `Clock`, `DateTime`, `Random` or `Schedule`; no `Effect.sleep`, `delay`, `timeout*`, `retry`, `repeat`, `schedule*`, `race*`, `promise`, `tryPromise`, `async` or `callback`; nothing imported from `@capxul/runtime` or another concept's door. **Every `yield*`** is a generated step or wait of that workflow, a member of `Activity`, `DurableClock`, `DurableDeferred` or `Workflow` (from `effect/workflow`), a declared error, or `Effect.all`, `forEach`, `succeed`, `fail`, `void`, `when`, `log*` or `annotateCurrentSpan` over the same. **Every step and wait the book declares** for the workflow is yielded somewhere in its body. | A2 (Effect Workflow); P3; `rules.process-wakeups`. Effect Workflow re-runs a body on resume and replays recorded activity results, so anything else in the body gives a different answer on replay. Activities run at least once, which B0 proves with an idempotency key. The time a body waits is `DurableClock`. | `workflows.*` (steps, waits) | good: a body that yields `steps.settle(…)`, `waits.accept(…)` and `DurableClock.sleep(…)`, with `Clock` used inside an activity's `execute`. bad: `yield* Clock.currentTimeMillis` in the body; `Effect.sleep("1 second")`; `Date.now()`; `yield* helper()` imported from elsewhere; a door procedure called in the body; a declared step never run | none |
| `capxul/span-names` | The name argument of `Effect.fn`, `Effect.withSpan`, `Effect.makeSpan`, `Effect.makeSpanScoped`, `Effect.useSpan` and `Layer.span` is a member of the generated `Spans`, never a string or template literal. Helpers that should not trace use `Effect.fnUntraced`. | P6 (the required span tree: `cli.*`, `sdk.*`, `rpc.*`, `db.tx`, `call.*`, `workflow.*`, `wait.*`, all opened by generated wrappers); an rpc's and a flow's `spans` (the book declares exactly one child span today: `sdk.step.browser-install`); evals `rpc:<id>/spans`, `flw:<id>/spans`, `spn:<op>`. A span a handler needs is added to its record first. | `spans` | good: `Effect.fn(Spans.sdk.step.browserInstall)`, `Effect.fnUntraced(…)`. bad: `Effect.fn("rpc.payments.commands.prepare")`, `` Effect.withSpan(`rpc.${id}`) `` | yes, when the literal equals a catalogue name and `Spans` is imported: rewrites it to the constant (measured in the prototype) |
| `capxul/generated-intact` | Every file under `**/src/generated/**` starts with the header, and its `sha256` matches the rest of the file. No file outside `src/generated/` carries the header. | `system.layout` (the do-not-edit header); `sys:generated`. A hand edit is caught in the editor and at pre-commit in milliseconds; `generate:check` stays the full proof. | none (the file itself) | good: a correctly hashed file. bad: one byte changed; header missing; the header copied into `src/payments/x.ts` | none (the fix is `npm run generate`) |
| `capxul/no-throw` | No `throw` statement in product code (the `PRODUCT` override; generated code included). Fail with a declared error: `return yield* new X(…)`. Make a switch exhaustive with `absurd` from `effect/Function`. | The error vocabulary (`books/target/shared/vocabulary.ts`: code, class, exit code); `rpc:<id>/errors`; B1's handler type, whose error channel is the rpc's declared errors. A throw escapes both and becomes a defect. Replaces the old `no-throw-in-recipe`, widened to all product code. | none | good: `return yield* new NotAuthenticated({})`, `absurd(x)`. bad: `throw new Error("x")`, `throw e` in a `catch` | none |
| `capxul/catch-keeps-cause` | A handler that fails again reads what it caught, other than through `void`. This covers `Effect.catch`, `catchIf`, `catchTag`, each handler of `catchTags`, `mapError`, the `catch` option of `Effect.try` and `tryPromise`, and a `catch (e)` clause. The handler must be written inline: a handler passed by name is refused, so the rule never reads across files. A handler that recovers to a value needs no cause. | The generated error classes carry an optional `cause`; Error Tracking needs the chain (old ADR-0023 R11, ADR-0039 L1). The old rule followed named handlers across files in 549 lines; requiring inline handlers removes that. | none | good: `Effect.mapError((cause) => new ProviderUnavailable({ cause }))`; a recovery to a value. bad: `mapError(() => new X())`; `catch: () => new X()`; `catchTag("A", handler)`; `(e) => { void e; return new X() }` | none |
| `capxul/comments` | A debt marker (`TODO`, `FIXME`, `HACK`, `XXX`) is written `TODO(#123): …`, naming a GitHub issue of capxul-next. When the swarmD ledger runs, its task id is accepted too, by changing one constant. A disable directive (`oxlint-disable*`, `eslint-disable*`) names its rules and gives a reason after ` -- `. | Work is tracked, never left in a comment (`CLAUDE.md`: tracking work); `reportUnusedDisableDirectives` removes stale disables, and this rule makes every remaining one say why. Replaces the old `tech-debt` cross-file walk with a per-file rule, so the editor shows it. | none | good: `// TODO(#12): …`, `// oxlint-disable-next-line capxul/no-throw -- the CLI's exit`. bad: `// TODO tidy`, `// FIXME(aaron)`, a bare `// oxlint-disable-next-line`, `// eslint-disable-next-line no-console` with no reason | none |
| `capxul/no-sentinel-tests` | In tests: no `expect.fail`, no `it.fails`/`test.fails`, no constant expectation (`expect(true).toBe(false)`) and no empty test body. Oxlint's vitest rules add no focused, skipped or todo tests. | Prove by running: a test that cannot fail proves nothing. Kept from the old plugin. | none | good: a test that asserts on the code's output. bad: each of the four forms | none |

**Events need no rule.** Hand-written code sends no product event. Each machine's one event is sent by the
generated transition code (P7), through the outbox. The operation's wide event comes from the generated CLI
span. B1's handler types leave the PostHog integration out of every handler's services, because no rpc's
`calls` names it.

The workspace import table (decision `tooling.imports`). knip's unlisted-dependency check makes
each `package.json` agree with it:

| Package | May import these workspace packages |
|---|---|
| `runtime` | none |
| `backend` | `@capxul/runtime` |
| `sdk` | none (its generated client carries the rpc contract) |
| `cli`, `mcp`, `sdk-react` | `@capxul/sdk` |
| `indexer`, `devnet` | none |
| `generate`, `evals` | `@capxul/book` (and the books, by relative path) |
| `lint` | none |

### Adding or changing a rule

A rule changes with its fixtures, in the same pull request:

1. One invalid case per message.
2. One valid case per allowed form.
3. A line in `README.md`.
4. A decision record when the rule's scope or meaning changes.

A rule that blocks correct code is fixed in the rule, or in the book, or it gets a reasoned disable.
It is never weakened by an override that nobody recorded.

## 4. Cross-file checks: kept, cut, replaced

| Old check (lines) | Target | Why |
|---|---|---|
| `sdk-public-surface` | **Cut.** The SDK client is generated from the flows' `sdk` names; `sys:generated` keeps it equal to the book. | It policed a hand-written barrel. There is none. |
| `telemetry-spine` | **Cut.** The telemetry catalogue is generated from machines, events and spans (B1). Events are sent only by the generated transition code (P7). Span names come only from `Spans` (`capxul/span-names`). Coverage is proven by `evt:`, `spn:`, `rpc:/spans` and `flw:/spans`. | Planned against wired drift cannot happen when both sides are generated from one record. |
| `operation-errors` (a call graph) | **Replaced** by B1's handler type: its error channel is exactly the rpc's or flow's declared errors, so the compiler refuses an undeclared one. `rpc:<id>/errors` proves it at run time. | The type system does in zero lines what the old check did with a static call graph. |
| `v8-boundary` | **Cut.** | No Convex V8 runtime; the backend is Node. |
| `presence-implies-mode` | **Replaced** by `effecttsgo/process-env` and `process-env-in-effect` (only `Config` reads the environment), plus B1's generated `Config` from each environment record's `config` and `secrets`. A mode is then a decoded value, never a variable's presence. | A generated, schema-decoded config cannot treat presence as a mode. |
| `tech-debt` (a repository walk) | **Replaced** by `capxul/comments`. | Per-file, so the editor shows it, at no cost to the gate. |
| `error-contract` (per-folder counts that could only fall) | **Cut.** Errors come from the generated catalogue. The integration edge maps each provider failure to the error its record names (`int:<id>.<call>/<error>` evals). `capxul/catch-keeps-cause` keeps the chain. | A ratchet exists to pay down legacy code. New code starts at zero, and the types hold it there. |
| `ambient-time` | **Replaced** by the Effect-native time, timer and randomness rules (product code) and `capxul/workflow-body` (bodies). | Effect's own rules do it with configuration only. |
| `error-catalog` | **Replaced** by the generated error catalogue (B1). | Generated. |

| Old plugin rule | Target |
|---|---|
| `canonical-helpers` | Cut. The homes are Effect's own (`Predicate`, `absurd` in `effect/Function`) and the runtime's; jscpd measures duplication. |
| `catch-keeps-cause` | Kept, simplified to inline handlers. |
| `concept-file-shape` | `capxul/concept-shape`, driven by the book's facts instead of a hand-written list. |
| `concept-import-door`, `no-foreign-internal-import`, `no-relative-parent-import-out-of-concept` | Merged into `capxul/imports`. |
| `no-raw-provider-call` | `capxul/imports` (no vendor module in a concept) and `effecttsgo/global-fetch`. |
| `no-sentinel-tests` | Kept. |
| `no-throw-in-recipe` | `capxul/no-throw`, for all product code. |
| `no-openfort-stub`, `no-raw-convex-path`, `no-v-any` | Cut: Convex and the old Openfort stubs are gone. |

**Kept or new cross-file checks.** Each one exists because no single file can show the mistake:

| Check | Command | What it fails on | Eval or decision it serves |
|---|---|---|---|
| Generated files | `npm run generate:check` | any `src/generated/` file (and, from B1, any migration) that differs from what the records generate | `sys:generated` |
| Lines | `npm run loc` | Prints JSON of hand-written lines (not blank, not comment-only; not tests, fixtures or `src/generated/`) per package and per concept, summed over the backend and the SDK, with the count of disable directives and debt markers in the same files. It fails when the product total passes 100,000, or a concept passes its `lines`. | `system.size`, `sys:loc/<c>` |
| Workspace | `npm run workspace` | a dependency spec that is not an exact version (`*` allowed only for `@capxul/*`); one package at two versions; `overrides.vite` or `overrides.vitest` out of step with `vite-plus`'s own dependencies (Vite Plus issue #2356: bots bump them apart); a bundled Oxlint or tsgolint outside @effect/tsgo's supported list (read from its README's `supported-components` block); a package missing from the root `tsconfig.json` references; `.node-version` outside `devEngines` | `tooling.pins`, `tooling.typescript` |
| The lint canary | `vp test run packages/lint` | a rule that does not fire on its bad fixture, or fires on a good one, through the real `vite.config.ts` | `tooling.lint-config` |

Third-party, configured only: knip (unused and unlisted dependencies, files and exports), jscpd
(duplication), gitleaks (secrets).

## 5. The gates and their time budgets

| Gate | Runs | Budget | Measured on 8 November 2026 |
|---|---|---|---|
| pre-commit | `vp staged`: fmt and lint (type-aware, Effect, capxul) on the staged files; gitleaks on the staged diff | ≤ 5 s for a commit of up to 30 files; ≤ 15 s worst case | 1.4 s for 8 files (prototype); gitleaks 0.04 s |
| pre-push | protected-branch and HEAD checks; `vp fmt --check`, `vp lint`, `tsc -b`, `generate:check`, `npm run book` and `vp test run`, over the whole tree | ≤ 90 s until B3, then re-measured and recorded | book checks about 15 s (`tsc -p books` 4.8 s on TypeScript 7); the lint of 6 product files 1.1 s; a full-history gitleaks scan 5.9 s (CI only) |
| CI `check` | everything in the workflow above, from a clean install | ≤ 10 min wall, install included | T0 records the first green run's step times as the baseline |
| CI `secrets` | gitleaks over the whole history | ≤ 2 min, install included | 5.9 s scan; 32 s `go install` |

Every gate prints its time; GitHub records each step's duration. A gate that runs over its budget
is reported in the job summary, and the lane that slowed it either fixes it or records a new budget
with a decision. When pre-push passes 90 s, the first remedy is to scope `vp test` to the changed
packages, as a decision with the measurement. Old lessons say it must never start the full `vp run`
task graph from a hook.

**Lessons the old `lefthook.yml` and its scripts record, and where they land:**

1. **Every `vp` call in a hook sets `CI=1` and `VP_NO_UPDATE_CHECK=1`.** `vp` opens `/dev/tty` for
   prompts (update check, shim set-up). Under the hook those prompts waited forever: a pre-push
   "hang" of about 9 minutes. `VP_NO_UPDATE_CHECK=1` alone is not enough. Kept in both hooks and in
   CI's `env`.
2. **Worktree safety.** On macOS, the native `vp` binary was SIGKILLed (137) in a worktree, and the
   SDK's declaration build hit a memory cliff (#1044, #1046). So pre-push called direct verbs (`vp
   fmt`, `vp lint`, `node …`) and never the `vp run` task graph or the full test corpus. Kept:
   pre-push calls direct verbs only. Agents run in Linux containers, but a person may push from a
   macOS worktree.
3. **lefthook skipped a pre-push command when `git diff HEAD @{push}` was empty**, which let `git
   push origin HEAD:other` through unchecked, so the old gates were scripts that read stdin. Moot:
   the Vite Plus dispatcher always runs the script, and the script reads stdin.
4. **A pushed ref that is not HEAD is refused**, because the gates read the working tree. Kept.
5. **A direct push to the protected branch is refused** (old CAP-155). Kept for `main` and
   `integration/build`, with branch protection as the real guard.
6. **`vp exec` dropped every argument after a literal `--`**, so the hooks ran bare `oxfmt` and
   `oxlint`. Kept: no `vp exec`, and no `--` before flags.
7. **`vp staged` appends the staged paths to every command**, so `tsc -p` cannot run there
   (TS5042). Kept: the type check at pre-commit comes from lint's `typeCheck`; `tsc -b` runs at
   pre-push.
8. **No `--fix` at pre-commit.** The Effect preset's fixes rewrite Effect code. Kept.

## 6. How T0 proves itself

T0 is done when all of these were run and observed, and their output is in the T0 pull request:

1. **Install.** From a fresh clone on the cloud environment above, `npm ci` installs exactly the
   pin set and `prepare` applies the Effect patch. `npx vp --version` prints vite-plus 1.5.0,
   oxlint 1.91.0, oxfmt 0.76.0, oxlint-tsgolint 7.0.2005 and vitest 5.1.0. `npm run workspace`
   passes. `npm approve-scripts --allow-scripts-pending` lists nothing unreviewed.
2. **The rules.** `vp test run packages/lint` passes:
   - every `capxul/*` rule has at least one valid and one invalid RuleTester case, and the test
     enumerates the plugin's rules, so a rule without cases fails;
   - the config test imports `vite.config.ts` and finds that every `capxul/*` rule, every rule of
     the strict preset and every Effect-native rule is `"error"` where its section says, that no
     rule anywhere is `"warn"`, and that `unstable-api-usage` is the only Effect rule turned off
     globally;
   - **the canary** lints `packages/lint/fixtures/bad` with the real config (`vp lint --no-ignore
     --format json`) and finds every expected rule id at least once: one rule from each built-in
     category, `effecttsgo/floating-effect`, `effecttsgo/global-date-in-effect`, `import/no-cycle`
     and each of the nine `capxul/*` rules. `fixtures/good` gives zero findings. This is the only
     proof that all three layers are loaded, which the old system's silent passes lacked.
3. **The whole tree.** After the one formatting commit, `vp fmt --check`, `vp lint` (0 findings, 0
   warnings) and `tsc -b` pass. `npm run book` reports 2,132 records, 4,752 evals, 0 problems and 74
   gaps, and `check-frozen` 0 breaches (the counts at hand-off; any change is explained by a commit
   that is not T0's).
4. **Generated.** `npm run generate:check` passes. Changing one byte of `facts.ts` makes `vp lint`
   fail with `capxul/generated-intact`, and `generate:check` name the file. Revert both.
5. **The hooks, on a scratch branch.**
   - A commit that stages a file with `throw new Error()` in `packages/backend/src/payments/` is
     refused by pre-commit, naming `capxul/no-throw`.
   - A commit that stages a fake token is refused by gitleaks.
   - `git push origin HEAD:main` is refused.
   - Pushing a ref that is not HEAD is refused.
   - Timed: pre-commit ≤ 5 s, pre-push ≤ 90 s.
6. **CI.** On the T0 pull request, `check` and `secrets` are green within budget. A throwaway
   commit on a scratch branch that adds a `Date.now()` to a fixture-like product file fails `check`
   at the Lint step. The branch is then deleted.
7. **Secrets.** `gitleaks git --redact .` over the full history reports no leaks, or each finding is
   allowlisted by exact path and value with a reason.
8. **Baselines logged** in `docs/mission/progress.md`: each gate's time; lines (product 0; plugin
   ≤ 900; checks ≤ 200; facts target ≤ 120); disables 0; duplication; the pin set.

## 7. What B1 and every lane must pass from day one

**The generators (B1)** extend `packages/generate` and are held to these rules:

- **The standard.** Every generated file passes the same lint standard: only the `GENERATED`
  override applies. It typechecks under TypeScript 7 strict. A lint finding in generated code is
  fixed in the generator.
- **One writer.** Every target goes through the shared writer: the header with `sha256`, sorted
  keys, LF and a final newline. Two runs give the same bytes, and `generate:check` holds that in CI
  and at pre-push. SQL migrations carry the same header as a `--` comment, and `generate:check`
  covers them.
- **The types that replace the old checks.** These are design requirements on B1, not options:
  - **Rpc handlers.** Each is typed `Effect<Output, DeclaredErrors, DeclaredServices>`:
    - errors from the rpc's `errors` and those of what it calls;
    - services: the integrations of its `calls`, accessors for exactly its `reads` and `writes`
      (the `tbl:<t>/writers` eval at compile time), and the door procedures of its `invokes`.

    A handler that reaches an undeclared integration, table or door does not compile. Flows are
    typed the same way.
  - **Workflows.** Skeletons export their typed `steps` (each an `Activity` whose `execute` takes
    an idempotency key) and `waits` (`DurableDeferred` and `DurableClock`). These are the names
    `capxul/workflow-body` allows.
  - **Errors.** One `Schema.TaggedError` class per error, with an optional `cause`.
  - **Spans.** One `Spans` constant for the whole P6 tree.
  - **Config.** One `Config` module per environment record.
  - **Machines.** The transition tables refuse an undeclared transition, and they send the
    machine's one event; nothing else sends events.
- **Numbers.** A field written `Schema.Number` in the book (97 of them) generates `Schema.Finite`,
  unless its record says non-finite values are meant. Measured: linted as runtime code, the book's
  schemas raise 456 `effecttsgo/schema-number` findings.
- **New facts.** When a rule needs a new fact, it is added to the facts target in the same pull
  request as the rule.

**Every lane, from its first commit:**

- **Hooks and CI.** The pre-commit and pre-push hooks pass. `--no-verify`, `VP_GIT_HOOKS=0` and
  `HUSKY=0` are never used for a commit or push meant to merge. CI is green before review.
- **Lint.** Zero findings and zero warnings. A disable names its rule and its reason, and it is
  counted. A new override needs a tooling decision.
- **Generated code.** `generate:check` is clean. Nothing under `src/generated/` is edited by hand:
  change the record or the generator, run `npm run generate`, and commit both.
- **New dependencies.** An exact version, at least 3 days old (npm enforces it). The same version as
  every other package that uses it (`npm run workspace`). Listed in the importing package's
  manifest (knip's unlisted count stays 0). No install script unless `allowScripts` approves it
  with a decision.
- **Lines.** Each concept's lines are counted (`npm run loc`) and stay within its budget once B3
  sets them.
- **The book.** The four book checks stay green, and the book changes first.

## 8. The decisions

Recorded in `books/target/shared/tooling.ts`. Two are Aaron's to confirm: `tooling.package-manager`
and `tooling.branch-protection`.

| Id | Decision |
|---|---|
| `tooling.milestone` | T0 runs before B0, with the exit above |
| `tooling.layers` | Each policy is enforced at the cheapest layer that can enforce it fully |
| `tooling.package-manager` | npm 12 workspaces (Aaron to confirm) |
| `tooling.pins` | The pin set, the coherence rule, a 3-day release-age window, script approval |
| `tooling.node` | Node 24.22.2 LTS |
| `tooling.typescript` | TypeScript 7.0.2 only; independent composite projects with `tsc -b` |
| `tooling.entry` | Vite Plus is the one entry; no lefthook; no task graph at T0 |
| `tooling.lint-config` | The lint config lives in `vite.config.ts`; the canary proves it is loaded |
| `tooling.effect-rules` | The Effect strict preset, the extras, the Effect-native set in product code; `unstable-api-usage` off |
| `tooling.lint-standard` | The built-in groups, the named rules and the one strict standard |
| `tooling.lint-scope` | What Oxlint covers; the design book stays under its own checks |
| `tooling.plugin` | `packages/lint`: nine rules, facts from the book, line budgets |
| `tooling.imports` | Import form and the import rules (concept and workspace) |
| `tooling.workflow-body` | A workflow body is replay-safe |
| `tooling.span-names` | Span names only from the generated catalogue |
| `tooling.generated-header` | The header carries a hash, checked per file |
| `tooling.errors` | No throw in product code; a catch keeps its cause; typed failures by generated types |
| `tooling.comments` | Debt markers name an issue; disables name a rule and a reason |
| `tooling.tests` | Vitest through `vp test`; no sentinel tests; the book keeps `node:test` |
| `tooling.cross-file` | The old checks cut or replaced, and the four that remain |
| `tooling.fmt` | Oxfmt's settings; Markdown and generated files unformatted; one formatting commit |
| `tooling.hooks` | The pre-commit and pre-push contents, budgets and lessons |
| `tooling.branch-protection` | GitHub branch protection on the merge branches (Aaron's step) |
| `tooling.ci` | The CI jobs and budgets |
| `tooling.secrets` | gitleaks 8.30.1, installed through the Go module proxy |
| `tooling.dead-code` | knip and jscpd and their scope |
| `tooling.lane-gate` | What B1 and every lane must pass from day one |
