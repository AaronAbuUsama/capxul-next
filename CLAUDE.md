# CLAUDE.md

> **9 November 2026: read [START-HERE.md](START-HERE.md) first.** The direction changed: capxul-next becomes the rebuild of Capxul Core, Frappe-native, coordinated through the ledger portal with Aaron in the loop (no swarmD). Where this file disagrees with START-HERE.md, START-HERE.md wins.


This repository holds the Capxul rebuild: a typed design book (`books/target`, `packages/book`) and,
from the build session on, the product code it describes.

- **Start here.** Read `HANDOFF.md`. To build, the goal is `docs/mission/initializer.md`. Read
  `docs/design-book.md` before you add or change a record.
- **The book changes first.** When code needs to differ from the book:
  1. change the record and add a decision record;
  2. rebuild to zero problems;
  3. change the code.

  Never edit `books/frozen/` or any file under a `src/generated/` folder.
- **What is fixed is behaviour, not spelling** (`system.frozen-behaviour`). Each of the 215 old
  operations is either booked in the book or classified by the cut (reached, dropped or parked: `books/target/shared/cut.ts`,
  `docs/cut-archive/INDEX.md`), never both and never neither. A booked operation's acceptance claims are the evals. Commands, flags,
  `--json` shapes, refusal codes and wording are the target book's to design as one system. A
  change to any of them goes into the book first, with a decision.
- **Every change passes these checks before it merges:**

  ```bash
  pnpm exec tsc -p packages/book && pnpm test
  pnpm exec tsc -p books
  node --experimental-strip-types packages/book/src/main.ts books/target/index.ts /tmp/target   # 0 problems
  node --experimental-strip-types tools/check-frozen.ts                                           # 0 breaches: every behaviour kept
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
- **Old system.** `Xelmar-tech/infrastructure` (branch `integration/factory`) is a reference for
  behaviour, not a baseline. Read its code for edge cases (contract reverts, money paths,
  permissions). Never port it, and never run the evals against it. The as-is book is closed and
  archived in `docs/as-is/archive/`.
