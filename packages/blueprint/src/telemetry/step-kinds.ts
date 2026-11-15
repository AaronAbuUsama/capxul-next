// The kinds a declared span may have (docs/design/blueprint.md, part 10): what the time of a span was spent on. A
// span's kind is recorded as `capxul.step.kind` (./envelope.ts), so a slow call can be read by where its time went,
// and the waits a budget leaves out are the spans of kind `wait`. Declared here once; every span of every operation
// and piece of work names one of these by import, and the blueprint's tests prove no other is used.
import * as Schema from "effect/Schema";

/** A step kind, as `capxul.step.kind` carries it. */
export const StepKindValue = Schema.Literals([
  "database",
  "site",
  "chain",
  "bundler",
  "wait",
  "deploy",
  "branch",
  "container",
  "compute",
  "restore",
  "poll",
]);

export type StepKind = typeof StepKindValue.Type;

/** Each kind, with what its time is spent on. */
export const STEP_KINDS: { readonly [Kind in StepKind]: string } = {
  database: "a world's own database, or the registry's: a query or a transaction",
  site: "a company's Frappe site, through the site service or the site API",
  chain: "a world's chain: a read, a write, a block or a clock move",
  bundler: "the bundler: a user operation sent and its receipt",
  wait: "waiting on purpose for work outside the call: a person signing, a parked world waking, a confirmation",
  deploy: "deploying or destroying a stage's workers and objects",
  branch: "a Neon branch: made, reset or deleted",
  container: "a container of ours doing its own work: an index stopped or resumed, a CI job's own process",
  compute:
    "work done in-process, touching nothing outside: a gate's rung, a call's checks, a ratchet's count, a verdict written",
  restore: "putting saved state back: a snapshot of a chain, a site or a database",
  poll: "asking again until something outside is ready: an endpoint answering, a site up, records arrived",
};

/** Each kind by its own name, so a declaration writes `StepKind.database`, never the string. */
export const StepKind: { readonly [Kind in StepKind]: Kind } = {
  database: "database",
  site: "site",
  chain: "chain",
  bundler: "bundler",
  wait: "wait",
  deploy: "deploy",
  branch: "branch",
  container: "container",
  compute: "compute",
  restore: "restore",
  poll: "poll",
};
