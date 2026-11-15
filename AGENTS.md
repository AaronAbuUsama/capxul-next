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
- **Verdicts** say what is proven: made only by CI, kept on the orphan branch `proofs`, each notarised by a GitHub
  check (roadmap step 4.5). What happened is **telemetry**, in the sink. Until 4.5 lands, run records made by checks and
  scenario runs stand in for verdicts; nobody writes one by hand, and a run from an agent's container is never proof.

Every fact has one owner in code. Everything else that needs it imports it, generates it from it, or is checked
against it, so two places cannot disagree (`docs/roadmap.md`, "One source for every fact"). Which owner holds which
fact, and how it will be checked, is in "How a feature is built" below; the design behind it is
[docs/design/blueprint.md](docs/design/blueprint.md). Nothing checks this as a whole yet: roadmap
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
  pass or improve. Until the run is fast, only the speed lane's slice runs `world` and other slices land without it (roadmap, "Full runs paused until the run is fast", Aaron, 15 November 2026). Otherwise, only pull requests from `slice/<name>` into `master` that are not drafts and change more than documents or records run `world` (a lead keeps its slice's pull request a draft until it is ready to land, 15 November 2026),
  and `master` runs it once a day (Aaron, 14 and 15 November 2026: Actions minutes are spent on the journeys only at a
  slice's merge, and a run is not repeated under load). Nothing in the repository checks this beyond the workflows' triggers.
- Never push to, merge into or open a pull request against `main` or `integration/build`. Never force-push. Nothing
  checks this; it is on you.
- A builder must not change the scenarios or the runner's generic checks: those judge its work. It may change
  everything else it needs, the world and the runner's plumbing included (readiness, caching, connections), and every
  such change shows in its diff. Nothing checks this yet; the reviewer reads the diff.
- Measure first. Every run record holds every operation's timings, caller and server, with the spans of each step. A
  budget is a target: nothing ever fails on speed, and a measured p95 over 1.5 times its budget raises an architecture
  review as a task (roadmap, "Budgets are targets"). Nothing checks this yet.
- CI (`.github/workflows/check.yml`, job `gate`) runs rungs 1 to 5 of the ladder on every pull request and every
  push to `master`. `.github/workflows/world.yml`, job `thin-line`, runs rung 6 on slice pull requests into `master`
  and once a day on `master`.

## Lanes, leads and the conductor

A **lane** is a chain of roadmap steps, each step needing the one before (the `Needs` column of
[docs/roadmap.md](docs/roadmap.md), "Steps to the goal"). Each lane is led by one cloud session, its **lead**, on one
slice branch `slice/<lane>`. One more session, the **conductor**, starts leads and does not write feature code.

- **The conductor** starts a lane's lead only when every step the lane's first step needs is Done on `master`, and
  starts lanes whose needs are met at once, so independent lanes run in parallel. It watches the spend and the bench's
  load, keeps the status dashboard, and archives a lead's session when its lane's last step is Done. Its state is the
  roadmap and the leads' sessions, so a fresh conductor can take over from them alone.
- **A lead** is started with one line naming its lane, its steps and its slice branch. It cuts the slice from
  `master`; for each step it has the scenarios and checks written first by another agent, so they fail on empty
  handlers, then has builders open pull requests into the slice; it merges each when `check` is green, opens the slice's
  pull request into `master` and merges it when `check` and `world` are green; and it marks each step Done in the
  roadmap with the proof committed, in that same pull request. When a step it needs from another lane lands, it merges
  `master` into its slice.
- **A builder** does one piece of work on one branch and one pull request into the slice, and is started by its lead.
- **Every thread is one type**, titled with its emoji: 🎼 conductor, 🧭 lead, ✍️ author, 🔨 builder, 🔍 reviewer,
  📐 designer, 🧹 triage, 🕒 keeper, 🖥️ local. The kit is in `.agents/skills/`, written for any agent: `threads` (the
  types, and each agent's word for starting, messaging, reading and archiving a thread), `conductor` (the loop, and the
  rule that a slice reaches `master` only with a 🔍 pass, a fresh `gate` and `world`), `hashtags` (Aaron's
  `#shortcuts`) and `reviewer` (the 🔍 review). `.claude/skills/` and `.claude/agents/reviewer.md` are links to it, so
  edit the kit only in `.agents/skills/`.
- **A Claude Code cloud session never connects to Aaron's computer.** A session that does is limited to his trusted
  devices for good, and then no cloud thread or scheduled task can reach it. A conductor on his machine (Amp, Codex, a
  terminal) does that work itself.

Standing rules from Aaron, for the conductor and every lead (14 and 15 November 2026):

- Merge your own pull requests when CI is green. Push on until actually blocked.
- Change a roadmap decision only with Aaron's written yes. A blueprint delta inside the decisions is the lead's call.
- Ask Aaron only about money beyond the cap, credentials, production, or a decision nothing covers; batch the
  questions.
- Spend at most $10 a day across Cloudflare and Neon, all lanes together.
- Every world, stage and site you make is destroyed; nothing is left running. Touch only your own resources. Never run
  `alchemy nuke`.
- On `abuusama.dev`, create records only under `worlds.abuusama.dev`, never edit or delete another record, and remove
  what you made. No certificate changes without Aaron's yes.
- Never print a key or connection string; the network proxy adds keys. Never create a cloud credential without
  Aaron's written yes. Never give Cloudflare a route into an agent's container.
- Keep people's emails and personal details private.

## How a feature is built

Agreed with Aaron on 15 November 2026 (`docs/decisions.md`, "How a feature is built" and the decisions after it).
Everything is about being measurable: a feature is done when run records prove it and its measures are watched, not
when its code is written. Steps marked with a roadmap step, such as (3.4), are not built yet; until their roadmap step is Done, the reviewer checks
them by reading the diff.

### The loop

1. **Idea, then decision.** An idea that changes what Capxul promises is a roadmap decision: Aaron agrees it, and it is
   written in `docs/decisions.md` with its date. That covers a new kind of thing with a lifecycle, a new kind of
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
| Operations, payloads, answers, refusals and exit codes, events, claims, starting worlds | The blueprint, in the verb's file under `src/things/<thing>/` | Core's server, the SDK, the CLI, the pages in `packages/blueprint/generated/`, the types of the scenarios' checks |
| A thing's lifecycle (3.4) | The blueprint, the thing's `lifecycle.ts` | The state schema, the closing refusal's `state` field, the `step` function Core moves state with, the SQL CHECK constraint (in a new migration whenever the states change: an applied migration is never edited), the diagram in the thing's page, the runner's path check, coverage |
| Who may call an operation (5.1) | The blueprint: roles declared once, `allowed` on each operation | Core's one standing check, the generated refusal steps |
| An operation's steps and logs (4.1) | The blueprint, the operation's own file (3.6) | The generic checks, the waits a budget leaves out |
| The pipeline's own work: worlds, resets, sites, starting worlds, journeys, the checks, proofs (3.6) | The blueprint, the domain `pipeline` | The runner's and the world's spans (4.7), the proof names in the roadmap |
| Telemetry names: the envelope, producers, step kinds, metrics, datasets, monitors (3.6) | The blueprint, `src/telemetry/` | The attribute constants, each process's resource, the datasets and routing `packages/platform` creates, Axiom's monitors and dashboards |
| Ratchets (3.6) | The blueprint's registry | `pnpm ratchets`, the dashboard's lines |
| The words for things (3.8) | The blueprint's glossary | Folder, package and command names, the docs, lint |
| Contract events and functions (3.1) | The compiled contracts in `packages/contracts` (`forge build`; Foundry runs in CI and in the agents' environment) | One generated ABI module, imported by the blueprint, Core and the indexer |
| Contract addresses on the seeded chain (3.1) | `packages/contracts/deployments/devnet.json` | One generated table, imported by Core and `packages/world` |
| The seeded chain state (3.2) | The contracts and their deploy script | `packages/contracts/state/core.json`, rebuilt by one command and checked in CI |
| A person's account (5.2) | The blueprint: grade groups, account version, the email's normalisation, the derivation | The salt Core sends to `claim`; checked against the contract's `safeAddressFor` |
| Capxul's own names on a company's site (3.1) | The blueprint, `src/common/site.ts` | A generated Python module in `packages/frappe-app` |
| What runs where, and where telemetry goes | `packages/world`, `packages/platform` | |
| What is proven | Verdicts on `proofs` (4.5); run records until then | The roadmap's step states |

These rules make "typed once" and "measured" checks rather than hopes (3.3, 4.1), each with its ratchet:

- In the blueprint, a raw schema (`Schema.String`, `Schema.Literals`, `Schema.Number`, ...) appears only in a values
  file, a machine or the telemetry vocabulary (`src/telemetry/`); every field of an operation, event or refusal is a named value. Outside the blueprint, raw schemas
  appear only in edge files listed in `.oxlintrc.json`, each with its reason, and stored rows are decoded with the
  blueprint's schemas.
- A declared name (an operation, event, refusal, state or span) is imported, never written as a string.
- Every effectful function of our own code (Core, the world, the platform client, the runner's plumbing) is a span:
  `Effect.fn` with a name that is a declared step, imported from the blueprint (4.1).

CI's `pnpm generate:check` fails when generating again would change any file (3.1). Generated files sit in a
`generated/` folder (`packages/contracts/generated`, `packages/frappe-app/capxul/generated`) and are listed in
`packages/generate/src/sources.ts`.

### Changing what works: side by side, then flip, then retire

Until a real caller exists (phase 8), this does not apply: existing operations are reshaped and renamed directly,
and the journey author updates the journeys in the same lane (roadmap, "No callers, no compatibility"). From the
first real caller:

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
operation, some journey step reached. Every newly declared move, refusal and outcome must be reached by a journey before
its slice merges into `master`; existing declarations sit on ratchet R9's list (3.7). A budget is a target and never
fails a run.

### A new format reaches old work by a ratchet

A new or changed operation uses a new format from the day it lands. Existing declarations are moved to it in the same
slice where that is cheap; the rest are listed in the format's `unmigrated` list, which a test allows only to shrink.
The format's roadmap step closes when the format exists, is proven in full on its named domain, and its ratchet is
registered and counting today's count; it does not wait for the list to be empty. The ratchet's own lane closes when
its list is empty (Aaron, 15 November 2026). New work is born compliant; old work catches up in parallel and blocks
nothing. Every ratchet is declared once in the blueprint's registry, and `pnpm ratchets` fails a pull
request whose list grew (3.6; `docs/design/blueprint.md`, part 4). A migration changes no behaviour: every journey stays
green. Generic checks added by such a slice are written by a different agent from the one that migrates Core.

## The ladder

Run `pnpm check` before you open a pull request. It runs rungs 1 to 5 in order and stops at the first that fails.
`pnpm format` rewrites the code into shape; run it before `pnpm check`.

<!-- generated:gate start -->
<!-- Written by `pnpm generate` from `GATE` in packages/lint/src/gate.ts; never edit it. -->
| Rung | Command | What fails it |
|---|---|---|
| 1. Shape | `pnpm shape` | An entry at the top level, a package or a file under `docs/` that `packages/lint/src/shape.ts` does not list; a package or spike with no `README.md`; a source file under `packages/` over 300 lines; the two lists of entry files in `.oxlintrc.json` naming different paths |
| 2. Format | `pnpm format:check`, `pnpm generate:check`, `pnpm seed:check` | TypeScript or JavaScript under `packages/` that oxfmt would change (config: `packages/lint/oxfmt.json`); a generated file that `pnpm generate` would write differently (it builds the contracts with Foundry first, `packages/generate`); a seeded chain state (`packages/contracts/state/core.json`, `deployments/devnet.json`) that `pnpm seed` would rebuild differently |
| 3. Lint | `pnpm lint` | Any finding of `.oxlintrc.json`, every rule an error: oxlint's correctness and suspicious rules and a few more, all of Effect's rules from `@effect/tsgo` but two (each off with its reason), and ours from `packages/lint` (below) |
| 4. Types | `pnpm types` | A type error in any TypeScript package, or an Effect language service error or warning (`effect-tsgo tsc`) |
| 5. Tests | `pnpm test`, then `pnpm delta:check` and `pnpm words` (and `pnpm ratchets` from 3.6) | A failing unit test in any package (`pnpm frappe:test` and `pnpm status:test` included). Foundry's tests in `packages/contracts` are not in it: CI builds only the contracts, not their tests. Then the delta check: an operation that lacks a format that exists and is not on that format's `unmigrated` list (`packages/blueprint-tools/src/checks/formats.ts`). Then the old words: an old word of the glossary written more often than `packages/blueprint/generated/old-words.json` counts (3.8). From 3.6, a ratchet whose list grew |
| 6. Proof | `packages/runner/run.sh scenarios` (and `prove.yml` from 4.5) | A scenario that fails in a fresh world; from 3.7, a newly declared move, refusal or outcome no journey reaches. CI runs it in `.github/workflows/world.yml` once the bootstrap has given CI its Cloudflare and Neon keys (roadmap step 1.8) |
<!-- generated:gate end -->

Our lint rules, each tested in `packages/lint/test/rules.test.ts`:

<!-- generated:lint-rules start -->
<!-- Written by `pnpm generate` from each rule's `description` in packages/lint/src/rules/; never edit it. -->
- `capxul/blueprint-owns-names`: an operation, a refusal (a tagged error), an event or a starting world is declared only
  in `packages/blueprint`.
- `capxul/effect-only`: no `async`, `await`, `new Promise`, `try`, `throw`, `process.env`, `Date.now`, `new Date()` or
  `console` in TypeScript outside entry files. Entry files are listed in `.oxlintrc.json` under
  `settings.capxul.entries`, each with its reason.
- `capxul/import-door`: another package is imported only through its door, `src/door.ts` (`src/index.ts` in the
  blueprint and its toolkit), or by its bare name.
- `capxul/no-json-text`: no `JSON.parse`, `JSON.stringify`, `Schema.parseJson` or string schema documented as JSON
  outside entry files and the edges listed under `settings.capxul.jsonEdges`.
- `capxul/owned-values`: a raw schema (`Schema.String`, `Schema.Literals`, ...) only in the blueprint's values files,
  machines and telemetry vocabulary, and there only as a named value, never as a field; elsewhere only in entry files
  and the edges listed under `settings.capxul.schemaEdges`, each with its reason.
- `capxul/declared-names`: a name the blueprint declares (an operation, a refusal, an event, an outcome, a starting
  world) is imported, never written as a string outside the blueprint, except where the compiler checks it (an object's
  key, a computed member, the tag given to `catchTag`, `Match.tag` or `isTagged`).
- `capxul/decoded-rows`: no `sql<Row>` cast outside the blueprint; rows are decoded with the blueprint's schemas.
<!-- generated:lint-rules end -->

These three are ratcheted: what each found when it was turned on is on its list in `packages/lint/src/unmigrated.ts`,
a file with a count that may only fall (`packages/lint/README.md` says how to lower it). New files are never added.
Each skips generated files: a file whose first line is a comment starting `// Generated`, written by `pnpm generate`
and never edited.

What the ladder does not cover: `spikes/` (temporary code, deleted when its step graduates it; only its README is
checked), Ponder's files in `packages/indexer` (type-checked only), the Solidity in `packages/contracts`, and the
Frappe app's Python and form scripts (unit tests and formatting only). An override of a rule names its reason next
to it, in `.oxlintrc.json` or on the line it excuses.
