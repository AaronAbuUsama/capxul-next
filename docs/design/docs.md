# One set of docs: the plan

Status: agreed, 15 November 2026.

Written by the docs session on 15 November 2026 for Aaron, and agreed by him that day, question by question (section
8). Decision 3, the shape (`docs/design/blueprint.md`, part 7), wins where the two differ; section 0 lists every
difference. Decision 7 (part 12) renamed many things after this plan was written: new and moved docs use the
glossary's words, while this note keeps the words of the day it was written. The moves are in section 10 and land on
`slice/docs`.

Aaron's ask: "one cohesive set of docs and notes that is organised around progressive disclosure and is consistent
with itself and everything else that we're building."

## 0. Where decision 3 changes this plan

Read the rest of this plan with these amendments. Each one is decision 3's wording, applied.

1. **Everything inside `packages/blueprint` belongs to the blueprint session**: its README, `decisions.md`, `gaps.md`,
   the `order.md` and `claims.md` files, and the generated pages. It moves them in its stage 2a. This plan does not
   touch them. Outside the blueprint, this plan only repoints links and comments that cite them, after 2a.
2. **A domain's files** are `values.ts`, `events.ts`, `refusals.ts`, `machines.ts` and one `<operation>.ts` per
   operation. Shared events and refusals go in `events.ts` and `refusals.ts`, not in `values.ts` as section 8's
   note on row 9 said.
3. **Maps sit in `generated/`**: `packages/<name>/generated/index.md` for each package, and
   `packages/blueprint/generated/` for the blueprint. They replace `records/index.md` and `src/<domain>/index.md`
   in sections 3 and 5. `pnpm shape` requires every package to have one.
4. **How-to pages** live in `docs/guides/` for work across packages, and in `packages/<name>/docs/` for a package's
   own tasks, one task each.
5. **AGENTS.md holds the rules only.** The reasons go in `docs/`. This replaces "about 150 lines, rules with links".
   The rewrite is this plan's, after the blueprint's stage 2b has landed its changes of fact (F6: "run records"
   become verdicts and telemetry; one file per operation; `pnpm ratchets` and `pnpm delta:check`; the ratchet
   registry).
6. **A design note's status line** reads `open`, `agreed` or `superseded`, not `proposal`, `live` or `history`.
7. **Run records** under `packages/*/records/` are frozen from the proof lane's flip (R12, R14) and get no new files.
   The records index is generated once from the frozen records. Moving a spike's proof into `records/` must happen
   before that flip, or the proof stays where it is and the Proof column names it by verdict (section 10, M19).
8. **What proves a step** becomes verdicts and telemetry when stage 2b lands F6. Until then, section 8's answer to
   question 1 holds.
9. **The roadmap's decisions move to `docs/decisions.md`** after stage 2b, which adds new decisions to the roadmap's
   table. Moving them first would mean editing the table twice.
10. **Two more checks**: a test fails a README or operation file that lists files by hand; and every package has a
    generated index (with a ratchet list until each has one).
11. **Two files not covered by part 7**: `GROUNDING.md` is missing from part 7's top level. This plan keeps
    `docs/grounding.md` and asks the blueprint session to confirm it. The new top-level `notes.md` (Aaron's notes
    on the CLI and the names) is folded by the blueprint session into decisions 7 and 8.

Aaron's ask: "one cohesive set of docs and notes that is organised around progressive disclosure and is consistent
with itself and everything else that we're building."

This file itself breaks rung 1 today: `packages/lint/src/shape.ts` allows only `docs/roadmap.md` under `docs/`. That
is why it has no pull request. The first move below fixes it.

## 1. What is wrong, in one paragraph

The repository tracks 60 Markdown files on `master` (about 6,000 lines). Another 10 files (about 2,400 lines) sit on
three unmerged design branches. Four package READMEs run from 221 to 617 lines. Three hand-written lists are
contradicted by a second copy of themselves inside the same file: the blueprint's domain folders, Core's handler
folders, and the scenarios' `src/domains/`. These are merge artefacts. Facts are typed in two or three places and have
drifted apart: which packages exist, how many operations there are, what proves a step, where pull requests go, which
branch is the default, and whether Core reaches a site. 104 lines in 81 files cite `packages/blueprint/decisions.md` by
entry number. Some decisions Aaron agreed live only there, or only in an `order.md`. Nothing checks the length of any
doc, any link between docs, or where a note may live.

## 2. The inventory

Sizes are lines on `master` at `cf24c56e`, or on the design branch named. Audience key: **A** Aaron, **S** an agent
starting a task, **B** a builder, **R** a reviewer, **L** a lead or the conductor.

### At the top level

| File | Lines | Purpose | For | Duplicates | Contradicts |
|---|---|---|---|---|---|
| `README.md` | 29 | what this is, where things are | A S | the package list in `shape.ts` (lists 8 of 15); the ladder in AGENTS.md | gives `spikes/pipeline/run.sh scenarios` as the proof, where AGENTS.md and `world.yml` use `packages/runner/run.sh`; its `pnpm check` comment leaves out `generate:check` |
| `AGENTS.md` (`CLAUDE.md`) | 241 | the rules every agent follows | S B R L | about half restates roadmap decisions (the loop, side by side, the ratchet, measurement, the cap); rung 1 restates `packages/lint/README.md` | "run records say what is proven", where the roadmap's Proof column also accepts a transcript or `check:<command>`; rung 6 still waits on step 1.8, which is Done; rung 5 leaves out `door:test`; names `machines.ts` and a domain `steps.ts`, which do not exist yet, while two unrelated `steps.ts` files already do; says `claims.md` is generated, when `pnpm claims` renders it outside `pnpm generate` |
| `GROUNDING.md` | 51 | Aaron's strategy | A L | the roadmap's goal and "One public surface" | cites `aaron.jurisdiction-open`, which nothing defines; "equity parked" and "FDE parked" appear nowhere else |
| `docs/roadmap.md` | 173 | decisions, lifecycle rules, phases, steps, risks | A L | AGENTS.md's loop; platform's "Sites from a pool" | the "Convergence" row speaks of `master` becoming trunk, but it already is the default branch; step 0.8's evidence says gaps are still open, but they are fixed; the `pnpm claims` split above |
| `.github/pull_request_template.md` | 15 | a pull request's shape | B | the key rule | "one pull request into master", where builders open pull requests into `slice/<name>` |

### In the packages

