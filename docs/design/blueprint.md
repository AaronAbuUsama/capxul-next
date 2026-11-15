# The blueprint: the plan

The blueprint-first phase's plan, worked out with Aaron decision by decision from 15 November 2026. Each part says
whether it is **Agreed** (with its date) or **Proposed** (waiting for Aaron). Once the whole is agreed, this file becomes
the roadmap's restack and the changes to `AGENTS.md`, landed by pull request with the build on `slice/blueprint`.

**The goal, in Aaron's words:** "The ultimate goal of the blueprint is to make sure that there can never be drift from
it in the future. It should fully spec the system, and nothing that should be in it should be rolled by hand."

**The plan in six lines.**

1. The blueprint declares every fact a check can judge (part 2), in one file per operation, the pipeline's own work
   included.
2. Eight layers of checks hold the code to it, from generation to production (part 3). Each layer is itself declared
   pipeline work, instrumented and budgeted like any operation, so the checks cannot quietly eat the run.
3. Old code does not move in one go. Every gap between the code and the blueprint is a **ratchet**: a counted list that
   may only shrink, declared once, checked on every pull request, shown on the dashboard (part 4). Grinding the
   ratchets to zero is the hill we climb, in parallel lanes, with no change of behaviour.
4. Beside the ratchets, a few **measures** climb by trend, not by gate: the run's wall time toward 10 minutes, the
   share of it explained by declared spans, tries to green, cost per journey (part 4).
5. The order (part 5): finish the design; build the new format and the ratchet registry on `slice/blueprint`; then the
   ratchet lanes and the instrumentation lane run in parallel; the accounts pilot is the first feature born in the new
   format; then the ledger and breadth.
6. Everything we found that is wrong today is listed in part 1 with the part of the plan that fixes it.

## 1. What we found

