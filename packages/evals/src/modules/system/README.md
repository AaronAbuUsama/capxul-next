# system

One static check per `sys:imports/<concept>` and `sys:generated` claim in the slice-zero gate, named
`SYSTEM.imports.<concept>` and `SYSTEM.generated` and bound in `evals/bindings/system.json` (`system.eval-system-checks`).
`bash run.sh --list` needs no world.

Both checks read the files of the receipt's `commit` from git, never the working tree, so the verdict is about the build the
run tested. Evidence for each check is in `<run>/system/<check>.json`.

- **Imports:** TypeScript must exist under some `packages/<package>/src/<concept>/` (`system.layout`). Every import there
  that reaches another concept's folder, by relative path or by an `@capxul/<package>/…` subpath, must name a concept in the
  record's `dependsOn` and land on `packages/<package>/src/<other>/door.ts`. A concept with no such code fails with that
  reason rather than passing empty. Each concept's lane fixes its own violations; the check lists every one with its line.
- **Generated:** passes only once `packages/generate` regenerates every `src/generated/` from the records with no diff
  and the result compiles. Until the generator exists, it fails with that reason.
