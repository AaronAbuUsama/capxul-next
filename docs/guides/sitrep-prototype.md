# Goal: a polished, working prototype of the Sitrep, built on the blueprint's shapes

You are building the prototype of Aaron's Sitrep: a phone-first app that shows where Capxul's rebuild stands and
what needs him. The last mockups were wireframes. Aaron's words: "it's got to look really nice, consistent, and feel
consistent. Prototype it, test it, poke it, record it, and take evidence of all of it working."

Work only under `spikes/sitrep/prototype/` on branch `design/sitrep`. Change no product code. Never print a key.

## Read first

1. `docs/design/sitrep.md`: the agreed direction (five tabs, the things, how answers flow back).
2. `spikes/sitrep/README.md` and `spikes/sitrep/src/`: the seven things (plan, milestone, step, lane, thread, ask,
   sitrep), every change a stamped event (who: agent thread, person or pipeline run; when), state derived by replay.
   `./run.sh prove` and `./run.sh generate` must keep passing.
3. The `artifact-design` and `dataviz` skills (load them with the Skill tool) for the page contract, tokens and charts.
4. The Mobbin references, Aaron's collection "Capxul sitrep" (load the Mobbin tools with ToolSearch:
   `select:mcp__Mobbin__get_collection_contents,mcp__Mobbin__search_screens,mcp__Mobbin__search_flows`).
   Open the screens, look at them, and copy their patterns, not their branding:
   - Now: an agent's question card with lettered options and a "Recommended" chip (Grok); a poll that resolves in
     place with undo (Discord); pending requests with inline actions (Remote); Linear's inbox and its undo toast.
   - Plan: Linear's project page with issues grouped by state (flow); Amie and Attio for "Done (n)" folds; Plane's
     burn-down with a verdict sentence and an ideal line; GitHub's issue page and ClickUp's relationships for a step.
   - Lanes: GitHub Copilot's agent sessions; Perplexity's agent steps.
   - Measures: Bevel's trend cards; Copilot Money's spent-against-budget bars; The Outsiders' zones.
   - Sitreps: Queue's chapter scrubber; Apple Podcasts' speed row; Neuecast's played state and day groups.
   - Navigation: Linear Mobile's tab bar; X's five tabs with one badge; Airwallex's side panel on desktop.
   Search Mobbin further wherever a screen below has no reference.

## The data: real, and through the blueprint's projection

Write `spikes/sitrep/prototype/seed.py` that builds a full event log, `prototype/events.jsonl`, from the real state:
`docs/roadmap.md` (the plan's text, every milestone with its goal and done-when, every step), the status feed's step
states and done times (`python3 packages/status-feed/build.py` into `var/status-feed/`; in a shallow clone run
`git fetch --unshallow origin master` first; `.agents/skills/sitrep/numbers.py` shows the row-3.3 workaround), the
lanes, pull requests and threads in `.agents/skills/sitrep/example/now.json`, and its sitreps. Add two asks written
to the full ask schema (problem, context, rubric, options with trade-offs, recommendation and why), marked as
examples. Then project it with the spike's `project()` (add a `--log` argument to `src/main.ts` rather than copying
code) into `prototype/snapshot.json`. If the projection refuses the log, fix the log, not the projection. The page
reads only that snapshot, embedded at build time: it shows nothing that the blueprint's shapes did not pass.

## The prototype

One HTML page, `prototype/sitrep.html`, built by `prototype/build.mjs` from `prototype/src/` (Preact with `htm`, from
`https://cdn.jsdelivr.net/npm/preact@10.19.3/dist/preact.umd.js`, its `hooks/dist/hooks.umd.js`, and
`https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js`; nothing else external but Google Fonts). It follows the
artifact page contract: no doctype or head of its own, a `<title>`, every colour a token in light and dark, the
safe-area gutters, no sideways scroll at 390 pixels.

The design bar:

- **One system.** A type scale of five sizes, a 4-pixel spacing scale, two radii, one icon set (inline SVG, one stroke
  width), one accent, and semantic colours used only for state. Write the tokens first, at the top of the stylesheet,
  and use nothing else.
- **Native on a phone:** large titles that shrink on scroll, a five-tab bar with one badge style, pushed pages with a
  back chevron and a swipe-like slide, grouped inset lists, a mini player above the tab bar. **On a laptop:** a
  sidebar, the list in the middle, the detail in a right panel.
