# CLAUDE.md

This repository holds the Capxul rebuild: a typed design book (`books/target`, `packages/book`) and,
from the build session on, the product code it describes.

- **Start here.** Read `HANDOFF.md`. To build, the goal is `docs/mission/initializer.md`. Read
  `docs/design-book.md` before you add or change a record.
- **The book changes first.** When code needs to differ from the book:
  1. change the record and add a decision record;
  2. rebuild to zero problems;
  3. change the code.

  Never edit `books/frozen/` or any file under a `src/generated/` folder.
- **Every change passes these checks before it merges:**

  ```bash
  npx tsc -p packages/book && npm test -w @capxul/book
  npx tsc -p books
  node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target   # 0 problems
  node --experimental-strip-types tools/check-frozen.ts                                           # 0 breaches
  ```

- **Where code goes:** decision `system.layout` in `books/target/shared/decisions.ts`. In short:
  - one package per component;
  - `src/<concept>/` mirrors `books/target/<concept>/`;
  - another concept's code is imported only through its `door.ts`;
  - lanes `lane/<concept>` merge into `integration/build`.
- **Tracking work.** Until the swarmD ledger runs, track work on the scoreboard and in
  `docs/mission/progress.md`: one line per finished lane, with its evals and its commit. This old
  Capxul repository's Linear workflow and `docs/rules` do not apply here.
- **Decisions.** Every judgment is a decision record. Bring Aaron only what the goal prompt lists
  under "Bring to Aaron".
- **Old system.** `Xelmar-tech/infrastructure` (branch `integration/factory`) is evidence only.
  Read it; never port from it without reading its as-is record.
