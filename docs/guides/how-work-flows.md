# How work flows

Why the rebuild line, its slices, its lanes and its threads work the way they do. The rules themselves are in
[AGENTS.md](../../AGENTS.md), "This branch is `master`", "How work flows" and "Lanes, leads and the conductor"; this
page only explains them.

## The rebuild line

`master` was cut from `main` at `f12a831` on 13 November 2026, at Aaron's request, to rethink the blueprint and the
build pipeline without disturbing the product work in flight on `main` and `integration/build`. That is why the two
lines never merge into each other by routine: each would carry half-finished work into the other.

## Slices

A slice is an integration branch for one effort: a journey, or an item of the roadmap. Each piece of work in it is a
small pull request that the slice's lead merges on a green `gate` (rungs 1 to 5, a few minutes). The slice reaches
`master` in one pull request, so `master` changes in whole efforts, each proven together.

A builder may change the world and the runner's plumbing, but not the journeys or the runner's generic checks, because
those judge its work. A builder that could change its own judge could pass by changing the judge.

## When `world` runs

`world` is rung 6: the thin line's journeys in a fresh private world on staging. It is slow and it spends GitHub Actions
minutes and Cloudflare and Neon money, so it runs only where its answer decides something:

- at a slice's merge into `master`, from a pull request that is not a draft and changes more than documents or
  records, so a lead keeps its slice's pull request a draft until it is ready to land;
- once a day on `master`.

Aaron decided on 14 and 15 November 2026 that Actions minutes are spent on the journeys only at a slice's merge, and
that a run is not repeated under load. On 15 November 2026 he paused full runs until the run is fast: only the speed
lane's slice runs `world` meanwhile ([decisions](../decisions.md), "Full runs paused until the run is fast").

## Measure first

Every verdict holds every operation's timings, caller and server, with the spans of each of its parts, so a slow
journey can be explained before anyone guesses at a fix. A budget is a target, not a gate: when a measured p95 runs
over 1.5 times its budget, the answer is an architecture review, not a failed pull request
([decisions](../decisions.md), "Budgets are targets").

## Lanes, leads and the conductor

A lane is a chain of roadmap items, each needing the one before. Lanes whose needs are met start at once, so
independent lanes run in parallel, each on its own slice.

- The **conductor** starts and archives leads, and watches the spend and the bench's load. It keeps its state in the
  roadmap and the leads' sessions, not in its own memory, so a fresh conductor can take over from them alone.
- A **lead** runs one lane. It has an author write each item's journeys and checks first, so they fail on empty
  handlers, then has builders make them pass.
- A **builder** does one piece of work in one pull request.

## The kit

Every thread is one type, titled with its emoji. The kit in `.agents/skills/` is written for any agent (Amp, Claude
Code, Codex):

- `threads`: the types, and each agent's word for starting, messaging, reading and archiving a thread;
- `conductor`: the conductor's loop, and the rule that a slice reaches `master` only with a 🔍 pass, a fresh `gate`
  and `world`;
- `hashtags`: Aaron's `#shortcuts`;
- `reviewer`: the 🔍 review.

`.claude/skills/` and `.claude/agents/reviewer.md` are links to it, so Claude Code finds the same kit.

## Aaron's computer

A Claude Code cloud session that connects to Aaron's computer is limited to his trusted devices for good, and then no
cloud thread or scheduled task can reach it. So a cloud session never connects, and work that needs his machine is
done by a conductor running there (Amp, Codex, a terminal).
