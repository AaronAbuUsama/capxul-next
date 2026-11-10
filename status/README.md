# status

The scoreboard: what is proven, and by which run.

- `status.json`: the verdict of every eval, with the commit and the run that gave it.
- `runs/<run id>/`: the results and evidence of each run (`run.log` stays on the machine that ran it).

Written only by `pnpm evals`. **Never edit these files by hand.** Read by the portal, `pnpm plan show` and the loop.
