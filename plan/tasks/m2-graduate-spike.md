## What
Each proven part (the site app, the service, the CLI, the recorder, the clock) moves into packages/ where the book's layout puts it, cleaned to the repository's rules and renamed to the book's names, only when its evals pass on the scoreboard. The stand-in chain is replaced by the real contracts as part of the move.
## Why
The spike is proven but lives in spikes/ and was written fast. Rewriting it from nothing would throw the proof away; leaving it there means the product never starts.
## Done when
- Nothing the thin line needs runs from spikes/
- Every moved part passes its evals on the scoreboard
