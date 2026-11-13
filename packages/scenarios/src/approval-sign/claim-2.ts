// approval.sign, claim 2: a replay of the same signature answers with the same hash and sends nothing more. Checked
// through the operations: AlreadySent with the same transaction and block, and no entry in the record. Not checked:
// that the chain holds one PaymentSent for the payment, which only the door's chain RPC shows.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { answers, same } from "../support/expect.ts";
import { signWith } from "../support/signing.ts";
import { head, unchangedRecord } from "../support/world.ts";
import { freshHold } from "./hold.ts";

export const approvalSign2 = scenario(
  { operation: "approval.sign", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { held } = yield* freshHold;
    const signature = yield* signWith(held.approval.signerAddress, held.approval.digest);
    const sign = capxul["approval.sign"]({ approval: held.approval.id, signature }, { as: "sam" });
    const sent = yield* answers("the first signature", "Sent", sign);
    const before = yield* head;
    const again = yield* answers("the same signature again", "AlreadySent", sign);
    yield* same(
      "the replay",
      { approval: again.approval, subject: again.subject, transaction: again.transaction, block: again.block },
      { approval: sent.approval, subject: sent.subject, transaction: sent.transaction, block: sent.block },
    );
    yield* unchangedRecord("the replay", before);
  }),
);
