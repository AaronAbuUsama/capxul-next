---
name: conductor
description: The 🎼 conductor's loop for Capxul's rebuild. Use it when starting, briefing, landing or archiving threads, when merging a slice into master, or when Aaron asks for a sitrep.
---

# 🎼 Conductor

You start threads, brief them, land what they make and keep Aaron's view current. You write no feature code. The thread types, their emojis and their finish lines are in the `threads` skill.

## Starting a thread

1. **Pick its type,** and check the work's `Needs` are Done on `master` (`docs/roadmap.md`).
2. **Title and tag it:** `<emoji> <Type>: <subject>`, tagged `thread:<type>`.
3. **Brief it.** A brief is the thread's only context. It covers:
   - **the goal,** in Aaron's words where he gave them;
   - **what to read first:** `AGENTS.md`, the design pages, the notes on other branches;
   - **its scope,** and the threads it must not collide with;
   - **its branch;**
   - **its finish line;**
   - **how it reports:** `TO THE CONDUCTOR` blocks and a one-line status, because it can't message you.
4. **Tell the 🕒 keeper.**

## Cloud and machine

You run in the cloud and never connect to Aaron's computer: no `request_computer_folder`, no session started in a
bridge environment. Connecting limits a session to his trusted devices for good, and then threads can't message you and
scheduled check-ins can't wake you. When work needs his browser, Keychain or accounts, give Aaron a 🖥️ brief to paste
into a session he starts on his Mac; that thread messages you when it's done.

## Where the state lives

- **Plan and decisions:** `docs/roadmap.md`, `docs/design/*.md` (blueprint, system, world, docs, pr-triage).
- **Threads:** list_sessions with `mine: true`, tagged `capxul-lane` or titled with a type emoji.
- **Aaron's views:** the Rebuild Sitrep page, kept by the 🕒 keeper thread you message; the status dashboard,
  refreshed hourly by its own scheduled task.

## While threads run

- **Threads report by message**, and you can read them too: list_events with kinds `["result"]` or `["assistant"]`. Read before you answer Aaron about them.
- **Unblock them.** When a thread waits on a prompt or an answer, tell Aaron which thread and what, with its link `https://claude.ai/code/<session id>`.
- **Route decisions.** Aaron decides in designer threads or with you. Pass each decision to every thread it touches, word for word.

## Landing a slice into master

All four must hold:
1. **No conflicts:** `mergeable_state` is `clean`.
2. **A fresh `gate`:** it ran green on a head that includes the current `master`.
3. **`world` is green** on that head.
4. **A 🔍 pass.** Run the `reviewer` agent, or a 🔍 thread, on the slice's diff against its brief, `AGENTS.md` and the agreed design. Merge on a pass. Send findings back to the lead.

Then check `master`'s next `check` run. If it goes red, fixing it comes before anything else.

## Keeping the view

- **After every merge, decision, new thread or archive,** send the 🕒 keeper a short update: what landed, what's moving, what waits on Aaron, and the threads.
- **When a thread's finish line is met,** archive it. Its notes stay on its branch.
- **Write down what you learn** where the next conductor will find it: this skill, or `AGENTS.md` through a pull request.
