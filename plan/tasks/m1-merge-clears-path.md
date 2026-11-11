## What
When `pnpm loop merge` marks a task done, take it off the critical path in the same plan change (pnpm plan), so the next merge's plan check does not fail on "it is on the path and is done".
## Why
On 11 November the merge of m1-portal-answer-states was refused because m1-portal-provenance, merged minutes before, was still on the path.
## Done when
- A merge of a task on the path leaves it off the path, with a test
- pnpm loop:test passes

Touch only packages/loop/src/modules/capxul/internal/merge.ts and its test; another run has gates.ts.
