## What
A runner that takes eval ids from the book, runs each against a world, and writes pass or fail to status/status.json, which the portal already reads. Start with the thin line: map the spike's 119 checks onto the book's eval ids for that journey, so the same run produces the same score on a laptop and on the machine.
## Why
No test from the book has ever run, so the climb has no score. Until results come from a machine and not from a report, done means whatever an agent says.
## Done when
- status/status.json is written by a run, not by hand
- The portal shows a real count of tests passing for the thin line
- A check that fails in the run shows as failing in the portal
