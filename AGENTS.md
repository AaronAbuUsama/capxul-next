# AGENTS.md

`CLAUDE.md` is a link to this file. Every agent (Amp, Claude, Codex) reads the same rules.

## This branch is `master`: the rebuild line (read this first)

`master` is a separate line of work from `main` and `integration/build`. It was cut from `main` at `f12a831` on
13 November 2026, at Aaron's request, to rethink the blueprint and the build pipeline without
disturbing the product work in flight on those two branches.

- Rebuild work goes by pull request into `master`.
- Never merge `master` into `main` or `integration/build`, and never open a pull request from this line into them,
  unless Aaron asks for it in writing.
- Work that belongs to the in-flight product line stays on `main` and `integration/build`. Do not base it on `master`.
- `main` is merged into `master` only on purpose, by whoever leads this line, never as a routine catch-up.

If your task was written for `main` or `integration/build` and you are on this branch, stop and switch branches.

The plan this line follows is [docs/roadmap.md](docs/roadmap.md).

## Three sources, one owner for every fact

- **The blueprint** (`packages/blueprint`) says what Capxul does: its operations, refusals, events and starting worlds,
  as Effect declarations the product imports.
- **The world** (`packages/world`) says what runs where: the Alchemy stacks that create and destroy a world.
- **Run records**, made by checks and scenario runs, say what is proven. Nobody writes one by hand.

Every fact has one owner in code. Everything else that needs it imports it, generates it from it, or is checked
against it, so two places cannot disagree (`docs/roadmap.md`, "One source for every fact"). Which owner holds which
fact, and how it will be checked, is in "How a feature is built" below. Nothing checks this as a whole yet: roadmap
steps 3.1 and 3.3 add the checks.

## Worlds

A world is created, used and destroyed as one unit, with an owner and an expiry. The rules are in
[docs/roadmap.md](docs/roadmap.md), "World lifecycle rules, enforced by code". They belong in `packages/world`; until it lands, nothing checks them.

## How work flows

