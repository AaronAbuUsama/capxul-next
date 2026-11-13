# effect-counts

The rebuild line's measure of how Effect its TypeScript is (`docs/roadmap.md`, "Effect everywhere it can be"). Two
counts, and neither may rise:

1. Non-Effect constructs outside entry files: `async`, `await`, `new Promise`, `try`, `throw`, `process.env`,
   `Date.now` and `console`. Comments and strings are not counted.
2. Runtime dependencies that are not Effect or Alchemy.

`python3 packages/effect-counts/check.py` prints both counts with the files that contribute and fails when either is
above `baseline.json`. When a count falls, `check.py --write` lowers the baseline; commit it. CI runs the check on
every pull request.

It covers the folders written on the rebuild line (the `SCOPE` list in `check.py`). The packages carried over from
`main` are outside it until they are rewritten, and Frappe (Python) and the contracts (Solidity) are outside it for
good. An entry file, the one file that starts a program, may touch the outside world directly; entry files are named
by suffix in `ENTRY`.