| # | Found | Fixed by |
|---|---|---|
| F1 | The blueprint declares only the outside of an operation; steps, logs, lifecycle, who may call and telemetry are made up in code (176 span names typed by hand) | Part 2: the full format; ratchets R5, R6 |
| F2 | The pipeline's own work (world make, reset, snapshot, site claim, starting worlds, journeys) is not declared, yet it is most of a run's minutes | Part 2; decision 4; ratchet R6 |
| F3 | No telemetry vocabulary: every producer invents names and attributes | Part 2, the telemetry module; decision 5 |
| F4 | Measured facts typed by hand (a budget's `provisional` and `basis` in prose) | Part 3, layer 1: measured facts generated from verdicts; ratchet R13 |
| F5 | One operation spread across six files; READMEs of 222 to 607 lines; hand-written maps that have already drifted (the blueprint README lists its domains twice, differently) | Decision 3; ratchets R7, R8 |
| F6 | `AGENTS.md` says run records say what is proven; the agreed model is CI verdicts | Part 3; ratchet R12; the `AGENTS.md` change in part 5 |
| F7 | `AGENTS.md` names per-domain `machines.ts` and `steps.ts`; the proposal is one file per operation; #262's machine format is per domain and names operations and events by string, to avoid an import cycle | Decision 3 removes the cycle; ratchet R4 moves #262's machine into the new format |
| F8 | Roadmap step 4.1 predates the telemetry model | Part 5: 4.1 rewritten as `proof-and-telemetry.md` §10 says (logs through Effect's `Logger`, checks over OpenTelemetry spans and logs) |
| F9 | The account version against the protocol's major version | Agreed, part 6 |
| F10 | "One runner, one world" blocks a 10-minute run | Decision 4 |
| F11 | About 7 minutes of a run are the scenarios' observation reads (`world.show`, `record.export` before and after every try: 723 of about 1,000 calls), each reopening a Neon connection | Part 3, "What the checks cost"; the speed lane's changes 3 and 6 |

## 2. What the blueprint declares (decision 1)

**Agreed with Aaron, 15 November 2026** (option B: everything a check can judge).

**The rule.** The blueprint owns a fact when two places must agree on it, or a check judges work against it, and no
compiled source already owns it better. It never says how something is built or where it runs. Everything else that
uses a fact it owns gets it by generation, by an import that lint enforces, or by a check of what ran against it. A
fact it does not own has another named single owner, and the blueprint imports a generated copy of it.

| Fact | In the blueprint? | How |
|---|---|---|
| Operations, outcomes, events, refusals and their exit codes, claims | In | As today |
| Machines (lifecycles) | In | As decided on 15 November 2026. Operations and events are named by import, not by string |
| Roles and who may call (`allowed`) | In | As decided on 15 November 2026 (5.1) |
| Steps and logs | In | Every span of our own code is a declared step, with its kind; every log has a schema |
| Telemetry vocabulary | In: the envelope, attribute names, the conventions' version, producers, step kinds, metrics, logical datasets, fields marked sensitive. Out: sinks, routing, keys and creating datasets, which stay in `packages/platform` | The blueprint names; the platform wires (T2 to T8) |
| Starting worlds | In | Typed steps with their payloads, not prose (7.2) |
| The pipeline's own work | In | Declared operations in the same format (T5, B2a): world make, reset, snapshot save and restore, site claim, starting-world make, journey, run, **and the checks themselves** (part 3). Work no door serves has no Rpc but has steps, logs and a budget |
| Ratchets | In | Each ratchet declared once (part 4) |
| Budgets | The target is in. Whether it is measured, its basis and its p95 are generated from verdicts, never typed | |
| Frappe | In: Capxul's names on a site (`site.ts`), and per primitive which side owns each fact, the key that reconciles them and how their lifecycles line up. Out: Frappe's own doctype schemas | The Python module stays generated |
| Contract interfaces | Out: the compiled contracts own them (3.1), and the blueprint imports the generated ABI. In: which chain logs become which events, which reverts become which refusals | |
| Limits and settings a caller can see | In: quotas, lifetimes, the timeouts lifecycle rule 6 calls declared settings | |
| Account identity | In: grade groups, account version, chain id per grade, the email's normalisation, the derivation | |
| Proof names and the verdict schema | In, beside the pipeline's work (moved from the runner, where `proof-and-telemetry.md` placed them) | |
| Handlers, SQL, infrastructure (what runs where, sizes, resources), design reasoning | Out, always | Reasoning lives in the roadmap |

## 3. How drift fails: eight layers (decision 2)

**Agreed with Aaron, 15 November 2026**, with coverage option B and every layer instrumented and budgeted. A drift is a disagreement between the blueprint and the code that nothing fails. Each layer catches a
different kind.

| # | Layer | What fails | Where it runs | Today |
|---|---|---|---|---|
| 1 | Generate | A derived file that generating again would change: indexes and operation pages, `claims.md`, SQL CHECK constraints (a change of states with no new migration), Python names, attribute constants, the dataset list and routing table, Axiom's field descriptions, monitors and dashboards, the measured-facts file | `pnpm generate:check`, rung 2 | Partly (3.1) |
| 2 | Lint | A declared name written as a string (operation, event, refusal, state, step, attribute, metric, log); `Effect.fn` or `withSpan` without a declared step; a raw schema outside values files, machines and listed edges | rung 3 | Partly (#262) |
| 3 | Types | A handler that emits an event, opens a step, writes a log or makes a machine move its operation does not declare | rung 4 | Events only |
| 4 | Delta check | An operation missing a part of its format; a ratchet whose list grew | `pnpm delta:check`, rung 5 | Being built (#262) |
| 5 | Self-consistency | An unreachable state, an example that does not decode, a claim naming something undeclared, a domain missing from a hub | rung 5 | Mostly exists |
| 6 | Run time, closed vocabulary | On every call of every journey: an undeclared span, attribute, log or event (library spans allowed by instrumentation scope); a declared step missing on a path that ran; an event off its machine's path; a refusal with no deciding log; a caller outside `allowed` let through | rung 6, read from the tap | Partly |
| 7 | Confirm | Anything in Axiom the blueprint does not declare (fields, span or event names), or a field dropped at ingest: the run's verdict does not count, and a daily job raises a task | After each CI run; daily | Not built (4.4, 4.5) |
| 8 | Watch | Layers 6 and 7 on what staging and production record after a deploy; a failure is a finding raised as a task | After each deploy | Not built |

**A behaviour change with no blueprint change.** New observable behaviour (a refusal, event, move, step or log) fails
at layer 3, 2 or 6, because the vocabulary is closed. Different behaviour inside the declared vocabulary is caught by
the journeys and claims, written from the blueprint by a different agent from the builder. What is left is a
declaration no journey reaches: ratchet R9.

**Measured facts** are written by the proving job from verdicts into a generated file that names the digests of the
verdicts it came from; a check fails a number that does not match its verdict.

### What the checks cost, and how they are instrumented

Aaron's question (15 November 2026): how long do the layers take, and should they not be instrumented themselves?
They should. **Every layer is declared pipeline work**, in the same format as an operation: its steps, its logs, its
budget. Each emits spans through the same door as everything else, so every second a check takes is on the record,
and the checks have budgets that the run's 10 minutes must hold.

| Layer | Cost today, measured | Where it sits | Provisional budget | How it is instrumented |
|---|---|---|---|---|
| 1 to 5, the gate | 2 min 39 s for the whole job on `master` (`check` run 43710528109): setup and install 38 s, shape and format under 1 s, generate 2 s, lint 23 s, types 24 s, test 67 s | Every pull request, before any world | 3 min for the job; new rules add seconds (oxlint rules and the delta check are in-process) | `pnpm check` becomes one Effect entry that runs each rung as a declared step, exporting its trace to the door with the CI run's attributes. A rung's time is then a query, and a slow rung is a finding |
| 6, run time | The runner's own read-back is already one batched query per call's traces (`database.telemetry`). The cost is elsewhere: the scenarios' observation reads, about 7 minutes of a run (F11) | Inside the run | 30 s of a run's critical path | Checks become pure functions over the tap's spans and logs, read in one batch per journey step, and judged while the next step runs. Each check is a span (`capxul.check`), with its outcome. Observation reads are shared per try (speed change 6, the scenario author's work) |
| 7, confirm | Not built | After the journeys, during teardown | 60 s, off the critical path unless ingest is late | One query per run to Axiom, itself a span; the receipt counts go into the verdict |
| 8, watch | Not built | After a deploy | Off every path | A scheduled job, a span per check, its cost on the cost dashboard |

There is no regress: checking a check is layer 6 over the runner's own spans, which produces no new verdict.

**Coverage, R9: option B, agreed with Aaron, 15 November 2026.** Every newly declared move, refusal and outcome must be
reached by a journey before its slice merges into `master`; existing declarations sit on R9's list, which may only
shrink. This changes "Coverage is not a gate" in `AGENTS.md` (option A, coverage as a report only, was not chosen).

## 4. The hill: ratchets and measures

**Agreed with Aaron, 15 November 2026**, the registry and the fourteen ratchets as listed. Old code is never moved in one go. Each gap is a ratchet: declared once in the blueprint (its name, what
it counts, the command that counts it, its current list, the step that closes it), checked by one command,
`pnpm ratchets`, on every pull request (a list that grew fails; a list that shrank must be committed smaller), and
emitted as a metric (`capxul.ratchet.remaining`) so the dashboard shows every ratchet's line falling. A ratchet closes
when its list is empty, and its rule then becomes an ordinary check with no list. Moving an item off a list changes no
behaviour: every journey stays green.

| # | Ratchet | What its list holds | Today | Closes in |
|---|---|---|---|---|
| R1 | Raw schemas | Raw schemas outside values files, machines and listed edges | #262's `unmigrated` list | 3.3 |
| R2 | Names typed as strings | Declared names retyped as strings | #262's list | 3.3 |
| R3 | Rows not decoded | Stored rows cast to hand-written types instead of decoded with the blueprint's schemas | #262's list | 3.3 |
| R4 | Lifecycles not machines | Things with a lifecycle not yet declared as machines (site, approval, world, budget; the invitation is done by #262 and moves into the new format) | Roadmap "Other lifecycles" | 7.3 |
| R5 | Operations not in the full format | Operations missing a part: machine moves, `allowed`, steps, logs, deciding logs, budget | Every operation | 3.5, 4.1, 5.1 |
| R6 | Undeclared spans | Effectful functions of our own code without a declared step: Core, the world, the platform client, the runner's plumbing (176 span names) | Not counted yet | 4.1 |
| R7 | Operations not in one file | Operations still split across `operations.ts`, `refusals.ts`, `claims.ts`, `subjects.ts`, `order.md` | Every operation | Decision 3 |
| R8 | Long or hand-mapped docs | READMEs over one screen (60 lines); hand-written file maps; `decisions.md`, `gaps.md`, `order.md` not folded | Core, runner, platform, world READMEs (222 to 607 lines) | Decision 3 |
| R9 | Unreached declarations | Declared moves, refusals and outcomes no journey reaches | Coverage report | If option B |
| R10 | Non-Effect code | Non-Effect constructs outside entry files; non-Effect runtime dependencies (the two counts agreed on 13 November 2026) | Counted by lint | Phase 7 |
| R11 | Untyped starting worlds | Starting-world steps in prose, payloads retyped in the runner | 7 starting worlds | 7.2 |
| R12 | Proofs by file path | Proof column entries naming files, steps not yet Done | Every open step | 4.5 |
| R13 | Provisional budgets | Budgets not yet set from a measured verdict | Every budget | 4.1 and the measured runs |
| R14 | Own telemetry tables | `app.spans` readers and the runner's JSON records beside OTLP | Core, runner | 4.4 |

**Measures, climbed by trend, never a gate until the data sets a threshold:**

| Measure | Now | Target |
|---|---|---|
| A world run's wall time | 36 min quiet, 50 slow | 10 min (Aaron) |
| The gate's wall time | 2 min 39 s | Under 3 min while the rules grow |
| Explainability: the share of a run's wall time inside declared spans, every refusal with its log, every span with its parent (4.2) | Not measured; about half of a snapshot save is in no named span | Threshold set from data, then a gate |
| Tries to green per unit of work; breakage and recovery (4.3) | Not measured | Trend |
| Cost per journey and per day | Not measured | Under the $10 a day cap; trend |

## 5. The path (decision 6)

**Agreed with Aaron, 15 November 2026.** Each stage starts when what it needs is on `master`.

| Stage | What it delivers | Needs | Who |
|---|---|---|---|
| 0. Design | Decisions 2 to 6 agreed and written here | — | This session, with Aaron |
| 1. Land what is in flight | #262 (3.3 to 3.5), lane A's 3.2, the speed lane's two changes | — | The conductor |
| 2. The format, `slice/blueprint` | The one-file-per-operation format holding every part; the cycle removed so machines import their operations and events; the telemetry module; the pipeline section, its operations declared (not yet instrumented); the ratchet registry and `pnpm ratchets`, every ratchet registered with today's count; the generated indexes; one domain (`people`, which already has its machine) moved in full as the proof; journeys and checks written first by another agent; the roadmap, `AGENTS.md` and this restack landed in the same work | 0, 1 | A lead on `slice/blueprint` |
| 3a. Ratchet lanes | One lane per group of domains, moving operations into the format (R5, R7), machines (R4), names and schemas (R1 to R3), docs (R8). No behaviour change; every journey stays green | 2 | Leads, in parallel |
| 3b. Instrumentation lane, `slice/telemetry` | 4.4 (OTLP out, the door, the tap side by side with `app.spans`, then flipped), the pipeline's work instrumented to its declarations (R6 for the world and runner), the gate's rungs as spans, 4.1's lint rule | 2 (4.4's door can start at 1) | One lead |
| 3c. Proof lane | 4.5 (verdicts on `proofs`, `prove.yml`, the Proof column by name, R12) and 4.6 (cost) | 3b's 4.4 | One lead |
| 3d. Speed | The speed note's changes 3 to 6, then lanes of worlds if decision 4 allows, measured by 3b's spans | 3b | One lead |
| 4. Accounts pilot (5.1, 5.2) | The first feature born in the new format, through the whole loop | 2, 4.1's lint rule | One lead |
| 5. Invoice ledger (6.1, 6.2) | Side by side, flip, retire | 4 | One lead |
| 6. Breadth (7.1 to 7.3) | Journeys ported in waves; R4 and R11 to zero | 2, 3a under way | Leads |

**Roadmap changes this brings, to be landed in stage 2:** new decisions for parts 2, 3 and 4 and for decisions 3 to 5;
phase 4 gains 4.4 to 4.6 as `proof-and-telemetry.md` §11 proposes; 4.1 rewritten for the telemetry model (F8); a new
step for the format and the ratchet registry; "Coverage is not a gate" changed if option B is chosen. **`AGENTS.md`:**
"run records" become verdicts and telemetry (F6); "Who owns each fact" names one file per operation; the ladder gains
`pnpm ratchets` and `pnpm delta:check`; the ratchet rule names the registry.

## 6. Decisions still open, with recommendations

| # | Decision | Recommendation | State |
|---|---|---|---|
| 1 | Purpose and boundary | Option B, part 2 | **Agreed**, 15 November 2026 |
| — | Account version | Keep it as the "Account identity" decision records it: it changes only when an input of the derivation changes (the salt rule, the Safe factory, its singleton or module, the starting owner), not with the protocol's major version, so a person's Safe address survives releases that do not touch it. Replaces Aaron's first request for a salt versioned to the protocol's major version | **Agreed**, 15 November 2026 |
| 2 | No drift as checks | The eight layers, each instrumented and budgeted (part 3); coverage option B; measured facts generated from verdict digests; the ratchet registry (part 4) | **Agreed**, 15 November 2026 |
| 3 | The shape | Part 7, with its three choices as recommended | **Agreed**, 15 November 2026 |
| 4 | The pipeline as operations | Part 8 | Proposed |
| 5 | Telemetry in the blueprint | One telemetry module as `telemetry-in-the-blueprint.md` part 3B describes, with T1 to T8 as agreed | Not started |
| 6 | The sequence | Part 5 | **Agreed**, 15 November 2026 |

## 7. The shape: the blueprint, the repository and its docs (decision 3)

**Agreed with Aaron, 15 November 2026**, with its three choices as recommended. This section is the rule the docs session follows for every file it moves.

### Three levels, for every reader

A reader stops at the level that answers them.

1. **One screen** (60 lines at most, checked by `pnpm shape`): a README says what this is, links to the map, and says
   where to go for what. It lists no files by hand.
2. **A map, generated**: an `index.md` per package and per blueprint domain, written by `pnpm generate` from the code,
   one line per thing. Nothing hand-written lists files, operations or domains, so no map can drift.
3. **The thing itself**: an operation's file and its generated page, a package's source, a one-task doc page.

### The blueprint

Each domain has the same files. Shared nouns live at the domain's level, so machines and operations import each other
in one direction only and the import cycle of today's machine format is gone (F7):

```
packages/blueprint/
  README.md                 one screen
  src/
    format/                 the language: operation, machine, role, step, log, ratchet, starting world
    telemetry/              the vocabulary (decision 5)
    roles.ts                every role, once
    pipeline/               the pipeline's own work, the checks, the proofs, the ratchet registry: a domain like any other
    <domain>/
      values.ts             its values (subjects folded in)
      events.ts             its events
      refusals.ts           its refusals, with exit codes
      machines.ts           its machines: states and moves; each move names its event, imported from events.ts
      <operation>.ts        one per operation, everything about it: rpc, outcomes and their events, refusals,
                            the moves it makes (imported from machines.ts), allowed, steps, logs, budget,
                            examples, claims
    generated/              hubs: every domain, every operation, every refusal, the Rpc groups. Written, never edited
  generated/                index.md, one index.md per domain, one page per operation with its machine's diagram
```

Imports run one way: `values` → `events`, `refusals` → `machines` → `<operation>`. A move does not name the operation
that makes it; the operation names the move, and a test checks that every move is made by some operation. An operation's
file is named after the operation (`invite.accept` is `invite-accept.ts`, as the scenarios already name their checks).
The hand-written hubs (`domains.ts`, `errors.ts`, the gathering in `values.ts`, each `domain.ts`) become generated, so a
new domain or operation is a new file and nothing else. Folded away: `claims.ts` and `subjects.ts` (into the operation
and `values.ts`), `claims.md` and `order.md` (generated pages), the package's `decisions.md` (its design calls become
comments on the declarations they explain; any that are roadmap decisions move to `docs/decisions.md`), `gaps.md`
(coverage, R9).

### The repository's top level

```
README.md            one screen: what Capxul is, the map, where to go
AGENTS.md            the rules, and only the rules (CLAUDE.md links to it); reasons and detail live in docs/
docs/
  roadmap.md         the goal, phases and steps
  decisions.md       every decision Aaron agreed, dated, one entry each (moved out of the roadmap)
  design/            design notes: one per question, a status line at the top (open, agreed, superseded);
                     agreed and superseded notes stay as the reasoning behind a decision, linked from it
  guides/            how-to pages for work across packages, one task each
packages/<name>/
  README.md          one screen
  generated/index.md the map, generated
  docs/              the package's own how-to pages, one task each (what today's long READMEs hold)
spikes/              temporary code, each with a README
```

Run records under `packages/*/records/` are frozen from the proof lane's flip (R12, R14) and get no new files.

### What checks it

- `pnpm shape`: the top level and `docs/` as listed above; a README over 60 lines (R8 until the long ones are cut);
  every package and spike with a README; every package with a generated index.
- `pnpm generate:check`: every index, page and hub up to date.
- A test fails an operation file that names a hand-written list of files, or a README that lists files.

**Options weighed.**

- **Where events and refusals live:** in the domain's `events.ts` and `refusals.ts` (recommended), or inside the
  operation that first sends them. Several operations share events and refusals (`approval_signed`,
  `InvitationClosed`), and machines need them, so putting them in an operation's file makes operations import each
  other and brings the cycle back.
- **`AGENTS.md`:** the rules only, with reasons in `docs/` (recommended), or as today, rules and reasons together at
  about 250 lines. Every agent loads it on every turn, so its length is paid on every turn.
- **Decisions:** in their own `docs/decisions.md` (recommended), or kept in the roadmap's table. The roadmap is 54 KB,
  mostly that table.

## 8. The pipeline as operations, and the 10-minute run (decision 4)

**Proposed, not yet agreed.**

### What is declared

The pipeline is the blueprint domain `pipeline`, in the shape of part 7. Operations a door already serves stay in their
domain (`world.create`, `world.snapshot.save`, `world.snapshot.restore`, `world.show`). Everything else the pipeline
does becomes a declared operation with no Rpc: its steps, logs, budget and the refusals it can end in.

| Operation | What it is | Its steps (kinds) | Today |
|---|---|---|---|
| `run` | One CI or container run, from start to verdict. Its budget is the run's 10 minutes | the operations below | The runner's `oneWorld.timings`, partly spanned |
| `run.prepare` | Make the run's worlds and get each its starting worlds | deploy, branch, container, restore | Ad hoc spans in the runner and `packages/world` |
| `world.reset` | Reset a world in place to a snapshot | database, chain, index, clock, site, deploy | `world reset`, spanned by part |
| `site.claim`, `site.save`, `site.reset` | A world's company sites from the bench's pool | site, poll | The site door's calls, partly spanned |
| `starting-world.make` | The one generic maker of a starting world from its typed steps (7.2, R11) | the steps' own operations, wait | `packages/runner/src/worlds/*`, by hand |
| `journey` | One journey: its reset, its steps, its checks | reset, the operations it calls, check | Runner spans |
| `check.gate`, `check.call`, `check.confirm`, `check.watch` | The layers of part 3 | one step per rung or check | Not spanned |
| `run.verdict` | Write the verdict, set the check, archive the telemetry (4.5) | chain of writes, upload | Not built |
| `run.teardown`, `world.sweep` | Destroy what the run made; sweep what expired | deploy, branch, site | Spanned in part |
| `ratchets.count` | Count every ratchet (part 4) | one step per ratchet | Not built |

Journeys are named in the blueprint too, each with its starting world, so their names are imported wherever they are
used (the proof names, `capxul.journey`, coverage). Their steps stay the scenario author's, in `packages/scenarios`.

### The 10-minute budget, broken down

Provisional, as every budget is until measured. These are the speed note's projections, not measurements.

| Part | Budget | Today (quiet run) |
|---|---|---|
| CI outside the runner | 0.5 min | 0.7 min |
| `run.prepare`: worlds and starting worlds | 2 min | about 9 min (`make founded` 6 min, starting worlds, saves) |
| Journeys, the longest lane | 6 min | 20 min of journeys plus 3 min of resets, one after another |
| `check.confirm` and `run.verdict` | 0.5 min | not built |
| `run.teardown` | 1 min | about 1 min |
| **The run** | **10 min** | **36 min** |

### How the run gets there: lanes of worlds

The speed note's changes 1 to 6 bring a quiet run to about 18 minutes and keep one world. The rest needs journeys side
by side, which "One runner, one world" (14 November 2026) forbids.

- **A. Keep one world.** About 18 minutes is the floor. The 10-minute budget is out of reach.
- **B. Lanes of worlds, by a ratchet (recommended).** A run splits its journeys across K worlds, one lane each. Each
  lane makes its world and restores the run's saved starting worlds into it, all lanes at once. K starts at 2 and rises
  while four measures hold: the hub's admission waits, the site door's 5xx answers, the green rate, and the daily
  spend. Each lane has its own owner, because the quota journeys fill one owner's 5 worlds. The hub's 24 places hold
  about three lanes of one run, so `fleet`'s capacity rises, or each run gets its own hub. Projected: the longest lane
  6 to 7 minutes, the run 10 to 11. It starts only after changes 1 to 6 have landed and the pipeline's operations are
  instrumented, so K is raised on measured runs.
- **C. A world per journey, all at once.** The fastest on paper. It multiplies the bench's and the hub's load by the
  number of journeys at once, so it is not for now.

`founded` kept as a template across runs (the speed note's change 8) is not proposed: after change 1 it is worth about
a minute, and it changes "Bench templates never change" and the world lifecycle rules.

**What this changes in the roadmap:** "One runner, one world" becomes "One runner, K worlds": a run's journeys run in
lanes, each lane one world reset in place between its journeys, K raised by the four measures. The speed lane (stage
3d) builds it.
