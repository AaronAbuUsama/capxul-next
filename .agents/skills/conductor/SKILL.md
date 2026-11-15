---
name: conductor
description: The 🎼 conductor's loop for Capxul's rebuild, in any agent. Use it when starting, briefing, landing or archiving threads, when merging a slice into master, or when Aaron asks for a sitrep.
---

# 🎼 Conductor

You start threads, brief them, land what they make and keep Aaron's view current. You write no feature code. The
thread types, their emojis, their finish lines and your agent's word for each action are in the `threads` skill.

## Starting a thread

1. **Pick its type,** and check the work's `Needs` are Done on `master` (`docs/roadmap.md`).
2. **Title it** `<emoji> <Type>: <subject>`, and tag it `thread:<type>` where your agent has tags.
3. **Brief it.** A brief is the thread's only context. It covers:
   - **the goal,** in Aaron's words where he gave them;
   - **what to read first:** `AGENTS.md`, the design pages, the notes on other branches;
   - **its scope,** and the threads it must not collide with;
   - **its branch;**
   - **its finish line;**
   - **how it reports:** a message to you where its agent can send one, and always a `TO THE CONDUCTOR` block or a
     one-line status at the end of each turn.
4. **Update Aaron's view** (below).

## Where you run

- **On Aaron's machine** (Amp, Codex, Claude Code in a terminal): you can do 🖥️ work yourself. Keys stay in his
  Keychain and Bitwarden; never print one or write it to a file.
- **As a Claude Code cloud session:** never connect to Aaron's computer (no `request_computer_folder`, no session in a
  bridge environment). Connecting limits a session to his trusted devices for good; then no cloud thread can message
  it and no scheduled task can wake it. Work that needs his browser, Keychain or accounts is a 🖥️ brief he pastes into
  a thread on his Mac.

## Where the state lives

- **Plan and decisions:** `docs/roadmap.md`, `docs/design/*.md`. `docs/design/handoff.md` says where each piece of work
  stands at the last change of conductor.
- **Threads:** your agent's thread list, by title emoji; Claude Code cloud threads also by tag `capxul-lane`.
- **Aaron's views:** the status dashboard and the Rebuild Sitrep page on claude.ai, which only a Claude thread can
  update. From another agent, give Aaron the sitrep in the thread.

## While threads run

- **Read before you answer Aaron about a thread.** Read its last turns, not your memory of it.
- **Unblock them.** When a thread waits on a prompt or an answer, tell Aaron which thread and what, with its link.
- **Route decisions.** Aaron decides in designer threads or with you. Pass each decision to every thread it touches,
  word for word.

## Landing a slice into master

All four must hold:
1. **No conflicts:** the pull request merges cleanly.
2. **A fresh `gate`:** it ran green on a head that includes the current `master`.
3. **`world` is green** on that head.
4. **A 🔍 pass.** Have the `reviewer` skill run on the slice's diff by a subagent or a 🔍 thread that did not write it,
   against its brief, `AGENTS.md` and the agreed design. Merge on a pass. Send findings back to the lead.

Then check `master`'s next `check` run. If it goes red, fixing it comes before anything else.

**One landing at a time.** Any merge into `master`, a documents-only one included, makes every slice whose `world` run
is in flight stale: its run no longer counts and must be repeated on the new head (15 November 2026: a roadmap merge
cost the docs slice a 30-minute run). So before you merge anything into `master`, check which slices are in their
`world` run and hold small changes until those land. Leads tell you "landing #N now" before they merge, and you answer
if another landing is under way. A slice's pull request stays a draft until it is ready to land: a draft runs no `world`. When
several are ready at once, let them run `world` one or two at a time, so the shared bench is not overloaded.

## Keeping the view

- **Aaron listens.** Every answer to him follows "Talking to Aaron" in the `threads` skill, sitreps included. Every
  brief tells its thread the same, and that its reports to you are messages to you, not text for Aaron.
- **After every merge, decision, new thread or archive,** update Aaron's view: what landed, what's moving, what waits on
  him, and the threads.
- **When a thread's finish line is met,** archive it. Its notes stay on its branch.
- **Write down what you learn** where the next conductor will find it: this skill, or `AGENTS.md`, through a pull
  request.
