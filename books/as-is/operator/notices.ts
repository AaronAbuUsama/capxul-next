// The as-is book of the old operator concept: the notices area, the notice delivery record (G5).
//
// Every operation registered at `operator/notices:*` (packages/backend/convex/operator/notices.ts):
// internal functions. The mail owner's `sendNotice` writes through `record` on every deployment;
// `capxul dev mail notices` reads `list` through the devnet guardian. None is scheduled, so both are rpcs.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { error_UNKNOWN } from "../shared/vocabulary.ts";
import { machine_notice_delivery, table_notice_deliveries } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/operator/notices.ts`;
const NT = `${BACKEND}/src/operator/notices`;
const OPS = `${NT}/operations`;

const Status = Schema.Literals(["sent", "retrying", "failed"]);
const LastError = Schema.Struct({ code: Schema.String, message: Schema.String });

export const rpc_operator_notices_record = defineRpc({
  id: "operator.notices.record",
  title: "Upsert one notice recipient's delivery record",
  about:
    "The internal mutation `operator/notices:record`. Finds the row by notice id and the trimmed, lowercased recipient " +
    "and updates it, or inserts it: the status as sent, the attempt count never lower than before, the last error and " +
    "mail id when given (an earlier error stays until a later one replaces it), `updatedAt` in backend time. No status " +
    "check and no environment gate: it runs on every deployment. The caller catches any failure and logs " +
    "`[CAPXUL_NOTICE_RECORD_FAILED]`, so the record never stops a notice.",
  was: [`${CONVEX}:6`, `${OPS}/record.ts:13`, `${NT}/writes.ts:27`, `${NT}/writes.ts:37`, `${NT}/reads.ts:8`, "packages/backend/src/integrations/mail/notices.ts:41"],
  concept: concept_operator,
  kind: "mutation",
  who: "internal: the mail owner's `recordDelivery` after each notice attempt (integrations/mail/notices.ts:41).",
  input: Schema.Struct({
    noticeId: Schema.String,
    template: Schema.String,
    operation: Schema.String,
    recipient: Schema.String,
    status: Status,
    attempts: Schema.Number,
    lastError: Schema.optionalKey(LastError),
    mailId: Schema.optionalKey(Schema.String),
  }),
  output: Schema.Struct({ noticeId: Schema.String, recipient: Schema.String, status: Status, attempts: Schema.Number }),
  errors: [error_UNKNOWN],
  reads: [table_notice_deliveries],
  writes: [table_notice_deliveries],
  drives: [machine_notice_delivery.t.to_sent, machine_notice_delivery.t.to_retrying, machine_notice_delivery.t.to_failed],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_notices_list = defineRpc({
  id: "operator.notices.list",
  title: "Each notice recipient's delivery record, most recently written first",
  about:
    "The internal query `operator/notices:list` (`capxul dev mail notices`). The 200 most recently written rows (write " +
    "order, not `updatedAt`, because a devnet rewind sets business time back), to one address or to any; the template " +
    "filter is applied after the 200 are taken. No environment gate: on production it reads real recipients' addresses.",
  was: [`${CONVEX}:5`, `${OPS}/list.ts:14`, `${OPS}/list.ts:23`, `${NT}/reads.ts:26`, `${NT}/views.ts:5`],
  concept: concept_operator,
  kind: "query",
  who: "internal: an operator or the devnet guardian with `convex run` (`capxul dev mail notices`).",
  input: Schema.Struct({ to: Schema.optionalKey(Schema.String), template: Schema.optionalKey(Schema.String) }),
  output: Schema.Array(
    Schema.Struct({
      noticeId: Schema.String,
      template: Schema.String,
      operation: Schema.String,
      to: Schema.String,
      status: Status,
      attempts: Schema.Number,
      lastError: Schema.NullOr(LastError),
      mailId: Schema.NullOr(Schema.String),
      createdAtMs: Schema.Number,
      updatedAtMs: Schema.Number,
    }),
  ),
  errors: [error_UNKNOWN],
  reads: [table_notice_deliveries],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
