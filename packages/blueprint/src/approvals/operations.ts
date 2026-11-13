// The concept "approvals": giving a signature that an operation asked for. Every signature in a world is made with
// a key by its signer and handed over here; nothing signs in a browser. This is how a held payment is paid, how a
// company's setup is authorised and how a Director approves a proposal.
import * as Str from "effect/String";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import {
  ApprovalClosed,
  ApprovalExpired,
  ApprovalNotFound,
  InsufficientBalance,
  NotYourApproval,
  SignatureInvalid,
  TransactionReverted,
} from "../errors.ts";
import { declareOutcomes, outcome } from "../operation.ts";
import { ApprovalId, Hash, PersonId, Signature, Subject } from "../values.ts";

export class ApprovalSigned extends Schema.TaggedClass<ApprovalSigned, { readonly brand: unique symbol }>()(
  "approval_signed",
  {
    approval: ApprovalId,
    signer: PersonId,
  },
) {}

/** The transaction the approvals authorised was included in the world's chain and did not revert. */
export class ApprovalLanded extends Schema.TaggedClass<ApprovalLanded, { readonly brand: unique symbol }>()(
  "approval_landed",
  {
    approval: ApprovalId,
    transaction: Hash,
    subject: Subject,
  },
) {}

/** The signature is kept; the subject needs more signatures before anything is sent. */
export class Collected extends Schema.TaggedClass<Collected, { readonly brand: unique symbol }>()("Collected", {
  approval: ApprovalId,
  signer: PersonId,
  subject: Subject,
  signatures: Schema.Int,
  threshold: Schema.Int,
}) {}

/** This signature completed the subject: its transaction was sent and is in the chain. */
export class Sent extends Schema.TaggedClass<Sent, { readonly brand: unique symbol }>()("Sent", {
  approval: ApprovalId,
  signer: PersonId,
  subject: Subject,
  transaction: Hash,
  block: Schema.Int,
}) {}

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
      success: Collected.make({
        approval: "apr_books1",
        signer: "dana",
        subject: { kind: "officer_change", id: "chg_books1" },
        signatures: 1,
        threshold: 2,
      }),
    },
    {
      payload: { approval: "apr_pay00001", signature: `0x${Str.repeat(65)("1c")}` },
      success: Sent.make({
        approval: "apr_pay00001",
        signer: "sam",
        subject: { kind: "payment", id: "req_pay00001" },
        transaction: `0x${Str.repeat(32)("77")}`,
        block: 47893300,
      }),
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
