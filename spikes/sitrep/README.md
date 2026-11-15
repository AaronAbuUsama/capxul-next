# Spike: the conductor's state, declared by the blueprint

Proves that the sitrep's whole state (the plan, milestones, steps, lanes, threads, asks and sitreps) can be declared
in the blueprint's own format, kept as an append-only log of stamped events, and derived from that log with nothing
typed twice and nothing able to drift. Design: `docs/design/sitrep.md`. Graduates into `packages/blueprint`
(the things) and `packages/blueprint-tools` (the four additions in `src/language.ts`) once Aaron agrees it.

```
./run.sh prove      # replays example/events.jsonl, then shows five broken histories refused
./run.sh generate   # writes generated/ from the declarations and the log
```

It runs against the real toolkit (`Machine.make` from `@capxul/blueprint-tools`) and Effect 4.1.2.

## Every change is an event at a step

Each line of `example/events.jsonl` is one change: its event, the thing it changes, **who** made it (an agent's
thread, a person, or the pipeline's CI run) and **when**. Agents append events through `capxul <thing> <verb>`; Aaron
appends his (an answer, an agreement, a sitrep heard) through the page. A thing's state is never stored: it is its
events played through its machine. So the page shows each thing's full history, who did what and when.

## What owns what, and what fails when it drifts

| Fact | Declared in | Generated or derived from it | What fails if they drift |
|---|---|---|---|
| A plan's required sections: why, what, where it ends, what it leaves out | `src/things/plan.ts`, `PlanText` | `generated/events.schema.json`; the plan's page `generated/plan.md` | Writing a plan without a section: the event is refused (`Prose` has a minimum) |
| A milestone's goal, why now, done-when, steps | `src/things/milestone.ts` | the schemas; each milestone's section of `plan.md` | A milestone without its goal: refused (shown by `prove`) |
| A step's what, why, done-when, needs, units | `src/things/step.ts` | the schemas; the burn-down (`snapshot.burn`), derived from step events | A step needing one nobody planned: refused |
| Each thing's states and moves | `Machine.make` in each thing's file | `generated/things.md`: states, Mermaid diagram | A move from a state it cannot start from: the history is invalid (an ask answered twice, shown) |
| Who may make each move | `…Allowed` beside each machine | the "Who may" column of `things.md` | An agent agreeing the plan or proving its own step: refused (both shown) |
| An ask's problem, context, rubric, two to four options with trade-offs, recommendation and reason; an answer as an option or own words | `src/things/ask.ts` | the schemas; the Now tab | An ask with one option or no rubric: refused |
| A sitrep's parts (one to five, each speakable), links, lanes | `src/things/sitrep.ts` | the schemas; the Sitreps tab | A sitrep naming a lane never opened: refused |
| Every event the state can hold | `Event` in `src/view.ts`, the union of the things' events | `generated/events.schema.json`, which any agent's CLI validates against | An event no thing declares: refused |
| What the page reads | `Snapshot` in `src/view.ts` | `generated/snapshot.schema.json`; the page's types are `typeof Snapshot.Type` | `project` decodes its own output with `Snapshot`, so a page shape the projection does not meet fails here, not on screen |
| References between things | `project` in `src/view.ts` | none | A plan, milestone, lane, ask or sitrep naming a thing that does not exist, or a step and its milestone disagreeing |

In the blueprint these files sit in `src/things/<thing>/` (values, events, lifecycle, one file per verb), and
`pnpm generate` writes `generated/`; `generate:check` then fails when a declaration changes and its generated files do
not.

## What the blueprint's toolkit lacks today (`src/language.ts`)

1. **A stamp on every event**: who (agent thread, person, pipeline run) and when. Product events carry their own actor
   fields today, each differently.
2. **Replay**: a machine answers one move (`step`); nothing derives a thing's state from its history, and nothing
   refuses a history that breaks the machine.
3. **Who may make a move**, per move. Roadmap step 5.1 declares roles per operation; the conductor's things need
   actor kinds too.
4. **Prose as a value**: a required section of words with a minimum, so "a milestone has a goal" is enforced, not hoped.

## Not covered by the spike

Where the log lives (the orphan branch `state`), the CLI verbs that append to it, the refresh that publishes the
snapshot, and the page. `docs/design/sitrep.md` covers each.
