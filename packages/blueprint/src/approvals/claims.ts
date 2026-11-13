// The acceptance claims of approval.sign. It stands in the thin line's step 6, where the old blueprint had
// payment.send; the old payment.send claims that still hold for signing a held payment are kept here.
import { claim, dropped, kept, rewritten, type ClaimsOf } from "../claims/claim.ts";
import { ApprovalExpired, ApprovalNotFound, NotYourApproval, SignatureInvalid } from "../errors.ts";
import { startingWorlds as w } from "../starting-worlds.ts";
import * as Approvals from "./operations.ts";

const notHere =
  "It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.";

export const sign: ClaimsOf = {
  operation: Approvals.sign,
  claims: [
    claim(
      "A signed held payment is sent once, from the signer's Safe, and its Payment Entry posts once.",
      w.paymentHeld,
      "approval.sign as sam with his key's signature of the digest answers Sent for the payment with one transaction. Through the door's chain RPC that transaction holds one UserOperationEvent from sam's Safe and one PaymentSent carrying the payment's id; Brightside's address gained 125.50 USDC and the company Safe lost 125.50. report.run's General Ledger then shows the Payment Entry once and the invoice has nothing outstanding.",
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
      "approval.sign with the same signature twice answers Sent, then AlreadySent with the same transaction and no event. Through the door's chain RPC there is one PaymentSent for the payment.",
      { origin: kept("payment.send/c-59edd1848ac75c56") },
    ),
    claim(
      "A signature that does not recover the signer, an unknown approval and another person's approval are each refused, and nothing is sent.",
      w.paymentHeld,
      "approval.sign as sam with olga's key's signature is refused with SignatureInvalid naming both addresses; of an id nobody issued, with ApprovalNotFound; as olga of sam's approval, with NotYourApproval. No PaymentSent appears through the door's chain RPC and record.export shows no new entry.",
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
      "The operator warps the clock past the approval's expiry; approval.sign as sam is then refused with ApprovalExpired naming the expiry, and no PaymentSent appears.",
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
      "After org.member.grant, approval.sign by dana answers Collected with 1 of 2 and the hat is not worn; approval.sign by eli answers Sent.",
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