| File | Lines | Purpose | For | What is wrong |
|---|---|---|---|---|
| `packages/world/README.md` | 617 | everything about a world | B R | lists 4 platform operations of 7; says Core reaching a site is unproven (1.4 is Done); says nothing schedules `sweep` (two workflows run it); contradicts itself on which proofs ran on the hub; repeats the roadmap's lifecycle rules; has 90 lines of stale timings |
| `packages/platform/README.md` | 405 | the shared platform | B A | says `world.yml` runs on every pull request into `master`, where it runs only on `slice/*` pull requests and daily; says `drift.yml` waits for `master` to become default; says the runner makes no template world (1.16 and 1.18 are Done); its file table misses three paths; repeats the roadmap's "Hosting" decision |
| `packages/runner/README.md` | 333 | the scenario runner | B R | its settings table misses 7 of the settings in `src/settings.ts`; its records table misses 11 runs, including `run-138efc`, which is the proof of five steps; its "Not done" contradicts itself; its file table misses 7 files |
| `packages/core/README.md` | 221 | the Capxul server | B | "Every handler is built" appears twice, once naming `board`, once `budgets`; says 16 and 4 operations, where there are 19 and 7; says "all twelve" where there are 26; says reaching a site waits for the bench (1.4 is Done) |
| `packages/scenarios/README.md` | 123 | how journeys are written | the scenario author | `src/domains/` and `src/support/` listed twice; "invite olga to Northwind" listed twice with different steps; the support list misses 5 files |
| `packages/contracts/README.md` | 112 | the contracts and their seed | B | a stale "proof" section; test counts that drift; its agent-authority section quotes `spend(..., documentHash, jobNonce)`, which the invoice-ledger direction replaces |
| `packages/contracts/src/README.md` | 5 | — | — | says "Empty on purpose"; the folder holds every contract |
| `packages/sdk/README.md`, `packages/cli/README.md` | 80, 80 | the client and the command line | B, callers | "all twelve operations" |
| `packages/frappe-app/README.md` | 64 | the app on every site | B | its module table misses 10 modules; "Core boundary" (23 lines) describes `main`'s outbox, not this line |
| `packages/bench-image/README.md` | 54 | the bench's image | B | links to `docs/mission/sites-host/bench-image.md`, which does not exist; old-line task names |
| `packages/indexer/README.md` | 9 | the Ponder app | B | written for `main` ("slice zero", "not written yet") |
| `packages/generate/README.md`, `lint/README.md`, `status-feed/README.md` | 25, 16, 12 | — | B | accurate; keep |
| `packages/platform/bootstrap/BOOTSTRAP.md` | 116 | the one-time runbook | A | "The schedule" says `main` is the default branch |

### In the blueprint

| File | Lines | Purpose | Written how | What is wrong |
|---|---|---|---|---|
| `packages/blueprint/README.md` | 102 | package map, adding an operation | by hand | the domain-folder row twice, one with `board`, one with `budgets`; `subjects.ts` twice; "twelve operations", where 23 are declared; repeats what the declarations and `claims.md` say |
| `decisions.md` | 398 | 53 design calls, then "Answered by Aaron" 1 to 4 | by hand | the answers reuse numbers 1 to 4; entries 3, 16, 24, 27 and 34 are stale; entry 47's unsalted hash disagrees with the roadmap's sealed document; entries 26 and 53 and answers 1 to 3 are Aaron's and missing from the roadmap |
| `gaps.md` | 131 | gaps the scenario author found | by hand | causes 1 to 9 closed; open points 1 and 5 still open; open 3 closed |
| `order.md` and 9 `src/*/order.md` | 34 + 179 | build order, parts, starting worlds, why | by hand, partly tested | covers steps 1 to 12 of 16; predates the fleet hub and "One runner, one world"; `record.export` is placed before what it needs; `board`, `budgets` and `people` hold real design prose |
| `claims.md` and 9 `src/*/claims.md` | 39 + 782 | each operation's claims | rendered by `pnpm claims`, tested in rung 5 | not in `pnpm generate`, not in a `generated/` folder, "do not edit" is on line 3, not line 1; the top file's checks paragraph is hand text and a subset of AGENTS.md |

### In the spikes

All seven spikes belong to steps that are Done. Two of them still hold their step's only proof.

| Spike | Lines | Step | Proof inside it? | Not captured anywhere else |
|---|---|---|---|---|
| `pipeline` (6 READMEs) | 475 | 0.7 | `scenarios/red-records/`, cited by the runner's record note | Core's latency baseline (87 ms a round trip, eastern US to London) |
| `containers` | 86 | 0.6 | **yes**, `records/ct-w3.prove.txt` | — |
| `hosting` | 55 | 0.1–0.3 | no | — |
| `state` | 94 | 0.4, 0.5, 2.5 | no | what was left in the Cloudflare account on purpose, and how to remove it |
| `bench-clocks` | 124 | 0.8 | **yes**, `observed*.txt` | the bench's memory and site-creation numbers; what still reads host time |
| `site-speed` | 181 | 1.17 | no; about 70 JSON records cited by about 10 code comments | one bench's capacity; why many companies on one site breaks the model |
| `world-speed` | 190 | 1.15, 1.16, 1.18 | no; records cited by number in `packages/world` comments | options A to F; the floors still open |

The blueprint's world budgets rest on deploy times from `spikes/containers` and `spikes/hosting` that the fleet hub has
since beaten (15.7 to 18.4 s against 39 to 43 s). Those budgets are the blueprint session's, so this plan only flags
them.

### Records

Every `.txt` and `.json` under `packages/*/records` is evidence: transcripts, account inventories, the proofs' own
client code kept as `.txt` to stay out of lint. They stay where they are. Two prose notes sit among them:

- `packages/runner/records/spike/README.md`: evidence for 0.7. Keep it.
- `packages/world/records/spike-bundler/README.md`: the history of a deleted spike. Keep it, but cut its "Run it"
  section, which names scripts that no longer exist.

### On the design branches (read, never pushed)

| Note | Lines | Status | Live spec or history |
|---|---|---|---|
| `design/proof-telemetry: proof-and-telemetry.md` | 614 | the plan and decisions 4, 6 and 7 decided by Aaron on 15 November; decisions 1–3, 5, 8 and 9 recommended | live spec until roadmap steps 4.4 to 4.6 land, then history |
| `design/proof-telemetry: telemetry-in-the-blueprint.md` | 331 | T1 to T8 decided on 15 November | live spec until the blueprint's `telemetry/` module exists; Part 1 then becomes reference material |
| `design/speed: speed.md` | 145 | analysis, decides nothing | history and a backlog; its changes #7 and #8 need roadmap decisions |
| `design/contracts-first-principles: invoice-ledger.md` | 371 | the direction, mostly decided on 15 November | live spec until the 5.2 and 6.2 blueprint deltas exist |
| `… agreements-design.md` | 374 | partly superseded | §2 (the seal and privacy) live; the rest history |
| `… primitive-mapping.md` | 332 | exploration, partly rejected | history |
| `… parity-inventory.md` | 270 | research for step 7.1 | a frozen snapshot of the old stack |
| `… handoff-knock-on-map.md` | 101 | a brief for the next session | retire once its spec exists |
| `… README.md` | 19 | the notes' status and reading order | a convention worth keeping |

