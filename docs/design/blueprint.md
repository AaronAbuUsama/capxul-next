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
| R15 | Old words | The glossary's old words still written as names in code, counted per word by `pnpm words` (`generated/old-words.json`) | Every package | 3.8 |

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
| 2a. The move, `slice/blueprint` | Every file of `packages/blueprint` moved at once into part 7's layout, in one mechanical pull request with no change of behaviour: the language in `src/format/`, `src/telemetry/`, the checks' code in `src/pipeline/`, one folder per product domain with `values.ts`, `events.ts`, `refusals.ts` and `machines.ts` split out, the hand-written hubs generated into `src/generated/`, `door.ts` the only entry; the package's markdown folded as part 7 says; a one-screen README with a generated index; a check that fails anything later landing outside the layout. Every journey stays green. The full move table is shown to Aaron before it is built | 0, 1 | A lead on `slice/blueprint` |
| 2b. The format, `slice/blueprint` | The one-file-per-operation format holding every part; the cycle removed so machines import their operations and events; the telemetry module; the pipeline section, its operations declared (not yet instrumented); the ratchet registry and `pnpm ratchets`, every ratchet registered with today's count; the generated indexes; one domain (`people`, which already has its machine) moved in full as the proof; journeys and checks written first by another agent; the roadmap, `AGENTS.md` and this restack landed in the same work | 2a | A lead on `slice/blueprint` |
| 3a. Ratchet lanes | One lane per group of domains, moving operations into their own files inside folders already right since 2a, into the format (R5, R7), machines (R4), names and schemas (R1 to R3), docs (R8). No behaviour change; every journey stays green | 2 | Leads, in parallel |
| 3b. Instrumentation lane, `slice/telemetry` | 4.4 (OTLP out, the door, the tap side by side with `app.spans`, then flipped), the pipeline's work instrumented to its declarations (R6 for the world and runner), the gate's rungs as spans, 4.1's lint rule | 2 (4.4's door can start at 1) | One lead |
| 3c. Proof lane | 4.5 (verdicts on `proofs`, `prove.yml`, the Proof column by name, R12) and 4.6 (cost) | 3b's 4.4 | One lead |
| 3d. Speed | The speed note's changes 3 to 6, then lanes of worlds if decision 4 allows, measured by 3b's spans | 3b | One lead |
| 4. Accounts pilot (5.1, 5.2) | The first feature born in the new format, through the whole loop | 2, 4.1's lint rule | One lead |
| 5. Invoice ledger (6.1, 6.2) | Side by side, flip, retire | 4 | One lead |
| 6. Breadth (7.1 to 7.3) | Journeys ported in waves; R4 and R11 to zero | 2, 3a under way | Leads |

**Stage 2 split in two, 15 November 2026** (Aaron, through the conductor): moving only `people` while the rest waited
for the ratchet lanes would have left the package more mixed for a while, so the whole reshape lands first, on its own
(2a), and everything after it follows the new layout (2b, 3a). Everything inside `packages/blueprint`, its README and
markdown included, belongs to the blueprint session; the docs session owns the rest of the repository's docs and follows
part 7.

**Roadmap changes this brings, to be landed in stage 2:** new decisions for parts 2, 3 and 4 and for decisions 3 to 5;
phase 4 gains 4.4 to 4.6 as `proof-and-telemetry.md` §11 proposes; 4.1 rewritten for the telemetry model (F8); a new
step for the format and the ratchet registry; "Coverage is not a gate" changed if option B is chosen. **`AGENTS.md`:**
"run records" become verdicts and telemetry (F6); "Who owns each fact" names one file per operation; the ladder gains
`pnpm ratchets` and `pnpm delta:check`; the ratchet rule names the registry.

### Where it stands (15 November 2026, evening)

Written at the hand-over from the Claude blueprint thread, so an agent that never saw that thread can continue from
this section and the parts it names.

