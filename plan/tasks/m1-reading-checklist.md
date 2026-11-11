## What
Read docs/mission/research-2026-11-11.md, "What stands between the portal and Aaron accepting it", item 1. Make the plan task m1-aaron-accepts readable as a reading checklist: write plan/tasks/m1-aaron-accepts.md's What as an ordered list of the portal pages Aaron should read to accept the book (Overview, Plan, Questions, the concepts, Architecture, Build, Worlds, Docs), each with one line on what to look for and the question it should answer for him, and say that his acceptance is tied to the commit the portal shows. Do not change the portal's code or design. Touch plan/tasks/m1-aaron-accepts.md only (the coordinator records its plan changes).
## Why
Exit g7: Aaron reads the portal and accepts it. Without a checklist, the read has no end and no commit.
## Done when
- plan/tasks/m1-aaron-accepts.md holds the ordered checklist, every page named exists in the built portal (pnpm portal, then look in packages/portal/dist), and pnpm plan check passes
