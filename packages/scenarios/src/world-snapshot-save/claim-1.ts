// world.snapshot.save, claim 1: a snapshot saves everything that makes the world and leaves it untouched. Checked:
// the answer, the one new entry, and world.show and the General Ledger read the same before and after. Not checked:
// the Safes' balances, which only the door's chain RPC shows.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { ledger } from "../support/books.ts";
import { entriesAfter, head, northwind, view } from "../support/world.ts";

export const worldSnapshotSave1 = scenario(
  { operation: "world.snapshot.save", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, org } = yield* northwind;
    const position = yield* head;
    const books = yield* ledger(org, {}, "sam");
    const saved = yield* capxul["world.snapshot.save"]({
      world: world.world,
      snapshot: "probe",
      replace: false,
      template: false,
    });
    yield* same(
      "the snapshot",
      { world: saved.world, snapshot: saved.snapshot, template: saved.template },
      { world: world.world, snapshot: "probe", template: false },
    );
    yield* same("the record position the snapshot holds", saved.recordSeq, position);
    yield* same("the snapshot's clock", saved.clock, world.clock);
    yield* same("the snapshot's companies", saved.companies, 1);

    const added = yield* entriesAfter(position);
    yield* same(
      "the entries the save added",
      Arr.map(added, (entry) => ({ event: entry.event, carried: entry.carried })),
      [
        {
          event: "snapshot_saved",
          carried: { world: world.world, snapshot: "probe", recordSeq: position, template: false },
        },
      ],
    );
    const after = yield* view(world.world);
    yield* same(
      "world.show after the save, but for its record head",
      { ...after, recordHead: world.recordHead },
      world,
    );
    yield* same("world.show's record head after the save", after.recordHead, position + 1);
    yield* same("the General Ledger after the save", yield* ledger(org, {}, "sam"), books);
  }),
);
