# The blueprint, explained

This is the plain-language guide to the blueprint: what it is, how it works, how to add to it, what happens when
something in it is wrong, and the daily workflow around it. It is written for anyone who has to work with it, a
person or an agent, without reading the code first. `docs/blueprint.md` is the detailed reference; this page is the
way in.

In the portal this page carries live tables built from the blueprint at the commit the portal was generated from, so
the numbers and examples on it are always the real ones. The words are kept in `docs/blueprint-guide.md`; the
tables are made by `guide.ts` and `guideTables.ts` in `packages/portal/src/modules/site/internal/`.

## The idea

Capxul is being rebuilt, and the blueprint is the design of the rebuilt system, written as data instead of as
documents.

The old Capxul described itself in five places: a book of 215 operation pages, a docs site, architecture decision
records, Linear tickets and the code. They drifted apart, and nothing could tell when they disagreed. The blueprint
fixes that by making the design something a machine can check:

- **Every part of the system is a record.** A table, a state machine, a server endpoint, a CLI command, an error, a
  background process, a decision: each is one TypeScript value in a file under `blueprint/`.
- **A link between records is an import.** When a server endpoint writes a table, its record holds that table's
  record. A misspelt or deleted record is a compile error, not a broken sentence.
- **The rules are code that runs on every build.** For example: no concept writes another concept's table, every
  state machine sends exactly one event, every command has a speed budget.
- **The definition of done falls out of the records.** Each record implies a list of checks, called evals, that
  say when the real code matches it. Nobody writes or maintains a separate test plan.

One rule keeps it honest: **the blueprint changes first.** When code needs to behave differently from the blueprint,
you change the record and write down why (a decision record), rebuild the blueprint until it reports zero problems,
and only then change the code. Code that disagrees with the blueprint is a defect, not a design.

<!-- generated: now -->

## What it is made of

A record has a kind, an id and the fields its kind needs. The kinds sit in layers, and links only point down the
layers, so the blueprint never loops back on itself:

- **What a caller asks for.** An *operation* is one CLI command (`doc submit`, `payment send`). It is answered by
  exactly one *rpc* (one server endpoint) or one *flow* (one Core SDK method that calls several rpcs in order).
- **What is stored and how it changes.** A *table* holds rows. A status column on a table is a *machine* (a state
  machine), whose *transitions* move a row from one status to another and each send an *event*. One concept can
  change another concept's tables only through that concept's *procedures*, its front door.
- **What runs when nobody is waiting.** A *workflow* is a durable background process: what starts it, what it waits
  for, and what wakes it.
- **The outside world.** An *integration* is an outside service and its *calls*. A *contract* is an on-chain contract,
  with its *functions* and *chain events*.
- **The whole system.** The *system*, its *components* (what runs) and *environments* (where), the
  *concepts* that own everything, *errors* (one vocabulary with exit codes), *journeys* (a person's path through
  several operations) and *invariants* (what must always hold).
- **What a person sees in Frappe.** A *doctype* is a Frappe DocType (or the fields Capxul adds to one), a *role* is a
  hat and the Frappe roles it grants, a *feature* is a part of the site a company turns on, and a *screen* is what a
  person sees, on which DocType, for which hats.
- **How the running system is watched.** A *log* is a row the system writes, a *metric* a number it records, an
  *insight* a question asked of events, logs and metrics, an *alert* what fires when an insight crosses a line, and a
  *dashboard* the insights one audience reads.
- **Every judgment.** A *decision* records a question, the options, what was chosen and why, and which records it
  affects.

<!-- generated: kinds -->

