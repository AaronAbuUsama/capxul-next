# spikes

Proven throwaway code. It showed that the design works end to end, and it is waiting to be moved into packages.

`skeleton/` is the walking skeleton: a real Frappe v16 site, a stand-in chain and a small core service, driven by
`run.sh`, with what it found in `FINDINGS.md` and the interface it settled in `INTERFACE.md`.

Used today by the loop's sandbox and by some evals bindings, so it must keep working. Plan task `m2-graduate-spike`
moves it into the product part by part, under the blueprint's tests; when that is done this directory is deleted. Do not
add new product code here.
