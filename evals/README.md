# evals

`bindings/<concept>.json` says which checks prove each eval of that concept. `checks/<concept>.sh` holds the skeleton's
checks for that concept. Both directories are discovered automatically: agents on different concepts edit different files,
not a shared registry. An eval with no binding is `not_run`.

Skeleton check files are sourced libraries. They register `register <order> <behaviour> <function> '<dependencies>'` and define
that function; they do not run checks while sourced. The shared runner owns the fixture and helpers, resolves dependencies,
and executes registered functions in numeric order. A standalone script (such as selected-stack acceptance) may instead be
named directly by its concept's binding file; it implements the same `--list` and `@check` protocol.

Eval IDs are opaque, never positional. Content-derived keys survive insertion and reordering; an explicit record `key` keeps
the ID through rewording. A changed claim or observation still invalidates its old verdict. See decision `system.eval-identity`.

Written by: the lane that adds a check. Read by: `pnpm evals` (`packages/evals`), which runs the bound checks and is
the only thing that writes `status/`. `pnpm evals -- gaps` lists the evals with no check. The rules are in
`docs/blueprint.md`, "Evals run".
