## What
Take every gap whose rule is undriven-transition, unwritten-table or unproduced-error (32 today). For each, name what drives the transition, writes the table or produces the error, or remove the record if the cut made it dead, or record why it stands. Change only what the gap names; add a decision record where a judgment is made.
## Why
Exit line g2: the blueprint builds with no problems and every open gap is closed or has a recorded reason. 162 gaps are open after the telemetry work; they are listed in the findings file the blueprint build writes (pnpm blueprint, then findings.json in the output folder, under gaps, each with record, rule and detail).
## Done when
- The blueprint build reports no gap with the rule undriven-transition, unwritten-table or unproduced-error that lacks a recorded reason
- The build has 0 problems and the frozen check has 0 breaches