These notes contradict `master` in ways that only their decisions can settle. The docs follow whichever side Aaron
agrees, so this plan lists them as open in section 5.

## 3. The target set

Three levels. A reader stops at the first level that answers the question.

| Level | Says | Length | Where | Written how |
|---|---|---|---|---|
| 1 | what this is, the rules, where to go next | one screen | `README.md`, `AGENTS.md`, each package's `README.md` | by hand, with generated maps inside |
| 2 | the map of an area: what is in it, what state it is in | as long as the area | `docs/roadmap.md`, `docs/decisions.md`, generated indexes | generated wherever the facts exist in code |
| 3 | the detail | as long as it must be | a comment at the top of the module it describes; `packages/<p>/docs/<topic>.md` where a topic spans modules; `docs/design/` for reasoning; `records/` for evidence | by hand, beside what it describes |

### The files, once done

```
README.md                    level 1: what this is, the dashboard, the ladder, a generated map of the packages
AGENTS.md  (CLAUDE.md)       level 1: every rule an agent must follow, each with a link to the reasoning
docs/
  roadmap.md                 level 2: goal, lifecycle rules, phases, steps (read by status-feed), risks
  decisions.md               level 2: every decision Aaron agreed, word for word, each with its date
  grounding.md               level 2: Aaron's strategy (was GROUNDING.md)
  design/
    README.md                generated: each note, its status line and date
    <topic>.md               level 3: why something is the way it is; first line states its status
packages/<p>/
  README.md                  level 1 for the package: at most 60 lines
  docs/<topic>.md            level 3, only for a topic no single module owns
  records/                   evidence; records/index.md generated from each summary.json and *.proof.json
packages/blueprint/
  index.md                   generated: every domain, its operations, their claims (decision 3's index)
  src/<domain>/index.md      generated: the domain's operations, refusals, events, budgets, claims and build order
spikes/<s>/README.md         only while the spike's step is not Done
```

There are rules for which file a fact goes in. The first rule that fits decides.

1. **A rule an agent must follow** goes in `AGENTS.md`, once. If a decision explains the rule, AGENTS.md states the
   rule in one sentence and links to the decision. It never restates the decision's reasoning.
2. **A decision Aaron agreed** goes in `docs/decisions.md`, with its words and its date. The roadmap links to it.
3. **What the plan is and where each step stands** goes in `docs/roadmap.md`.
4. **A fact the code already holds** is generated from that code, or left in the code. Examples are a list of
   files, operations, settings, records, journeys, packages or commands.
5. **How one module works** goes in a comment at its top. A topic that spans modules goes in
   `packages/<p>/docs/<topic>.md`.
6. **Why something was chosen** goes in `docs/design/<topic>.md`. **What was measured** goes beside its evidence in
   `records/`.
7. **What is not done yet** is a roadmap step, or a TODO on the code it concerns, never a "Not done" section.

### Where each existing piece goes

| From | What happens | To |
|---|---|---|
| `README.md` | kept, rewritten to one screen | the package list becomes a generated block from `PACKAGES` in `shape.ts`; the proof command fixed to `packages/runner/run.sh` |
| `AGENTS.md` | kept; about 240 down to about 150 lines | every rule stays, word for word. Restated decision reasoning becomes links to `docs/decisions.md`. The lint-rule list moves to `packages/lint/README.md`. The ladder table becomes a generated block from `package.json`. Names not yet built are marked with their step. Stale facts are fixed. |
| `GROUNDING.md` | moved | `docs/grounding.md`, unchanged |
| roadmap "What was decided …" (40 rows) | moved | `docs/decisions.md`, words and dates unchanged; the roadmap keeps a one-line link |
| roadmap lifecycle, phases, steps, risks | kept | `docs/roadmap.md`; the "Steps to the goal" heading and table stay byte-compatible, because `status-feed/feed.py` parses them |
| `blueprint/decisions.md`, Aaron's: 26, 53's rule, answers 1–3, 51's open question | moved | `docs/decisions.md`, with their words and dates; answers renumbered so no number is used twice, with an old-to-new table |
| `blueprint/decisions.md`, the format and the worlds: 4–25, 28, 30, 32–44, 46–50, 52, the rest of 53 | moved | comments on the declaration each one governs. The blueprint inventory names the file for each. The blueprint session moves these, because the files are its own. |
| `blueprint/decisions.md` 29, 31, 45 and the history of old codes | deleted | git keeps them |
| `blueprint/gaps.md` | deleted after its two open points become TODOs on `world/operations.ts`, and open 2 and 4 become coverage notes | — |
| `blueprint/order.md` and `src/*/order.md` | generated instead | the build order goes into each domain's generated `index.md`, from claims' starting worlds and the starting worlds' steps. The design prose in `board`, `budgets` and `people` moves to comments on those domains' `operations.ts`. The world-parts list moves to `packages/world/README.md`. |
| `blueprint/claims.md` and `src/*/claims.md` | generated by `pnpm generate` | moved into `OUTPUTS` in `packages/generate/src/sources.ts`, with "generated" on line 1, and merged into the `index.md` files if decision 3 says so; the hand paragraph on checks becomes a link to AGENTS.md |
| `blueprint/README.md` | rewritten to one screen | its operation table and folder map are replaced by a link to the generated `index.md` |
| `world/README.md` (617) | split | README: what a world is, its parts, commands, the rules-to-files map. `docs/hub.md`, `docs/reset.md` and `docs/renew.md` for topics that span modules. How each part is reached goes in a comment at the top of its module. The proofs table is generated into `records/index.md`. Timings and "What was learned" move to their records. "Not done" moves to the roadmap. |
| `platform/README.md` (405) | split | README: what it is, its stacks, names, run it. The site door's API moves to `door/README.md`. The 115 lines of history move to `records/<x>/README.md` beside their evidence. "Bench templates never change" gets one owner, `door/templates.py`; the world and runner copies become links. |
| `runner/README.md` (333) | split | README: what it does, run it, what a run writes. Each mode is described at the top of its module. The settings table is generated from `src/settings.ts`. The records table is generated into `records/index.md`. |
| `core/README.md` (221) | split | README: what it serves, folder map, adding an operation, migrations. The per-domain handler tables are deleted, because the blueprint's index says what each operation does. "What every call gets" moves to a comment in `src/telemetry/middleware.ts`. |
| `scenarios/README.md` (123) | trimmed | the journeys table is generated from `registry.ts`; the duplicate rows are removed |
| `contracts/README.md` (112) | trimmed | provenance moves to `deploy/PROVENANCE.md`; the authority flow moves to NatSpec in the contract that implements it; the seed moves to `state/README.md` |
| `contracts/src/README.md` | rewritten | a one-line map of the folders |
| `frappe-app/README.md` | fixed | complete module table; "Core boundary" moves to docstrings in `api.py`, or is deleted as `main`'s history (question 6) |
| `sdk`, `cli`, `bench-image`, `indexer` READMEs | fixed in place | stale counts, the dead link, `main` wording |
| `BOOTSTRAP.md` | kept | "The schedule" cut to one line |
| `.github/pull_request_template.md` | fixed | "into `slice/<name>`" |
| spikes | deleted once their proofs and uncaptured findings move (question 4) | proofs move to `packages/world/records/spike-containers/`, `packages/frappe-app/records/bench-clocks/` and `packages/runner/records/spike/red-records/`, and the roadmap's Proof cells for 0.6 and 0.8 are changed to the new paths in the same pull request. Findings go to `packages/world/docs/speed.md`, `packages/platform/docs/capacity.md`, `packages/platform/docs/account-resources.md` and `packages/frappe-app/docs/clock.md`. About 30 code comments citing spike paths are updated. |
| design notes | land under `docs/design/` when their thread closes (question 3) | proof-and-telemetry, telemetry-in-the-blueprint, speed, invoice-ledger, and agreements-design §2 as live or history notes; primitive-mapping, parity-inventory and the handoff stay on their branch, named by the note that replaced them |

