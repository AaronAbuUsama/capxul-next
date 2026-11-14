// The refusals of the domain "approvals": giving a signature an operation asked for. Each is declared once, here;
// ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { Address, ApprovalId, Hash, Instant, PersonId } from "../values.ts";

export class ApprovalNotFound extends Schema.TaggedError<ApprovalNotFound, { readonly brand: unique symbol }>()(
  "ApprovalNotFound",
  {
    approval: ApprovalId,
  },
) {}

/** The approval asks another person to sign. */
export class NotYourApproval extends Schema.TaggedError<NotYourApproval, { readonly brand: unique symbol }>()(
  "NotYourApproval",
  {
    approval: ApprovalId,
    signer: PersonId,
  },
) {}

/** The signature does not recover the approval's signer. Both addresses are named. */
export class SignatureInvalid extends Schema.TaggedError<SignatureInvalid, { readonly brand: unique symbol }>()(
  "SignatureInvalid",
  {
    approval: ApprovalId,
    expected: Address,
    recovered: Address,
  },
) {}

export class ApprovalExpired extends Schema.TaggedError<ApprovalExpired, { readonly brand: unique symbol }>()(
  "ApprovalExpired",
  {
    approval: ApprovalId,
    expiredAt: Instant,
  },
) {}

/** The approval ended without being sent. */
export class ApprovalClosed extends Schema.TaggedError<ApprovalClosed, { readonly brand: unique symbol }>()(
  "ApprovalClosed",
  {
    approval: ApprovalId,
    state: Schema.Literals(["declined", "withdrawn", "displaced"]),
  },
) {}

/** The transaction was sent and the chain reverted it. Nothing moved. */
export class TransactionReverted extends Schema.TaggedError<TransactionReverted, { readonly brand: unique symbol }>()(
  "TransactionReverted",
  {
    approval: ApprovalId,
    transaction: Hash,
    reason: Schema.String,
  },
) {}

export const refusals = {
  ApprovalNotFound,
  NotYourApproval,
  SignatureInvalid,
  ApprovalExpired,
  ApprovalClosed,
  TransactionReverted,
} as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  ApprovalNotFound: 2,
  NotYourApproval: 4,
  SignatureInvalid: 2,
  ApprovalExpired: 2,
  ApprovalClosed: 2,
  TransactionReverted: 5,
};
