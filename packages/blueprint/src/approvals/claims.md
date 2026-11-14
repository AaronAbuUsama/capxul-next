# Acceptance claims of the domain `approvals`

Rendered from `claims.ts` here and the declarations by `pnpm claims`. Do not edit it by hand: a test fails when
this file and its sources differ. What the runner checks on every call, and the starting worlds a claim is in,
are in [claims.md](../../claims.md).

## Count

| Operation | Claims | Old, word for word | Old, rewritten | New | Old, not kept |
|---|---|---|---|---|---|
| `approval.sign` | 5 | 1 | 3 | 1 | 5 |

## 1. `approval.sign`

- Served by: the world group.
- Refusals: `ApprovalNotFound`, `NotYourApproval`, `SignatureInvalid`, `ApprovalExpired`, `ApprovalClosed`, `InsufficientBalance`, `TransactionReverted`, `NotImplemented`, and `NotSignedIn` from sign-in.
- Emits: `Collected`: `approval_signed`; `Sent`: `approval_signed`, `approval_landed`; `AlreadySent`: none.
- Budget: 4,000 ms, provisional, excluding waking a parked world and chain confirmation on a public chain. Basis: a sponsored UserOperation or Safe transaction on the world's own chain, which mines at once; it answers when the transaction is in a block.

1. A signed held payment is sent once, from the signer's Safe, and its Payment Entry posts once. *(thin line)*
   - In: `payment-held`.
   - Observes: approval.sign as sam with his key's signature of the held approval's digest (the `held` fact) answers Sent for the payment with one transaction. Through the door's chain RPC (chain.transaction) that transaction holds one UserOperationEvent from sam's Safe and one PaymentSent carrying the payment's `paymentId` and `documentHash` from the Held answer; by chain.balance Brightside's address gained 125.50 USDC and the company Safe lost 125.50. report.run's General Ledger then shows the Payment Entry once and the invoice has nothing outstanding.
   - Old: `acc:payment.send/c-c9400dfaeba081e7`, rewritten. It said: "A signed personal payment is sent once and records its one Payment." Why: The thin line signs a payment held by doc.submit from the company Safe; it does not prepare a personal payment.
2. A replay of the same signature answers with the same hash and sends nothing more.
   - In: `payment-held`.
   - Observes: approval.sign with the same signature twice answers Sent, then AlreadySent with the same transaction and no event. Through the door's chain RPC (chain.logs of PaymentSent from the world's Payments) there is one PaymentSent with the payment's `paymentId`.
   - Old: `acc:payment.send/c-59edd1848ac75c56`, kept word for word.
3. A signature that does not recover the signer, an unknown approval and another person's approval are each refused, and nothing is sent.
   - In: `payment-held`.
   - Observes: approval.sign as sam with olga's key's signature is refused with SignatureInvalid naming both addresses; of an id nobody issued, with ApprovalNotFound; as olga of sam's approval, with NotYourApproval. No PaymentSent appears through the door's chain RPC (chain.logs) and record.export shows no new entry.
   - Refusals: `SignatureInvalid`, `ApprovalNotFound`, `NotYourApproval`.
   - Old: `acc:payment.send/c-59a1c78521a27aca`, rewritten. It said: "A signature that does not recover the account's signer, an unknown execution and another person's execution are each refused and nothing is sent." Why: What is signed is an approval, not an execution.
4. An expired approval is refused, naming when it expired, and nothing is sent.
   - In: `payment-held`.
   - Observes: The operator warps the clock past the held approval's expiry (the `held` fact); approval.sign as sam is then refused with ApprovalExpired naming the expiry, and no PaymentSent appears (chain.logs).
   - Refusals: `ApprovalExpired`.
   - Old: `acc:payment.send/c-37ce3ad182b6ecb0`, rewritten. It said: "An expired approval is refused and names the wait command." Why: Which command to run next is the command line's to say; the refusal carries the expiry it needs to say it.
5. A signature short of the threshold is kept, and nothing is sent until the last one needed.
   - In: `founded`.
   - Observes: After org.member.grant, approval.sign by dana answers Collected with 1 of 2; approval.sign by eli answers Sent, and the hat its transaction minted to sam's Safe (chain.transaction) was not worn by it at the block before (chain.wears at that block) and is worn after.
   - Old: none; this claim is new.

Old claims not kept:

- `acc:payment.send/c-f0567d73a498e614`: "An Organization payment uses the one spending allowance you hold for the asset, and with several asks which and takes `--from`." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-fd8fc63a3750fb85`: "A mistyped address, and a recipient that is nothing, are refused naming it." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-dd1de9fc08186cfb`: "A payment from a spending allowance is one `Budgets.spend` from the wearer's Safe; before anyone signs, the route must name that allowance's own active budget, and a route to another budget, a pending allowance or an unreadable list is closed unsent." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-88977816e3ab1aa9`: "A dated Director payment is one exact `Budgets.schedule` of the asked amount to the asked address on a v4 Budgets; another amount, recipient or contract is refused before anyone approves." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
- `acc:payment.send/c-e0782c0ab0380104`: "Once its Board proposal executes, each item reads `scheduled` with the scheduled id of its own `Budgets.schedule`, never one on another budget, and it still does when a chain read fails once on the way." Why: It is about preparing a new payment with payment.send, which is not in the thin line; it stays with payment.send's journey.
