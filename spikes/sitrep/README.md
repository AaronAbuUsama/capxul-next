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

## What owns what

The table of each fact, its declaration, what is generated from it and what fails when they drift is in
`docs/design/sitrep.md`, "What owns what in the spike".

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

## The prototype (`prototype/`)

Its goal prompt is `docs/guides/sitrep-prototype.md`.

A phone-first page on the blueprint's shapes: `seed.py` builds `events.jsonl` from the real state, the projection
writes `snapshot.json`, and `build.mjs` embeds that snapshot in `sitrep.html` (Preact and htm, from `src/`). The page
shows nothing the projection did not pass.

```
python3 prototype/seed.py && ./run.sh project --log prototype/events.jsonl --derived prototype/derived.json --out prototype/snapshot.json
node prototype/build.mjs      # writes prototype/sitrep.html
node prototype/test.cjs       # Playwright: widths, themes, every screen, an ask, the walk, the player, keyboard, motion
node prototype/record.cjs DIR # screenshots, three videos and EVIDENCE.md into DIR
```

Answers and sitreps heard are kept on the page as stamped events (Aaron, the time); writing them back to the log is
the `state` branch's work in `docs/design/sitrep.md`.
