# evals

`bindings/` says which check proves which eval of the blueprint (today in `books/`): one JSON file per group of checks (the devnet, the
plugs, the test sites). An eval with no binding is `not_run`.

Written by: the lane that adds a check. Read by: `pnpm evals` (`packages/evals`), which runs the bound checks and is
the only thing that writes `status/`. `pnpm evals -- gaps` lists the evals with no check. The rules are in
`docs/design-book.md`, "Evals run".
