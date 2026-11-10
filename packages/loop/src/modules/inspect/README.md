# inspect

A run as plain data, for another program to read: `loop status --json [--since-hours 24]` (every run that is running, or was
saved within the window, with its last three events) and `loop show <run id> --json` (one run, its last twenty events).
`types.ts` is the module: the task, script, status (`dead` for a run whose process is gone), step, round, start, end, last
event, the maker's and each checker's model, turns, tool calls (total and by name), tokens in and out, the lane's branch,
the events as one line each (time, agent, tool name and a short argument), and why the run is not going on.

It reads `status.json` and, read-only, the run's pi-durable storage; it adds no store. Nothing leaves that is a file's
contents, a prompt, an agent's reply or an environment value: a tool call shows its name and the command's first line, a
path or a pattern, capped at 90 characters; every free text passes `scrub` (key and token shapes, `NAME=value` assignments,
values of environment variables whose names say secret, long hashes; a commit shows as seven characters). `LOOP_RUNS`
names another folder of runs. The portal's Live page runs these commands; nothing in the portal imports this package.

`loop show <run id> --json --full` is the other reading, for a page that shows a run to its owner (`RunDetail` in
`types.ts`): every step with what it left behind (the builder's hand-back and its commit's diff, each check's output, a
reviewer's verdict and findings) and every agent's conversation, entry by entry, with tool calls and their results.
It does carry prompts, replies and tool output: each text is scrubbed and cut, and paths under the lane are shown
relative. The storage itself is never changed: it keeps every conversation whole.
It also carries the run's captures (`captures`, from the evidence folder's own record) and, on each agent's step, the
claims of its structured output judged against them (`evidence`); the files themselves are the host's to serve.
