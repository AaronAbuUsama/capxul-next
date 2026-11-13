// approval.sign, claim 3: a signature that does not recover the signer, an unknown approval and another person's
// approval are each refused, and nothing is sent. "Nothing is sent" is read from the record and the books: no
// entry, and no ledger line for the payment. Not checked: the absence of PaymentSent through the door's chain RPC.
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { refusal, same, sameAddress } from "../support/expect.ts";
import { ledger, linesOf } from "../support/books.ts";
import { signWith } from "../support/signing.ts";
import { castMember, head, unchangedRecord } from "../support/world.ts";
import { freshHold } from "./hold.ts";

const NOBODY_ISSUED = "apr_nobodyissuedthis";

export const approvalSign3 = scenario(
  { operation: "approval.sign", claim: 3 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const { world, org, held } = yield* freshHold;
    const sam = yield* castMember(world, "sam");
    const olga = yield* castMember(world, "olga");
    const before = yield* head;
    const byOlga = yield* signWith(olga.signer, held.approval.digest);
    const bySam = yield* signWith(sam.signer, held.approval.digest);

    const invalid = yield* refusal(
      "sam giving olga's signature",
      "SignatureInvalid",
      capxul["approval.sign"]({ approval: held.approval.id, signature: byOlga }, { as: "sam" }),
    );
    yield* same("SignatureInvalid's approval", invalid.approval, held.approval.id);
    yield* sameAddress("SignatureInvalid's expected address", invalid.expected, sam.signer);
    yield* sameAddress("SignatureInvalid's recovered address", invalid.recovered, olga.signer);

    const unknown = yield* refusal(
      "an approval nobody issued",
      "ApprovalNotFound",
      capxul["approval.sign"]({ approval: NOBODY_ISSUED, signature: bySam }, { as: "sam" }),
    );
    yield* same("ApprovalNotFound's approval", unknown.approval, NOBODY_ISSUED);

    const notHers = yield* refusal(
      "olga signing sam's approval",
      "NotYourApproval",
      capxul["approval.sign"]({ approval: held.approval.id, signature: bySam }, { as: "olga" }),
    );
    yield* same(
      "NotYourApproval",
      { approval: notHers.approval, signer: notHers.signer },
      { approval: held.approval.id, signer: "sam" },
    );

    yield* unchangedRecord("the three refused signatures", before);
    const lines = linesOf(yield* ledger(org, {}, "sam"), held.name);
    yield* expect(lines.length === 0, `the General Ledger shows ${held.name} after the refused signatures`);
  }),
);
