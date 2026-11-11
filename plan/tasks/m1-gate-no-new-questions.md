## What
Add a gate to the loop's pair gates and to `pnpm loop merge`: a run may not add a decision that waits for Aaron (blueprint/shared/waiting.ts forAaron) unless its task says it brings him a question. Compare the for-aaron list of the lane with that of its base and fail with the new ids.
## Why
m1-loop-decision-11110813 merged a decision (loop.gateway) whose text cites Aaron's ruling; the predicate put it on his Questions page as if it were a question. Fixed by hand in waiting.ts; the gate stops the next one.
## Done when
- A lane that adds a for-aaron decision fails the gate, with a test
- pnpm loop:test passes

Touch only packages/loop/src/modules/capxul/internal/gates.ts, a new file beside it if needed, and their test; another run has merge.ts.
