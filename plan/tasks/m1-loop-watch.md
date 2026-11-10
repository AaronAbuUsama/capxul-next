## What
A pnpm loop watch command that prints one line per event: a run started, ended, a refused call, a model failure, a refusal rate over one in twenty, a run superseded. packages/loop only
## Why
Layer first: the post-mortem's coordinator read statuses and missed 226 refusals; the sweep must be woken by runs, not by polling
## Done when
- A test plays a scripted run and gets the start, refusal, failure and end lines in order
- pnpm loop:test passes
