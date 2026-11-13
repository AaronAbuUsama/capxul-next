# system

One static check per `sys:imports/<concept>` and `sys:generated` claim in the slice-zero gate, named
`SYSTEM.imports.<concept>` and `SYSTEM.generated` and bound in `evals/bindings/system.json` (`system.eval-system-checks`).
`bash run.sh --list` needs no world.

Both checks read the files of the receipt's `commit` from git, never the working tree, so the verdict is about the build the
run tested. Evidence for each check is in `<run>/system/<check>.json`.

- **Imports:** TypeScript or JavaScript must exist under some `packages/<package>/src/<concept>/` (`system.layout`). Every
  module a file names, read from its syntax tree (import and export declarations, `import = require()`, `import()` types,
  `import()`, `require()` and `import.meta.resolve()` calls, `new URL(…, import.meta.url)`), that reaches another
  concept's folder must name a concept in the record's `dependsOn` and land on its `src/<other>/door` (`.ts` or `.js`);
  any other module or file there is a violation. Relative paths resolve against the file, and `@capxul/<package>`
  imports resolve through that package's `exports` map as Node loads them (first matching condition in object order,
  `require` for `require()`). An `@capxul` import that resolves to no file at the commit, or a call whose argument is
  not a literal, is a violation. Tests in a
  concept folder count; a receipt commit marked `+dirty` is refused. A concept with no such code fails with that
  reason rather than passing empty. Each concept's lane fixes its own violations; the check lists every one with its line.
- **Generated:** in a clean `git worktree` of the receipt's commit, after `pnpm install --frozen-lockfile` (offline
  first), runs that commit's own `packages/generate/src/main.ts --check` and passes only on exit 0. The evidence keeps each
  step's command, exit, stdout and stderr. Until `packages/generate` exists at the commit, it fails with that reason.
