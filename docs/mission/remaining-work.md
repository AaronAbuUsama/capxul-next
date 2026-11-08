# Remaining work on the as-is book

This file is about the **as-is book only**: the lanes of the old system that were not written when
that book was paused on purpose. The rebuild's own state is in `HANDOFF.md`, and its next work is
`docs/mission/initializer.md`. The as-is book is evidence; target designers read the old code where
it has gaps, so these lanes are optional. The scripts are in `tools/workflows/`: pass a script's
text as a Workflow `script` and the lanes below as `args`.

## Milestone 2: lanes still to write

Run with `tools/workflows/book-as-is-writers.js` (writers only). Each writer first lists the names
other files already expect from its lane (`npx tsc -p books/as-is | grep <folder>`) and defines them.

| Lane | Writes |
|---|---|
| parties | `books/as-is/parties/` (27 files import its procedures) |
| books | `books/as-is/books/` (two partial files from a stopped writer: overwrite) |
| small-a | `activity/`, `profiles/`, `media/`, `documents/` |
| permissions-allowances | `permissions/allowances.ts`, `replacements.ts`, `commands.ts`, `flows-allowances.ts` |
| shared-events | the whole event catalog in `shared/vocabulary.ts` |
| ops-equity-orgs | `operations/equity.ts`, `operations/organizations.ts` |

The briefs, verbatim, are in `tools/workflows/remaining-lanes.json`: pass its `writers` array as
`args.lanes`, two or three lanes per workflow.

## Milestone 2: reviews still to run

Run with `tools/workflows/book-as-is-lanes.js` in review-only form (or the full script; a reviewer
rereads the old code at every `was:` and fixes the files). Order, by money risk first:

1. books, banking, requests, payroll, permissions (both parts), accounts
2. parties, the operation files, shared external and events
3. access, organizations (both parts), applications, operator, indexing, small-a

Usage note: 16 agents at once spent the five-hour limit in about 36 minutes. Run 4 to 6 agents at a
time.

## Judgments made in running the work

- **Reviews come after the missing writers, money concepts first** (8 November 2026). Low-risk
  as-is files may reach the target design unreviewed; the target designers reread the old code and
  the build catches structural errors.
- **Paused at 10% of the weekly limit** (Aaron, 8 November 2026): the target architecture is the one
  lane left running, as the highest-value judgment; the as-is writers stopped before writing.
