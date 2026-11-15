---
name: threads
description: Thread types for Capxul's cloud sessions, each with its emoji, job and finish line. Read it when you start a thread, or when your brief names your type ("you are a 🔨 builder thread").
---

# Thread types

Every cloud session on this repository is one **thread type**. Its title starts with the type's emoji, so Aaron can see what each one is at a glance: `<emoji> <Type>: <subject>`, for example `🔨 Builder: invitation accept in the new format`. Tag it `thread:<type>`.

The conductor starts threads, briefs them and lands what they make. Report to it with send_message to the session id your brief names: when you finish, when you're blocked, and when a decision is needed. End each turn with a one-line status too, because the conductor also reads threads directly.

`AGENTS.md` binds every type. That covers its standing rules, the ladder, and "Lanes, leads and the conductor".

| Emoji | Type | Job | Finished when |
|---|---|---|---|
| 🎼 | Conductor | Starts, briefs, lands and archives threads; keeps `master` green; routes Aaron's decisions; feeds the keeper | Never; a fresh conductor can take over from the roadmap and the threads |
| 🧭 | Lead | Runs one lane on its `slice/<lane>`: has authors and builders do its items, merges their pull requests into the slice, lands the slice on `master` | Every item of the lane is Done on `master` with its proof |
| ✍️ | Author | Writes the journeys and checks for an item from its blueprint delta, before any build; they fail on empty handlers | The journeys fail on empty handlers, in a pull request into the slice |
| 🔨 | Builder | Does one piece of work: one branch, one pull request into the slice | The pull request is merged with `gate` green; never touches journeys or the runner's checks |
| 🔍 | Reviewer | Reads a diff against its brief, `AGENTS.md` and the agreed design, independent of whoever wrote it | A verdict: pass, or the numbered findings that block it |
| 📐 | Designer | Works a question through with Aaron: options, a recommendation each, his decision recorded | Each decision is written in `docs/design/<topic>.md` on a `design/<topic>` branch, with its date |
| 🧹 | Triage | Sorts a backlog (pull requests, issues) into groups with a recommendation each | Aaron has decided every group; only the groups he approved are acted on |
| 🕒 | Keeper | Keeps one page or file current from the updates it is sent | The page shows the latest update, checked against the repository |
| 🖥️ | Local | Runs on Aaron's Mac for what only it can reach: his browser, his Keychain, his accounts | The task is done, and nothing secret was printed or written outside the Keychain |

## Rules every type keeps

- **Land on a fresh base.** Merge a pull request only when it has no conflicts and `gate` ran on a head that includes the current `master`. Two pull requests that were each green have broken `master` together.
- **A slice into `master` needs a 🔍 pass** as well as `gate` and `world`.
- **Secrets stay out of view.** Never print a key or connection string, or write one to a file or repository.
- **Use the glossary's words:** `docs/design/blueprint.md`, part 12.
