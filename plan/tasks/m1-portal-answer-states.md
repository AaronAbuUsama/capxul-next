## What
Read docs/mission/research-2026-11-11.md, section 'What stands between the portal and Aaron accepting it', first. Item 5: on the Questions page an answer saved reduces the count only on that page; other pages keep the old count, and the page does not say before you answer whether this server saves answers or opens a GitHub issue. Show the serving mode before the buttons, and keep unanswered, saved and applied apart in what the page says. Touch packages/portal/assets/site.js and packages/portal/src/modules/render/internal/questions.ts only (another run has direction.ts and the Overview). Test it the way docs/mission/coordinator-handoff.md 'Traps' says: never record an answer on the real portal.
## Why
Exit g7, and Aaron's answers are the one thing the portal takes from him.
## Done when
- The Questions page states the serving mode before an answer, and saved and applied answers are told apart, with tests
- pnpm portal:check and the portal's tests pass
