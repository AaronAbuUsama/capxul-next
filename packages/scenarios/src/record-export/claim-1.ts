// record.export, claim 1: an export carries the lineage and every entry once: the first world's entries up to the
// snapshot's position, entry for entry as record.export at the first world's door answers them, then the restore's
// world_created.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect, scenario } from "../scenario.ts";
import { present, same } from "../support/expect.ts";
import { inOrder } from "../support/record.ts";
import { fieldOf, record, recordOf, textOf, view } from "../support/world.ts";

export const recordExport1 = scenario(
  { operation: "record.export", claim: 1 },
  Effect.gen(function* () {
    const exported = yield* record;
    const lineage = yield* present("the restored world's lineage", exported.lineage);
    yield* same("the lineage's snapshot", lineage.snapshot, "m3");
    yield* expect(lineage.world !== exported.world, `the lineage names the world itself, ${lineage.world}`);
    yield* inOrder(exported.entries, 1);
    yield* same("the number of entries", exported.entries.length, exported.head);
    yield* same("the head", exported.head, lineage.recordSeq + 1);

    const first = yield* view(lineage.world);
    const source = yield* recordOf({ at: first.door });
    yield* same(
      `the entries up to ${lineage.recordSeq}, against the first world's`,
      Arr.take(exported.entries, lineage.recordSeq),
      Arr.take(source.entries, lineage.recordSeq),
    );
    const last = yield* present("the last entry", Option.getOrNull(Arr.last(exported.entries)));
    yield* same("the last entry's event", last.event, "world_created");
    yield* same("the world the last entry names", textOf(last.carried, "world"), exported.world);
    yield* same("the parent the last entry names", fieldOf(last.carried, "parent"), lineage);
  }),
);
