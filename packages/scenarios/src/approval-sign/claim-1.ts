// approval.sign, claim 1: a signed held payment is sent once, from the signer's Safe, and its Payment Entry posts
// once. Checked: Sent for the payment with one transaction, then the books: the Payment Entry's credit to the
// company Safe's account is 125.50 once, and the invoice has nothing outstanding. Not checked: the transaction's
// UserOperationEvent and PaymentSent and the two balances, which only the door's chain RPC shows.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect, scenario } from "../scenario.ts";
import { answers, same, sameAmount, show } from "../support/expect.ts";
import { ledger, linesOf, numberOf, outstanding, safeCredits } from "../support/books.ts";
import { approve } from "../support/signing.ts";
import { eventually } from "../support/wait.ts";
import { fieldOf } from "../support/world.ts";
import { freshHold } from "./hold.ts";

export const approvalSign1 = scenario(
  { operation: "approval.sign", claim: 1 },
  Effect.gen(function* () {
    const { org, invoice, held } = yield* freshHold;
    const sent = yield* answers("sam's signature of the held payment", "Sent", approve(held.approval));
    yield* same("the subject sent", sent.subject, { kind: "payment", id: held.payment.request });
    yield* same("the signer", sent.signer, "sam");
    yield* same("the approval", sent.approval, held.approval.id);

    const lines = yield* eventually(
      `the General Ledger to show ${held.name}`,
      ledger(org, {}, "sam"),
      (rows) => linesOf(rows, held.name).length > 0,
    );
    const credits = safeCredits(linesOf(lines, held.name));
    yield* expect(
      credits.length === 1,
      `${held.name} credits the company Safe's account ${credits.length} times: ${show(credits)}`,
    );
    yield* sameAmount(
      "the Safe's credit for the payment",
      Arr.reduce(credits, 0, (sum, line) => sum + numberOf(fieldOf(line, "credit"))),
      125.5,
    );
    yield* sameAmount(`what is outstanding on ${invoice}`, yield* outstanding(org, invoice, "sam"), 0);
  }),
);