Every concept has its own folder under `blueprint/<concept>/`, with the same files in each: `data.ts` (tables,
machines, events), `procedures.ts` (its front door), one file per area of rpcs, `processes.ts` (workflows),
`flows.ts`, `operations.ts`, `decisions.ts` and `index.ts` (the concept's list of modules). `blueprint/shared/`
holds what belongs to no single concept: the concept map and what each may depend on (`foundation.ts`), the error
vocabulary, the architecture decisions, Aaron's rulings and the cut. `blueprint/baseline/` is the old system's 215
operations, generated from the old code and never edited by hand.

<!-- generated: concepts -->

## How it works: the build

`pnpm blueprint` builds the blueprint. It takes about a second, and does this:

1. **Load.** Node imports `blueprint/index.ts`. Every record is checked against the schema of its kind as its file
   loads: an id in the wrong shape, a missing field or an `about` longer than 2,000 characters stops the load.
2. **Register and link.** Every record is filed under `kind:id` (`operation:doc.submit`). Two records with the same
   kind and id are a problem. Then every field of every record is walked, and each link is checked: a link to a
   record that is not in the blueprint is a problem (`dangling`), and a link that holds nothing, usually an import
   cycle, is a problem (`undefined-link`).
3. **Rules.** The base rules always run: concept boundaries, state machines, dependency cycles, refusals an
   implementation cannot produce. Because the blueprint is built at stage `target`, the accepted design policies run
   too: events only on transitions, one event per machine, no endpoint that nothing reaches, a budget on every piece
   of behaviour, tenant-first keys, every acceptance line written as a claim with what it observes.
4. **Gaps.** Then the build derives what is incomplete: a table nothing writes, an error nothing produces, a
   transition nothing drives, a refusal with no test world that can reach it.
5. **Evals.** Finally it derives every eval the records imply, each with an id, a level, the record it is about, its
   claim, and who decides it (a machine, an agent or a person).

It writes `var/blueprint/README.md`, one page per concept, `evals.json` and `findings.json`, prints one summary
line, and exits with an error if there is any problem. The three outcomes matter differently:

- **A problem** means the design contradicts itself or a policy. The blueprint does not build, and nothing may merge
  until the count is zero.
- **A gap** means the design is incomplete there. The build still passes; each gap is visible work.
- **A standing gap** is a gap a decision has accepted for a stated reason (its `stands` field names the record, the
  rule and why). It is moved out of the open gaps and listed apart. A standing entry that no longer matches any gap
  becomes a problem (`stale-standing-gap`), so excuses cannot outlive what they excuse. Problems can never be
  excused this way.

## One record, end to end

Here is one real acceptance claim followed all the way from the record to the verdict the portal shows. The
operation is `doc submit`, in the sites concept (`blueprint/sites/operations.ts`), and the claim is its first
acceptance line.

<!-- generated: follow -->

The record says what must be true and what a black-box run observes to check it. The build turns that line into the
eval `acc:doc.submit/1`. A binding in `evals/bindings/sites.json` says which named check in the test script proves
it, and why that check proves the whole claim. `pnpm evals` runs the script, reads each check's result line, decides
the eval's verdict and writes it to `status/status.json` with the commit, the time, the run and a link to the
evidence it kept. The portal reads that file, and the operation's stand (where it is on the climb) follows from it.

Notice one honest wrinkle in this very example: the claim's `observes` names a Purchase Invoice, and the bound check
submits a Sales Invoice. The binding's `why` explains why the check still proves the claim (an ordinary document posts
when submitted). Whether a check proves a whole claim is a judgment the person or agent writing the binding makes,
and the `why` is where that judgment is written down for review.

The other evals the same operation implies, and where each one stands:

<!-- generated: follow-evals -->

## Evals: what the records promise

An eval is a claim the records make about the real system. The kind of eval is the start of its id, before the
colon. Every operation gets the same family: one `acc` per acceptance line, one `ret` for the shape of its `--json`
output, one `ref` per refusal, one `evt` per event sent anywhere under it, one `spn` for its trace, one `bud` for its
speed budget, one `doc` (its help and reference page agree with the record) and one `des`, a design review that an
agent decides rather than a machine. The records under an operation (its rpcs, flows, tables, transitions,
workflows) add their own.

Evals sit at four levels: L1 is one operation and the records under it, L2 is a journey run end to end, L3 is the
whole system (import rules, line budgets, generated files, invariants, environments), and L4 is live traffic on
staging. The build derives L1 to L3; nothing derives L4 yet.

<!-- generated: eval-kinds -->

### The score

An eval only changes from not run when a run proves it. A **check** is a named step of a test script with an expected
outcome. A **binding** (in `evals/bindings/<area>.json`) says which checks prove which eval, and why. The rules are
strict:

- An eval is bound only to checks that prove the whole claim. A check that proves part of it is listed as a
  **near-miss**, with what is missing, and never scores.
- An eval passes when every one of its checks passes, and fails when any fails. An eval asked for with no binding is
  written `not_run`, never `pass`. If its checks did not all run and none failed, nothing is written.
- Only `pnpm evals` writes `status/status.json`. Nobody edits it or a verdict by hand, and an agent saying it is done
  is not evidence: a run's results are.

<!-- generated: score -->

<!-- generated: bound -->

## How you use it

**To read it**, use this portal. Every concept, operation and record has its own page with what it links to, what
links to it, its evals and their verdicts, and an "If this changes" list of everything that depends on it. The Docs
section lists every record by kind, the Build page shows where every operation stands, and the Questions page holds
every decision that waits for Aaron. Every page has a Markdown twin and a JSON twin for agents, and `llms.txt` is
the map.

**From the command line**, the same facts:

```bash
pnpm blueprint                                                     # build it: records, evals, problems, gaps
pnpm frozen                                                        # check every old behaviour is kept, or cut with a decision
pnpm judgments                                                     # every decision, and the ones that wait for Aaron
node --experimental-strip-types --no-warnings packages/blueprint-engine/scripts/impact.ts operation:doc.submit
                                                                   # everything that depends on a record
pnpm evals -- list                                                 # which checks prove which evals
pnpm evals -- gaps                                                 # checks that prove nothing yet, and near-misses
pnpm evals -- acc:doc.submit/1                                     # run one eval and record its verdict
```

