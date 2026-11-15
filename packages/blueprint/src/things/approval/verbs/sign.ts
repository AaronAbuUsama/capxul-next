// `capxul approval sign` (today `approval.sign`): giving a signature an operation asked for.
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import { declareOutcomes, outcome, claim, kept, rewritten, dropped } from "@capxul/blueprint-tools";
import { InsufficientBalance, NotImplemented } from "../../../common/refusals.ts";
import { ApprovalId, Hash, Signature } from "../../../common/values.ts";
import { Subject } from "../../../generated/subjects.ts";
import { startingWorlds as w, type ClaimsOf } from "../../../starting-points/points.ts";
import { ApprovalLanded, ApprovalSigned } from "../events.ts";
import { booksCollected, paymentSent } from "../examples.ts";
import {
  ApprovalClosed,
  ApprovalExpired,
  ApprovalNotFound,
  NotYourApproval,
  SignatureInvalid,
  TransactionReverted,
} from "../refusals.ts";
import { Collected, Sent } from "../values.ts";

/** The same signature was given again after it was sent: the same transaction, and nothing more is sent. */
export class AlreadySent extends Schema.TaggedClass<AlreadySent, { readonly brand: unique symbol }>()("AlreadySent", {
  approval: ApprovalId,
  subject: Subject,
  transaction: Hash,
  block: Schema.Int,
}) {}

const signRpc = Rpc.make("approval.sign", {
  payload: {
    approval: ApprovalId,
    /** The signer's signature of the approval's digest, made with their own key. */
    signature: Signature,
  },
  success: Schema.Union([Collected, Sent, AlreadySent]),
  error: Schema.Union([
    ApprovalNotFound,
    NotYourApproval,
    SignatureInvalid,
    ApprovalExpired,
    ApprovalClosed,
    InsufficientBalance,
    TransactionReverted,
    NotImplemented,
  ]),
});

const signed = ({ success }: { readonly success: Collected | Sent }) => ({
  approval: success.approval,
  signer: success.signer,
});

export const sign = declareOutcomes({
  rpc: signRpc,
  outcomes: {
    Collected: outcome(signRpc, "Collected", [{ event: ApprovalSigned, carries: signed }]),
    Sent: outcome(signRpc, "Sent", [
      { event: ApprovalSigned, carries: signed },
      {
        event: ApprovalLanded,
        carries: ({ success }) => ({
          approval: success.approval,
          transaction: success.transaction,
          subject: success.subject,
        }),
      },
    ]),
    AlreadySent: outcome(signRpc, "AlreadySent", []),
  },
  budget: {
    ms: 4_000,
    excludes: ["waking a parked world", "chain confirmation on a public chain"],
    provisional: true,
    basis:
      "a sponsored UserOperation or Safe transaction on the world's own chain, which mines at once; it answers when the transaction is in a block",
  },
  examples: [
    {
      payload: { approval: "apr_books1", signature: `0x${Str.repeat(65)("1b")}` },
      success: booksCollected,
    },
    {
      payload: { approval: "apr_pay00001", signature: `0x${Str.repeat(65)("1c")}` },
      success: paymentSent,
    },
    {
      payload: { approval: "apr_pay00001", signature: `0x${Str.repeat(65)("1c")}` },
      success: AlreadySent.make({
        approval: "apr_pay00001",
        subject: { kind: "payment", id: "req_pay00001" },
        transaction: `0x${Str.repeat(32)("77")}`,
        block: 47893300,
      }),
    },
  ],
});

/** Who serves it: a world's Core, through the world's door (`WorldRpcs`). */
export const server = "world";

const notHere =
  "It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.";

