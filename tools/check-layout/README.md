# check-layout

Three rules that keep the repository findable, as pure functions (`service.ts`) over what the entry
(`tools/check-layout.ts`) reads from git. Run it with `pnpm layout`; it is part of `pnpm test`.

| Rule | Fails when | To fix |
|---|---|---|
| top level | an entry at the top level is not in `ALLOWED` (in `tools/check-layout.ts`) | move it into a package, `docs/`, `archive/` or `var/`; or add it to `ALLOWED` with a reason |
| size | a source file is over 300 lines, or a file in `oversize.json` grew | split the file; `oversize.json` records the offenders of 10 November 2026 and only ever shrinks |
| readme | a top-level directory or a package has no `README.md` | write five lines: what it is, who writes it, what reads it |

Not measured for size: `books/`, `docs/`, `archive/`, any `generated/` folder, `packages/contracts/lib/` (vendored).

```ts
const problems = checkLayout(tree, policy);   // [] when the layout holds
```
