// world.snapshot.save, claim 2: a name already saved is refused unless replacing is asked for, and the snapshot is
// unchanged. The refusal leaves the record as it was; the replacement holds the record's position now, after the
// one `m3` first held (the `m3` fact).
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, given, scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { head, unchangedRecord } from "../support/world.ts";

export const worldSnapshotSave2 = scenario(
  { operation: "world.snapshot.save", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const facts = yield* given(startingWorlds.withSnapshot);
    const world = facts.world.world;
    const save = (replace: boolean) =>
      capxul["world.snapshot.save"]({ world, snapshot: "m3", replace, template: true });
    const before = yield* head;
    const refused = yield* refusal("saving m3 again without replace", "SnapshotExists", save(false));
    yield* same("SnapshotExists", { world: refused.world, snapshot: refused.snapshot }, { world, snapshot: "m3" });
    yield* unchangedRecord("the refused save", before);
    yield* expect(
      before > facts.m3.recordSeq,
      `the record's head ${before} is not past m3's position ${facts.m3.recordSeq}`,
    );
    const replaced = yield* save(true);
    yield* same("the replacement's record position", replaced.recordSeq, before);
    yield* same("the replacement's template", replaced.template, true);
    yield* unchangedRecord("the replacement and its one snapshot_saved", before + 1);
  }),
);