That is about 1,600 of the 2,165 README lines moved, generated or deleted, plus about 700 lines of blueprint notes
replaced by generated indexes and comments.

## 4. Duplicates and contradictions, and which version wins

The source of truth is what the system actually does: CI, the code, GitHub. Where Aaron decided, the decision in its
dated form wins. A doc that disagrees is fixed, not the other way round.

| # | The fact | Versions | Wins | Why |
|---|---|---|---|---|
| 1 | what proves a step | AGENTS.md: run records. Roadmap: a passed run record, a transcript or `check:`. GROUNDING: "checks and eval runs". proof-and-telemetry: CI verdicts only | **open** (question 1); until then the roadmap's Proof column | `feed.py` implements it; the verdict model is still a recommendation |
| 2 | the proof command | README: `spikes/pipeline/run.sh`; AGENTS.md and `world.yml`: `packages/runner/run.sh` | `world.yml` | it is what CI runs |
| 3 | which packages exist | README lists 8; `shape.ts` lists 15 | `shape.ts` | rung 1 enforces it; README's list is generated from it |
| 4 | where a builder's pull request goes | template: `master`; AGENTS.md: `slice/<name>` | AGENTS.md | Aaron's 14 November decision; `world.yml`'s trigger follows it |
| 5 | the default branch | BOOTSTRAP.md, `drift.yml`'s comment, platform README: `main`; GitHub and roadmap 2.5: `master` | GitHub | the live fact |
| 6 | rung 6's gate | AGENTS.md: waits on 1.8 | the roadmap: 1.8 is Done | — |
| 7 | the test rung | AGENTS.md misses `door:test` | `package.json` | the ladder table is generated from it |
| 8 | the loop, the cap, side by side, the ratchet | AGENTS.md and the roadmap, nearly word for word | the roadmap's dated decision for the why; AGENTS.md for the rule | one says what was agreed, the other what to do |
| 9 | where machines, steps and logs are declared | AGENTS.md: the domain's `machines.ts` and `steps.ts`; telemetry notes: each operation's own file and a `telemetry/` module | **one file per operation** (Aaron, 15 November 2026) | decision 3 records it |
| 10 | `claims.md` is generated | AGENTS.md: by `pnpm generate`; the code: by `pnpm claims`, tested in rung 5 | the code, until the move makes AGENTS.md true | — |
| 11 | how many operations | 12 (blueprint README, sdk, cli, core tests); 16 + 4 (core); 4 platform (world); declared 23 to 26 | the blueprint's `domains.ts` | no doc states a count again; the generated index shows it |
| 12 | Core reaches a site | world, core and platform: not proven | roadmap 1.4: Done, `run-138efc` | — |
| 13 | when `world.yml` runs | platform README: every pull request into `master` | `world.yml`: `slice/*` pull requests into `master`, and daily | — |
| 14 | "Bench templates never change" | world, platform and runner each explain it | the roadmap decision for the rule; `door/templates.py` for how | one owner; the others link |
| 15 | lifecycle rules | roadmap and world README | the roadmap | the world README keeps only the map from rule to file |
| 16 | the hosting choices | roadmap "Hosting" and the platform README | the roadmap | — |
| 17 | a document's hash | blueprint decision 47: unsalted keccak of the Payment Entry; roadmap "Every payment settles one sealed document": salted | **salted** (Aaron, 15 November 2026) | the blueprint session amends decision 47 |
| 18 | reject under an agreement; Escrow | roadmap: a payer may reject; Escrow stays as on `master`. invoice-ledger: no reject; Escrow becomes the held payment | **the invoice ledger** (Aaron, 15 November 2026: no reject; Escrow becomes the held payment) | the contracts thread rewrites the roadmap decision |
| 19 | whether to restore in place | blueprint decision 18: never; roadmap "One runner, one world": reset in place as plumbing | both; decision 18's comment says it governs the operation, not the runner's plumbing | — |
| 20 | world create split | roadmap 1.3: 45.8 s deploy, 46.5 s index; world-speed: 60.6 s and 25.7 s | both, as different runs | timings belong in records, not prose; the prose copies are removed |
| 21 | Aaron's agreed rules outside the roadmap | blueprint 26 (founding with a board), 53 (the chain's budget is the only gate), answers 1–3 (7 days and 5 worlds, the faucet, "the books coming out right is the rule"); invoice-ledger's Companies House signers | `docs/decisions.md` once moved | they are promises, so they belong with the others |
| 22 | `contracts/src` | README: "Empty on purpose" | the folder | — |

