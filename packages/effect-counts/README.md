# effect-counts

The rebuild line's measure of how Effect its TypeScript is (`docs/roadmap.md`, "Effect everywhere it can be"). Two
counts, and neither may rise:

1. Non-Effect constructs outside entry files: `async`, `await`, `new Promise`, `try`, `throw`, `process.env`,
   `Date.now` and `console`. Comments and strings are not counted.
2. Runtime dependencies that are not Effect or Alchemy, other than the few kept by decision because nothing replaces
   them yet (Ponder with the Hono app its API file needs, viem, the alto bundler). Those are listed on every run with
   the reason, and the list changes only by Aaron's decision.

`python3 packages/effect-counts/check.py` prints both counts with the files that contribute and fails when either is
above `baseline.json`. When a count falls, `check.py --write` lowers the baseline; commit it. CI runs the check on
every pull request.

It covers the folders written on the rebuild line (the `SCOPE` list in `check.py`). The packages carried over from
`main` are outside it until they are rewritten, and Frappe (Python) and the contracts (Solidity) are outside it for
good. A Ponder app's own files are written to Ponder's async API and are not counted. An entry file, the one file that starts a program, may touch the outside world directly; entry files are named
by suffix in `ENTRY`.
