# Remaining work, and how to run it

Status on 8 November 2026. The weekly usage limit was nearly spent, so the work is paused at the
end of milestone 2 (the as-is book) and milestone 3 (the target architecture). Everything written so
far is committed on `claude/infrastructure-refactor-plan-v41iue`. The scripts are in
`tools/workflows/`: pass a script's text as a Workflow `script` and the lanes below as `args`.

## Milestones

| # | Milestone | State |
|---|---|---|
| 1 | Groundwork: schema for the accepted decisions, frozen text of all 215 operations, conventions | done |
| 2 | As-is book of the whole old system | 15 of 21 lanes written; 1 reviewed |
| 3 | Target architecture: concept map, components, kept errors, integrations, v4 contracts, decisions | running when paused; check `books/target/` and `docs/decisions/target-architecture.md` |
| 4 | As-is merge: retire `payments/neighbors.ts` stand-ins, build the whole system, system findings | not started |
| 5 | Target design per concept | not started |
| 6 | Target book built with the target rules, zero problems | not started |
| 7 | Spike: Effect Workflow on Postgres survives kill and resume | not started (needs Postgres) |
| 8 | Handoff: rewrite `initializer.md` around the finished book; final report of every judgment | not started |

## Milestone 2: lanes still to write

Run with `tools/workflows/book-as-is-writers.js` (writers only). Each writer first lists the names
other files already expect from its lane (`npx tsc -p books | grep <folder>`) and defines them.

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
