// world.show, claim 1: a world restored into another names its parent. The record position `m3` holds is read
// from the restored world's own record: its lineage, and the parent its world_created names.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect, scenario } from "../scenario.ts";
import { present, same } from "../support/expect.ts";
import { entriesOf, fieldOf, record, textOf, view } from "../support/world.ts";

export const worldShow1 = scenario(
  { operation: "world.show", claim: 1 },
  Effect.gen(function* () {
    const exported = yield* record;
    const shown = yield* view(exported.world);
    const parent = yield* present("the restored world's parent", shown.parent);
    yield* same("the parent's snapshot", parent.snapshot, "m3");
    yield* expect(parent.world !== shown.world, `the restored world names itself as its parent`);
    yield* same("the parent world.show answers", parent, exported.lineage);
    const born = yield* present(
      "the restored world's world_created",
      Option.getOrNull(
        Arr.findLast(entriesOf(exported.entries, "world_created"), (e) => textOf(e.carried, "world") === shown.world),
      ),
    );
    yield* same("the parent its world_created names", fieldOf(born.carried, "parent"), parent);
    yield* same("the position of its world_created", born.seq, parent.recordSeq + 1);
    const source = yield* view(parent.world);
    yield* expect(
      source.recordHead > parent.recordSeq,
      `the first world's head ${source.recordHead} is not past m3's position ${parent.recordSeq}`,
    );
  }),
);
