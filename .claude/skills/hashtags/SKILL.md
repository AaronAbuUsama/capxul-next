---
name: hashtags
description: Aaron's #shortcuts for the conductor. Use it when his message holds a #word such as #menu, #threads, #waiting, #sitrep, #landed, #next, #decide, #new or #archive.
---

# #shortcuts

A `#word` in Aaron's message is a command. Answer it in the shape below, short and current. Gather the facts first, with list_sessions (`children: true`), list_events, the pull requests and `master`. A shortcut with words after it (`#new 🔍 the blueprint slice`) passes them on. Several shortcuts in one message are answered in order.

| Shortcut | What you give back |
|---|---|
| `#menu` | This table as a short list: each shortcut and what it gives back, one line each. |
| `#threads` | Every active thread, one line each: `<emoji> [title](https://claude.ai/code/<session id>)`, what it's doing, and what it waits on, if anything. Then the archived ones from today, on one line. |
| `#waiting` | Only what waits on Aaron: each prompt or question, its thread's link, and your recommendation. Prompts to approve first, then decisions. |
| `#sitrep` | Five lines (done, moving, waiting, next milestone, `master`'s state) and the sitrep page's link. Send the 🕒 keeper an update as well. |
| `#landed` | What merged into `master` today, newest first: number, title, one line on what it means. |
| `#next` | The critical path to the next milestone, step by step, with your estimate of when, and what could stretch it. |
| `#decide` | Every open decision across the threads, batched, each with options and your recommendation, so Aaron can answer them in one reply. |
| `#new <type> <subject>` | Start a thread of that type (the `threads` skill) with a brief, then give back its link. |
| `#archive` | The threads whose finish line is met, and confirmation once they're archived. |

Links use the thread's title as their text, never a bare id.
