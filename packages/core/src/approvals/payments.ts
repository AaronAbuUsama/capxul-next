// The approval of a payment from a company Safe, which doc.submit holds (decisions.md, 23 and 28): one UserOperation
// of the member's own Safe, `Budgets.spend` from the company's top budget, whose hat (Books) the member's Safe
// wears, so Budgets pays from the company Safe through its Roles and Gate, and Payments sends it with the document's
// hash. It is prepared now, so its digest is known before doc.submit answers; approval.sign sends it with the
// member's signature. The payment's id on the chain is what `spend` answers, read by simulating it now.
import { Errors } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as PgClient from "@effect/sql-pg/PgClient";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  keccak256,
  parseAbi,
  parseUnits,
  stringToHex,
} from "viem";
import { Cast } from "../cast/Cast.ts";
import { hexOf, usdcOf } from "../chain/calls.ts";
import { APPROVAL_LIFETIME_MS, SEEDED, USDC_DECIMALS } from "../chain/seeded.ts";
import { nonceKeyOf, prepare } from "../chain/userop.ts";
import { WorldChain } from "../chain/WorldChain.ts";
import { instant } from "../organizations/caller.ts";
import { worldNow } from "../record/emit.ts";
import { newId } from "../organizations/ids.ts";
import * as Store from "../organizations/store.ts";
import type { OpenedPayment, PaymentToHold } from "../site-ops/payments.ts";
import { open } from "./store.ts";
import { hex } from "../chain/hex.ts";

const SPEND = parseAbi([
  "function spend(uint256 id, address recipient, uint128 amount, uint16 kind, bytes32 documentHash, bytes32 jobNonce) returns (bytes32)",
]);
/** Payments' kind of a payment to a supplier (Budgets refuses any above its prepared kinds). */
const SUPPLIER_PAYMENT = 1;

/** Opens the approval of `payment`, or refuses when the company Safe holds less than it pays. */
export const openPayment = Effect.fn("payment.open")(function* (payment: PaymentToHold) {
  const sql = yield* PgClient.PgClient;
  const chain = yield* WorldChain;
  const cast = yield* Cast;
  const amount = parseUnits(payment.amount.amount, USDC_DECIMALS);
  const balance = yield* usdcOf(payment.safe);
  if (amount > balance)
    return yield* Errors.InsufficientBalance.make({
      safe: payment.safe,
      asset: payment.amount.asset,
      balance: formatUnits(balance, USDC_DECIMALS),
      amount: payment.amount.amount,
    });
  const organization = yield* Effect.flatMap(Store.byOrg(payment.org), Effect.fromOption).pipe(Effect.orDie);
  if (organization.budget === null)
    return yield* Effect.die(`${payment.org}'s setup has not landed: it has no budget to pay from`);
  const member = yield* Effect.flatMap(cast.find(payment.person), Effect.fromOption).pipe(Effect.orDie);
  if (member.safe === null) return yield* Effect.die(`${payment.person} has no Safe to pay from`);
  const request = yield* newId("req");
  const spend = encodeFunctionData({
    abi: SPEND,
    functionName: "spend",
    args: [
      BigInt(organization.budget),
      hex(payment.payeeAddress),
      amount,
      SUPPLIER_PAYMENT,
      hex(payment.documentHash),
      keccak256(stringToHex(request)),
    ],
  });
  // What `spend` answers as the member's Safe now is the payment's id: Payments derives it from the call alone.
  const simulated = yield* hexOf(
    "eth_call",
    yield* chain.rpc("eth_call", [{ from: member.safe, to: SEEDED.budgets, data: spend }, "latest"]),
  );
  const paymentId = decodeFunctionResult({ abi: SPEND, functionName: "spend", data: simulated });
  const operation = yield* prepare({
    sender: member.safe,
    to: SEEDED.budgets,
    data: spend,
    operation: 0,
    nonceKey: nonceKeyOf(`payment:${request}`),
    callGas: 1_500_000n,
  });
  const now = yield* worldNow;
  const approval = {
    id: yield* newId("apr"),
    signer: member.person,
    signerAddress: member.signer,
    digest: operation.digest,
    expiresAt: instant(now.timestampMs + APPROVAL_LIFETIME_MS),
  };
  yield* sql.withTransaction(
    open({
      subject: { kind: "payment", id: request },
      org: payment.org,
      threshold: 1,
      needs: member.person,
      spends: { safe: payment.safe, amount },
      landing: { via: "operation", operation },
      about: { documentHash: payment.documentHash, amount: payment.amount.amount, payee: payment.payeeAddress },
      approvals: [{ ...approval, signerSafe: member.safe }],
    }),
  );
  return { request, paymentId, approval } satisfies OpenedPayment;
});
