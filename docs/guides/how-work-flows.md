# How work flows

Why the rebuild line, its slices, its lanes and its threads work the way they do. The rules themselves are in
[AGENTS.md](../../AGENTS.md), "This branch is `master`", "How work flows" and "Lanes, leads and the conductor"; this
page holds the reasons that moved out of it, in their own words, and the decisions behind them.

## The rebuild line

`master` "was cut from `main` at `f12a831` on 13 November 2026, at Aaron's request, to rethink the blueprint and the
build pipeline without disturbing the product work in flight on those two branches" (`main` and `integration/build`).

## Slices

A builder must not change the scenarios or the runner's generic checks: "those judge its work". The decision behind it,
"The scenario author is not the builder" ([decisions](../decisions.md)): "A scenario is written before the build by a
different agent, and CI rejects one that already passes against an empty handler."

## When `world` runs

`world` runs only at a slice's merge and once a day on `master` (Aaron, 14 and 15 November 2026: "Actions minutes are
spent on the journeys only at a slice's merge, and a run is not repeated under load").

Until the run is fast, other slices land without it. The decision, "Full runs paused until the run is fast"
([decisions](../decisions.md)), quotes Aaron on 15 November 2026: "we need to speed this up. let's pause running the
full tests until we sort out the speed tests. let's keep the momentum up". It lasts until the speed lane brings a
`world` run under 10 minutes; meanwhile the speed lane's slice and `master`'s daily run still run every journey, "so a
regression is caught there and fixed before anything else".

## Lanes, leads and the conductor

The conductor starts lanes whose needs are met at once, "so independent lanes run in parallel". Its state is the
roadmap and the leads' sessions, so a fresh conductor can take over from them alone (AGENTS.md, "Lanes, leads and the
conductor"). Which thread does what, and when each is finished, is in `.agents/skills/threads/SKILL.md`.

## Aaron's computer

A Claude Code cloud session never connects to Aaron's computer because "a session that does is limited to his trusted
devices for good, and then no cloud thread or scheduled task can reach it".
