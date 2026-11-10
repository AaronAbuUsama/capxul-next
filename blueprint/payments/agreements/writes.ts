// The writes area: following one write to its end. Every write flow (flows.ts) prepares its write,
// has it signed, then subscribes here until the agreement's process decides it.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/blueprint-engine/src/index.ts";
import { concept_payments } from "../../shared/foundation.ts";
import { error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED } from "../../shared/vocabulary.ts";
import { table_agreement_writes, table_agreements } from "./data.ts";
import { Agreement, CollectionPayment, Write, WriteRef } from "./shapes.ts";

export const rpc_payroll_writes_watch = defineRpc({
  id: "payroll.writes.watch",
  title: "Follow one write until the chain decides it",
  about:
    "A live query over one write and its agreement: it pushes each change until the write is landed, failed or " +
    "abandoned, then ends. The agreement is as payroll holds it (its status and terms; the chain's live figures are left " +
    "null, as the prepare rpc already answered them). A landed collection carries its one payment: its id as `payment " +
    "get` finds it (`payment_` and the 64 hex digits of the v4 payment id its PaymentSent names, payments.chain-born-ids), " +
    "the amount, the window it covers and the transaction. An unknown write is INVALID_INPUT; one the " +
    "caller neither prepared nor may read (a member of the paying Organization, or the payee) is ROLE_PERMISSION_DENIED.",
  was: ["packages/backend/src/payroll/agreements/views/agreements.ts", "packages/sdk/src/payroll"],
  concept: concept_payments,
  kind: "live",
  who: "Whoever prepared the write; a member of the paying Organization; the payee.",
  input: WriteRef,
  output: Schema.Struct({ write: Write, agreement: Agreement, payment: Schema.NullOr(CollectionPayment) }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED],
  reads: [table_agreement_writes, table_agreements],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("live-read"),
});
