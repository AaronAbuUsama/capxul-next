# budgets

One rule for every budget claim (`bud:*/p95`, `rpc:*/budget`, `flw:*/budget`), shared by all runners
(`system.eval-warm-budgets`). It has no script of its own: a concept's runner measures, then asks this module for the verdict.

```ts
import { budgetOf, judgeBudget, saveJudgement } from "../budgets/service.ts";

const judgement = judgeBudget(budgetOf(blueprint, id), samples);  // samples: [{ kind, ms, clock: "host" | "span", startedAt, waits? }]
saveJudgement(join(runDir, "activity", "budgets", `${fileNameOf(id)}.json`), id, judgement);
emit(checkName, judgement.pass, judgement.detail);
```

- **Samples** are taken in this run only, from operational host time: a database `clock_timestamp()` pair such as
  `created_at`/`acked_at`, or a span duration. Never world or chain time, which the devnet clock can move. `startedAt` is
  the sample's host-clock start in epoch ms. `waits: [{ name, ms }]` is time in named waits and is subtracted, but only
  names in `budgetOf(...).excludes` are accepted: a workflow's `wait.<name>` waits, its budget's `excludes` and
  `chain.confirm`; a flow's `wait.<step>` local wait steps and its `excludes`; an operation's or rpc's `excludes` (usually
  none). Any other name, or waits longer than the sample, fails the check.
- **Warm:** a `kind` is one measured path in one process (`note-payment-open@worker-1`). The helper orders each kind by
  `startedAt`, so its earliest sample is cold and excluded whatever order you pass; a missing start or two samples of one
  kind with the same start fails. Every kind needs a warm sample, and at least 2 warm samples (N) are required, or the check fails.
- **Statistics:** with N ≥ 20, nearest-rank p95 and p50 (the ⌈q·N⌉-th smallest). With N < 20, the maximum must be within
  the p95 budget and the median within the p50 budget. Workflow, rpc and flow claims name p95 only.
- **Budget** numbers come from the eval's blueprint record (`budgetOf`), never from the implementation.
- **Evidence:** keep the saved judgement, with the budget and its exclusions, N (warm only), method, every sample (also
  split warm and cold) and the result, in your
  module's run directory, and put `judgement.detail` in the check line.
