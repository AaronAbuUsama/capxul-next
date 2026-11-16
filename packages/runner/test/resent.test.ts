// A read the scenarios sent again because its connection dropped is kept on the step it was made in, so a run record
// says how often it happens (steps.ts, `Steps.resent`); a step with none says nothing of it.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { operations } from "@capxul/blueprint";
import { Steps } from "@capxul/scenarios";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type { Call } from "../src/client.ts";
import { hearing, stepsOf, type Heard } from "../src/steps.ts";

const SHOW = operations["world.show"].rpc._tag;
const OUTLINE = [
  { operation: SHOW, does: "the first step" },
  { operation: SHOW, does: "the second step" },
] as const;

test("a resend is kept on the step it was made in, and a step without one has none", async () => {
  const heard = await Effect.runPromise(
    Effect.gen(function* () {
      const kept = yield* Ref.make<ReadonlyArray<Heard>>([]);
      const log = yield* Ref.make<ReadonlyArray<Call>>([]);
      yield* Effect.gen(function* () {
        const steps = yield* Steps;
        yield* steps.begin(1, OUTLINE[0]);
        yield* steps.end(1, null);
        yield* steps.begin(2, OUTLINE[1]);
        yield* steps.resent?.("chain head: try 1 of 3 got no answer (read ECONNRESET), sent again") ?? Effect.void;
        yield* steps.end(2, null);
      }).pipe(Effect.provide(hearing(kept, log)));
      return yield* Ref.get(kept);
    }),
  );
  const [first, second] = stepsOf(OUTLINE, heard, []);
  assert.equal(first?.resent, undefined);
  assert.deepEqual(second?.resent, ["chain head: try 1 of 3 got no answer (read ECONNRESET), sent again"]);
});
