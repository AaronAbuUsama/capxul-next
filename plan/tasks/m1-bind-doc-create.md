## What
Read docs/mission/research-2026-11-11.md, "Running the thin-line checks from a lane". Promote the near-miss acc:doc.create/1 to a binding: add to spikes/skeleton's B6 step a named check that reads back a newly created document and finds docstatus 0 (a draft), keep B7.closed-month-invoice-refused for its validation, remove the near-miss entry, and bind the eval to both checks with a why. Follow the script contract in docs/blueprint.md ("Evals run"): a check is an `@check` line the runner reads. You cannot run the stack from a lane; the coordinator runs `pnpm evals -- acc:doc.create/1` on the Mac after the merge. Touch spikes/skeleton (the B6 check only) and evals/bindings only.
## Why
The score is 8 of 5,175: checks that run prove little of the book. This is the first near-miss turned into a binding, and the pattern for the rest.
## Done when
- pnpm evals -- check: 0 problems, 9 bound evals, and acc:doc.create/1 is no longer a near-miss
- bash -n passes on every changed script
