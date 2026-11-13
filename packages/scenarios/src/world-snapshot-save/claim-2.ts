// world.snapshot.save, claim 2: a name already saved is refused unless replacing is asked for, and the snapshot is
// unchanged. A snapshot is read back only by restoring it, which world.snapshot.restore's claims cover; here the
// refusal is checked to leave the record as it was, and the replacement to hold the record's position now, after
// the one `m3` held when it was first saved.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { record, savedSnapshot, thisWorld, unchangedRecord } from "../support/world.ts";

export const worldSnapshotSave2 = scenario(
  { operation: "world.snapshot.save", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const world = yield* thisWorld;
    const before = yield* record;
    const first = yield* savedSnapshot(before.entries, "m3");
    const save = (replace: boolean) =>
      capxul["world.snapshot.save"]({ world, snapshot: "m3", replace, template: true });
    const refused = yield* refusal("saving m3 again without replace", "SnapshotExists", save(false));
    yield* same("SnapshotExists", { world: refused.world, snapshot: refused.snapshot }, { world, snapshot: "m3" });
    yield* unchangedRecord("the refused save", before.head);
    const replaced = yield* save(true);
    yield* same("the replacement's record position", replaced.recordSeq, before.head);
    yield* expect(replaced.recordSeq > first, `the replacement holds ${replaced.recordSeq}; m3 first held ${first}`);
    yield* same("the replacement's template", replaced.template, true);
  }),
);
