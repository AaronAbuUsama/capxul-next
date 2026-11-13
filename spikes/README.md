# spikes

Proven throwaway code. It showed that the design works end to end, and it is waiting to be moved into packages.

`skeleton/` is the walking skeleton: a real Frappe v16 site (its app is now `packages/frappe-app`), the real v4
contracts and a small core service, driven by
`run.sh`, with what it found in `FINDINGS.md` and the interface it settled in `INTERFACE.md`.

Used today by the loop's sandbox and by some evals bindings, so it must keep working. Plan task `m2-graduate-spike`
moves it into the product part by part, under the blueprint's tests; when that is done this directory is deleted. Do not
add new product code here.

`pipeline/` is the pipeline spike on the rebuild line (`master`, roadmap step 0.7): an Effect contract, an empty
Core Worker, a world and a generic scenario runner. Its README says what is proven and how to run it.
