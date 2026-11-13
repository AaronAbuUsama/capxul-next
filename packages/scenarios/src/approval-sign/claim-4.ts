// approval.sign, claim 4: an expired approval is refused, naming when it expired, and nothing is sent. Not checked:
// the absence of PaymentSent through the door's chain RPC; the record and the books are read instead.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { addSeconds, refusal, same, sameInstant } from "../support/expect.ts";
import { ledger, linesOf } from "../support/books.ts";
import { approve } from "../support/signing.ts";
import { head, unchangedRecord } from "../support/world.ts";
import { freshHold } from "./hold.ts";

export const approvalSign4 = scenario(
  { operation: "approval.sign", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { org, held } = yield* freshHold;
    const past = addSeconds(held.approval.expiresAt, 60);
    const warped = yield* capxul["world.clock.warp"]({ target: { _tag: "to", at: past } });
    yield* sameInstant("the clock after the warp", warped.clock.now, past);
    const before = yield* head;
    const expired = yield* refusal("sam signing after the expiry", "ApprovalExpired", approve(held.approval));
    yield* same("ApprovalExpired's approval", expired.approval, held.approval.id);
    yield* sameInstant("ApprovalExpired's expiry", expired.expiredAt, held.approval.expiresAt);
    yield* unchangedRecord("the refused signature", before);
    const lines = linesOf(yield* ledger(org, {}, "sam"), held.name);
    yield* expect(lines.length === 0, `the General Ledger shows ${held.name} after the refused signature`);
  }),
);
