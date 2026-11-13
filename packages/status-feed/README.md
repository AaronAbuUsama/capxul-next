# status-feed

Builds the two small files the rebuild line's status dashboard reads, from stored facts only:

- `items.json`: the phases and risks in `docs/roadmap.md` with their states, and the changes merged into `master`.
- `activity.json`: commits on `master` per day since it was cut from `main`.

`python3 packages/status-feed/build.py` writes both to `var/status-feed/` (not committed). A scheduled task runs it and
uploads the files to the dashboard. Nothing here is typed by hand: to change what the dashboard says, change the
roadmap or merge work.
