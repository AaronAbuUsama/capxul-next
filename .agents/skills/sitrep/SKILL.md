---
name: sitrep
description: The Rebuild Sitrep, Aaron's live page of where the rebuild stands, in any Claude agent. Use it to update the sitrep after a merge, a decision, a new thread or an archive, to add a spoken sitrep, to answer #sitrep, to change the page's design, or to make the page again from scratch.
---

# Rebuild Sitrep

Aaron's one page for where the rebuild stands: https://claude.ai/artifact/CjRhEey4CEwXciharu1bPF

The page is a fixed template. It holds no data: it reads the artifact's own database and redraws live when the data
changes. So you update the sitrep by writing data, never by republishing the page. The design and the reasons are in
`docs/design/sitrep.md`.

| What | Where | Who writes it |
|---|---|---|
| The page | `template.html` here, published to the URL above | whoever changes the design, by pull request |
| Milestones, the next milestone's steps, the plan's totals, the burn-down | doc `sitrep/numbers` | `numbers.py`, from `docs/roadmap.md` and `master`'s history. Never typed |
| Needs you, `master`, the run time, lanes, landed, threads | doc `sitrep/now` | the conductor |
| One spoken update each | collection `sitreps` | the conductor |
| What each viewer has heard, and their reading speed | `data/users/<viewer>/sitrep-prefs` | the page itself |

Only a Claude agent with the artifact tools (`Artifact`, `ArtifactData`) can write it: a Claude Code cloud session or
Claude in the app. From Amp or Codex, give Aaron the sitrep in the thread and ask the conductor to write it.

## Updating it (the conductor, after every merge, decision, new thread or archive)

1. **Numbers.** In a shallow clone, first `git fetch --unshallow origin master`. Then
   `python3 .agents/skills/sitrep/numbers.py > "$TMP/numbers.json"` and write it with `ArtifactData` `set` on
   collection `sitrep`, doc `numbers`, `file_path` that file, `if_version` from a `get` of it.
2. **Now.** `get` `sitrep/now`, change what moved, `set` it back whole with its `if_version`. Check facts at their
   source first: pull requests and the `check` runs on GitHub, threads with `list_sessions`. Set `at` to now.
3. **A sitrep,** when something happened that Aaron would want to hear: `set` a new document in `sitreps` (no
   `if_version`: it is new). Its id is `YYYYMMDD-HHMM-<slug>` in UTC, which keeps ids unique and sortable.
4. Use one `batch` for all three: one approval, applied together.

Never rewrite an old sitrep to change history: add a new one. Delete a sitrep only when it was wrong.

## Writing a sitrep

Aaron listens to these (the `threads` skill, "Talking to Aaron"). Each one is:

- a **title** of a few words that says what happened: "Blueprint stage 2a landed";
- one to three **paras**, each one or two short sentences, the answer first; each para is one part of the player, so
  he can skip between them. No numbers of pull requests, branches, symbols or emoji in them;
- **links** at the end, `{label, href}`, for when he looks at the screen; every `href` starts `https://`;
- **lanes**: the ids of the lanes it belongs to, so it shows inside each lane too;
- say "Nothing needs you" when that is true. When something does, it also goes in `needsYou`.

## The data

`sitrep/now` (`schema` 1):

```json
{
  "schema": 1, "at": "2026-11-15T18:50:00Z", "repo": "AaronAbuUsama/capxul-next",
  "needsYou": [{ "title": "Seven decisions on cutting the run time", "detail": "About ten minutes", "href": "https://…" }],
  "master": { "state": "green | red | running", "label": "4c37d15", "href": "https://… the check run" },
  "run": { "minutes": 27, "target": 5, "state": "green | red", "href": "https://… the world run, or null" },
  "spend": null,
  "lanes": [{
    "id": "run-time", "name": "Speed", "state": "building | proving | done | broken | paused",
    "line": "One line under the lane's name",
    "where": "Where the lane stands, in a sentence or two",
    "next": "The next thing that will happen",
    "gauge": { "label": "Full run time", "now": 27, "target": 5, "max": 50, "unit": "min", "note": "optional" },
    "steps": [{ "id": "4.12", "name": "The run's plumbing", "state": "building | proving | queued | Done" }],
    "prs": [{ "number": 341, "title": "slice/run-time into master", "state": "merged | open | draft | queued | checks running | checks failed | closed" }],
    "lead": "https://claude.ai/code/session_…"
  }],
  "landed": [{ "at": "2026-11-15T17:53:20Z", "title": "What landed, in plain words", "href": "https://…" }],
  "threads": [{ "title": "🧭 Lead · speed", "state": "active | archived", "href": "https://claude.ai/code/session_…" }]
}
```

`gauge`, `steps`, `prs` and `lead` are optional. Keep `landed` to the last eight or so, newest first, and `threads` to
the live ones. `sitreps/<id>`: `{ "at", "title", "paras": [], "links": [{ "label", "href" }], "lanes": [] }`.
`sitrep/numbers` is whatever `numbers.py` prints; never edit it by hand. `example/` holds a full set, from
15 November 2026.

## What the page does

Five tabs, at the bottom on a phone and down the side on a laptop (published 16 November 2026, the v3 design).

- **Now:** what needs Aaron first (or "Nothing needs you"), then health (`master`, the run time against its target),
  then the newest unheard sitrep, open, with play, "Mark heard" and its links.
- **Plan:** the plan's progress and its burn-down (hover or touch for each point: when, how much was left, what
  happened), then the milestones. A milestone opens as its own page with a back button.
- **Lanes:** one row per lane. A lane opens as its own page: where it stands, its measure, its steps, its pull requests
  and its sitreps.
- **Measures:** the measured figures the data carries.
- **Sitreps:** unheard first, then heard. Each opens to its text, a play button and its links.
- **The player,** while reading, sits above the tabs: pause and resume, back, forward, a speed of 0.8, 1, 1.25 or
  1.5 times, and a bar of parts to jump to. The platform's voice has no seek, so a jump is always to the start of a
  part. Heard state and speed follow the viewer across devices.
- Reading aloud works in Chrome and the desktop app. Safari, Firefox and the mobile apps show the text without a
  play button.

## Changing the page

1. Edit `template.html`. Keep its rule: no data in it, and every colour a token in both themes.
2. `node .agents/skills/sitrep/test.cjs` must pass. It renders the page at 390, 768 and 1440 pixels, light and dark,
   with a fake database and voice fed from `example/`, and drives every control. Look at its screenshots.
3. Publish: the `Artifact` tool, `url` the sitrep's, `file_path` this template, and leave `capabilities` out so the
   stored ones stay. Then open a pull request with the template change.
4. A change to the data's shape changes the schema above, `example/`, the test and `numbers.py` in the same pull
   request, and the conductor's next write.

## Making it from scratch

For a new artifact (a new URL), publish `template.html` with:

```json
{ "db": { "rules": [ { "path": "", "read": "view", "write": "admin" },
                     { "path": "data/users/{self}", "write": "interact" } ] },
  "user": {}, "tts": {} }
```

Then write `sitrep/numbers`, `sitrep/now` and a first sitrep as in "Updating it", read them back once with
`as_level: "view"`, and put the new URL at the top of this file.

## #sitrep

Answer for the ear: the newest unheard sitrep's text, then the five lines the `hashtags` skill names, then the page's
link at the end.
