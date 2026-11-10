## What
Make the book's contract records match the code now in `packages/contracts`, and add a check that fails when they differ. Known differences: the book says Safe 1.4.1 and the code uses 1.5.0; the book describes a general escrow that was never built; several records list fewer functions than the code; the recorded test addresses differ from what the build deploys.
## Why
This is exit line g4. A book that disagrees with working code is wrong, and nobody can tell which parts.
## Done when
- A tool compares each contract record's functions and events with the compiled contracts and fails on a difference.
- The four known differences are resolved in the book, each by a decision.
## Links
- `packages/contracts/README.md`
- `books/target/` contract records