- **Every state designed:** loading, empty ("Nothing needs you"), stale (a source older than 30 minutes shows its age
  in amber, in words), and an error.
- **Motion that helps:** page pushes, folds and the answered card, each under 250 ms, none with reduced motion.

The screens:

1. **Now:** only what needs Aaron. Each ask is a card: who asked and how long it has waited; the question; the
   options as lettered rows with "Recommended" on one; and "Problem", "Context", "Rubric" and "Why this
   recommendation" folded away under "Details". The last option is always "Answer in my own words", which opens a
   text box. Answering resolves the card in place, with an undo toast. The answer becomes an `ask_answered` event,
   stamped by Aaron with the time, and shows in the ask's history. Below the asks come health (master, the last full
   run) and new sitreps.
2. **Plan:** the written plan first, with its title, why, what, where it ends and what it leaves out, its state
   ("agreed by Aaron, 17:20"), and the whole plan's burn-down with a verdict sentence. Then the milestones. A
   milestone's page has its goal, why now, done-when, progress, its burn-down, and its steps grouped Moving and Not
   started, with "Done (n)" folded. A step's page has its state, what, why, done-when, what it needs (linked), its
   lane, its proof, its pull requests, and the ratchet it closes. **Every plan, milestone and step page ends with its
   history:** each event, who (with the thread's emoji and type, Aaron, or the pipeline's run), and when.
3. **Lanes:** rows like Copilot's agent sessions. A lane's page has its lead thread, its steps, pull requests with
   states, threads, its sitreps and its history.
4. **Measures:** a card per counted ratchet, with its sparkline and verdict ("down 14 today"), the uncounted ones
   folded; the run's budget as a bar that turns red past 1.5 times; the evals, marked "not measured yet".
5. **Sitreps:** day groups, unheard bold with a dot, partly heard with a progress bar, heard dimmed. Tap to fold one
   open: its parts (tap a part to play from it), play, mark heard, and links. The player uses the artifact's `tts`
   capability (`await window.claude?.use?.("tts")`; read
   `/tmp/claude-0/bundled-skills/*/artifact-capabilities/*/tts.d.ts`) with speed, pause, back, forward and a parts
   bar. Where `tts` is null, the page says reading aloud is not available here, and the text stays readable. Hearing a
   sitrep is a `sitrep_heard` event in its history.

## Test it, poke it, record it

Write `prototype/test.cjs` (Playwright is preinstalled: `require('playwright')`, `chromium.launch()`), with a fake
`window.claude` whose `tts` follows the `tts.d.ts` contract, as `.agents/skills/sitrep/test.cjs` does. It must check:

- 390, 768 and 1440 pixels, light and dark: no sideways scroll, no console errors, the five tabs present;
- every screen above reached by clicking, and its key content visible;
- an ask answered with an option, then undone, then answered in own words, and the answer in its history;
- Plan, then a milestone, then a step, then a needed step, then back twice, landing where it started;
- the player: play, pause, resume, forward, back, speed to 1.5 (and `setRate` called), a jump by the parts bar, stop;
  the sitrep then shown as heard;
- keyboard: Tab reaches every control with a visible focus ring; Escape closes the open fold or panel;
- reduced motion: no animation runs.

Then record evidence into the scratchpad folder
`/tmp/claude-0/-home-user-capxul-next/4707df65-5966-5bd3-9a4a-3fc5e8c023d9/scratchpad/prototype-evidence/`:
screenshots of every screen at 390 (deviceScaleFactor 2) in light and dark and at 1440 in light; and three videos
with Playwright's `recordVideo` at 390 by 844: answering an ask, walking plan to milestone to step and back, and
playing a sitrep with the controls. Look at every screenshot yourself and fix what looks wrong before you finish:
alignment, spacing, contrast, truncation, anything that does not look like it belongs to one product.

## Done when

- `node spikes/sitrep/prototype/test.cjs` passes, and `./run.sh prove` still passes;
- the evidence folder holds the screenshots and three videos, with `EVIDENCE.md` listing each file and what it shows;
- `pnpm shape`, `pnpm lint` and `pnpm format:check` pass;
- everything is committed on `design/sitrep` and pushed (never force-push).

Report back in under 400 words: what you built, the test results, the evidence files, and anything you could not do
and why. Do not publish the artifact: the designer reviews and publishes it.
