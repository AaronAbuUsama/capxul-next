// approval.sign, claim 2: a replay of the same signature answers with the same hash and sends nothing more.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given, scenario } from "../scenario.ts";
import { answers, same } from "../support/expect.ts";
import { paymentsSent } from "../support/chain.ts";
import { signWith } from "../support/signing.ts";
import { head, unchangedRecord } from "../support/world.ts";

export const approvalSign2 = scenario(
  { operation: "approval.sign", claim: 2 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, held } = yield* given(startingWorlds.paymentHeld);
    // An operation first: what the empty handlers answer must be what the scenario fails on.
    yield* head;
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
    yield* same("the PaymentSent logs for the payment", (yield* paymentsSent(world, held.payment.paymentId)).length, 1);
  }),
);