## 5. What must be generated, so it cannot drift

Each generated output is listed in `OUTPUTS` in `packages/generate/src/sources.ts`. Its first line says so, and
`pnpm generate:check` (rung 2) fails when it is stale. Two forms:

- **a whole file**, such as an index; or
- **a block inside a hand-written file**, between `<!-- generated:<name> start -->` and `<!-- generated:<name> end -->`
  (`packages/generate/src/markdown-blocks.ts`; the form agreed with the blueprint lead on 15 November 2026). The
  reader keeps one file, and the generator owns only the block.

| Output | From | Replaces |
|---|---|---|
| the package map in `README.md` | `PACKAGES` and `TOP_LEVEL` in `shape.ts` | README "Where things are" |
| the ladder table in `AGENTS.md` | `LADDER` in `packages/lint/src/ladder.ts`, which now owns the rungs' words (built: they are declared, not read from the root `package.json` scripts) | AGENTS.md's ladder table |
| the lint-rule list in `packages/lint/README.md` | each rule's `meta.docs` in `packages/lint/src/rules/` | AGENTS.md's list |
| `packages/blueprint/index.md` and `src/<domain>/index.md` | `domains.ts`, each domain's `operations`, `refusalsOf`, `emits`, `budget`, `allClaims`, `startingWorlds`; later `machines` (3.4), steps (4.1), `allowed` (5.1) | blueprint README's tables, `claims.md` (if decision 3 merges them), every `order.md` |
| each domain's build order | claims' starting worlds, followed through each starting world's `steps[].operation` and `from`, then sorted | `order.md`; the "parts" column needs a new declaration, which is the blueprint session's call |
| `packages/<p>/records/index.md` | each `summary.json` and `*.proof.json` (claim, outcome, date) | the runner's records table and the world's proofs table |
| the runner's settings table | `Config.*` in `packages/runner/src/settings.ts` | the hand table, which misses 7 |
| the scenarios' journeys table | `registry.ts` | the hand table, which lists one journey twice |
| `docs/design/README.md` | each note's first line (status and date) | `design-notes/README.md`'s hand list |

Two more could follow later, but not in this slice: the world's commands from its CLI's help, and the site door's
call table from its routes.

Prose about an operation cannot be read from a `//` comment at run time. The index either reads summaries with the
TypeScript compiler API, or the blueprint moves them into Schema `description` annotations. That is decision 3's call.

## 6. Changes to the shape rung

Each check goes in `packages/lint/src/shape.ts`, is tested in `packages/lint/test/shape.test.ts`, and reads only files
git tracks. Checks that today's tree would fail start with an `unmigrated` list that a test allows only to shrink, the
same ratchet AGENTS.md uses for formats. The rung is green from the first pull request, and each later move removes
an entry.

1. **`docs/` holds what is listed.** `DOCS` becomes a map of paths and patterns to reasons, like `PACKAGES`:
   `docs/roadmap.md`, `docs/decisions.md`, `docs/grounding.md`, `docs/design/README.md`, `docs/design/*.md`.
   `GROUNDING.md` leaves `TOP_LEVEL` when it moves.
2. **A README fits on a screen.** Every `README.md` is at most 60 lines, and `AGENTS.md` at most 160. Generated
   blocks count. The current long READMEs start in `unmigrated`.
3. **Markdown lives only where a doc may live.** Under `packages/` that is: `README.md` anywhere;
   `packages/<p>/docs/*.md`; anything under `records/`; and generated outputs listed in `sources.ts`. Everything else
   starts in `unmigrated`, such as `decisions.md`, `gaps.md`, `order.md` and `BOOTSTRAP.md`. `BOOTSTRAP.md` may stay
   as an exception with a reason, because it is a runbook beside its code.
4. **Every relative link resolves** to a tracked file. This catches bench-image's dead link and the spike-bundler
   "Run it" scripts, and anything a move leaves behind. Links into `generated/` and anchors are checked for the file
   only.
5. **A design note states its status.** Line 1 of each `docs/design/*.md` (not the generated README) is
   `Status: proposal | live | history, <date>`, so the generated index can read it.
6. **Generated Markdown says so on line 1** and is listed in `OUTPUTS`. Rung 2 already fails a stale one.

These are not proposed: an orphan check (every doc reachable from `README.md` or `AGENTS.md`), and length limits on
level-3 docs. Both can wait until the tree is clean.

## 7. The order of moves