/** What `approval.sign` promises, each promise checked by the journeys. */
export const promises: ClaimsOf = {
  operation: sign,
  claims: [
    claim(
      "A signed held payment is sent once, from the signer's Safe, and its Payment Entry posts once.",
      w.paymentHeld,
      "approval.sign as sam with his key's signature of the held approval's digest (the `held` fact) answers Sent for the payment with one transaction. Through the door's chain RPC (chain.transaction) that transaction holds one UserOperationEvent from sam's Safe and one PaymentSent carrying the payment's `paymentId` and `documentHash` from the Held answer; by chain.balance Brightside's address gained 125.50 USDC and the company Safe lost 125.50. report.run's General Ledger then shows the Payment Entry once and the invoice has nothing outstanding.",
      {
        origin: rewritten(
          "payment.send/c-c9400dfaeba081e7",
          "A signed personal payment is sent once and records its one Payment.",
          "The thin line signs a payment held by doc.submit from the company Safe; it does not prepare a personal payment.",
        ),
        thinLine: true,
      },
    ),
    claim(
      "A replay of the same signature answers with the same hash and sends nothing more.",
      w.paymentHeld,
      "approval.sign with the same signature twice answers Sent, then AlreadySent with the same transaction and no event. Through the door's chain RPC (chain.logs of PaymentSent from the world's Payments) there is one PaymentSent with the payment's `paymentId`.",
      { origin: kept("payment.send/c-59edd1848ac75c56") },
    ),
    claim(
      "A signature that does not recover the signer, an unknown approval and another person's approval are each refused, and nothing is sent.",
      w.paymentHeld,
      "approval.sign as sam with olga's key's signature is refused with SignatureInvalid naming both addresses; of an id nobody issued, with ApprovalNotFound; as olga of sam's approval, with NotYourApproval. No PaymentSent appears through the door's chain RPC (chain.logs) and record.export shows no new entry.",
      {
        refusals: [SignatureInvalid, ApprovalNotFound, NotYourApproval],
        origin: rewritten(
          "payment.send/c-59a1c78521a27aca",
          "A signature that does not recover the account's signer, an unknown execution and another person's execution are each refused and nothing is sent.",
          "What is signed is an approval, not an execution.",
        ),
      },
    ),
    claim(
      "An expired approval is refused, naming when it expired, and nothing is sent.",
      w.paymentHeld,
      "The operator warps the clock past the held approval's expiry (the `held` fact); approval.sign as sam is then refused with ApprovalExpired naming the expiry, and no PaymentSent appears (chain.logs).",
      {
        refusals: [ApprovalExpired],
        origin: rewritten(
          "payment.send/c-37ce3ad182b6ecb0",
          "An expired approval is refused and names the wait command.",
          "Which command to run next is the command line's to say; the refusal carries the expiry it needs to say it.",
        ),
      },
    ),
    claim(
      "A signature short of the threshold is kept, and nothing is sent until the last one needed.",
      w.founded,
      "After org.member.grant, approval.sign by dana answers Collected with 1 of 2; approval.sign by eli answers Sent, and the hat its transaction minted to sam's Safe (chain.transaction) was not worn by it at the block before (chain.wears at that block) and is worn after.",
    ),
  ],
  dropped: [
    dropped(
      "payment.send/c-f0567d73a498e614",
      "An Organization payment uses the one spending allowance you hold for the asset, and with several asks which and takes `--from`.",
      notHere,
    ),
    dropped(
      "payment.send/c-fd8fc63a3750fb85",
      "A mistyped address, and a recipient that is nothing, are refused naming it.",
      notHere,
    ),
    dropped(
      "payment.send/c-dd1de9fc08186cfb",
      "A payment from a spending allowance is one `Budgets.spend` from the wearer's Safe; before anyone signs, the route must name that allowance's own active budget, and a route to another budget, a pending allowance or an unreadable list is closed unsent.",
      notHere,
    ),
    dropped(
      "payment.send/c-88977816e3ab1aa9",
      "A dated Director payment is one exact `Budgets.schedule` of the asked amount to the asked address on a v4 Budgets; another amount, recipient or contract is refused before anyone approves.",
      notHere,
    ),
    dropped(
      "payment.send/c-e0782c0ab0380104",
      "Once its Board proposal executes, each item reads `scheduled` with the scheduled id of its own `Budgets.schedule`, never one on another budget, and it still does when a chain read fails once on the way.",
      notHere,
    ),
  ],
};
