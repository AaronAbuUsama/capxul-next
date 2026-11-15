# The Rebuild Sitrep

Aaron's one page for where the rebuild stands, redesigned with him on 15 November 2026.
Page: https://claude.ai/artifact/CjRhEey4CEwXciharu1bPF. How to update it, its data and its tests: the `sitrep` skill
(`.agents/skills/sitrep/`).

## What it is for

Aaron mostly glances at it on his phone, away from his desk, and listens rather than reads. In the first five
seconds it answers: does anything need me, is `master` healthy, how fast is a full run, and how much of the plan is
done. Then: how close the next milestone is, whether the work left is falling, what each lane is doing, and what landed.

Agreed with Aaron, in order:

1. A tower: tiles, then detail. Not a briefing column, not a spoken-only page.
2. The next milestone with its steps, every milestone's progress, and a burn-down (not a burn-up) that shows each
   point's time and cause on hover or touch.
3. Lanes open in place, like an accordion, with their own sitreps inside.
4. Spoken sitreps on their own tab: a fold-out list, unheard first, heard in grey, each with its text, a play button
   and its links. Finer playback: speed, pause, back, forward, and a bar of parts to jump to.
5. A native phone layout, with a tab bar at the bottom.

## How it is built

- **The page is a template with no data in it.** It reads the artifact's database (the `db` capability) and redraws
  live. Updating the sitrep is a data write by the conductor, never a republish, so the design changes only by pull
  request and the data cannot drift from what the page expects.
- **Numbers are never typed.** Milestones, steps and the burn-down come from `numbers.py`, which uses
  `packages/status-feed/feed.py`: a step is Done only when its proof is committed, at the time that proof landed.
  The burn-down's total comes from the roadmap's own history, so the plan growing shows as the line going up.
- **The conductor writes only what needs judgement:** what needs Aaron, the lanes, what landed in plain words, the
  threads, and the spoken sitreps, each checked at its source first.
- **Per viewer:** what each viewer has heard and their reading speed live in their own private part of the database,
  so his phone and his laptop agree.
- **Reading aloud** uses the platform's voice (`tts`). It has speed, pause and resume, and lines, but no seek, so each
  sitrep is split into parts and back, forward and the parts bar start a new reading at a part's start.
- **Access:** anyone the page is shared with reads it; only Aaron and editors (and the conductor acting as Aaron) write
  the shared data.

## How it should connect to the blueprint

Today the sitrep reads the facts it shows from their owners: step states and times from the roadmap through the
status feed, pull requests and `check` runs from GitHub. Nothing on it is a second copy of a fact that has an owner,
except what the conductor writes by hand after checking it.

That hand-written part should shrink as the pipeline is declared:

1. When the blueprint's `pipeline` domain lands (3.6), the sitrep's documents (`now`, a sitrep, a lane) become things
   declared there, and their JSON schema is generated into the skill, so the page, the test and the conductor share
   one shape that `generate:check` keeps honest.
2. When verdicts land (4.5), the run-time tile and `master`'s health come from verdicts, and `numbers.py` reads them
   instead of the conductor typing a run's minutes.
3. When the pipeline is instrumented (4.7), lanes and their pull requests can be derived from slices and their
   telemetry, leaving the conductor only the spoken sitreps and what needs Aaron.

Each is a blueprint delta inside the existing decisions, so it is the lead's call when its step comes.

## Open

- Spend has no source yet, so the page does not show it; `now.spend` is reserved for when cost is measured (4.6).
- The status dashboard and this page overlap. Once this page reads verdicts, the dashboard can be retired; that is
  Aaron's call.
