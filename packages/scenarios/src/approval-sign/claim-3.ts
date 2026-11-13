// approval.sign, claim 3: a signature that does not recover the signer, an unknown approval and another person's
// approval are each refused, and nothing is sent.
import { startingWorlds } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { given, scenario } from "../scenario.ts";
import { refusal, same, sameAddress } from "../support/expect.ts";
import { paymentsSent } from "../support/chain.ts";
import { signWith } from "../support/signing.ts";
import { castMember, head, unchangedRecord } from "../support/world.ts";

const NOBODY_ISSUED = "apr_nobodyissuedthis";

export const approvalSign3 = scenario(
  { operation: "approval.sign", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, held } = yield* given(startingWorlds.paymentHeld);
    const approval = held.approval;
    // An operation first: what the empty handlers answer must be what the scenario fails on.
    const before = yield* head;
    const sam = yield* castMember(world, "sam");
    const olga = yield* castMember(world, "olga");
    const byOlga = yield* signWith(olga.signer, approval.digest);
    const bySam = yield* signWith(sam.signer, approval.digest);
    const sign = (id: string, signature: string, as: string) =>
      capxul["approval.sign"]({ approval: id, signature }, { as });

    const invalid = yield* refusal("sam giving olga's signature", "SignatureInvalid", sign(approval.id, byOlga, "sam"));
    yield* same("SignatureInvalid's approval", invalid.approval, approval.id);
    yield* sameAddress("SignatureInvalid's expected address", invalid.expected, sam.signer);
    yield* sameAddress("SignatureInvalid's recovered address", invalid.recovered, olga.signer);

    const unknown = yield* refusal("an approval nobody issued", "ApprovalNotFound", sign(NOBODY_ISSUED, bySam, "sam"));
    yield* same("ApprovalNotFound's approval", unknown.approval, NOBODY_ISSUED);

    const notHers = yield* refusal("olga signing sam's approval", "NotYourApproval", sign(approval.id, bySam, "olga"));
    yield* same(
      "NotYourApproval",
      { approval: notHers.approval, signer: notHers.signer },
      { approval: approval.id, signer: "sam" },
    );

    yield* unchangedRecord("the three refused signatures", before);
    yield* same("the PaymentSent logs for the payment", (yield* paymentsSent(world, held.payment.paymentId)).length, 0);
  }),
);
