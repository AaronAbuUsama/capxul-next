# check-layout

Three rules that keep the repository findable, as pure functions (`service.ts`, `internal/rules.ts`) over what the
entry (`packages/layout/src/main.ts`) reads from git. Run it with `pnpm layout`; it is part of `pnpm test`.

| Rule | Fails when | To fix |
|---|---|---|
| top level | an entry at the top level is not in `ALLOWED` (in `packages/layout/src/main.ts`) | move it into a package, `docs/`, `archive/` or `var/`; or add it to `ALLOWED` with a reason |
| size | a source file is over 300 lines, or a file in `packages/layout/oversize.json` grew | split the file; `oversize.json` records the offenders of 10 November 2026 and only ever shrinks |
| readme | a top-level directory or a package has no `README.md` | write five lines: what it is, who writes it, what reads it |

Not measured for size: `blueprint/`, `docs/`, `archive/`, any `generated/` folder, `packages/contracts/lib/` (vendored).

```ts
const problems = checkLayout(tree, policy);   // [] when the layout holds
```