- Work is done on an integration branch per slice: one effort being climbed (a journey, a step of the roadmap),
  named `slice/<name>` and cut from `master` by the lead. Each piece of work in it is one branch and one pull request
  into that slice branch, merged by the lead when `check` (rungs 1 to 5, a few minutes) is green. A slice reaches
  `master` by one pull request from `slice/<name>`, merged only when `check` and `world` (the thin line's journeys in a
  fresh private world on staging, rung 6) are both green: every journey must still pass, and the slice's own journeys
  pass or improve. Only pull requests from `slice/<name>` into `master` that change more than documents or records run `world`,
  and `master` runs it once a day (Aaron, 14 and 15 November 2026: Actions minutes are spent on the journeys only at a
  slice's merge, and a run is not repeated under load). Nothing in the repository checks this beyond the workflows' triggers.
- Never push to, merge into or open a pull request against `main` or `integration/build`. Never force-push. Nothing
  checks this; it is on you.
- A builder must not change the scenarios or the runner's generic checks: those judge its work. It may change
  everything else it needs, the world and the runner's plumbing included (readiness, caching, connections), and every
  such change shows in its diff. Nothing checks this yet; the reviewer reads the diff.
- Measure first. Every run record holds every operation's timings, caller and server, with the spans of each step. A
  budget stays provisional and is never enforced until it is set from measured runs, so nothing fails on speed until
  then. Nothing checks this yet.
- CI (`.github/workflows/check.yml`, job `gate`) runs rungs 1 to 5 of the ladder on every pull request and every
  push to `master`. `.github/workflows/world.yml`, job `thin-line`, runs rung 6 on slice pull requests into `master`
  and once a day on `master`.

## How a feature is built

Agreed with Aaron on 15 November 2026 (`docs/roadmap.md`, "How a feature is built" and the decisions after it).
Everything is about being measurable: a feature is done when run records prove it and its measures are watched, not
when its code is written. Steps marked with a roadmap step, such as (3.4), are not built yet; until their roadmap step is Done, the reviewer checks
them by reading the diff.

### The loop

1. **Idea, then decision.** An idea that changes what Capxul promises is a roadmap decision: Aaron agrees it, and it is
   written in `docs/roadmap.md` with its date. That covers a new kind of thing with a lifecycle, a new kind of
   refusal, a change to the contracts, a change to existing behaviour and a new outside dependency. Anything else is
   the slice lead's call.
2. **The blueprint delta**, written before any code and signed off by the slice lead. It declares, in
   `packages/blueprint`:
   - the operations, with their payloads and answers;
   - the machines they move: each thing's states, its moves, the event of each move, and the refusal from every state
     a move cannot start from (3.4);
   - who may call each operation: the roles allowed, the company it applies to, the refusal for anyone else (5.1);
   - the refusals that depend on data (a balance, a quota), each with its exit code;
   - the events and what each carries;
   - each operation's steps (its spans, each of a kind: database, site, chain, bundler, wait) and the logs it writes,
     each with a schema (4.1);
   - its budget, provisional until measured.

   It says nothing about how the operation is built. That is the builder's. `pnpm delta:check` fails when an
   operation lacks a format that exists: its machine's moves and the refusal from each state, its declared steps and
   logs (3.5).
3. **Generate.** `pnpm generate` writes everything derived from the declarations (3.1). A generated file says so in its
   first line and is never edited.
4. **Journeys and checks, written first, failing.** A different agent from the builder writes the journeys and each
   operation's checks from the delta, and each journey fails against empty handlers. The generic checks follow from
   the declarations and are not written per operation.
5. **Build.** The builder writes handlers and whatever else they need; never the scenarios or the generic checks.
6. **Measured runs.** Rungs 1 to 5 on every pull request, rung 6 at the slice's merge. A journey counts as passed only
   when every step and check passes and its record passes the explainability eval (below; 4.2).
7. **Deploy, then watch.** After a deploy, the same generic checks and measures run on what the deployed system
   records. A measure that gets worse is a finding, raised as a task.

### Who owns each fact

| Fact | Its one owner | Generated from it or checked against it |
|---|---|---|
| Operations, payloads, answers, refusals and exit codes, events, claims, starting worlds | The blueprint, in the operation's domain | Core's server, the SDK, the CLI, `claims.md`, the types of the scenarios' checks |
| A thing's lifecycle (3.4) | The blueprint, the domain's `machines.ts` | The state schema, the closing refusal's `state` field, the `step` function Core moves state with, the SQL CHECK constraint (in a new migration whenever the states change: an applied migration is never edited), the diagram in `claims.md`, the runner's path check, coverage |
| Who may call an operation (5.1) | The blueprint: roles declared once, `allowed` on each operation | Core's one standing check, the generated refusal steps |
| An operation's steps and logs (4.1) | The blueprint, the domain's `steps.ts` | The generic checks, the waits a budget leaves out |
| Contract events and functions (3.1) | The compiled contracts in `packages/contracts` (`forge build`; Foundry runs in CI and in the agents' environment) | One generated ABI module, imported by the blueprint, Core and the indexer |
| Contract addresses on the seeded chain (3.1) | `packages/contracts/deployments/devnet.json` | One generated table, imported by Core and `packages/world` |
| The seeded chain state (3.2) | The contracts and their deploy script | `packages/contracts/state/core.json`, rebuilt by one command and checked in CI |
| A person's account (5.2) | The blueprint: grade groups, account version, the email's normalisation, the derivation | The salt Core sends to `claim`; checked against the contract's `safeAddressFor` |
| Capxul's own names on a company's site (3.1) | The blueprint, `src/documents/site.ts` | A generated Python module in `packages/frappe-app` |
| What runs where | `packages/world` | |
| What is proven | Run records | The roadmap's step states |

These rules make "typed once" and "measured" checks rather than hopes (3.3, 4.1), each with its ratchet:

- In the blueprint, a raw schema (`Schema.String`, `Schema.Literals`, `Schema.Number`, ...) appears only in a values
  file or a machine; every field of an operation, event or refusal is a named value. Outside the blueprint, raw schemas
  appear only in edge files listed in `.oxlintrc.json`, each with its reason, and stored rows are decoded with the
  blueprint's schemas.
- A declared name (an operation, event, refusal, state or span) is imported, never written as a string.
- Every effectful function of our own code (Core, the world, the platform client, the runner's plumbing) is a span:
  `Effect.fn` with a name that is a declared step, imported from the blueprint (4.1).

CI's `pnpm generate:check` fails when generating again would change any file (3.1).

### Changing what works: side by side, then flip, then retire

1. **Side by side.** The new behaviour is declared beside the old, as a new version of the operation, or a new move of
   its machine. Its journeys are written first and fail. The old behaviour's journeys stay green throughout.
2. **Flip.** Once the new version passes every journey that applies to it, one pull request makes it the default: the
   SDK, the CLI and the starting worlds call it. That pull request holds nothing else.
3. **Retire.** A later pull request deletes the old version, its handlers and the journeys that covered only it, once
   the run records show no call of it in the slice's runs. Never in the flip's pull request.

Stored state changes the same way: new states are added first, existing rows are moved by a declared migration, and
old states are removed at retirement. Operations and events carry a version from 6.1; until then, a new version is a
new operation name.

### How it is measured

Every run record holds, for every call: the operation and its version, the caller, its outcome or refusal, the
caller's and the server's milliseconds beside its budget, the spans of its declared steps, its logs, and the events
it sent with what each carried.

The generic checks run on every call of every journey, and judge the builder:

- the declared events were sent, each carrying what its declaration says;
- one span for the operation, and the span of every step it declares whenever that step's path ran: a declared step
  that is missing fails the call (4.1). Library spans, such as `postgres`, HTTP `GET` and `POST`, `rpc` or `bundler`,
  are neither required nor forbidden, and the check ignores them;
- one log where each refusal is decided, naming the state or the rule that refused (4.1);
- the events of each thing form a path through its machine (3.4);
- every timing is recorded.

What counts as good, in this order:

1. **Correct.** Every step and every check of every journey passes.
2. **Explainable** (4.2). A failed or slow step can be explained from its record alone, without running it again: every
   refusal has its deciding log, every span its parent, and the share of each call's time its declared steps account for. The
   score is reported from measured runs first, and its threshold is then set from the data, as budgets are; from then,
   a journey that is correct but not explainable has not passed.
3. **Better over time** (4.3), once explainability holds: tries to green per unit of work, journeys broken and how fast
   they recovered, and speed and cost per journey across runs. These are trends to read, not thresholds.

Coverage is reported with every run: which moves of each machine, and which refused pairs of a state and an
operation, some journey step reached. It is the scenario author's target, not a gate. A budget stays provisional and is
never enforced until it is set from measured runs.

### A new format reaches old work by a ratchet

A new or changed operation uses a new format from the day it lands. Existing declarations are moved to it in the same
slice where that is cheap; the rest are listed in the format's `unmigrated` list, which a test allows only to shrink,
and the format's roadmap step closes when the list is empty. New work is born compliant; old work catches up in
parallel and blocks nothing. A migration changes no behaviour: every journey stays
green. Generic checks added by such a slice are written by a different agent from the one that migrates Core.

## The ladder

Run `pnpm check` before you open a pull request. It runs rungs 1 to 5 in order and stops at the first that fails.
`pnpm format` rewrites the code into shape; run it before `pnpm check`.

| Rung | Command | What fails it |
|---|---|---|
| 1. Shape | `pnpm shape` | An entry at the top level, a package or a file under `docs/` that `packages/lint/src/shape.ts` does not list; a package or spike with no `README.md`; a source file under `packages/` over 300 lines; the two lists of entry files in `.oxlintrc.json` naming different paths |
| 2. Format | `pnpm format:check` | TypeScript or JavaScript under `packages/` that oxfmt would change (config: `packages/lint/oxfmt.json`) |
| 3. Lint | `pnpm lint` | Any finding of `.oxlintrc.json`, every rule an error: oxlint's correctness and suspicious rules and a few more, all of Effect's rules from `@effect/tsgo` but two (each off with its reason), and ours from `packages/lint` (below) |
| 4. Types | `pnpm types` | A type error in any TypeScript package, or an Effect language service error or warning (`effect-tsgo tsc`) |
| 5. Tests | `pnpm test` | A failing unit test in any package (`pnpm frappe:test` and `pnpm status:test` included). Foundry's tests in `packages/contracts` are not in it: CI has no Foundry |
| 6. Proof | `packages/runner/run.sh scenarios` | A scenario that fails in a fresh world. CI runs it in `.github/workflows/world.yml` once the bootstrap has given CI its Cloudflare and Neon keys (roadmap step 1.8) |

Our lint rules, each tested in `packages/lint/test/rules.test.ts`:

- `capxul/blueprint-owns-names`: an operation, a refusal (a tagged error), an event or a starting world is declared
  only in `packages/blueprint`.
- `capxul/effect-only`: no `async`, `await`, `new Promise`, `try`, `throw`, `process.env`, `Date.now`, `new Date()`
  or `console` in TypeScript outside entry files. Entry files are listed in `.oxlintrc.json` under
  `settings.capxul.entries`, each with its reason.
- `capxul/import-door`: another package is imported only through its door, `src/door.ts`, or by its bare name.
- `capxul/no-json-text`: no `JSON.parse`, `JSON.stringify`, `Schema.parseJson` or string schema documented as JSON
  outside entry files and the edges listed under `settings.capxul.jsonEdges`.

What the ladder does not cover: `spikes/` (temporary code, deleted when its step graduates it; only its README is
checked), Ponder's files in `packages/indexer` (type-checked only), the Solidity in `packages/contracts`, and the
Frappe app's Python and form scripts (unit tests and formatting only). An override of a rule names its reason next
to it, in `.oxlintrc.json` or on the line it excuses.
