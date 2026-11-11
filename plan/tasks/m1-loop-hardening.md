## What
Record the decision for the loop in the book. Re-run m1-dev-commands now that the faulty test is fixed, and merge it through the loop's own merge gate. Add a real spend limit from the gateway's usage figures, run agents inside an operating-system sandbox, exercise the heavy sandbox once, and trim the package towards the cap by moving the generic half into its own module for swarmD.
## Why
The first version works but is not yet safe to leave alone: its budget is counted in turns and time, not money; its rules on what an agent may run are a filter, not a sandbox; steering a running agent and the heavy sandbox are untested; and it is 1,200 lines against a cap of 800.
## Done when
- A task goes from the plan to merged through the loop with nobody starting agents by hand
- A run that exceeds its budget stops
- The decision record exists in the book
