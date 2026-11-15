# How a feature is built

The decisions behind the rules in [AGENTS.md](../../AGENTS.md), "Three sources, one owner for every fact" and "How a
feature is built". The rules, the table "Who owns each fact", what a run record holds and how coverage is reported are
in AGENTS.md; this page links each part to the decisions it comes from ([decisions](../decisions.md)), in their words.

## One owner for every fact

"One source for every fact", agreed 13 November 2026: "a speed budget, an error code, an event or a starting world is
declared once and imported everywhere else, so two places cannot disagree." "Generated, never typed twice", agreed 15
November 2026, extends it: "a fact written by hand in two places is a defect to fix. Each kind of fact has one owner and
everything else is generated from it and checked in CI". Which owner holds which fact is the table in AGENTS.md,
"Who owns each fact"; the design behind it is [docs/design/blueprint.md](../design/blueprint.md).

## The loop

"How a feature is built", agreed 15 November 2026: "idea, then decision, then the blueprint delta, then generated
artefacts, then journeys and checks written first and failing, then the build, then measured runs, then deploy and
watch". "The slice lead signs off a blueprint delta; Aaron agrees only what is a roadmap decision".

Journeys come first and from another agent because of "The scenario author is not the builder": "A scenario is written
before the build by a different agent, and CI rejects one that already passes against an empty handler."

## How it is measured

"Measurement is part of the contract": "Every proven run stores timings and outcomes per operation, so speed and cost
are climbed as well as correctness." "Three kinds of check" places the generic checks: "A generic runner on every
scenario (declared events sent, spans and logs present, speed)", beside the compiler and the written scenarios.
"Internals are the code's business and are covered by package tests."

A budget is a target. "Budgets are targets", agreed 15 November 2026: "nothing ever fails on speed. When the measured
p95 of an operation, or of a whole run, is over 1.5 times its budget, the cost job raises an architecture review as a
task, naming the parts that grew."

## Changing what works

"No callers, no compatibility", agreed 15 November 2026: "until a real caller exists (phase 8), existing operations are
reshaped and renamed directly, with no side-by-side versions; the journey author updates the journeys in the same
lane." "'Side by side, then flip, then retire' applies again from the first real caller."

## A new format reaches old work by a ratchet

"New work is born compliant; old work catches up in parallel and blocks nothing" (AGENTS.md, "A new format reaches old
work by a ratchet"). How a ratchet is declared and counted is in [docs/design/blueprint.md](../design/blueprint.md),
part 4.