**Where an operation stands.** The portal places every operation at one of five stands, and the first that matches
wins: *specify* (it or a record under it has a problem or an open gap), *decide* (a decision that waits for an answer
names it or what implements it), *build* (an L1 eval of it or under it has no passing verdict), *observe* (every L1
eval passes, live evals do not all hold yet) and *done*. A missing example or telemetry gap is counted beside the
stand but never moves it back.

## Adding to it and building on it

### A new operation, as it really goes

This walkthrough was run for real on this repository, adding a `doc print` command to the sites concept. The outputs
below are what the tools printed.

1. **Write the record** in the owning concept's `operations.ts`: its id (the command's words joined by dots,
   `doc.print`), title, command, what implements it, who may run it, what it changes, its acceptance claims (each a
   `claim` and what an eval `observes`), its refusals (each an error and the test world that reaches it), its
   `returns` schema, its examples and its budget. Export it; the concept's `index.ts` already lists the file.
2. **Build.** The first try left out `examples`, and the load stopped with a schema error, `Expected array at
   ["examples"]`. With that fixed the build printed `0 problems, 1 gaps`, the gap being `no-example` ("no one has
   seen what it prints"). It also derived seven evals on its own: `acc:doc.print/1`, `ret:doc.print`,
   `ref:doc.print/NOT_AUTHENTICATED`, `spn:doc.print`, `bud:doc.print/p95`, `doc:doc.print` and `des:doc.print`.
3. **Check the old behaviour.** `pnpm frozen` refused: `1 breaches. breach doc.print: a target operation that is none
   of the 215, with no decision on it; a new operation needs a decision that cites the Aaron ruling it serves
   (rules.new-operations)`. A new command is allowed only when a decision on it names the ruling of Aaron's that
   asks for it, it has at least one acceptance claim, and its id and command collide with nothing old or new.
4. **Write the decision** in the concept's `decisions.ts`: the question, the options, the choice, why (citing the
   ruling, here `aaron.one-door`) and the records it affects. `pnpm frozen` then printed `0 breaches`.
5. **Typecheck** (`pnpm exec tsc -p blueprint`), rebuild to zero problems, and run the rest of the checks listed
   under "The workflow" below.
6. **Then build the code** the record describes, add a check to the test script, bind it to the eval with a `why`,
   and run `pnpm evals` on it. The operation moves from build towards observe as its evals pass.

If the decision is one only Aaron can make, write it with its options and a recommendation; it then waits for him on
the Questions page, and every operation it names stands at *decide* until he answers.

### Changing an existing record

Change the record, and add a decision if the change is a judgment. Before you change it, look at its "If this
changes" list in the portal (or run `impact.ts`) to see what depends on it. Two things are easy to get wrong:

- **Eval ids are positions.** The first acceptance line is `/1`, the second `/2`. Insert a line in the middle and
  every later id now points at a different claim, carrying the old claim's verdict with it. Add new lines at the end;
  a line that is dropped is kept as a gap in the list (`null`) so the numbers after it do not move. The same holds for
  repeated refusal codes (`/2`, `/3`).
- **A changed claim or observation drops its old verdict.** The status file records, with each verdict, the claim and
  (for an acceptance line) the `observes` it was checked against. When either changes, the verdict is stale and counts
  as not run (`staleEvals` in `packages/blueprint-engine/src/status.ts`); the ripple lists the eval as re-worded. Run
  the eval again after you change what it claims or how it is observed. Other inputs (the world a refusal starts from,
  a schema the claim names) are not part of that fingerprint yet.

### A new concept

Define its concept record in `blueprint/shared/foundation.ts`, with what it may depend on, and add it to `CONCEPTS` there; create its folder with the usual
files and an `index.ts` that exports `modules`, and add it to the list in `blueprint/index.ts` in dependency order.
The portal finds concepts through `CONCEPTS`; a concept that keeps records in a subfolder (as payments keeps its pay
agreements in `payments/agreements/`) also needs a line in the portal's loader, which is easy to miss.

### Contracts

For the on-chain contracts in `packages/contracts` the direction is the other way round: the contract code is the
truth for what exists. Change the contract's source, run `pnpm contracts:export-abi`, then reconcile the contract
records until `pnpm contracts:check-blueprint` reports no undeclared differences.

## When something is wrong

Something can be wrong at six points, and each says so in its own way:

