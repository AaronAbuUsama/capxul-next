// approval.sign, claim 1: a signed held payment is sent once, from the signer's Safe, and its Payment Entry posts
// once. sam signs the starting world's own held approval (the `held` fact).
import { Site, startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { expect, given, scenario } from "../scenario.ts";
import { answers, present, same, sameAddress, sameAmount, show } from "../support/expect.ts";
import { isAddress, logsOf, usdc } from "../support/chain.ts";
import { approve } from "../support/signing.ts";
import { ledger, linesOf, numberOf, outstanding, safeCredits } from "../support/site.ts";
import { eventually } from "../support/wait.ts";
import { castMember, fieldOf, head, textOf } from "../support/world.ts";

export const approvalSign1 = scenario(
  { operation: "approval.sign", claim: 1 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const facts = yield* given(startingWorlds.paymentHeld);
    const { world, held } = facts;
    const org = facts.founded.org;
    const company = facts.founded.safe;
    const payee = textOf(facts.supplier.fields, Site.SUPPLIER_FIELDS.paymentAddress);
    // An operation first: what the empty handlers answer must be what the scenario fails on.
    yield* head;
    const before = yield* Effect.all({ payee: usdc(world, payee), company: usdc(world, company) });

    const sent = yield* answers("sam's signature of the held payment", "Sent", approve(held.approval));
    yield* same("the subject sent", sent.subject, { kind: "payment", id: held.payment.request });
    yield* same("the signer", sent.signer, "sam");
    yield* same("the approval", sent.approval, held.approval.id);

    const sam = yield* castMember(world, "sam");
    const samSafe = yield* present("sam's Safe", sam.safe);
    const included = yield* capxul.chain.transaction({ transaction: sent.transaction });
    yield* same("the transaction's status", included.status, "success");
    const userOps = Arr.filter(logsOf(included.logs, "UserOperationEvent"), (log) =>
      isAddress(log.address, world.contracts.entryPoint),
    );
    yield* same("the transaction's UserOperationEvents", userOps.length, 1);
    for (const op of userOps) yield* sameAddress("the UserOperation's sender", op.sender, samSafe);
    const payments = Arr.filter(logsOf(included.logs, "PaymentSent"), (log) =>
      isAddress(log.address, world.contracts.payments),
    );
    yield* same(
      "the transaction's PaymentSent",
      Arr.map(payments, (log) => ({ paymentId: log.paymentId, documentHash: log.documentHash })),
      [{ paymentId: held.payment.paymentId, documentHash: held.payment.documentHash }],
    );
    const after = yield* Effect.all({ payee: usdc(world, payee), company: usdc(world, company) });
    yield* sameAmount(
      "what Brightside's address gained",
      Number(after.payee) - Number(before.payee),
      Site.INVOICE_AMOUNT,
    );
    yield* sameAmount(
      "what the company Safe lost",
      Number(before.company) - Number(after.company),
      Site.INVOICE_AMOUNT,
    );

    const rows = yield* eventually(
      `the General Ledger to show ${held.name}`,
      ledger(org, {}, { as: "sam" }),
      (lines) => linesOf(lines, held.name).length > 0,
    );
    const credits = safeCredits(linesOf(rows, held.name));
    yield* expect(
      credits.length === 1,
      `${held.name} credits the company Safe's account ${credits.length} times: ${show(credits)}`,
    );
    const credited = Arr.reduce(credits, 0, (sum, line) => sum + numberOf(fieldOf(line, Site.ROW_FIELDS.credit)));
    yield* sameAmount("the Safe's credit for the payment", credited, Site.INVOICE_AMOUNT);
    yield* sameAmount(
      `what is outstanding on ${facts.invoice.name}`,
      yield* outstanding(org, facts.invoice.name, { as: "sam" }),
      0,
    );
  }),
);
