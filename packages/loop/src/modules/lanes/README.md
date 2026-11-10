# lanes (generic)

A lane is a git worktree on `lane/<name>` cut from a base branch: files isolated, nothing more. `ensureLane` (safe to repeat),
`commitAll`, `catchUp` (merge the base in, abort on conflict), `dropLane`, `freePort`. Plain `git` run in a directory.
Tested through the capxul module's tests (a temp repository with a bare origin). Generic.
