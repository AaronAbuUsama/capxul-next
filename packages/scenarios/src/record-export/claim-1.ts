// record.export, claim 1: an export carries the lineage and every entry once. Checked: the lineage, the positions 1
// to the head in order, each entry a declared event carrying exactly its fields, and the restore's world_created
// last, naming the lineage. Not checked: that entries 1 to the snapshot's position are the first world's own, entry
// for entry: the client is made for one world's door and cannot export the first world's record.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { expect, scenario } from "../scenario.ts";
import { present, same } from "../support/expect.ts";
import { carriesExactly, inOrder } from "../support/record.ts";
import { fieldOf, record, textOf, view } from "../support/world.ts";

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
    yield* Effect.forEach(exported.entries, carriesExactly, { discard: true });
    const first = yield* present("the first entry", Option.getOrNull(Arr.head(exported.entries)));
    yield* same("the first entry's event", first.event, "world_created");
    const last = yield* present("the last entry", Option.getOrNull(Arr.last(exported.entries)));
    yield* same("the last entry's event", last.event, "world_created");
    yield* same("the world the last entry names", textOf(last.carried, "world"), exported.world);
    yield* same("the parent the last entry names", fieldOf(last.carried, "parent"), lineage);
    const source = yield* view(lineage.world);
    yield* expect(
      source.recordHead >= lineage.recordSeq,
      `the first world's record head ${source.recordHead} is before the lineage's position ${lineage.recordSeq}`,
    );
  }),
);
