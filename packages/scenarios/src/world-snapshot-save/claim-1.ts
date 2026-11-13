// world.snapshot.save, claim 1: a snapshot saves everything that makes the world and leaves it untouched.
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given, scenario } from "../scenario.ts";
import { same } from "../support/expect.ts";
import { usdc } from "../support/chain.ts";
import { ledger } from "../support/site.ts";
import { entriesAfter, head, view } from "../support/world.ts";

export const worldSnapshotSave1 = scenario(
  { operation: "world.snapshot.save", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const facts = yield* given(startingWorlds.paid);
    const world = yield* view(facts.world.world);
    const org = facts.founded.org;
    const position = yield* head;
    const books = yield* ledger(org, {}, { as: "sam" });
    const safes = [facts.founded.safe, ...Arr.flatMap(world.cast, (each) => (each.safe === null ? [] : [each.safe]))];
    const balances = Effect.forEach(safes, (safe) => usdc(world, safe));
    const before = yield* balances;

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
    yield* same("the General Ledger after the save", yield* ledger(org, {}, { as: "sam" }), books);
    yield* same("the Safes' USDC after the save (the company Safe's first)", yield* balances, before);
  }),
);