Phase 2 starts only when Aaron has agreed this plan, the blueprint session has recorded decision 3, and lane B's
`slice/typed-once` (#262) and lane A's `slice/generate` (3.2) have landed on `master`. Both slices edit AGENTS.md, the
roadmap and five READMEs. The speed lane's `slice/speed` (#273) changes no docs, so it does not block.

All of it goes on one slice, `slice/docs`, cut from `master`. Each item below is one pull request into it, merged when
`check` is green. The slice reaches `master` by one pull request. The docs change no behaviour, so `world` is not run
on it, because `world.yml` skips docs and records.

1. **The shape rung** (section 6, checks 1 to 6, with `unmigrated` lists). No doc moves, so it is green on day one.
2. **Plain factual fixes**, in place, with no moves. These are rows 2 to 7 and 10 to 13 and 22 of section 4: the
   proof command, the template, the default branch, rung 6, `door:test`, the operation counts, "Core reaches a site",
   `world.yml`'s triggers, `contracts/src`, the dead link, the duplicated rows. This pull request is small, and every
   later lane gains from it at once.
3. **Top-level moves.** `GROUNDING.md` goes to `docs/grounding.md`. The roadmap's decisions table goes to
   `docs/decisions.md`, word for word, with the roadmap linking to it. Every link to them is updated. The roadmap's
   own header says it changes only with Aaron's agreement, so this needs his yes (question 2).
4. **The generator's Markdown support.** `packages/generate` learns generated blocks. It writes the README package
   map, the AGENTS.md ladder table, the lint-rule list, the records indexes, the runner settings table and the
   journeys table. Each one replaces its hand version in the same pull request.
5. **The blueprint's docs**, only with the blueprint session's agreement, because the files are its own:
   - `claims.md` rendering moves into `pnpm generate`;
   - the generated `index.md` and build order;
   - Aaron's decisions move from `decisions.md` into `docs/decisions.md`;
   - the 104 citations of `decisions.md` are repointed (to `docs/decisions.md`, or to the declaration that now
     carries the comment);
   - `gaps.md` and `order.md` are deleted.

   The comments on declarations are written by the blueprint session or with its sign-off. Where decision 3 assigns
   this differently, it wins.
6. **One pull request per package README**, largest first: world, platform, runner, core, scenarios, contracts, then
   the rest. Each moves its level-3 content beside the code and removes its entry from `unmigrated`. Comments added to
   source files are comments only, so behaviour does not change; the reviewer checks that the diff of each `.ts` file
   is comments.
7. **The spikes**, if Aaron agrees (question 4). First, one pull request moves the proofs and repoints the roadmap's
   Proof cells for 0.6 and 0.8. Then one pull request extracts the uncaptured findings, updates the code comments
   citing spike paths, and deletes the spikes.
8. **The design notes**, as each thread closes (question 3). The session that owns the thread lands its note under
   `docs/design/` with a status line. This slice only makes the place.
9. **AGENTS.md last.** It is rewritten to the target, with every rule's words kept, links to the new homes, and names
   not yet built marked with their step. Its wording on what proves a step follows question 1's answer.

Steps 1 and 2 can start as soon as Aaron agrees, before decision 3 lands, because they move nothing. Every later step
waits for decision 3.

## 8. Questions for Aaron, each with a recommendation

**Answered by Aaron, 15 November 2026:** "i agree with the rest". All eight questions below are agreed as recommended.
On row 17 of section 4 he answered "salted": the salted hash of the roadmap's "Every payment settles one sealed
document" wins over blueprint decision 47. The blueprint session amends 47.

Later the same day he settled the two rows left open:

- **Row 9: one file per operation** ("B"). Each domain has a generated `index.md`, `values.ts` (shared values, and
  the events and refusals more than one operation uses), `machines.ts`, and one file per operation declaring
  everything about it. There is no domain `steps.ts`. Decision 3 records it; AGENTS.md's "Who owns each fact" follows.
- **Row 18: (b), and the Escrow wording.** A payer may no longer reject an invoice presented under an agreement; the
  cap per period, pause and end are the payer's protection. Escrow becomes the held payment of the invoice ledger
  (shape agreed 15 November 2026), still parked as a build item. The contracts thread writes both into the
  roadmap's "Every payment settles one sealed document".

1. **What proves a step, in the docs.** AGENTS.md says run records; proof-and-telemetry recommends CI verdicts, but
   decisions 1 and 2 of that note are not yet agreed. *Recommend:* the docs use the roadmap's current Proof column (a
   passed record, a transcript or `check:`) until you agree the verdict model. AGENTS.md then changes in the same pull
   request that adds that decision.
2. **Move the decisions out of the roadmap** into `docs/decisions.md`, word for word, so the roadmap is the plan and
   the steps. *Recommend:* yes. The roadmap shrinks from 173 to about 110 lines, and the status feed is unaffected,
   since it reads only "Steps to the goal".
3. **Design notes on `master`.** *Recommend:* each thread lands its live note under `docs/design/` when its decisions
   are written into `docs/decisions.md`, marked `live`, and it is marked `history` when the code supersedes it.
   Superseded explorations stay on their branch, named by the note that replaced them: primitive-mapping,
   parity-inventory, the handoff, and agreements-design apart from §2.
4. **Delete the seven spikes**, since every step they serve is Done, after moving the two proofs and the findings
   nothing else holds. *Recommend:* yes, in this slice, as two pull requests. A spike is not a doc, so this is also a
   lead's call, but AGENTS.md already says a graduated spike is deleted.
5. **Generated blocks inside hand-written files** (README, AGENTS.md, package READMEs), or only whole generated
   files. *Recommend:* blocks, so a reader opens one file. The generator owns only what is between the markers.
6. **The frappe-app's "Core boundary" section** describes `main`'s outbox. *Recommend:* delete it here; it lives on
   `main`. The methods' docstrings in `api.py` say what they do.
7. **The 60-line cap** for every README, and 160 for AGENTS.md. *Recommend:* yes, with the ratchet above, so nothing
   breaks on the day the check lands.
8. **Aaron's decisions found outside the roadmap.** These are blueprint 26 and 53 and answers 1 to 3, and the
   Companies House signers in invoice-ledger. *Recommend:* move them into `docs/decisions.md` with their original
   words and dates. Nothing is reworded.

## 9. For the blueprint session

These are decision 3's to settle. This plan follows whatever it records:

- the names and places for machines, steps, logs and telemetry (row 9);
- whether `claims.md` and `order.md` become one generated `index.md` per domain, and how prose summaries reach it
  (comments read by the compiler, or Schema descriptions);
- who writes the comments that replace `decisions.md` entries on the declarations;
- decision 47 against the sealed-document decision (row 17), and the world budgets that rest on superseded spike
  numbers.

## 10. The moves, marked where a rename would change them

The list was prepared against today's names, at `52ef4e27` on `master` (#262 and 3.2 landed). The conductor holds every
move until decision 7, the names of things, is recorded. The **Rename** column marks two cases: a move whose target
path holds a name decision 7 may change (world, hub, core, door, platform, bench, site, runner, stage, shared), and a
move that writes new text using those names. **Rename: no** means decision 7 cannot change the move. **D8** marks a
move that decision 8 (the CLI as the one surface) may reshape. **After** names what must land first.

Each move is one pull request into `slice/docs`, unless a row says otherwise.

