// The approval a held payment waits for (blueprint decisions.md, 23 and 28). doc.submit reads the payment from the
// Payment Entry, its payee's address from the Supplier and its hash from what doc.create stored; opening the approval
// for it is the approvals' work: the sponsored UserOperation the signer's signature will send, its digest, its
// expiry and the payment's id on the chain, and the check that the company Safe holds the amount. approval.sign sends
// it. That half is built with approval.sign (the chain operations), which provides `PaymentApprovals`.
import type { Errors, Values } from "@capxul/blueprint";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** A payment from a company's Safe, as doc.submit read it, waiting for an approval. */
export interface PaymentToHold {
  readonly org: string;
  /** The person who submitted it: the member whose permission pays it. */
  readonly person: string;
  readonly document: { readonly doctype: string; readonly name: string };
  readonly payee: string;
  readonly payeeAddress: string;
  readonly amount: typeof Values.Money.Type;
  /** The company Safe it is paid from, as the company's site keeps it. */
  readonly safe: string;
  readonly documentHash: string;
}

/** The approval opened for it: the request's id, the payment's id on the chain and the signature it waits for. */
export interface OpenedPayment {
  readonly request: string;
  readonly paymentId: string;
  readonly approval: typeof Values.Approval.Type;
}

export class PaymentApprovals extends Context.Service<
  PaymentApprovals,
  {
    /** Opens the approval of `payment`, or refuses when the Safe holds less than it pays. */
    readonly open: (payment: PaymentToHold) => Effect.Effect<OpenedPayment, Errors.InsufficientBalance>;
  }
>()("@capxul/core/site-ops/payments/PaymentApprovals") {}

/**
 * Until approval.sign's half is merged: a Payment Entry from the Safe reaches here and the call dies, naming what is
 * missing, so nothing is held that nothing could send. Every other document posts.
 */
export const PaymentApprovalsUnbuilt = Layer.succeed(
  PaymentApprovals,
  PaymentApprovals.of({
    open: (payment) =>
      Effect.die(
        `${payment.document.name} is paid from the company Safe: its approval is opened by approval.sign's PaymentApprovals, which this Core was not built with`,
      ),
  }),
);
