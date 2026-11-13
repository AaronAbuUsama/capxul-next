# status-feed

Builds the two small files the rebuild line's status dashboard reads, from stored facts only:

- `items.json`: the milestones and steps in `docs/roadmap.md` with their progress, the critical path through the unfinished steps, and the changes merged into `master`.
- `activity.json`: how much of the work was finished by each of the last 48 hours.

`python3 packages/status-feed/build.py` writes both to `var/status-feed/` (not committed). A scheduled task runs it and
uploads the files to the dashboard. Nothing here is typed by hand: to change what the dashboard says, change the
roadmap or merge work.