| # | Move | After | Rename |
|---|---|---|---|
| M1 | The shape rung: `docs/` as part 7 lists it; a README over 60 lines (R8 list); Markdown only where a doc may live; every relative link resolves; a design note's status line; generated Markdown says so on line 1; every package has `generated/index.md` (its own ratchet list). The checks name no package | decision 7 (by the conductor's hold) | no |
| M2 | Factual fixes in place, with no path chosen: the root README's proof command and the `generate:check` comment; the pull request template ("into `slice/<name>`"); BOOTSTRAP's "The schedule"; `contracts/src/README.md`; bench-image's dead link; `world.yml`'s triggers, the operation counts, "Core reaches a site" and the duplicated rows in the world, platform, runner, core and scenarios READMEs. A rename later carries these edits with it | decision 7 | in place only; the README splits in M7–M11 rewrite most of these lines anyway, so M2 could be cut to the files M7–M11 don't touch |
| M3 | `GROUNDING.md` to `docs/grounding.md`; links updated; `TOP_LEVEL` loses it | the blueprint session confirms `docs/grounding.md` | no |
| M4 | The roadmap's decisions table to `docs/decisions.md`, word for word, with Aaron's decisions found elsewhere added with their own words and dates (the Companies House signers; the blueprint's 26, 53 and answers 1 to 3 come from stage 2a's fold) | stage 2b's roadmap changes; 2a's fold | no |
| M5 | `docs/design/README.md`, generated from each note's status line | M1 | no |
| M6 | The generator learns Markdown blocks between markers, and writes the root README's package map (from `PACKAGES`), the AGENTS.md ladder table and the lint-rule list. The mechanism is shared with stage 2b's generated indexes, so it is agreed with the blueprint session first | 2b's generator | the package map shows package names, which a rename changes; the generator follows `PACKAGES`, so it needs no edit |
| M7 | `packages/world/README.md` (617) to one screen; `docs/` pages for the fleet's shared host, resetting a world and renewing one; module-header comments; its proofs table into `generated/index.md` | decision 7 | **yes**: world, hub, core, door, bench, site appear in paths and text |
| M8 | `packages/platform/README.md` (405) to one screen; the site door's API beside the door's code; history beside its records; one owner for "Bench templates never change" | decision 7 | **yes**: platform, door, bench, site |
| M9 | `packages/runner/README.md` (333) to one screen; each mode described at the top of its module; the settings table generated | decision 7 | **yes**: runner, world, stage, shared |
| M10 | `packages/core/README.md` (221) to one screen; per-domain handler tables deleted; "What every call gets" moved into the middleware | decision 7; stage 2b (handlers may mirror one file per operation) | **yes**: core, door |
| M11 | `packages/scenarios/README.md` (123) to one screen; the journeys table generated | decision 4's journeys named in the blueprint (2b) | low: "journey" and "scenario" may be in the glossary |
| M12 | `packages/contracts/README.md` (112) to one screen; provenance to `deploy/PROVENANCE.md`; the seed to `state/README.md`; the authority flow to NatSpec, replaced by the invoice ledger's flow when 6.2 lands | — | no |
| M13 | `packages/sdk/README.md` and `packages/cli/README.md`: stale counts | decision 8 | **D8**: the CLI may become the one surface, so its README is rewritten, not trimmed |
| M14 | `packages/frappe-app/README.md`: a full module table; "Core boundary" deleted (Aaron, question 6) | decision 7 | **yes**: core, site |
| M15 | `packages/bench-image/README.md`, `packages/indexer/README.md`: `main` wording and the dead link | decision 7 | **yes**: bench, world |
| M16 | `packages/platform/bootstrap/BOOTSTRAP.md`: stays a runbook, listed as an exception to the Markdown placement check | decision 7 | **yes**: platform |
| M17 | `packages/world/records/spike-bundler/README.md`: cut its dead "Run it" | — | no |
| M18 | `.github/pull_request_template.md` | — | no (in M2) |
| M19 | The spikes' proofs: `spikes/containers/records/` (0.6), `spikes/bench-clocks/observed*.txt` (0.8) and `spikes/pipeline/scenarios/red-records/` (0.7's runner note) move beside the package records, and the roadmap's Proof cells for 0.6 and 0.8 are repointed in the same pull request | before the proof lane's flip (R12), or skipped if the Proof column then names verdicts | **yes**: the target folders are under world, frappe-app and runner |
| M20 | The spikes' uncaptured findings as `docs/` pages: Core's latency baseline; the account's resources left on purpose; one bench's capacity and why many companies on one site breaks the model; the clock; world speed's options and floors | decision 7 | **yes**: every page names world, bench, site, core or platform, in its path or its text |
| M21 | The seven spikes deleted; the about 30 code comments citing spike paths updated | M19, M20 | comments only; a rename changes the files they sit in, so after decision 7 |
| M22 | The citations of `packages/blueprint/decisions.md` outside the blueprint (core 26, world 14, runner 11, scenarios 4, frappe-app 3, and some in roadmap and READMEs) repointed to where stage 2a put each entry | stage 2a | the citing files may be renamed; after decision 7 |
| M23 | The design notes: each lands under `docs/design/` from its own thread, with a status line | the thread's decisions in `docs/decisions.md` | no; a note is reasoning and keeps its words |
| M24 | `AGENTS.md`: the rules only, the reasons moved to `docs/`, the ladder and lint list generated (M6) | stage 2b's changes of fact; decision 7 (the rules use the names) | **yes** |
| M25 | The root `README.md`: one screen, the generated package map (M6) | M6, decision 7 | **yes** |

Not in this list, because they are the blueprint session's: everything inside `packages/blueprint`, the roadmap's new
decisions and steps of stage 2b, and `notes.md`.

Moves that need nothing but the conductor's word: M1, M3 (with the confirmation), M5, M12, M17, M18 and M23. These
are rename-safe. If the conductor agrees, they can go before decision 7 without risk of moving anything twice.

## 11. Where the moves stand (15 November 2026, 15:20 UTC)

Merged into `slice/docs`:

