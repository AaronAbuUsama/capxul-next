---
name: threads
description: Thread types for Capxul's agent threads, each with its emoji, job and finish line, whatever agent runs it (Amp, Claude Code, Codex). Read it when you start a thread, or when your brief names your type ("you are a 🔨 builder thread").
---

# Thread types

A **thread** is one agent conversation working on this repository: an Amp thread, a Claude Code session, a Codex
session. Every thread is one **thread type**. Its title starts with the type's emoji, so Aaron can see what each one is
at a glance: `<emoji> <Type>: <subject>`, for example `🔨 Builder: invitation accept in the new format`. Where your
agent has tags or labels, tag it `thread:<type>`.

The conductor starts threads, briefs them and lands what they make. Report to it when you finish, when you're blocked,
and when a decision is needed: message it if your agent can reach the conductor's thread, and in every case end each
turn with a `TO THE CONDUCTOR` block or a one-line status, because the conductor also reads threads directly.

`AGENTS.md` binds every type. That covers its standing rules, the gate, and "Lanes, leads and the conductor".

| Emoji | Type | Job | Finished when |
|---|---|---|---|
| 🎼 | Conductor | Starts, briefs, lands and archives threads; keeps `master` green; routes Aaron's decisions; keeps his view current | Never; a fresh conductor can take over from the roadmap, `docs/design/handoff.md` and the threads |
| 🧭 | Lead | Runs one lane on its `slice/<lane>`: has authors and builders do its items, merges their pull requests into the slice, lands the slice on `master` | Every item of the lane is Done on `master` with its proof |
| ✍️ | Author | Writes the journeys and checks for an item from its blueprint delta, before any build; they fail on empty handlers | The journeys fail on empty handlers, in a pull request into the slice |
| 🔨 | Builder | Does one piece of work: one branch, one pull request into the slice | The pull request is merged with `gate` green; never touches journeys or the runner's checks |
| 🔍 | Reviewer | Reads a diff against its brief, `AGENTS.md` and the agreed design, independent of whoever wrote it (the `reviewer` skill) | A verdict: pass, or the numbered findings that block it |
| 📐 | Designer | Works a question through with Aaron: options, a recommendation each, his decision recorded | Each decision is written in `docs/design/<topic>.md` on a `design/<topic>` branch, with its date |
| 🧹 | Triage | Sorts a backlog (pull requests, issues) into groups with a recommendation each | Aaron has decided every group; only the groups he approved are acted on |
| 🕒 | Keeper | Keeps one page or file current from the updates it is sent | The page shows the latest update, checked against the repository |
| 🖥️ | Local | Runs on Aaron's Mac for what only it can reach: his browser, his Keychain, his accounts | The task is done, and nothing secret was printed or written outside the Keychain |

## Rules every type keeps

- **Land on a fresh base.** Merge a pull request only when it has no conflicts and `gate` ran on a head that includes the
  current `master`. Two pull requests that were each green have broken `master` together.
- **A slice into `master` needs a 🔍 pass** as well as `gate` and `world`.
- **Secrets stay out of view.** Never print a key or connection string, or write one to a file or repository.
- **Use the glossary's words:** `docs/design/blueprint.md`, part 12.

## Threads in your agent

The kit names actions, not tools. Use your agent's own:

| Action | Claude Code (cloud) | Amp | Codex |
|---|---|---|---|
| Start a thread | `create_session` | a new thread, or a handoff | a new session |
| Run a short side task | a subagent (`Agent`) | a subagent | a subagent |
| Message a thread | `send_message` | none yet: Aaron passes the message, or the thread reads it from the repository | none yet |
| Read a thread | `list_events` | read the thread by its link | read its transcript |
| Archive a thread | `archive_session` | archive the thread | close it |
| A thread's link | `https://claude.ai/code/<session id>` | `https://ampcode.com/threads/<thread id>` | none |

Where a cell is wrong for your agent, fix it in a pull request: this table is the one place it is written.
