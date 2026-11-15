// The ways the approval's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";
import { Address, ApprovalId, Hash, Instant, PersonId } from "../../common/values.ts";

export class ApprovalNotFound extends refusal<ApprovalNotFound, { readonly brand: unique symbol }>()(
  "ApprovalNotFound",
  {
    approval: ApprovalId,
  },
  2,
) {}

/** The approval asks another person to sign. */
export class NotYourApproval extends refusal<NotYourApproval, { readonly brand: unique symbol }>()(
  "NotYourApproval",
  {
    approval: ApprovalId,
    signer: PersonId,
  },
  4,
) {}

/** The signature does not recover the approval's signer. Both addresses are named. */
export class SignatureInvalid extends refusal<SignatureInvalid, { readonly brand: unique symbol }>()(
  "SignatureInvalid",
  {
    approval: ApprovalId,
    expected: Address,
    recovered: Address,
  },
  2,
) {}

export class ApprovalExpired extends refusal<ApprovalExpired, { readonly brand: unique symbol }>()(
  "ApprovalExpired",
  {
    approval: ApprovalId,
    expiredAt: Instant,
  },
  2,
) {}

/** The approval ended without being sent. */
export class ApprovalClosed extends refusal<ApprovalClosed, { readonly brand: unique symbol }>()(
  "ApprovalClosed",
  {
    approval: ApprovalId,
    state: Schema.Literals(["declined", "withdrawn", "displaced"]),
  },
  2,
) {}

/** The transaction was sent and the chain reverted it. Nothing moved. */
export class TransactionReverted extends refusal<TransactionReverted, { readonly brand: unique symbol }>()(
  "TransactionReverted",
  {
    approval: ApprovalId,
    transaction: Hash,
    reason: Schema.String,
  },
  5,
) {}

export const refusals = {
  ApprovalNotFound,
  NotYourApproval,
  SignatureInvalid,
  ApprovalExpired,
  ApprovalClosed,
  TransactionReverted,
} as const;
