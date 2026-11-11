## What
Read docs/mission/research-2026-11-11.md, "What exit g5 still lacks". Record in the book the spike's finding that the CLI must drain stdout before it exits (spikes/skeleton/FINDINGS.md, "Smaller findings": process.exit after console.log cut piped output at 64 KB), as a decision on the CLI with a claim a run can check (a response over 64 KB piped through is complete and parses), placed where the CLI's records live. Then go through every other item under "Smaller findings" in spikes/skeleton/FINDINGS.md and docs/mission/findings.md: for each, name the record or decision that already holds it, or add one. Write the list of items and where each landed into the decision's why. blueprint/ only; touch nothing in packages/ or spikes/. Change no record whose id starts with aaron.
## Why
Exit g5: everything the spikes found is a record or a decision. The research found one finding with no record.
## Done when
- A decision on draining stdout exists with a checkable claim, and every "Smaller findings" item is named with its record or decision
- pnpm blueprint: 0 problems and 0 gaps; pnpm frozen: 0 breaches
