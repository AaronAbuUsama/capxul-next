## What
Take every gap whose rule is unused-call, unhosted-component, no-acceptance or refusal-without-world (31 today). For each: use the call from the procedure that needs it or remove it; host the component in an environment; give the operation its acceptance claims; give the refusal the world state it needs. Change only what the gap names.
## Why
Exit line g2: the blueprint builds with no problems and every open gap is closed or has a recorded reason. 162 gaps are open after the telemetry work; they are listed in the findings file the blueprint build writes (pnpm blueprint, then findings.json in the output folder, under gaps, each with record, rule and detail).
## Done when
- The blueprint build reports no gap with the rule unused-call, unhosted-component, no-acceptance or refusal-without-world that lacks a recorded reason
- The build has 0 problems and the frozen check has 0 breaches
