// world.snapshot.restore, claim 1: a restore into a separate world leaves the first world untouched and the two
// never see each other. Checked: a different door and the parent; then a document and a signed payment in the
// first world appear in its record and its General Ledger, while the new world's record head, which world.show
// reads, does not move. Not checked: the same calls in the new world, and each Safe's balance through each door:
// the client is made for one world's door, and Capxul offers no chain read.
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { answers, same } from "../support/expect.ts";
import { BRIGHTSIDE, create, holdPayment, ledger, linesOf, supplierFields } from "../support/books.ts";
import { holdsInOrder } from "../support/record.ts";
import { approve } from "../support/signing.ts";
import { eventually } from "../support/wait.ts";
import { entriesAfter, head, northwind, record, savedSnapshot, view } from "../support/world.ts";
import { restoreInto } from "./restore.ts";

export const worldSnapshotRestore1 = scenario(
  { operation: "world.snapshot.restore", claim: 1 },
  Effect.gen(function* () {
    const { world, org } = yield* northwind;
    const position = yield* savedSnapshot((yield* record).entries, "m3");
    const { as, made } = yield* restoreInto(world, "m3", "rs1");
    yield* expect(made.door !== world.door, `the new world answers the first world's door, ${made.door}`);
    yield* same("the new world's parent", made.parent, { world: world.world, snapshot: "m3", recordSeq: position });
    const newHead = (yield* view(as)).recordHead;

    const before = yield* head;
    yield* create(org, "Supplier", supplierFields("Isolation Check Ltd"), "sam");
    const { held } = yield* holdPayment(org, { supplier: BRIGHTSIDE, invoice: null, amount: 10 }, "sam");
    yield* answers("sam's signature of the payment", "Sent", approve(held.approval));
    const added = yield* entriesAfter(before);
    yield* holdsInOrder(added, ["doc_created", "doc_created", "payment_held", "approval_signed", "approval_landed"]);
    yield* eventually(
      `the first world's General Ledger to show ${held.name}`,
      ledger(org, {}, "sam"),
      (rows) => linesOf(rows, held.name).length > 0,
    );
    yield* same("the new world's record head after the first world's calls", (yield* view(as)).recordHead, newHead);
    yield* same("the first world's own name after the restore", (yield* view(world.world)).world, world.world);
  }),
);