**Landed on `master`.** The design and every decision in this file: parts 1 to 14 (#275 the restack, #281 things then
verbs, the glossary and the CLI, #283 the climb and "no callers, no compatibility"), part 15 the triage backlog and
the declined speed option (#306, this pull request).

**On `slice/blueprint`, not yet on `master`.** Stage 2a, the move into part 13's layout (#282 the layout record, #291
the move: `src/things/<thing>/<verb>.ts`, `src/common/`, `src/starting-points/`, `src/protocol/`, `src/generated/`, the
new package `packages/blueprint-tools`, `src/index.ts` as the entry). Its pull request into `master` is **#295**: it passed the 🔍 reviewer, and `gate` and `thin-line` on head
`adcb697`. `master` then moved (the world-layout slice and others), so `master` was merged into `slice/blueprint` again
at `77f94ff` (one conflict, `packages/generate/src/main.ts`, resolved by keeping both: the blueprint's generated indexes
and the world's generated map; `pnpm check` passes locally), and `gate` and `thin-line` were re-running on that head
at hand-over. To land it: confirm both green on the head that includes the current `master`, check #295 is not
conflicting, merge. If `master` moved again, merge it into the slice first and wait once more.

**Open pull requests into `slice/blueprint`** (each green on its own; held only so that #295's head did not move under
its journey run and review; merge each after #295 lands, then merge `master` into the slice again):

| PR | Branch | What | Note |
|---|---|---|---|
| #299 | `work/ratchets` | The ratchet registry (`packages/blueprint/src/ratchets.ts`, R1 to R14), `pnpm ratchets` in `gate`, the generated scorecard `packages/blueprint/generated/scorecard.md` (items 3.6 part, 3.11) | R13 deliberately not counted (every new verb starts provisional) |
| #301 | `work/telemetry-pipeline` | `packages/blueprint/src/telemetry/` (conventions pinned 1.37.0, envelope, producers, step kinds, metrics, datasets, monitors) and the pipeline's things as "work no door serves" (`blueprint-tools/src/language/work.ts`) | Follow-up below |
| #302 | `work/glossary` | `packages/blueprint/src/glossary.ts`, the generated glossary page, the old-words count `pnpm words` in `gate` (item 3.8, first part) | Follow-up below |

**Next steps of stage 2, in order.**

1. Land #295, then #299, #301 and #302 into the slice (resolve their conflicts with each other in the generated files
   and `packages/generate/src/sources.ts` by regenerating).
2. A small follow-up into the slice, decided by the lead within the agreed decisions:
   - add the step kind `compute` for work done in-process (gate rungs, call checks, ratchet counting), and use it where
     #301 used `container`;
   - rename the pipeline verb `run.run` to `run.start`, matching the CLI `capxul run start`;
   - add a glossary entry `claim`: claiming a person's Safe (it stays "claim"; part 12's promise row says so), so the
     old-word count of `claim` covers only the renamed meanings;
   - count `lane` only in `packages/runner` (where it means a shard); leave `step` to R6;
   - fix the old blueprint paths in `docs/roadmap.md` (the "Facts typed twice" table and items 3.3 to 3.5).
3. Fold `packages/blueprint/docs/decisions.md` and `gaps.md` (moved unchanged by #291): each decision becomes a comment
   on the declaration it explains, a roadmap decision, or is dropped when superseded; gaps go to ratchet R9.
4. Stage 2b and item 3.10: every format in the toolkit, proven end to end on the invitation (lifecycle, who may call,
   spans and logs, budget, promises, telemetry names). Remove the toolkit's relative import of the blueprint
   (`blueprint-tools` reads `../../../blueprint/src/index.ts` to avoid a package cycle) by having the blueprint pass
   itself to the checks; write the pages inside `pnpm generate`; drop the hand-written domain table in
   `packages/generate/src/sources.ts` once the renames of 3.8 land.
5. Items 3.7 (the coverage gate) and 3.9 (the CLI's grammar), then the slice into `master`, then the climb (phase C).

**Open decisions.** None waits on Aaron in this design. Within the climb, each thing's states are agreed with Aaron as
they are declared where today's lists disagree or were never written: the site's "unreachable", the approval's states.
The two roadmap candidates of part 15 (a world-time lint rule; the site joining the trace) go to Aaron at the next
restack.

**Backlog.** Part 15 (14 ideas from the triage, each with its source pull request).

## 6. Decisions still open, with recommendations

| # | Decision | Recommendation | State |
|---|---|---|---|
| 1 | Purpose and boundary | Option B, part 2 | **Agreed**, 15 November 2026 |
| — | Account version | Keep it as the "Account identity" decision records it: it changes only when an input of the derivation changes (the salt rule, the Safe factory, its singleton or module, the starting owner), not with the protocol's major version, so a person's Safe address survives releases that do not touch it. Replaces Aaron's first request for a salt versioned to the protocol's major version | **Agreed**, 15 November 2026 |
| 2 | No drift as checks | The eight layers, each instrumented and budgeted (part 3); coverage option B; measured facts generated from verdict digests; the ratchet registry (part 4) | **Agreed**, 15 November 2026 |
| 3 | The shape | Part 7, with its three choices as recommended | **Agreed**, 15 November 2026 |
| 4 | The pipeline as operations | Part 8: the operations as listed, journeys named in the blueprint, the 10-minute breakdown, lanes of worlds (option B). A budget is a target, not a gate | **Agreed**, 15 November 2026 |
| 5 | Telemetry in the blueprint | Part 10, with its five points as recommended | **Agreed**, 15 November 2026 |
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

**Agreed with Aaron, 15 November 2026**: the operations as listed, journeys named in the blueprint, the breakdown below
as the provisional budget, and lanes of worlds (option B), which changes "One runner, one world".

**A budget is a target, not a gate** (Aaron, 15 November 2026). Nothing fails on speed. A run within striking distance
of its budget is fine; a run far over it is a reason to look at the architecture, not to fail the work. Agreed rule
for "far over" (Aaron, 15 November 2026): when the measured p95 of an operation, or of the whole run, is over 1.5 times its budget (15 minutes for
the run), the cost job raises an architecture review as a task, naming the parts that grew.

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

**Declined by Aaron, 15 November 2026:** keeping `founded` across runs (the speed note's change 8): "no to keeping
founded". "Bench templates never change" stands as it is.

**What this changes in the roadmap:** "One runner, one world" becomes "One runner, K worlds": a run's journeys run in
lanes, each lane one world reset in place between its journeys, K raised by the four measures. The speed lane (stage
3d) builds it.

## 9. What it looks like

**Agreed with Aaron, 15 November 2026, as the format's shape.** The names of the format's functions (`operation`,
`work`, `step`, `log`) are illustrative: stage 2 settles them. What the sketch fixes is what each file holds and in
what order things are imported.

### A pipeline operation: `src/pipeline/world-reset.ts`

```ts
// world.reset: put a world back to a saved snapshot, in place, with one clock.
import { budget, log, step, work } from "../format/door.ts";
import { StepKind } from "../telemetry/door.ts";
import { operator } from "../roles.ts";
import { SnapshotName, WorldName } from "../world/values.ts";
import { ResetPart, ResetReason } from "./values.ts";
import { WorldReset } from "./events.ts";
import { ResetFailed, SnapshotNotFound } from "./refusals.ts";

/** Its steps, in the order a reset runs them. These names exist nowhere else: code imports them. */
export const steps = {
  stopIndex: step("world.reset.index.stop", StepKind.container),
  database: step("world.reset.database", StepKind.branch),
  chain: step("world.reset.chain", StepKind.chain),
  clock: step("world.reset.clock", StepKind.chain),
  sites: step("world.reset.sites", StepKind.site),
  core: step("world.reset.core", StepKind.deploy),
  resumeIndex: step("world.reset.index.resume", StepKind.container),
  ready: step("world.reset.ready", StepKind.poll),
};

/** Its logs, each with a schema. `refused` is written where a refusal is decided, naming why. */
export const logs = {
  refused: log("world.reset.refused", { world: WorldName, snapshot: SnapshotName, reason: ResetReason }),
  partFailed: log("world.reset.part_failed", { world: WorldName, part: ResetPart }),
};

export const worldReset = work({
  name: "world.reset",
  allowed: [operator.ownerOfTheWorld],
  payload: { world: WorldName, to: SnapshotName },
  emits: [WorldReset],
  refusals: { SnapshotNotFound: logs.refused, ResetFailed: logs.partFailed },
  steps: Object.values(steps),
  budget: budget({ ms: 15_000 }), // the target; measured p95 and basis are generated, never typed
  examples: [{ payload: { world: "w-lane-1", to: "founded" } }],
});
```

How `packages/world` uses it. The span's name and its kind come from the declaration; lint fails an `Effect.fn` with a
string, and the run-time check fails a reset whose record is missing a step that ran:

```ts
import { Pipeline } from "@capxul/blueprint";
const { steps, logs } = Pipeline.worldReset;

const restoreBranch = Step.fn(steps.database)(function* (world: World, to: Snapshot) {
  // ... Neon's restore, as today
});
```

### A product operation in the same format: `src/people/invite-accept.ts`

```ts
// invite.accept: the invitee accepts, and is a member at once.
import * as Rpc from "effect/rpc/Rpc";
import * as Schema from "effect/Schema";
import { budget, claim, emit, log, operation, step } from "../format/door.ts";
import { StepKind } from "../telemetry/door.ts";
import { person } from "../roles.ts";
import { NotImplemented } from "../errors/server.ts";
import { Invitation, InvitationId, Member, RefusalRule } from "./values.ts";
import { InvitationAccepted } from "./events.ts";
import { InvitationClosed, InvitationNotFound, NotYourInvitation } from "./refusals.ts";
import { Invitation as Lifecycle } from "./machines.ts";

export class Accepted extends Schema.TaggedClass<Accepted>()("Accepted", { invitation: Invitation, member: Member }) {}
export class AlreadyAccepted extends Schema.TaggedClass<AlreadyAccepted>()("AlreadyAccepted", {
  invitation: Invitation,
  member: Member,
}) {}

export const steps = {
  load: step("invite.accept.load", StepKind.database),
  write: step("invite.accept.write", StepKind.database),
};
export const logs = { refused: log("invite.accept.refused", { invitation: InvitationId, rule: RefusalRule }) };

export const inviteAccept = operation({
  rpc: Rpc.make("invite.accept", {
    payload: { invitation: InvitationId },
    success: Schema.Union([Accepted, AlreadyAccepted]),
    error: Schema.Union([InvitationNotFound, NotYourInvitation, InvitationClosed, NotImplemented]),
  }),
  allowed: [person.theInvitee],
  moves: [Lifecycle.moves.accept], // the machine's refusals from other states come with the move
  outcomes: {
    Accepted: [emit(InvitationAccepted, ({ success }) => ({ ...success.member, invitation: success.invitation.id }))],
    AlreadyAccepted: [],
  },
  refusals: { InvitationNotFound: logs.refused, NotYourInvitation: logs.refused, InvitationClosed: logs.refused },
  steps: Object.values(steps),
  budget: budget({ ms: 300, excludes: ["waking a parked world"] }),
  examples: [/* one per outcome */],
  claims: [claim("accepting a pending invitation makes the caller a member at once", { from: "invited" })],
});
```

Everything about `invite.accept` is in this one file. What it shares with other operations (the invitation's values,
its events, its refusals, its machine) is one import away, in the domain's four shared files.

### The generated page: `packages/blueprint/generated/pipeline/world-reset.md`

```md
<!-- Generated by pnpm generate from src/pipeline/world-reset.ts. Do not edit. -->
# world.reset
Put a world back to a saved snapshot, in place, with one clock.

| Budget | Measured p95 | From |
|---|---|---|
| 15 s (target) | 14.8 s | verdict sha256:3be1… of proof journeys/thin-line |

Steps: index.stop (container) → database (branch) → chain → clock (chain) → sites (site) → core (deploy)
→ index.resume (container) → ready (poll)
Refusals: SnapshotNotFound (logs world.reset.refused), ResetFailed (logs world.reset.part_failed)
Allowed: the world's owner. Called by: journey, run.prepare. Ratchets touching it: none.
```

### A run, as its trace reads in Axiom

```
run                                   budget 10 min
├─ run.prepare                        2 min
│  ├─ world.create            lane 1  ┐
│  ├─ world.create            lane 2  ├ at once
│  └─ starting-world.make founded     ┘
├─ lane 1 ─ journey "found Northwind"
│  ├─ world.reset → index.stop, database, chain, clock, sites, core, index.resume, ready
│  ├─ org.create          (caller span → Core's span → its declared steps)
│  │  └─ check.call       spans · events · machine path · deciding logs · allowed
│  └─ …
├─ lane 2 ─ journey "pay and branch" …
├─ check.confirm                       Axiom read back: nothing undeclared, receipts match
├─ run.verdict                         proofs branch, check proof/journeys, archive in R2
└─ run.teardown
```

Each line is a declared operation or step. A second not under one of them shows as unexplained time (4.2).

## 10. The telemetry model in the blueprint (decision 5)

**Agreed with Aaron, 15 November 2026**, with its five points as recommended. T1 to T8 of `telemetry-in-the-blueprint.md` are agreed already (Axiom Cloud; 12 datasets
in correlation groups; locked event schemas; conventions first for the envelope, product events in a typed events
dataset; a closed vocabulary; the pipeline's work declared; Claude Code's telemetry on, prompts and tool details off;
query-cost caps; one pinned conventions' version). This part says where each lives and settles what those decisions
left open.

### `src/telemetry/`, one file each

| File | Declares | Generated from it |
|---|---|---|
| `conventions.ts` | The OpenTelemetry semantic conventions' version, pinned (T8) | The schema URL on every producer's resource |
| `envelope.ts` | Every attribute stamped on every record: its name, convention or `capxul.*`, schema, who sets it | The constants producers import; the door's stamping; Axiom field descriptions |
| `producers.ts` | Each `service.name`: core, runner, world, platform client, sdk, cli, door, cost job, gate, agents' sessions | Each process's resource |
| `step-kinds.ts` | database, site, chain, bundler, wait, deploy, branch, container, restore, poll | `capxul.step.kind`; the waits a budget leaves out |
| `metrics.ts` | Each metric: name, type, unit, the tags it may carry | Effect `Metric` definitions; the metrics a check expects |
| `datasets.ts` | The 12 logical datasets (T2), by grade group and signal, and their correlation groups | The datasets `packages/platform` creates; the door's routing table |
| `watch.ts` | Monitors and dashboards over declared names: the 1.5× architecture review, a run over 15 minutes, refusal and error rates per operation, a ratchet that stopped falling, a missing daily cost heartbeat | Axiom monitor and dashboard JSON, applied by the platform's deploy |

Steps, logs and events stay in each operation's file and each domain's `events.ts` (part 7). The events dataset's field
manifest is generated from the event schemas; a field marked sensitive is never sent (the door drops it as a second
guard).

### The envelope

| Attribute | Name | Set by |
|---|---|---|
| Session | `session.id` (convention) | The caller's resource, checked by the door against its token |
| Grade | `deployment.environment.name` (convention) | The door |
| World, stage | `capxul.world`, `capxul.stage` | The door |
| Run, lane, journey, journey step, trusted | `capxul.run`, `capxul.lane`, `capxul.journey`, `capxul.journey.step`, `capxul.run.trusted` | The runner, carried in baggage |
| Code | `vcs.ref.head.revision`, `vcs.ref.head.name` (conventions) | Each producer, from its deploy |
| CI run | `cicd.pipeline.run.id` (convention) | The gate and the runner in CI |
| On an operation's span | `capxul.operation`, `capxul.operation.version`, `capxul.outcome`, `capxul.refusal`, `capxul.caller.role`, `capxul.budget.ms` | The operation's middleware |
| On a step's span | `capxul.step.kind` | `Step.fn` |
| On a check's span | `capxul.check`, `capxul.check.layer` | The checks |

**What this settles that was open:**

1. **The session's name.** `proof-and-telemetry.md` used `capxul.session`; T4 (conventions first) points to the
   convention `session.id`. Recommended: `session.id`, so Axiom types it and Claude Code's own records join on it.
2. **`capxul.lane`** is new, from decision 4.
3. **Monitors and dashboards are declared** in `watch.ts` and generated, never made by hand in the console; the
   console is only for locking the events datasets (T3).
4. **Metric tags are a closed list per metric**, so a metric cannot grow tags nobody declared.
5. **Refusals are not errors**, as `proof-and-telemetry.md` §4 says: a refusal leaves the span's status unset, with
   `capxul.outcome=refused` and `capxul.refusal`; only what nobody declared sets `ERROR`.

## 11. The restack: what changes in the roadmap and `AGENTS.md`

**Signed off by Aaron, 15 November 2026, and landed on `master` as a documents-only pull request ahead of the build.** Every decision above is agreed; this is their exact landing. Step numbers already
used elsewhere (3.1 to 3.5, 4.1 to 4.3, 5.1, 5.2) keep their numbers, so no reference breaks; new steps are added
after them.

### New decisions in the roadmap's table, each dated 15 November 2026

| Decision | In plain words | Amends |
|---|---|---|
| The blueprint's boundary | Part 2: the blueprint owns every fact two places must agree on or a check judges, unless a compiled source owns it better; never how or where | "One source for every fact" (extends) |
| No drift, in eight layers | Part 3: generate, lint, types, delta check, self-consistency, run time, confirm, watch; each layer is declared pipeline work, instrumented and budgeted | "Three kinds of check" (extends) |
| Coverage gates new declarations | Every newly declared move, refusal and outcome is reached by a journey before its slice merges into `master`; existing ones by ratchet R9 | `AGENTS.md`'s "coverage ... not a gate" |
| One registry of ratchets | Part 4: every ratchet declared once, `pnpm ratchets` on every pull request, each count a metric on the dashboard | "New formats by a ratchet" (extends) |
| Budgets are targets | Nothing fails on speed. A measured p95 over 1.5 times its budget raises an architecture review as a task. A run's budget is 10 minutes | "Measurement is declared" (makes "never enforced" permanent) |
| The shape | Part 7: three levels; one file per operation with four shared files per domain; generated hubs, indexes and pages; one-screen READMEs; `docs/decisions.md`; `AGENTS.md` holds rules only | `AGENTS.md`'s per-domain `machines.ts` and `steps.ts` |
| The pipeline is declared | Part 8: the pipeline's work is the blueprint domain `pipeline`; journeys are named in the blueprint | |
| One runner, K worlds | A run's journeys run in lanes, one world each, reset in place between journeys; K starts at 2 and rises while the hub's admission waits, the site door's 5xx answers, the green rate and the daily spend hold | "One runner, one world" (replaces) |
| Proof and telemetry | `proof-and-telemetry.md` §11's wording: emit, route, keep, confirm; proof is a CI verdict on `proofs`, notarised by a GitHub check; container runs are never proof; the sink is Axiom Cloud; CODEOWNERS on what judges the work | "Measurement is part of the contract" (run data in the sink and archive, not the repository) |
| Telemetry in the blueprint | Part 10: `src/telemetry/`, T1 to T8, `session.id`, `capxul.lane`, declared monitors, closed metric tags, refusals are not errors | |

### Steps added or changed

| Step | What | Needs |
|---|---|---|
| 3.6 (new) | The blueprint's format (part 7, part 9): one file per operation; machines import their events and operations name their moves; hubs, indexes and pages generated; `src/telemetry/`; the `pipeline` domain declared; the ratchet registry and `pnpm ratchets`, every ratchet counted; `people` moved in full; journeys and checks written first by another agent | 3.5 |
| 3.7 (new) | The coverage gate on new declarations, in `world.yml` at a slice's merge | 3.6 |
| 4.1 (changed) | As written, plus: logs through Effect's `Logger`; the generic checks over OpenTelemetry spans and logs; its run-time log checks need 4.4 | 3.3 |
| 4.2 (changed) | The explainability score covers the whole run's wall time, from the tap, written into the verdict | 4.1, 4.7 |
| 4.3 (changed) | Reads verdicts, the sink and the cost metrics | 4.2, 4.5, 4.6 |
| 4.4 (new) | Telemetry is OpenTelemetry: Effect's exporters, the door on `staging`, the test sink, the tap beside `app.spans`, then flipped and `app.spans` retired | 1.2 |
| 4.5 (new) | Proof is a verdict: verdicts on `proofs`, checks as notary, the archive in R2, `prove.yml`, the Proof column by name | 4.4 |
| 4.6 (new) | Cost measured daily per world, run, journey and lane, against the cap | 4.4 |
| 4.7 (new) | The pipeline instrumented: every pipeline operation's steps are spans of declared steps (R6 for the world, the runner and the platform client); the gate's rungs as spans | 3.6, 4.4 |
| 4.8 (new) | Lanes of worlds: a run in K worlds, K raised by its four measures | 4.7 |
| 5.2 (changed) | Needs 3.6 as well | 3.2, 3.5, 3.6, 4.1, 5.1 |
| 7.1 (changed) | Needs 3.6 as well | 3.1 to 3.6 |
| 7.4 (new) | Ratchets R7 and R8 empty: every operation in one file, every README one screen | 3.6 |

Phase 3 is Done when 3.1 to 3.7 are Done; phase 4 when 4.1 to 4.8 are.

### `AGENTS.md`

- "Three sources": what is proven is owned by verdicts, made only by CI; what happened is telemetry, in the sink.
- "Who owns each fact": one file per operation; telemetry names (the blueprint); where telemetry goes (`packages/world`,
  `packages/platform`); proofs and the verdict schema (the blueprint's `pipeline`); ratchets (the registry).
- "How it is measured": coverage gates new declarations; budgets are targets with the 1.5× review.
- The ladder: `pnpm ratchets` and `pnpm delta:check` in rung 5; rung 6 names `prove.yml` beside `world.yml`.
- The rules-only rewrite of `AGENTS.md` is the docs session's, following part 7; these are changes of fact it carries.

## 12. Things, then verbs; the names; the CLI (15 November 2026)

**Agreed with Aaron, 15 November 2026: the blueprint is organised as things, then verbs.** Capxul is made of things (a
company, a person, an invitation, a document, an approval, a budget, a payment; and, for building it, a world, a run,
a journey, a proof). Each thing has a life, and operations are the verbs done to it. The blueprint has one folder per
thing and one file per verb, the thing's lifecycle, values, events and refusals beside its verbs, and how an outside
system (Frappe, the chain) serves the thing kept with the thing. The command, the file, the docs page and the trace
share one shape: `capxul invitation accept` is `invitation/accept.ts`, the page "invitation › accept" and the span
`invitation.accept`. A new verb is a new file and a new thing a new folder, so new work lands in place without anyone
deciding where. The machinery that declares and checks the blueprint lives in a separate toolkit package. This amends
part 7, whose "domain folders" become thing folders; user-facing renames of operations go side by side, by ratchet.

**Decision 7, the names: agreed with Aaron, 15 November 2026, every recommendation as offered** (the glossary page
"Capxul Glossary"). One word, one meaning, owned by a glossary in the blueprint that folders, commands, docs and lint
take their words from; the rename runs as a ratchet, user-facing names side by side.

| Concept | Today | Becomes |
|---|---|---|
| The server that carries out a world's operations | core, Core | **api** (`packages/api`) |
| The address a world answers at | door, `CAPXUL_DOOR_URL`, `--at` | **endpoint** (the CLI takes `--world <name>`) |
| Calls outside any world; where a person's sign-in lives | platform (group), "at the platform" | **account** |
| One whole, isolated Capxul | world | **world** (kept) |
| Private, shared or real | grade | **grade** (kept) |
| Test or real | grade group | **realm** |
| A company's Frappe site | site | **site** (kept; other uses renamed) |
| A test world's people | cast | **cast** (kept) |
| Who owns and runs worlds | operator, owner | **operator** (the faucet's account is the **faucet**) |
| The shared containers worlds run on | hub, fleet, fleet hub | **cluster** |
| Its single address | the hub's door | **gateway** |
| What hosts company sites | platform, `packages/platform` | **sites** (`packages/sites`); **bench** stays Frappe's word |
| The bench service that makes, takes, saves and resets sites | site door | **site service** |
| The Capxul app's side that accepts signed calls | `door.py` | **site API** |
| Where telemetry is sent and routed | telemetry door | **collector** |
| A deployed instance of a stack | stage | **stage** (kept, internal) |
| A saved state of a world | snapshot, point, backup, chain snapshot | **snapshot** (a site's part: **site snapshot**) |
| A named state a journey begins from | starting world, template snapshot | **starting point** |
| A ready copy of a starting point's sites on the bench | template | **site template** |
| Giving a world sites from the pool | claim | **take** |
| Holding a world's name | claim | **reserve** |
| A written story of operations that must pass | journey, scenario | **journey** (`packages/journeys`) |
| What runs and judges journeys | runner | **runner** (kept); the thing it makes is a **run** |
| One world of a run's several | lane | **shard** |
| A sentence an operation guarantees | claim | **promise** |
| What judges one call or run | check | **check** (only this) |
| The pass every pull request clears | `pnpm check`, gate, ladder | **gate** (`pnpm gate`; its levels are rungs) |
| What a CI run proved | run record, proof record, verdict | **verdict** |
| A world's ordered history | record, `record.export` | **history** |
| A timed piece of work inside an operation | step (declared) | **span** |
| One move of a journey | step | **step** (journeys only) |
| A test world's own telemetry copy | tap | **tap** (kept) |
| The cluster's list of worlds | ledger | **registry** (ledger stays the invoice ledger) |
| The file other packages import from | `door.ts` | **`index.ts`** |
| The blueprint's gathering files | hubs | **generated index** |
| One line of the roadmap | step | **item** |
| A chain of roadmap items led by one lead | lane | **lane** (kept) |
| An integration branch for one effort | slice | **slice** (kept) |

**Decision 8, the CLI as the one surface: agreed with Aaron, 15 November 2026, every recommendation as offered.**
The CLI is Capxul's one surface, generated from the blueprint and the built code. It amends "One public surface,
Frappe where it owns the data".

1. **Grammar:** `capxul <thing> <verb>`, following things then verbs. `capxul login` signs into an account;
   `capxul use <world>` sets the current world, so `--world` may be left out; `--as <person>` acts as one of the cast.
   Output is a readable table on a terminal and JSON when piped or with `--json`; exit codes stay the blueprint's.
2. **The scripts become commands:** every `run.sh` job is a pipeline operation in the blueprint, and so a generated
   command (`capxul world create|destroy|reset|renew|sweep`, `capxul snapshot …`, `capxul cluster up|down|show`,
   `capxul sites deploy|drift`, `capxul run start --shards N`, `capxul journey run`, `capxul verdict show`). Build tools
   that are not operations of Capxul (the bench image's build, vendoring contract libraries, the one-off credential
   bootstrap) stay package scripts, each listed with its reason on a ratchet.
3. **Frappe, generated from its own metadata (option B):** the blueprint declares the generic verbs once (list, get,
   create, update, submit, cancel, amend, delete, run a report, call a function); `pnpm generate` reads every document
   type, field, report and function of the pinned app versions and writes typed commands under each app
   (`capxul erp purchase-invoice create`, `capxul hr leave-application submit`, `capxul crm lead list`). Permissions are
   Frappe's own, from the caller's hat on that company's site. Capxul's own things (invoices, payments, approvals) stay
   declared by hand. A coverage check lists every document type and function as exposed or not exposed with its
   reason, a list that may only shrink. Rejected: declaring everything by hand (never finishes); a raw passthrough
   (untyped, drifts).
4. **The Safe, through a `safe` thing whose verbs are generated from the contracts' ABI (option B):**
   `capxul safe call budgets.allocate --safe <safe> --args …`; Capxul checks the caller's roles allow that call on that
   Safe (5.1), turns it into an approval for the Safe's signers, and sends it through the bundler at the threshold.
   Authority is the caller's roles plus the Safe's own threshold, which the chain enforces; every call is in the
   world's history and traced. "Nobody calls the chain directly" becomes "nobody reaches the chain except through
   Capxul's `safe` verbs, within their roles". Rejected: signing only what Capxul proposes (too narrow); handing people
   their key (bypasses history, checks and telemetry).

**`notes.md`:** agreed with Aaron, 15 November 2026, to fold it into decisions 7 and 8 and delete the file in the
restack.

## 13. The blueprint's layout, locked (15 November 2026)

**Agreed with Aaron, 15 November 2026**, from the explorer "Blueprint Layout" (version 2): this is the layout stage 2a
moves the package into, and the layout every later piece of work lands in. The toolkit keeps the name
`blueprint-tools`. Directors are a thing of their own (`director/add`, `director/list`), apart from the board
(`board/set-threshold`).

**`packages/blueprint`: only facts about Capxul.**

| Path | Holds |
|---|---|
| `src/index.ts` | The one file other packages import from (was `src/door.ts`) |
| `src/things/<thing>/` | One thing: `values.ts`, `events.ts`, `refusals.ts`, `lifecycle.ts` where it has one, and one file per verb, `<verb>.ts`, holding its request and answer, refusals, outcomes, budget, examples and promises |
| `src/common/` | What several things use: `values.ts`, `ids.ts`, `refusals.ts`, `site.ts` (Capxul's names on a Frappe site), `chain/` (the logs and reads Capxul uses) |
| `src/starting-points/` | `points.ts`, the named states journeys begin from, and `facts.ts`, what each hands a journey |
| `src/protocol/` | How a call travels: `paths.ts`, `headers.ts`, `sign-in.ts`, `trace.ts` |
| `src/generated/` | Indexes written by `pnpm generate` (the things, the refusals, the subjects, the promises, each thing's hub). Never edited |
| `generated/` | `index.md` (every thing and its verbs) and one page per thing. Never edited |
| `docs/build-order.md` | One page, until each verb declares what it needs and the page is generated |
| `README.md` | One screen |

The thirteen things today, from the 26 operations: approval (sign), board (set-threshold), budget (create, show,
list), clock (warp), company (create), director (add, list), document (create, submit), history (export), invitation
(send, list, accept, decline; its lifecycle), member (grant, list), report (run), snapshot (save, restore, list,
delete), world (create, show, list).

**`packages/blueprint-tools`: how the blueprint is written and checked.** `src/language/` (operation, lifecycle,
promise, starting point, gather), `src/checks/` (the delta check, the formats, the declared names), `src/render/` (the
pages, run inside `pnpm generate`).

**What 2a does not do.** Operation names, event tags and identifiers keep today's words (`invite.accept`, `org`,
claims); the glossary's renames run on their own ratchet (item 3.8). No behaviour changes; every journey stays green.

**What keeps it.** A test fails a file under `src/` that does not fit: under `things/<thing>/` only `values.ts`,
`events.ts`, `refusals.ts`, `lifecycle.ts`, `examples.ts` (until 2b folds it) and verb files; only the folders above at
`src/`; markdown only in `generated/` and `docs/`.

## 14. Build the system, then climb, then breadth (15 November 2026)

**Agreed with Aaron, 15 November 2026.**

**Part 1: the blueprint system, complete and clean.** The machinery, not the product: the language with every format
it will need (thing, verb, lifecycle, who may call, spans and logs, budget, promises, telemetry names, glossary words,
the pipeline's things), the generators (indexes, pages, the CLI tree, SQL constraints, later the Frappe catalogue), the
checks (format, layout, lint, the closed vocabulary at run time) and the ratchet registry. Built as it should be, with no
shims for the old shape: old declarations sit on ratchet lists, they do not bend the format. Done when every format
exists, every ratchet is counted, a scorecard of every thing against every format is generated from the ratchet lists,
and one thing, the invitation, is in every format end to end (blueprint, generated code, API handler, journeys,
telemetry checks) with nothing drifting. Only once the whole system is working is the toolkit split off as a package
anyone could reuse.

**Part 2: the climb.** Everything that exists today is brought up to spec before breadth, in parallel lanes. The unit
is the thing: a lane takes a few things and brings each fully up to spec (its lifecycle declared and the API moving it
only through it, every format, the glossary's words, its spans declared and instrumented, journeys reaching every new
declaration). The lifecycles of every existing thing are pulled forward into the climb (they were item 7.3): world,
site, company setup, approval and document first; where today's states disagree or were never written down (the
site's "unreachable", the approval's states), they are agreed with Aaron as they are declared. The climb is done when
the scorecard is all green. It is run as a rehearsal of breadth, with the same machinery (a lead per lane, a journey
author apart from the builder, a thing per unit, lanes merging through slices) and measured as one: things brought to
spec per day, tries to green, conflicts between lanes, time waiting; breadth starts from those numbers.

**Then** the accounts pilot (phase 5), the invoice ledger (phase 6) and breadth (phase 7), in that order.

**No callers, no compatibility.** Agreed with Aaron, 15 November 2026: Capxul has no users yet, so until a real caller
exists (phase 8), existing operations are reshaped and renamed directly, with no side-by-side versions; the journey
author updates the journeys in the same lane. The aim is to cut over as quickly as possible: work merges fast into its
slice, and a slice reaches `master` only when every check passes (`gate` and `world`). "Side by side, then flip, then
retire" applies again from the first real caller.

## 15. Backlog: ideas routed from the pull-request triage (15 November 2026)

Routed by the conductor from the triage of the old wave-0 pull requests (`docs/design/pr-triage.md` on branch
`design/pr-triage`, draft #285), so that none is lost when those pull requests close. Nothing here is built yet; each is
placed where it fits, in the glossary's words.

**Blueprint candidates** (each lands with its thing in the climb, C.1, or as a later delta):

| # | Idea | Thing | Source |
|---|---|---|---|
| 1 | `approval.show` and `approval.decline`, with the event `approval_declined`: moves of the approval's lifecycle | approval | #166 |
| 2 | `approval.sign` never sends twice: after a lost answer, the send is found by its expected hash and answers `Sent` or `AlreadySent`; a bundler rejection is a declared refusal, `BundlerRefused` | approval | #127, #140 |
| 3 | A company approval ends by what used its Safe nonce (executed, failed, rejected or replaced), and the remaining approvals are withdrawn | approval (its lifecycle) | #106 |
| 4 | `world.clock.warp`'s refusals `WarpFollowerFailed` and `WarpInProgress`, and warping stops at the api's own due times | clock | #176 |
| 5 | `IndexBehind`: a read from the index answers "not yet" until the index reaches the asked block; it needs a `wait` span | common (chain reads) | #170 |

**Parity journeys** (the journey author writes them when their things are climbed or built):

| # | Journey | Source |
|---|---|---|
| 6 | J17 outside money: a Movement with a Memo keyed by its receipt ordinal, robust to reorganisations | #124, #172, #163 |
| 7 | J23 scheduled payments: paid on its day exactly once, refused `NotDue` before it (streaming pay stays dropped) | #128, #98 |
| 8 | J6 annotate: `activity.annotate`, checked against the site's chart, refusal `AccountNotInChart` | #94 |
| 9 | J21 redelivered exactly once: a fault control for test worlds, as a pipeline operation | #102 |

**Roadmap candidates** (brought to Aaron when the restack next opens):

| # | Idea | Source |
|---|---|---|
| 10 | A world-time-only lint rule (no host time where world time is meant), with a ratchet | #151, #167 |
| 11 | The site joins the trace through a W3C `traceparent`, its format generated from the blueprint's `TraceId` | #148 |

**Fixes for the sites lane** (recorded here; not the blueprint's to build):

| # | Fix | Source |
|---|---|---|
| 12 | The site service resumes a `removing` site after a restart | #229 |
| 13 | `SiteDoor.clock` answers asynchronously, so it does not hit 524 on a busy bench | triage |
| 14 | The CLI's world create and snapshot restore exceed Node fetch's 300 s limit (decision 8's CLI work covers it) | triage |

#145 (general escrow) stays open as the reference for the escrow revisit.