| Where | What you see | What to do |
|---|---|---|
| Loading a record | A schema error naming the field (`Expected array at ["examples"]`), and the build stops | Fix the field. The error does not name the record or the file, so look at what you just changed |
| Typecheck | `tsc -p blueprint` names the file and line, for example a `writes` given something that is not a table | Fix the link |
| The build | `N problems`, one line each: the record, the rule, and the detail; exit code 1 | Fix every problem. The rules are below |
| Old behaviour | `pnpm frozen` prints a breach per operation | Book the operation, classify it in the cut, or add the decision a new one needs |
| A run | An eval's verdict is `fail`, shown orange; its evidence file lists every check line | Fix the code, or if the record is wrong, change the record first |
| The portal | `pnpm portal:check` fails a named check, for example a status entry for an eval the blueprint no longer derives | Usually a record was renamed or removed: rerun the eval, or rebuild |

A real problem, made on purpose on this repository by adding a refusal that nothing under the command can produce:

```text
2668 records, 5176 evals, 1 problems, 0 gaps, 147 standing → var/blueprint
problem operation:doc.get refusal-not-produced: refusal INSUFFICIENT_BALANCE is not an error its implementation produces
```

The rules behind problems, with how many each finds right now:

<!-- generated: problems -->

The rules behind gaps, with how many are open and how many stand for a recorded reason:

<!-- generated: gaps -->

The decisions that hold the most standing gaps:

<!-- generated: standing -->

## Decisions, rulings and the cut

Every judgment in the blueprint is a decision record: the question, the options, the one chosen, why, where the
reason came from (`source`) and the records it affects. A decision whose source is Aaron is a ruling and is settled.
A decision written by an agent or the coordinator is either settled under a ruling it carries out, or it waits for
Aaron; one predicate (`forAaron` in `blueprint/shared/waiting.ts`) decides which, and the Questions page, the
judgments report and the stands all use it, so they cannot disagree. Aaron answers on the Questions page; the
coordinator writes his answer into the blueprint as a ruling and records that it was applied.

The old system's 215 operations are the floor of what the rebuild keeps. Each one is either booked as an operation in
the blueprint, or classified by **the cut** (`blueprint/shared/cut.ts`): reached (Frappe now does it), dropped, or
parked outside the built blueprint, each with the decision that put it there. Never both and never neither:
`pnpm frozen` checks it. What is kept is the behaviour, not the spelling: commands, flags, `--json` shapes and error
codes are the new blueprint's to design, with a decision for each change.

## The workflow

**For Aaron.** Read the blueprint here. Answer what waits on the Questions page. Everything else comes to you only as
a question there, never as a command to run.

**For an agent or a person doing the work.** One loop, every time:

1. `pnpm plan show` gives the goal, the critical path and your task, with the evals that say it is done.
2. Change the records first, with a decision for every judgment.
3. Build to zero problems and read the gaps.
4. Change the code to match.
5. Add or bind the checks that prove the evals, and run them with `pnpm evals`. Done means the evals pass in a run.
6. Before anything merges, every check passes:

```bash
pnpm exec tsc -p packages/blueprint-engine && pnpm test
pnpm exec tsc -p blueprint
pnpm blueprint                  # 0 problems
pnpm frozen                     # 0 breaches
pnpm contracts:check-blueprint  # 0 undeclared differences
pnpm layout                     # the top level, file sizes and package READMEs
```

If the code needs to differ from the blueprint at any step, go back to step 2.

## What the code does that the docs do not say

Checked against the engine on the day this page was written. Where the code and an older document disagree, the code
is what happens:

- **Nothing is generated from the records yet.** `docs/blueprint.md` describes generators that make migrations,
  schemas, the SDK client and the CLI wiring from the records. They are planned work; no `src/generated/` folder
  exists in the repository today, so the `doc` and `sys:generated` evals have nothing to check yet.
- **Live evals (L4) are not derived.** No operation can reach the *done* stand until they are.
- **The checks run on every pull request.** `.github/workflows/blueprint.yml` runs the typechecks, `pnpm blueprint`,
  the Frappe and contract checks, `pnpm frozen` and `pnpm test` on every pull request into `integration/build` and on
  every push to it, and writes the blueprint ripple into the run's summary. `pnpm test` alone still does not run
  `pnpm blueprint` or `pnpm frozen`.
- **A load error is hard to place.** A schema error at load prints the field but not the record or its file, followed
  by a long dump of the schema.
- **A decision's choice must be one of its options.** The build reports a `decision-chosen` problem otherwise
  (`chosenProblem` in `packages/blueprint-engine/src/reach.ts`), so `pnpm blueprint` fails on it.
- **Some counts in older docs are out of date.** `blueprint/CONVENTIONS.md` and `docs/blueprint.md` speak of 23
  concepts; the blueprint holds the number in the table at the top of this page. Trust the tables here over a typed
  number anywhere else.
- **Older files still say "the book".** It is the same thing as the blueprint, renamed by ruling `aaron.blueprint`
  (for example the `des` eval's claim says "consistent with the old book").

<!-- generated: unchecked -->
