// world.snapshot.restore, claim 2: the new world holds what the snapshot saved: its record up to the snapshot, its
// clock, its people, companies, documents, balances and hats. Checked through world.show of the new world: its
// record head and parent, its clock, its cast and its companies. Not checked: its record, General Ledger, Trial
// Balance, Safe balances and hats: the client is made for the first world's door only, and Capxul offers no chain
// read.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { record, savedSnapshot, thisView } from "../support/world.ts";
import { restoreInto } from "./restore.ts";

export const worldSnapshotRestore2 = scenario(
  { operation: "world.snapshot.restore", claim: 2 },
  Effect.gen(function* () {
    const world = yield* thisView;
    const position = yield* savedSnapshot((yield* record).entries, "m3");
    const { as, made } = yield* restoreInto(world, "m3", "rs2");
    yield* same("the new world's name", made.world, as);
    yield* same("the new world's record head", made.recordHead, position + 1);
    yield* same("the new world's parent", made.parent, { world: world.world, snapshot: "m3", recordSeq: position });
    yield* same("the new world's clock", made.clock, world.clock);
    yield* same("the new world's cast", made.cast, world.cast);
    const companies = (view: typeof world) =>
      Arr.map(view.companies, (each) => ({ org: each.org, handle: each.handle, name: each.name }));
    yield* same("the new world's companies", companies(made), companies(world));
  }),
);
