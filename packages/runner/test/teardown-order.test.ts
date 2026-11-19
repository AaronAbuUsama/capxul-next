// The order a run takes its worlds down in (worlds/teardown.ts, `destroyInOrder`; roadmap 4.8, the own-world track): a
// world restored from another goes before its source; worlds unrelated to each other go together, never more than the
// bound at once; every world is tried, and each one not destroyed is named with why. Against a stand-in destroy that
// keeps the order and how many run at once. Structural only, never about speed. Written first: the cases marked
// `todo` fail against today's stand-in until the runner's builder lands the change, and are then made plain tests.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Str from "effect/String";
import { RunnerFailure } from "../src/failure.ts";
import { destroyInOrder, type Doomed } from "../src/worlds/teardown.ts";

const UNTIL_BUILT = "until the runner's builder lands the own-world track's teardown (worlds/teardown.ts)";

/** A destroy that takes a moment, keeping when each world began and ended going and the most going at once. */
const watched = (failing: ReadonlyArray<string> = []) => {
  const events: Array<string> = [];
  let going = 0;
  let most = 0;
  const destroy = (stage: string) =>
    Effect.gen(function* () {
      going += 1;
      most = Math.max(most, going);
      events.push(`start ${stage}`);
      yield* Effect.sleep("20 millis");
      going -= 1;
      events.push(`end ${stage}`);
    }).pipe(
      Effect.andThen(
        Arr.contains(failing, stage)
          ? Effect.fail(RunnerFailure.make({ step: "destroy", message: `${stage} would not go` }))
          : Effect.void,
      ),
    );
  return { destroy, events, most: () => most };
};

const world = (stage: string, from: string | null = null): Doomed => ({ stage, from });

test("a restored world is destroyed before the world it was restored from", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { destroy, events } = watched();
      // The source first, as the run made them; the restored one must still go first.
      const failed = yield* destroyInOrder([world("w-src"), world("w-rst", "w-src")], destroy, 4);
      assert.deepEqual(failed, []);
      assert.ok(
        events.indexOf("end w-rst") < events.indexOf("start w-src"),
        `the restored world is gone before its source is begun: ${Arr.join(events, ", ")}`,
      );
    }),
  ));

test("worlds unrelated to each other go together, never more than the bound at once", { todo: UNTIL_BUILT }, () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { destroy, most } = watched();
      const failed = yield* destroyInOrder([world("w-a"), world("w-b"), world("w-c"), world("w-d")], destroy, 2);
      assert.deepEqual(failed, []);
      assert.equal(most(), 2, "two at a time: together, and bounded");
    }),
  ),
);

test("a chain of restores goes newest first while unrelated worlds go beside it", { todo: UNTIL_BUILT }, () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { destroy, events, most } = watched();
      const worlds = [world("w-src"), world("w-rst", "w-src"), world("w-again", "w-rst"), world("w-other")];
      assert.deepEqual(yield* destroyInOrder(worlds, destroy, 4), []);
      assert.ok(events.indexOf("end w-again") < events.indexOf("start w-rst"));
      assert.ok(events.indexOf("end w-rst") < events.indexOf("start w-src"));
      assert.ok(events.indexOf("start w-other") < events.indexOf("end w-again"), "the unrelated world goes beside");
      assert.ok(most() >= 2);
    }),
  ),
);

test("every world is tried, and each one not destroyed is named with why", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { destroy, events } = watched(["w-b", "w-src"]);
      const failed = yield* destroyInOrder([world("w-src"), world("w-rst", "w-src"), world("w-b")], destroy, 2);
      assert.deepEqual(Arr.sort(Arr.filter(events, Str.startsWith("start ")), Order.String), [
        "start w-b",
        "start w-rst",
        "start w-src",
      ]);
      assert.equal(failed.length, 2);
      assert.ok(Arr.some(failed, (each) => /^w-b: .*w-b would not go/u.test(each)));
      assert.ok(Arr.some(failed, (each) => /^w-src: .*w-src would not go/u.test(each)));
    }),
  ));
