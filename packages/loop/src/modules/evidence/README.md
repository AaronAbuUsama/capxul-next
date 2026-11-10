# evidence (generic)

What an agent shows for what it says. `types.ts` is the module: two records, kept apart.

- A **capture** is made by a tool the loop hands the agent. The tool writes the file and the record of how it was made
  into the run's evidence folder (`<run>/evidence/`, with `captures.jsonl`, one capture a line, only ever added to). The
  folder is outside the agent's directory, so an agent cannot write a capture by hand.
- An **evidence** entry is the agent's claim in its structured output: `{ capture, shows, eval? }`. `judge` checks each
  claim against the captures: a claim that names no capture of the run, says nothing, or names an eval the task does not
  have, does not stand, and says why.

| Tool | Makes | With |
|---|---|---|
| `record_terminal { name, command }` | `terminal`: a GIF and its cast, the command and its exit code | asciinema (no screen needed), agg |
| `browser { args }` | nothing: it drives the browser, one action a call | agent-browser |
| `screenshot { name, full? }` | `screenshot`: a PNG, the page's address and title | agent-browser |
| `record_screen { name, action }` | `screen-recording`: a GIF with a frame after each `browser` action between `start` and `stop` | agent-browser, ffmpeg |

`evidenceTools(deps)` builds them for one step's agent. The caller decides everything about who may do what: `refuse`
is its shell policy for a recorded command, `hosts` is where the browser may go (empty: no browser tools at all), and
`tooling` is which programs this machine has (`toolingOf(PATH)`); a missing program is said to the agent, never thrown.
A terminal recording opens with the command as typed and is drawn only as tall as its output.
The browser takes a closed list of actions (no `eval`, no cookies, no network rules), no long options, and opens only
`hosts`. Every program is run through `deps.exec`, so the tests need neither a recorder nor a browser; one test uses
the real recorder where it is installed.

A capture's hash and size are in its record, so a copy of a run's folder can be checked against it. That folder, with
the run's storage, is what a data set of runs is made from.

A browser recording is frames, not video, on purpose: agent-browser's own recorder (0.31.1) hung in its encoder after a
navigation and kept no file in two runs of three (10 November 2026), and a frame a step is what a reviewer reads.

Not here yet: real-time video, a native app (computer use), and any rule that an eval *needs* a capture: that rule is
the blueprint's.
