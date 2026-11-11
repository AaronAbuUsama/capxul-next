<!--
One pull request per task, from its own branch into integration/build. Never into main (only Aaron approves a
pull request into main). Never paste a token, key or password. The checks and the evals say done, not the author.
-->
## What changed

<!-- One or two sentences. Name the blueprint records or decisions changed first, if any. -->

## Evals

<!-- The eval ids this should move, and the result of `pnpm evals -- <ids>` (pass, fail, not run). _none_ if none. -->

## Checks

- [ ] `pnpm exec tsc -p packages/blueprint-engine && pnpm test`
- [ ] `pnpm exec tsc -p blueprint && pnpm blueprint` (0 problems)
- [ ] `pnpm frozen`, `pnpm contracts:check-blueprint`, `pnpm portal:check`, `pnpm layout`

## Needs Aaron

<!-- A decision only he can make, as one question with options and a recommendation, or _none_. -->
