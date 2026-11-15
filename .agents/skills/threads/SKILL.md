---
name: threads
description: Thread types for Capxul's agent threads, each with its emoji, job and finish line, whatever agent runs it (Amp, Claude Code, Codex). Read it when you start a thread, or when your brief names your type ("you are a 🔨 builder thread").
---

# Thread types

A **thread** is one agent conversation working on this repository: an Amp thread, a Claude Code session, a Codex
session. Every thread is one **thread type**. Its title starts with the type's emoji, so Aaron can see what each one is
at a glance: `<emoji> <Type>: <subject>`, for example `🔨 Builder: invitation accept in the new format`. Where your
agent has tags or labels, tag it `thread:<type>`, in your agent's form (the table at the end).

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

## Talking to Aaron: he listens, he doesn't read

Unless Aaron says otherwise, he talks to you through speech-to-text and listens to your answers through text-to-speech
(Aaron, 15 November 2026). So:

- **Read his words for meaning, not spelling.** Speech-to-text mishears names, numbers and code words; take the likely
  meaning, and ask only when two meanings would lead to different work.
- **Write to him for the ear.** Short, plain sentences, in the order he needs them: the answer first, then why, then
  what waits on him. No tables, no code blocks and no symbols that read badly aloud (arrows, slashes, asterisks,
  emoji in the middle of a sentence). Say what a pull request does rather than reading out its number; put numbers,
  links, branch names and commands at the end, after the spoken part, for when he looks at the screen.
- **Numbered lists** are fine, kept short, each item a full sentence. Decisions are offered as a few numbered options
  with your recommendation said first.
- **Messages to the conductor or another thread** are not for Aaron's ears. Keep them exact and complete, with numbers,
  branches and links: send them as messages to that thread, never through Aaron.

## Threads in your agent

The kit names actions, not tools. Use your agent's own:

| Action | Claude Code (cloud) | Amp | Codex |
|---|---|---|---|
| Start a thread | `create_session` | `create_thread`: an orb by default, or a live `amp` runner on Aaron's Mac when one is connected | a new session: `codex exec` (or `codex` and `/new`) on the machine, `codex cloud exec --env <env>` in the cloud |
| Run a short side task | a subagent (`Agent`) | a subagent (`Task`) | a subagent: ask Codex to spawn one |
| Message a thread | `send_message` | `send_thread_message`; a thread it starts reports back the same way when its brief asks it to | `codex queue --thread <session> --message "…" --resume`, for a session on the same machine; none for a cloud chat |
| Read a thread | `list_events` | `read_thread` for its whole history, `get_thread_status` for its live state and latest messages | its transcript under `~/.codex/sessions/`, or `/export` inside it; `codex cloud list` for cloud chats |
| Archive a thread | `archive_session` | `update_thread` with `archived: true` (`false` restores it); the threads it started stay active | `codex archive <session>` (`codex unarchive` restores it); the subagent sessions it spawned go with it |
| Tag a thread | the tag `thread:<type>` | the label `thread-<type>`: labels take only letters, digits and hyphens | none: the title carries the type (`/rename`) |
| A thread's link | `https://claude.ai/code/<session id>` | a Markdown link, the title as its text: `[<title>](https://ampcode.com/threads/T-…)` | a cloud chat's `url` from `codex cloud list`; a local session has none, so give its session ID |

Where a cell is wrong for your agent, fix it in a pull request: this table is the one place it is written.
