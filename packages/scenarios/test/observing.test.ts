// The calls a check makes to look at the world carry `Observing`, and the call under test never does: what a try's
// operation checks read before the call and in each check, against the one call the step makes. The runner retries a
// look whose transport failed, and never the call under test, by this mark (client.ts).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { operations, startingWorlds, type OperationName } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import { OperationChecks, type AllChecks } from "../src/checks/format.ts";
import { Capxul, Given, Observing, Steps, type CapxulClient } from "../src/door.ts";
import { Journal, type Made } from "../src/journal.ts";
import { named } from "../src/support/names.ts";
import { triesOf } from "../src/tries.ts";

/** A client whose every call says whether it was made as a look, and answers a success. */
const marking = (seen: Array<string>): CapxulClient => {
  const each = (operation: OperationName) => () =>
    Effect.gen(function* () {
      const look = Option.isSome(yield* Effect.serviceOption(Observing));
      seen.push(`${operation}${look ? " as a look" : ""}`);
      return { _tag: "Shown" };
    });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in client for one test: every operation answers the same success, whatever the operation's own answer type
  return { ...Rec.map(operations, (_, operation) => each(operation)), chain: {} } as unknown as CapxulClient;
};

/** Every operation's checks: one look before the call, and one check that looks again. */
const looking = (): AllChecks => {
  const look = Effect.flatMap(Capxul, (capxul) => capxul["record.export"]({ from: 1, to: 1 }));
  const set = {
    prepare: () =>
      look.pipe(Effect.as(() => [{ says: "it looks again", holds: look.pipe(Effect.orDie, Effect.asVoid) }])),
  };
  return Rec.map(operations, () => set);
};

test("a try's checks look as Observing, and the call under test is not marked", async () => {
  const seen: Array<string> = [];
  await Effect.runPromise(
    triesOf(1, named["world.show"])
      .succeeds({ world: "town" })
      .pipe(
        Effect.provideService(Capxul, marking(seen)),
        Effect.provideService(OperationChecks, looking()),
        Effect.provideService(Given, { world: startingWorlds.nothing, facts: Effect.succeed({}) }),
        Effect.provideService(Steps, { begin: () => Effect.void, tried: () => Effect.void, end: () => Effect.void }),
        Effect.provideServiceEffect(
          Journal,
          Effect.all({ next: Ref.make(1), made: Ref.make<ReadonlyArray<Made>>([]) }),
        ),
      ),
  );
  assert.deepEqual(seen, ["record.export as a look", named["world.show"], "record.export as a look"]);
});
