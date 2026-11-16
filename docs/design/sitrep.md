# The sitrep: the conductor's state, declared by the blueprint

Status: open. The direction is agreed with Aaron (15 November 2026) (the state lives in the repository; five tabs; Preact).
Shapes and build order below are proposed; the items under "Needs Aaron's yes" are not yet agreed.

The page today (https://claude.ai/artifact/CjRhEey4CEwXciharu1bPF, the `sitrep` skill) is a stopgap: its data's shape
is written only in the skill, and the conductor types half of what it shows. This note replaces that with one rule.

**The sitrep is a view of the conductor's state. The blueprint declares every shape in it. Every fact that has an owner
is read from that owner when the view is refreshed. Only judgement is typed, by any agent, through the CLI.**

## 1. The things

The conductor's state becomes things in the blueprint, in the same format as `ratchet` and `run` on `slice/blueprint`
(`src/things/<thing>/values.ts`, `machines.ts`, one file per verb, each verb work no door serves):

| Thing | What it holds | Where it is kept | Its states (machine) | Verbs, so CLI commands |
|---|---|---|---|---|
| `milestone` | Name, goal, what "done" means, its steps, its target (optional) | Declared in the blueprint (the plan, below) | from its steps | none: changed by pull request |
| `step` | What, needs, lane, count, waits-on, evidence, proof | Declared in the blueprint (the plan) | not started, in progress, done (from its proof; from verdicts at 4.5), claimed | none: changed by pull request |
| `lane` | Name, its chain of steps, its slice branch | Declared in the plan; its live state derived | open, landing, landed | none |
| `thread` | Type (emoji), title, agent (Claude Code, Amp, Codex), link, lane, parent | The `state` branch | active, waiting on Aaron, done, archived | `thread start`, `thread move`, `thread archive` |
| `ask` | A question for Aaron, 2 to 4 options, the recommended one, why, who asked, by when | The `state` branch | open, answered, withdrawn | `ask open`, `ask answer`, `ask withdraw` |
| `sitrep` | Title, parts (each one or two spoken sentences), links, lanes | The `state` branch | said | `sitrep say` |
| `measure` | Ratchets, budgets against measured times, the evals | Derived only | none | none |

Derived at each refresh, never typed:

- each step's state and done time, from its proof (today `packages/status-feed/feed.py`; verdicts from 4.5);
- the burn-down, from the plan's history and the steps' done times;
- each lane's pull requests and their checks, from `slice/<lane>` on GitHub; its lead, from the thread whose lane it is;
- what landed, from `master`'s merges;
- `master`'s health, from its latest `check` run; the run time, from run records (verdicts and telemetry later);
- the ratchets, from `generated/ratchets.json` at each commit of `master`; budgets from run records; the evals once
  4.2 and 4.3 exist;
- "needs you" also includes every open pull request whose "Needs Aaron" section is not `_none_`.

## 2. Where the state lives

- **The plan** (milestones, steps, lanes) is declared in the blueprint and changed by pull request, as the roadmap's
  table is today. The roadmap's "Phases" and "Steps to the goal" tables are generated from it.
- **The running state** (threads, asks, sitreps): replaced on 16 November 2026 by the logbook (`docs/decisions.md`,
  "No `state` branch"; `docs/guides/logbook.md`). What follows was the proposal: it lives on an orphan branch, `state`, as one JSON file per thing, the way
  verdicts live on `proofs`. Each CLI verb validates against the generated schema, commits and pushes. No CI runs on
  it, `master` stays quiet, and git keeps the history. Any agent with git and the CLI can write it.
- **Derived facts** are not stored anywhere but in the snapshot below.

## 3. How it flows

1. **`sitrep.refresh`** (work no door serves; `capxul sitrep refresh`) reads the plan, the `state` branch, GitHub and
   the run records. It builds one **snapshot**, whose schema is generated from the blueprint, and validates it. A
   snapshot that does not validate fails the refresh: nothing wrong is ever shown. Every part of the snapshot carries
   the time its source was read.
2. **Publishers** put the snapshot where Aaron reads it. The first is the Claude artifact: the refresh writes the
   snapshot into the artifact's database. Another agent's publisher could write a page elsewhere from the same
   snapshot.
3. **Freshness:** a scheduled task runs the refresh every 15 minutes, and every CLI verb runs it after its write. The
   page shows each panel's age, and turns it amber past 30 minutes.
4. **Answers come back:** on Now, Aaron taps an option (and may add a note). The page saves the answer in its database
   and, when the asking thread is a Claude Code session, sends that thread the answer as a message. The next refresh
   records it on the `state` branch (`ask answer`), so every agent sees it. For a thread in Amp or Codex, a copy button
   gives one plain line to paste: "Answer to <ask>: option 2, <note>".

The maintainer's whole interface is four commands: `capxul sitrep refresh`, `capxul sitrep say`, `capxul ask open`,
`capxul thread start` (and `archive`). Nothing else is typed.

## 4. The screens

Five tabs at the bottom on a phone, a sidebar on a laptop. Drill-down pushes a page with a back chevron on a phone and
opens a side panel on a laptop. Counts appear only on Now and Sitreps. Every chart has a verdict sentence and a
reference line. Done and heard things are dimmed and folded, never hidden for good.

1. **Now**: only what needs Aaron. Open asks as cards: the question, lettered options, the recommended one marked,
   how long the thread has waited, answered in place with undo. Then anything broken (`master` red, a failed run).
   Then new sitreps to play. When nothing needs him it says so and offers the latest sitrep.
2. **Plan**: milestones, each with its progress. A milestone's page has its goal, what done means, a burn-down with its
   verdict ("on pace", "behind by 3 units"), and its steps grouped by state, with **Done (n)** folded at the bottom. A
   step's page has its state, what it waits on (each a link), its lane, its evidence and proof, its pull requests and
   the ratchet it closes.
3. **Lanes**: each lane's row has its lead, its current step, its pull request and the age of its last update. A lane's
   page has its lead and threads, its steps, its pull requests with their checks, and its sitreps.
4. **Measures**: one card per ratchet (count, change this week, a falling line with its old ceiling dotted), each
   budget against its measured p95 (red past 1.5 times, where an architecture review is raised), and the evals.
5. **Sitreps**: a podcast-style feed by day; unheard bold, partly heard with a bar, heard dimmed; a mini player above
   the tabs with speed, back, forward and parts to jump to.

Reference screens (Mobbin, 15 November 2026): Linear's project and issues for Plan, Plane's burn-down, GitHub Copilot's
agent sessions for Lanes, Bevel's trend cards for Measures, Queue and Apple Podcasts for the player, Discord's poll for
answering in place.

## 5. The build

- A package, `packages/sitrep`: Preact and TypeScript, no component library, one set of design tokens, built by esbuild
  into one HTML file that is published to the artifact.
- Its data types are generated from the blueprint's snapshot schema (`pnpm generate`), so the page, the refresh and the
  tests share one shape and `generate:check` fails when they drift.
- Its tests render the page from a snapshot fixture that the schema validates, at phone, tablet and laptop widths, in
  both themes, and drive every control (as `.agents/skills/sitrep/test.cjs` does today).
- The page is an entry file in the lint's sense (browser code, outside Effect), listed with its reason. The refresh and
  the verbs are Effect, like the rest of the pipeline.

## 6. Needs Aaron's yes

1. The roadmap's two tables become generated from the plan declared in the blueprint (they stop being hand-written).
2. A new package, `packages/sitrep`, in the shape list.
3. A new orphan branch, `state`, written by agents.

## 7. Order of work

Each piece is written first as journeys or checks by another agent, as AGENTS.md says.

1. After 3.6 lands on `master`: the blueprint delta, meaning the six things, their machines, the verbs and the
   snapshot's schema. This is the blueprint lead's call inside the existing decisions.
2. The plan moved into the blueprint, with the roadmap's tables generated from it (after Aaron's yes).
3. The CLI verbs and the `state` branch.
4. `sitrep.refresh` and the artifact publisher, on a 15-minute schedule.
5. `packages/sitrep`, replacing the stopgap page at the same URL.
6. Retire the stopgap skill's hand-written schema, `numbers.py` and the status dashboard; the `sitrep` skill becomes
   the four commands.

