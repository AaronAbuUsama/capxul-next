// Compile-time checks: each line marked @ts-expect-error must fail to compile, so `tsc -p .` fails if the format
// ever stops catching a `carries` that does not fit its event, its call or its outcome. Never run, only compiled.
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declare, declareOutcomes, outcome, type Budget } from "../src/operation.ts";

class Thing extends Schema.TaggedClass<Thing>()("test_thing", { id: Schema.String, n: Schema.Int }) {}
class A extends Schema.TaggedClass<A>()("TestA", { id: Schema.String }) {}
class B extends Schema.TaggedClass<B>()("TestB", { n: Schema.Int }) {}

const budget: Budget = { ms: 1, excludes: [], provisional: true, basis: "a compile-time test" };
const single = Rpc.make("test.single", { payload: { id: Schema.String }, success: Schema.Struct({ n: Schema.Int }) });
const several = Rpc.make("test.several", { payload: { id: Schema.String }, success: Schema.Union([A, B]) });

export const fits = declare({ rpc: single, emits: [{ event: Thing, carries: ({ payload, success }) => ({ id: payload.id, n: success.n }) }], budget, examples: [] });

// @ts-expect-error: `n` is missing from what the event carries.
export const missing = declare({ rpc: single, emits: [{ event: Thing, carries: ({ payload }) => ({ id: payload.id }) }], budget, examples: [] });

// @ts-expect-error: the success has no `id`.
export const misread = declare({ rpc: single, emits: [{ event: Thing, carries: ({ success }) => ({ id: success.id, n: success.n }) }], budget, examples: [] });

// @ts-expect-error: outcome A's success has no `n`; only outcome B's does.
export const wrongOutcome = outcome(several, "TestA", [{ event: Thing, carries: ({ success }) => ({ id: "x", n: success.n }) }]);

// @ts-expect-error: every outcome of the success union must be declared; TestB is not.
export const unlisted = declareOutcomes({ rpc: several, outcomes: { TestA: outcome(several, "TestA", []) }, budget, examples: [] });

export const listed = declareOutcomes({
  rpc: several,
  outcomes: {
    TestA: outcome(several, "TestA", []),
    TestB: outcome(several, "TestB", [{ event: Thing, carries: ({ payload, success }) => ({ id: payload.id, n: success.n }) }]),
  },
  budget,
  examples: [],
});
