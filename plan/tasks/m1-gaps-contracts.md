## What
Take every gap whose rule is uncalled-function or unconsumed-chain-event (99 today: the installer, escrow, budgets, agent owner, agreements and factory contracts). For each, either name the operation, procedure or workflow that calls the function or consumes the event, or record on the record itself why nothing does (owner-only, set once at install, kept for a parked feature). Do not invent operations. The contract code in packages/contracts is the truth for what exists.
## Why
Exit line g2: the blueprint builds with no problems and every open gap is closed or has a recorded reason. 162 gaps are open after the telemetry work; they are listed in the findings file the blueprint build writes (pnpm blueprint, then findings.json in the output folder, under gaps, each with record, rule and detail).
## Done when
- The blueprint build reports no gap with the rule uncalled-function or unconsumed-chain-event that lacks a recorded reason
- pnpm contracts:check-blueprint still reports 0 undeclared differences, and the build has 0 problems