## What owns what in the spike

| Fact | Declared in | Generated or derived from it | What fails if they drift |
|---|---|---|---|
| A plan's required sections: why, what, where it ends, what it leaves out | `spikes/sitrep/src/things/plan.ts`, `PlanText` | `spikes/sitrep/generated/events.schema.json`; the plan's page `spikes/sitrep/generated/plan.md` | Writing a plan without a section: the event is refused (`Prose` has a minimum) |
| A milestone's goal, why now, done-when, steps | `spikes/sitrep/src/things/milestone.ts` | the schemas; each milestone's section of `plan.md` | A milestone without its goal: refused (shown by `prove`) |
| A step's what, why, done-when, needs, units | `spikes/sitrep/src/things/step.ts` | the schemas; the burn-down (`snapshot.burn`), derived from step events | A step needing one nobody planned: refused |
| Each thing's states and moves | `Machine.make` in each thing's file | `spikes/sitrep/generated/things.md`: states, Mermaid diagram | A move from a state it cannot start from: the history is invalid (an ask answered twice, shown) |
| Who may make each move | `…Allowed` beside each machine | the "Who may" column of `things.md` | An agent agreeing the plan or proving its own step: refused (both shown) |
| An ask's problem, context, rubric, two to four options with trade-offs, recommendation and reason; an answer as an option or own words | `spikes/sitrep/src/things/ask.ts` | the schemas; the Now tab | An ask with one option or no rubric: refused |
| A sitrep's parts (one to five, each speakable), links, lanes | `spikes/sitrep/src/things/sitrep.ts` | the schemas; the Sitreps tab | A sitrep naming a lane never opened: refused |
| Every event the state can hold | `Event` in `spikes/sitrep/src/view.ts`, the union of the things' events | `spikes/sitrep/generated/events.schema.json`, which any agent's CLI validates against | An event no thing declares: refused |
| What the page reads | `Snapshot` in `spikes/sitrep/src/view.ts` | `spikes/sitrep/generated/snapshot.schema.json`; the page's types are `typeof Snapshot.Type` | `project` decodes its own output with `Snapshot`, so a page shape the projection does not meet fails here, not on screen |
| References between things | `project` in `spikes/sitrep/src/view.ts` | none | A plan, milestone, lane, ask or sitrep naming a thing that does not exist, or a step and its milestone disagreeing |

In the blueprint these files sit in `spikes/sitrep/src/things/<thing>/` (values, events, lifecycle, one file per verb), and
`pnpm generate` writes `spikes/sitrep/generated/`; `generate:check` then fails when a declaration changes and its generated files do
not.
