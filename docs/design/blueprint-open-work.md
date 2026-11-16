# The blueprint's open work: a handover

Status: open. Written on 16 November 2026 by the blueprint lead (later the CLI lead) for the local thread that will
refactor the blueprint system on `slice/blueprint-studio`. It maps what was planned and not done, where it is written,
and what shaped it. The counts are from `master` at 5657dbe. Item 3.9, the CLI's grammar, is built on `slice/cli` but
not on `master`: its pull request, #473, is green and was left open by Aaron's pause of 16 November 2026 (section 5).

The design itself is [blueprint.md](blueprint.md). This note does not repeat it: it says what is left, and points.

## 1. The ratchets

Every ratchet is declared once in `packages/blueprint/src/ratchets.ts`, counted by `pnpm ratchets` (toolkit:
`packages/blueprint-tools/src/checks/ratchets.ts`, `ratchet-files.ts`; lists gathered by
`packages/generate/src/ratchet-sources.ts` and `ratchet-files.entry.ts`), and committed in
`packages/blueprint/generated/ratchets.json`. The scorecard, `packages/blueprint/generated/scorecard.md`, shows each
thing against each format. A count may only fall. The rule behind all of them: AGENTS.md, "A new format reaches old
work by a ratchet" (a format's item closes when the format exists, is proven on its domain and its ratchet counts; the
ratchet's own lane closes when its list is empty).

### Counted

