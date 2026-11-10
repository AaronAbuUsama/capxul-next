# @capxul/layout

The layout check: it keeps the repository findable. `pnpm layout` runs it, and it is part of `pnpm test`.

It fails when something is at the top level that is not on the allowlist, when a source file is over 300 lines
(beyond the recorded offenders in `oversize.json`, which may only shrink), or when a top-level directory or a package
has no README.

- `src/main.ts`: the entry, and the policy: `ALLOWED` (what may be at the top level, a reason each), the limit, what is
  exempt. **Edit this file to allow a new top-level entry.**
- `src/modules/layout/`: the three rules as pure functions, with their tests. Its README has the table of rules.
- `oversize.json`: the source files that were over the limit on 10 November 2026, and the size each may not exceed.

Written by: whoever changes the shape of the repository. Read by: `pnpm test`.
