## What
Read docs/mission/research-2026-11-11.md, section 'What stands between the portal and Aaron accepting it', first. Items 3 and 4: operation pages infer "no code exists" from having no verdict, and verdict rows drop the run, date, commit and evidence, so a reader cannot tell an old pass from proof at the built commit. Say "no recorded verdict" where that is what is known, use the real stand definitions for Build, and keep and link each verdict's run, date and commit, marking results older than the built commit. Touch packages/portal/src/modules/site/internal/locate.ts, render/internal/evals.ts, render/internal/operation.ts and render/internal/lists.ts only (other runs have the Overview, Questions and site.js). No visual design change beyond the added provenance text.
## Why
Exit g7: a page that claims more than is known cannot be accepted.
## Done when
- An operation page with no verdict says no recorded verdict, and a verdict row shows its run, date and commit, each with a test
- pnpm portal:check and the portal's tests pass

## The coordinator's answer, 11 November 2026
Yes to the maker's ask of run m1-portal-provenance-11110835: change the provenance data types and their callers as far as needed to pass the built commit through, and update the portal tests that assert the old "no code exists" lines, with regression tests for the new behaviour. Still no change to the Overview, questions.ts or site.js.