| Id | Name | Count | What it holds | Behind it | What emptying it takes |
|---|---|---|---|---|---|
| R1 | Raw schemas | 666 | Raw schemas outside values files, machines and listed edges: the findings of `capxul/owned-values` | 3.3, decision "Typed once, by check" | Move each raw schema into a values file as a named value, or list a true edge in `.oxlintrc.json` with its reason. The list is `packages/lint/src/unmigrated.ts` |
| R2 | Names typed as strings | 743 | Declared names retyped as strings outside the blueprint: `capxul/declared-names` | 3.3 | Import each name from the blueprint. Mostly Core, the runner and the scenarios |
| R3 | Rows not decoded | 38 | `sql<Row>` casts: `capxul/decoded-rows` | 3.3 | Decode each stored row with the blueprint's schema. All in Core |
| R5 | Operations not in the machine format | 13 | Operations that start or move no machine, or leave a state's refusal undeclared | 3.4, 3.5; decision "Lifecycles are machines" | Declare each thing's lifecycle (world, site, approval, budget, document, company) and move Core onto `step`. This is the climb, C.1 |
| R6 | Undeclared spans | 306 | Effectful functions of Core, the world, the platform client and the runner with no declared step: `capxul/declared-steps`, list in `packages/lint/src/unmigrated-steps.ts` | 4.1, 4.7; decision "Measurement is declared" | Name each `Effect.fn` by a step declared in the blueprint. The telemetry lane owns it |
| R7 | Operations not in one file | 17 | Verbs whose examples still sit in their thing's `examples.ts` | Part 13; decision "The shape" | Fold each thing's examples into its verb files. Cheap; was offered as filler inside the CLI slice and not taken |
| R8 | Long or hand-mapped docs | 10 | READMEs over 60 lines (`LONG_READMES`), hand-written file maps, and `packages/blueprint/docs/build-order.md`, not yet folded | Part 7; [docs.md](docs.md) | Shorten each README behind its generated map; fold `build-order.md` into the roadmap or declarations |
| R10 | Non-Effect code | 63 | `effect-only` findings outside the lint's reach (Ponder's files, the contracts' TypeScript), and non-Effect runtime dependencies | Decision "Effect everywhere it can be" | Mostly blocked on Ponder and Hono (decision "Hono"); the dependencies need replacing one by one. Phase 7 |
| R15 | Old words | 599 | Distinct names in code still holding a glossary old word, counted per word in `generated/old-words.json`; gated by `pnpm words`, not by `pnpm ratchets` | 3.8; decision "One glossary" | The renames' lane. Waits until the speed lane's door work has landed (conductor, 16 November 2026) |
| R16 | Names not from their path | 16 | Operations not named `<thing>.<verb>` from their file (`org.threshold.set` lives at `board/set-threshold.ts`) | Part 13, amended, point 3 | Rename each operation directly ("No callers, no compatibility"); the journeys' author updates the journeys. The CLI on `slice/cli` already takes its commands from the path (3.9), so its callers would see no change |
| R17 | Operations without who may call | 21 | The `allowed` format's unmigrated list | 5.1; decision "Who may call is declared" | Declare roles and `allowed` per operation, with Core's one standing check |
| R18 | Operations without steps and logs | 21 | The `spans` or `logs` formats' unmigrated lists | 4.1 | Declare each operation's spans and logs, first drafted from measured runs |
| R19 | Promises that do not name every refusal | 8 | The `promises` format's unmigrated list | 3.10 | Write a promise naming each refusal the operation decides. Part of the climb |
| R20 | Glossary words not yet landed | 15 | `packages/api`, `packages/sites`, `packages/journeys` and `pnpm gate` not there yet; 9 `door.ts` and 2 `door.py` files | 3.8 (#446) | The renames' lane, with R15. `--world <name>` is 3.9's (on `slice/cli`) and is not counted |

### Registered, not yet counted

Each names the item that will count it (`countedBy` in the registry). No count is guessed.

| Id | Name | What it will hold | Counted by |
|---|---|---|---|
| R4 | Lifecycles not machines | Things with a lifecycle not yet declared as a machine (site, approval, world, budget) | C.1 (absorbed 7.3). Overlaps R5; the new thread may merge them |
| R9 | Unreached declarations | Declared moves, refusals and outcomes no journey reaches; also the open points folded from the old `gaps.md` (comments in `ratchets.ts` beside R9) | 3.7, the coverage gate |
| R11 | Untyped starting worlds | Starting-world steps in prose, payloads retyped in the runner | 7.2 |
| R12 | Proofs by file path | Roadmap Proof cells naming files instead of verdicts | 4.5 |
| R13 | Provisional budgets | Budgets not yet set from a measured verdict. Deliberately not counted: every new verb starts provisional | 4.1 and measured runs |
| R14 | Own telemetry tables | Readers of `app.spans` and the runner's JSON records beside OTLP | 4.4. The telemetry lane was to hand me the sha of #444 (now #471) so I could count and close it; that is still owed |

## 2. Planned and not finished

### In [blueprint.md](blueprint.md)

- **Part 5, the path.** Stage 2 is Done (milestone 3, #448). Stages 3a (ratchet lanes), 3c (proof, 4.5 and 4.6) and
  4 to 6 are not started; 3b (telemetry) and 3d (speed) are in flight in their own lanes.
- **Part 8, the pipeline as operations.** The pipeline's things are declared as work (`src/things/{run,journey,world,
  check,ratchet,...}`), but none is yet a command, and none of `run.sh`'s jobs goes through them. Decision 8, item 2
  ("every `run.sh` job is a pipeline operation and so a generated command") is not started. Its other half, build
  tools listed on a ratchet with their reasons, has no ratchet registered.
- **Part 10, telemetry.** `src/telemetry/` exists; the run-time checks of steps and logs (4.1) and the explainability
  eval (4.2) do not.
- **Part 12, decision 8.** Item 1 is built on `slice/cli` (3.9, #473 open; section 5). Items 3 (Frappe through generated commands, 5.3) and 4 (the `safe`
  verbs from the ABI, 5.4) are not started.
- **Part 14.** The climb (C.1 to C.3) is not started: 0 of 13 things.
- **Part 15, the backlog.** Fourteen ideas from the triage, none built: five blueprint candidates (`approval.show` and
  `approval.decline`, `approval.sign` idempotence and `BundlerRefused`, the approval's end by nonce, the warp
  refusals, `IndexBehind`), four parity journeys (J17, J23, J6, J21), two roadmap candidates for Aaron (a world-time
  lint rule; the site joining the trace), three sites-lane fixes. Item 14 there (the CLI's world create and restore
  over Node fetch's 300 s limit) was not addressed by 3.9.
- **The status line.** `blueprint.md` has none and sits on `UNSTATED_NOTES` (`packages/lint/src/docs.ts`), a list
  that may only shrink. Give it one.

### In the roadmap ([roadmap.md](../roadmap.md))

| Item | State | The blueprint's part still to do |
|---|---|---|
| 3.7 | Not started | The coverage gate in `world.yml`: a slice's newly declared moves, refusals and outcomes must be reached by a journey; R9 counted |
| 4.1 | In progress (telemetry lane) | Declared steps per operation (R18), the run-time checks of steps and logs; the lint rule and R6 exist |
| 4.2 | Not started | The explainability eval, its threshold from data |
| 4.7 | In progress (telemetry lane) | The world's spans and R6's counter for them |
| 4.11 | — | Starting points take the journey's cast and company: [#347](https://github.com/AaronAbuUsama/capxul-next/pull/347), green, held into `slice/blueprint` until the speed lead says "merge #347" |
| 5.1 | Not started | Roles declared once, `allowed` everywhere (R17), Core's one standing check |
| 5.2 | Not started | Account identity in the blueprint: grade groups, account version, the email's normalisation, the derivation (AGENTS.md, "Who owns each fact") |
| 5.3, 5.4 | Not started | Decision 8, items 3 and 4 |
| 6.1 | Not started | Operations and events carry a version (until then a new version is a new name) |
| 7.2 | Not started | Starting worlds made by typed steps (R11), one generic maker in the runner |

### In [docs.md](docs.md) and [sitrep.md](sitrep.md)

- **docs.md** is agreed; what it left for the blueprint is R8's list (the long READMEs and `build-order.md`) and
  `blueprint.md`'s status line. Its "generated so it cannot drift" list (section 5) is partly built: the blueprint's
  pages, the package maps and the glossary are generated; the AGENTS.md ladder table is not.
- **sitrep.md** is open. It proposes the sitrep's things (lane, ask, sitrep, ...) declared by the blueprint with
  commands (`capxul sitrep refresh`, `capxul ask open`, ...). Only the spike exists (`spikes/sitrep`); section 6 lists
  what still needs Aaron's yes.

### Deferred by me, and why

- **The renames (R15, R20).** Held until the speed lane's door work lands, to avoid conflicts (conductor, 16 November
  2026).
- **R7 and R8.** Offered as filler inside `slice/cli`; not taken, to land 3.9 sooner.
- **The CLI (3.9) follow-ups:**
  - `--at` (a world by address) is still a hidden flag, kept for the runner's in-process `callVia` until journeys name
    worlds (`packages/blueprint/src/protocol/cli.ts`);
  - `world.snapshot.restore`'s payload field `as` (the new world's name) shares a word with `--as` (a person of the
    cast). It is allowed because account commands take no `--as`; renaming it to something like `into` would be
    cleaner;
  - `login` keeps an operator token in a profile until real sign-in (phase 8);
  - a world lookup refused by `world.show` exits 1 as a usage error, not with the refusal's own code.
- **The toolkit's own tests of R20** run on made-up files; the repository's count is tested in `packages/generate`.

## 3. The decisions that shaped it

All in [docs/decisions.md](../decisions.md); the dates are theirs.

| Date | Decision | What it did to the blueprint |
|---|---|---|
| 13 Nov 2026 | The blueprint is Effect code; One source for every fact; Effect everywhere it can be | The blueprint is code the product imports, not a document; R10 |
| 15 Nov 2026 | Generated, never typed twice; Typed once, by check | The lint rules behind R1 to R3; `pnpm generate` and `generate:check` |
| 15 Nov 2026 | Lifecycles are machines; Who may call is declared; Measurement is declared | The formats behind R5, R17, R18 |
| 15 Nov 2026 | New formats by a ratchet; One registry of ratchets | The registry and the rule that a format closes before its list is empty |
| 15 Nov 2026 | The blueprint's boundary; No drift, in eight layers; Coverage gates new declarations | Parts 2 and 3; 3.7 |
| 15 Nov 2026 | The shape; Things, then verbs; One glossary; The CLI is the one surface | Parts 7, 12 and 13: one folder per thing, one file per verb, the glossary, the CLI from the layout |
| 15 Nov 2026 | Build the system, then climb, then breadth; No callers, no compatibility | Part 14: the order, and direct renames until phase 8 |
| 15 Nov 2026 | Speed first, stage 2 trimmed | Stage 2b trimmed to 3.6, 3.8, 3.10 and 3.11; 3.7 and 3.9 moved to milestone 4 |
| 16 Nov 2026 | (conductor) Each lane writes its own blueprint delta | The blueprint has no single owner since; each lead signs off its delta |

**What I would do differently now.**

1. **Count from the first day.** R4, R9 and R11 to R14 were registered without counters; "not yet counted" lists are
   easy to forget. A ratchet should land with its counter or not at all.
2. **One ratchet per gap.** R4 and R5 overlap (lifecycles), as do R15 and R20 (renames). Merge them.
3. **Keep the domain table out.** `packages/generate/src/sources.ts` still holds a hand-written table of today's
   domains (`BLUEPRINT.domains`) beside the things' folders. It is the one hand-typed fact left in the generator; the
   things' layout should be the only grouping.
4. **Make the lint lists part of the blueprint.** The ratchets' lists for R1 to R3 and R6 live in `packages/lint`,
   not in the registry; the registry reads them across a package boundary. One place would be simpler.
5. **Measure before declaring steps.** 4.1 asks for steps drafted from measured runs; R18 was registered before any
   run was measured, so its list is the whole set.

## 4. Where the framework ends and Capxul begins

**The framework** is `packages/blueprint-tools`: no fact about Capxul, imports nothing of the blueprint.

- `src/language/`: the formats (operation, lifecycle, promise, starting point, work, kinds, glossary, ratchet).
- `src/checks/`: the delta check (`pnpm delta:check`), the formats, the old-words count, the ratchet counters, the
  scorecard.
- `src/render/`: the pages, the glossary page, the layout reader.

**Capxul's declarations** are `packages/blueprint`: `src/things/`, `src/common/`, `src/starting-points/`,
`src/protocol/` (including `cli.ts`), `src/telemetry/`, `glossary.ts`, `ratchets.ts`, and the generated
`src/generated/`.

**What is tangled today:**

- **Capxul paths inside the framework.** `checks/scorecard.ts` and `checks/word-files.ts` name
  `packages/blueprint/...` paths; `checks/ratchet-files.ts` names Capxul's packages (`NOT_LINTED`). A reusable
  framework would take them as configuration.
- **`packages/generate` sits between them.** It imports both, holds the domain table, gathers the ratchets' lists
  (`ratchet-sources.ts`, `ratchet-files.entry.ts`), writes the blueprint's generated indexes (`blueprint.ts`,
  `commands.ts`, `pipeline.ts`), the contracts' ABI, the Frappe module and the package maps. Part of it is the
  framework's generator, part is Capxul's build.
- **`packages/lint` holds Capxul rules and ratchet lists.** The rules (`owned-values`, `declared-names`,
  `decoded-rows`, `declared-steps`) enforce the blueprint's discipline, and their unmigrated lists are ratchet data.
- **The status feed** (`packages/status-feed`) reads the roadmap's Proof cells and the ratchets for the dashboard; it
  is neither framework nor declaration.
- **Generated code is checked in** inside the declarations package (`src/generated/`), so the framework's output and
  Capxul's sources share a folder tree.

The plan already says (part 14) that the toolkit is split off as its own product only once the whole system works.
The climb (C.1) has not started, so that condition is not met yet.

## 5. The CLI: generated, hand-written, and meant to be generated

State at the pause: the grammar of decision 8, item 1 (roadmap 3.9) is built on `slice/cli` at head d99e155d, in
#452 (the delta), #453 (the checks, written first by another agent) and #458 (the build), with the roadmap row marked
Done in #466 and #472. Its pull request into `master`, #473, passed `gate` and both 🔍 reviews and is **not merged**:
Aaron's pause stopped it. `master` still has the 1.10 CLI, whose commands are the operation's name split at its dots
(`capxul org threshold set`).

**From the blueprint, generated by `pnpm generate`:**

- Each operation's command path, `capxul <thing> <verb>`: `packages/blueprint/src/generated/commands.ts`, written by
  `packages/generate/src/commands.ts` from the things' folders and the verbs' files.

**From the blueprint, derived when the CLI runs** (no generated file; `packages/cli` reads the declarations):

- The command tree: one group per thing, one command per verb, from `commands` (`src/commands.ts`).
- Each command's flags: one per payload field, from the operation's payload schema (`src/input.ts`); the reserved
  names from `CLI_FLAGS` (`packages/blueprint/src/protocol/cli.ts`).
- Decoding the payload, and printing the answer: the operation's own schemas (`src/output.ts` for JSON, `src/view.ts`
  for the readable view, which walks the schema and has no per-operation code).
- Exit codes: the blueprint's `Errors.exitCode`.
- Which group serves a command (account or world): `servedBy`.

**Hand-written in `packages/cli`:**

- `login`, `logout` and `use` (`src/sign-in.ts`), the profile file (`src/profile.ts`) and where a call goes
  (`src/target.ts`: the environment over the profile, a world found by `world.show`). The blueprint declares their
  names and one-line meanings (`CLI_COMMANDS`), not their arguments or behaviour.
- Every flag's help text (`src/commands.ts`), and each command's description, which is only
  `<operation>: served by the <group>`. The blueprint holds no per-operation description the CLI could use.
- The in-process call the runner uses (`src/call.ts`, `callVia`), with the hidden `--at`.

**Meant to be generated, not done:**

- **The CLI tree as a generated artefact.** Part 14 lists "the CLI tree" among the generators; today it is built at run
  time from `commands` instead. Either is defensible; the plan named the first.
- **The pipeline's commands** (decision 8, item 2): `capxul world create|destroy|reset|renew|sweep`, `capxul run start
  --shards N`, `capxul journey run`, `capxul verdict show`, and the rest of `run.sh`'s jobs as declared work. The work
  verbs exist in the blueprint (`src/things/run/`, `journey/`, ...), but the CLI serves only operations a group serves
  (`Sdk.names`); no work verb is a command, and `run.sh` is unchanged. The ratchet for build tools that stay package
  scripts was never registered.
- **Frappe's commands** (decision 8, item 3; roadmap 5.3): the generic verbs declared once and typed commands per app
  generated from the pinned apps' metadata (`capxul erp purchase-invoice create`), with the coverage list.
- **The Safe's commands** (decision 8, item 4; roadmap 5.4): `capxul safe call ...` generated from the contracts' ABI.
- **Real sign-in** (phase 8): `login` keeps an operator token until then.
- **The help text from the blueprint**: per-operation descriptions and per-field meanings, so `--help` is generated too.
