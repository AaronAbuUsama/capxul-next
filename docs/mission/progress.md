# Build progress

One line per finished lane or milestone: the date, what finished, the evals it passes, the commit.
The build session appends here until the swarmD ledger takes over (`docs/spec/10-swarmd-ledger.md`).

| Date | Milestone or lane | Evals passing | Commit |
|---|---|---|---|
| 10 November 2026 | Portal generator (`packages/portal`): the designed screens, then the content pass: readable prose, highlighted code, linked counts, the operation trace and SDK call, evals by kind, the eval catalogue, Docs as catalogues, Architecture from the book | portal check 6 of 6 parts; 44 portal tests; no product eval has run | uncommitted, on `0bbd974` |
| 10 November 2026 | Ruling `aaron.one-door` (`books/target/shared/rulings.ts`): the CLI and SDK are the one door, Frappe works normally with money through the signer, the chain owns; the concepts are not yet re-cut to it and `spikes/skeleton/` is testing it | book 3352 records, 0 problems, 79 gaps; 0 frozen breaches; portal check 6 of 6 | uncommitted, on `0bbd974` |
