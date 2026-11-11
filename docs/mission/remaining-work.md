# The as-is book is closed

The as-is book described the old system in the same records as the design book. It was paused,
and on 8 November 2026 Aaron closed it: the old system is a reference for behaviour, not a
baseline, and the target book no longer needs it.

What is kept:

- `docs/as-is/payments.md`: the reviewed payments lane. Its keep list (K1 to K18) and findings are
  still read before anything touches payments.
- `docs/mission/findings.md`: what is wrong with the old system.
- `docs/as-is/lane-reports/`: every writer's and reviewer's report.
- `docs/as-is/archive/`: the as-is records themselves, including the unfinished lanes. They are
  outside every typecheck and are not maintained. The target records' `was` fields point into it.

No as-is lane remains to be written. When a target design needs to know what the old system does,
read the old code at `/home/user/factory` (branch `integration/factory`) for that behaviour.
