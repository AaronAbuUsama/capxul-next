// approval.sign, claim 4: an expired approval is refused, naming when it expired, and nothing is sent.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given, scenario } from "../scenario.ts";
import { addSeconds, refusal, same, sameInstant } from "../support/expect.ts";
import { paymentsSent } from "../support/chain.ts";
import { approve } from "../support/signing.ts";
import { head, unchangedRecord } from "../support/world.ts";

export const approvalSign4 = scenario(
  { operation: "approval.sign", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, held } = yield* given(startingWorlds.paymentHeld);
    const past = addSeconds(held.approval.expiresAt, 60);
    const warped = yield* capxul["world.clock.warp"]({ target: { _tag: "to", at: past } });
    yield* sameInstant("the clock after the warp", warped.clock.now, past);
    const before = yield* head;
    const expired = yield* refusal("sam signing after the expiry", "ApprovalExpired", approve(held.approval));
    yield* same("ApprovalExpired's approval", expired.approval, held.approval.id);
    yield* sameInstant("ApprovalExpired's expiry", expired.expiredAt, held.approval.expiresAt);
    yield* unchangedRecord("the refused signature", before);
    yield* same("the PaymentSent logs for the payment", (yield* paymentsSent(world, held.payment.paymentId)).length, 0);
  }),
);
