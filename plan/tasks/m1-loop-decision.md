## What
Record in the book how the build runs today, as decisions in blueprint/shared/swarm.ts (edit that file only; add no new module file, so no index changes): the build runs on packages/loop, not swarmD: the pair script (a builder, then a reviewer that approves or refuses), one git lane per run cut from integration/build, the coordinator's merge gate (`pnpm loop merge` gates again on the lane plus the current base), the plan as the one task list, and the model gateway (the CLI proxy on the Mac, 127.0.0.1:8317, no LiteLLM, by Aaron's ruling of 10 November). Name each older swarm decision this replaces or narrows. Change no record whose id starts with aaron. and no ruling. The loop is the build's tooling, not part of Capxul: add no component or environment record.
## Why
m1-loop-hardening: the decision for the loop is not in the book; swarm.ts still describes swarmD
## Done when
- pnpm blueprint: 0 problems and 0 gaps
- pnpm frozen: 0 breaches