- M1 (the docs' shape, `packages/lint/src/docs.ts`), M3, M12, M17, M18 and this note: #284.
- M8 and M16 (sites, `packages/platform`): #286. M9 and M11 (runner, journeys): #287. M7 (world): #288, merged
  before `packages/world` passed to the world-layout session; whether it stays is the conductor's call.
- M10, M13, M14 and M15 (api, frappe-app, SDK, CLI, bench-image, indexer): #289. M25 (root README): #290.
- M19 to M21 for five spikes (bench-clocks, hosting, pipeline, site-speed, state): #292.

Long READMEs left on the shrinking list: the blueprint's (the blueprint session's), the bundler record note, and
`spikes/containers` and `spikes/world-speed` (the world-layout session's to graduate).

Waiting on another session:

- M4 (the decisions to `docs/decisions.md`) and M24 (AGENTS.md, the rules only): after the blueprint's stage 2b.
- M22 (repointing citations of the blueprint's `decisions.md`): after stage 2a.
- M5 and M6 (generated maps and blocks): after the generator mechanism is agreed with the blueprint session.
- M23 (the design notes): each from its own thread.
- Anything in `packages/world`: the world-layout session.

## 12. Where it stands (15 November 2026, 19:10 UTC)

This section is the hand-over. An agent that has never seen the docs thread can carry on from it, `AGENTS.md` and
sections 0, 3 and 10 above.

### What is done

`slice/docs` holds every move that waits on no one else, each merged on a green `gate` against the then current
`master`: #284, #286 to #290, #292 and #293 (section 11 lists what each did). Its pull request into `master`, **#304**,
is open. At 16:40 UTC on 15 November its head was `5fe8e7ba`, with `master` (`72a5b0cf`, after #300) merged in and
`pnpm check` green locally; `gate` and `world` were running.

What it changed, in short:

- `packages/lint/src/docs.ts`, run by `pnpm shape`, checks the docs' shape. It controls what lives under `docs/` and
  where else Markdown may live: a `README.md`, `packages/<name>/docs/`, `records/`, `generated/`, `.claude/`, or the
  two listed exceptions. It holds every README to 60 lines, with the remaining long ones on `LONG_READMES`, which may
  only shrink. It requires every relative link to resolve, and a design note to say `Status: open | agreed |
  superseded` in its first 10 lines, with `docs/design/blueprint.md` on `UNSTATED_NOTES` until its owner adds the
  line. The tests in `packages/lint/test/docs.test.ts` cap both lists.
- `GROUNDING.md` became `docs/grounding.md`.
- Every package README is on one screen except the blueprint's. Detail moved to `packages/<name>/docs/` pages,
  records READMEs and header comments; changes to code files are comments only.
- Five spikes graduated and were deleted.
- The root README is on one screen.

### The rules a docs builder follows

- Write new and moved prose in the glossary's words (`docs/design/blueprint.md`, part 12). Never rename a package,
  folder, file, command or identifier: renames belong to the rename ratchet. Where a doc names something not yet
  renamed, use its current name in code font and the new word in prose, for example "the api (`packages/core`)".
- A README is at most 60 lines and lists no files by hand. Detail goes next to what it describes. A fact the code
  holds is not copied. A fact in `AGENTS.md` or the roadmap is linked, not restated. "Not done" lists become TODOs on
  the code or are deleted.
- **Stay out of `packages/blueprint`**: it is the blueprint session's. **Stay out of `packages/world`**: it is the
  world-layout session's. When `master` is merged into `slice/docs`, resolve every conflict inside either package in
  `master`'s favour.
- Change the roadmap only where a moved proof's path changes, and change nothing but the path.

### What is left, in order

Landed since the hand-over (15 November 2026, 19:10 UTC):

- **#304** reached `master` (b55dff4), with stage 2a, #315 and #316 merged in. The docs check now allows Markdown
  under `.agents/`, and `docs/design/handoff.md` and `run-time.md` state their status.
- **M22**, #350 into `slice/docs`: 70 citations of the blueprint's decisions outside the blueprint now read
  `packages/blueprint/docs/decisions.md, entry N`, and three of `src/starting-worlds.ts` read
  `src/starting-points/points.ts`. Left on purpose: the citations in the applied migrations
  `packages/core/migrations/0002_site_ops.sql` and `0005_approvals.sql`, which are never edited; the contracts' own
  decisions; the roadmap's lines, which are the blueprint lead's.
- **M5 and M6**, #352 into `slice/docs`: `pnpm generate` writes Markdown blocks between
  `<!-- generated:<name> start -->` and `<!-- generated:<name> end -->` (`packages/generate/src/markdown-blocks.ts`):
  the root README's package map, the ladder and the lint-rule list in `AGENTS.md`, the lint-rule list in
  `packages/lint/README.md`, and `docs/design/README.md`. Every package has `generated/index.md`, checked by
  `packages/lint/src/maps.ts`; `UNMAPPED` (`bench-image`, `status-feed`, `blueprint-tools`) may only shrink.
  `blueprint-tools` comes off it when its owner, the blueprint lead, chooses. The marker form was agreed with the
  blueprint lead; the blueprint's own pages are still written by its `pnpm claims` until its stage 2b moves them into
  `pnpm generate`. A note's status line is read twice, by `docs-render.ts` and by `packages/lint/src/docs.ts`; one
  owner for it is a follow-up.

Still to do:

1. **M4, after the blueprint's stage 2b:** move the roadmap's decisions table to `docs/decisions.md`, word for word
   and with its dates, and link it from the roadmap. Keep "Steps to the goal" byte-compatible, because
   `packages/status-feed/feed.py` parses it. Add Aaron's decisions recorded elsewhere, with their own words and
   dates: entry 26 (founding with a board) and entry 53's rule ("the chain's budget is the only gate on spending")
   of `packages/blueprint/docs/decisions.md`, unless the blueprint lead's fold has moved them; "Answered by Aaron" 1
   to 3; the Companies House signers, from `invoice-ledger.md` on branch `design/contracts-first-principles`. The
   contracts thread was to rewrite "Every payment settles one sealed document" with Aaron's two answers of 15
   November; if that has not happened, raise it, do not reword it.
2. **M24, after 2b:** `AGENTS.md` to the rules only, each rule's words kept, the reasons moved to `docs/` and
   linked. Its ladder and lint-rule list are generated blocks already. It must say that rung 1 covers the docs'
   shape (`packages/lint/src/docs.ts`) and the package maps (`packages/lint/src/maps.ts`).
3. **M23, the design notes:** each lands under `docs/design/` from its own thread, with a status line. The notes are
   `design/proof-telemetry`, `design/speed` and `design/contracts-first-principles` (`invoice-ledger.md`, and
   `agreements-design.md` §2).
4. **The last long READMEs:** `packages/world/records/spike-bundler/README.md`, `spikes/containers` and
   `spikes/world-speed`, which the world-layout session graduates into `packages/world`; `spikes/containers` holds
   item 0.6's only proof. Each comes off `LONG_READMES` in the pull request that fixes it, with the ceiling lowered.

Where two moves landed somewhere other than section 3 says: the spikes' red records are in
`packages/runner/records/spike-red-records/`, and the contracts' provenance, seed and authority flow are pages in
`packages/contracts/docs/` (section 0, item 4), not `deploy/PROVENANCE.md`, `state/README.md` and NatSpec.

### Open questions and loose ends

- **The dashboard's date for item 0.8.** `packages/status-feed/feed.py`'s `landed()` dates a proof with `git log
  --diff-filter=A` and no `--follow`, so item 0.8 will show the date #304 merges, not 13 November, because #292 moved
  its proof. The fix is in `feed.py`, which belongs to whoever keeps the dashboard.
- **`docs/grounding.md`** is the plan's choice. Part 7 of `docs/design/blueprint.md` does not list Aaron's strategy,
  and the blueprint session never confirmed the path.
- **Blueprint files that still cite deleted spike paths:** `src/world/operations.ts`, `src/world/claims.md`,
  `src/operation.ts`, `src/telemetry.ts` and `decisions.md`. This is for the blueprint session's 2a.
- **A flaky test:** `packages/world/test/patience.test.ts` ("the tries took 430 ms") failed once during a builder's
  full `pnpm check` and passed alone. It is the world-layout session's.
