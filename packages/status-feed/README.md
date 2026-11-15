# status-feed

Builds the two small files the rebuild line's status dashboard reads, from stored facts only:

- `items.json`: the milestones and steps in `docs/roadmap.md` with their progress, the critical path through the unfinished steps, the changes merged into `master`, and every ratchet of the scorecard with its committed count (`packages/blueprint/generated/`: `scorecard.md`, `ratchets.json`, and R15's total from `old-words.json`).
- `activity.json`: how much of the work was finished by each of the last 48 hours.

`feed.py` works out every step's state and the time it was done from the proof the roadmap names for it, never from a
hand-typed column; `tests/test_feed.py` checks that against a throwaway repository (`pnpm status:test`, part of
`pnpm test`). `python3 packages/status-feed/build.py` writes both to `var/status-feed/` (not committed). A scheduled task runs it and
uploads the files to the dashboard. Nothing here is typed by hand: to change what the dashboard says, change the
roadmap or merge work.
