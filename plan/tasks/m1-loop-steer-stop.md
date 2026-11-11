## What
Bring in the run-observability session's uncommitted work (var/stranded/run-observability-30638e.patch: notes to a running agent, the Stop confirm bar, the fix that kills a recorded command on stop, the door module), without its demo entry in .claude/launch.json. packages/loop and packages/loop-ui only
## Why
Layer first: a watched run must be stoppable from the page; the stopped run-observability session found that Stop left a recorded command running
## Done when
- On a live run with the scripted model, Stop from the page ends the run within 10 seconds, including while a command is being recorded
- A queued note reaches the builder's conversation
- pnpm loop:test passes
