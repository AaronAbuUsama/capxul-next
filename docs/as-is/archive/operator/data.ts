// The old operator concept's tables, as the old code has them (factory, branch integration/factory).
// Evidence, not the target design.
//
// packages/backend/src/operator/tables.ts, composed into the one production schema at
// packages/backend/convex/schema.ts:90. All four are operator or proof tooling living in the production
// schema, deployed to every environment: three of them (`e2eReceiptHolds`, `devnetMail`,
// `devnetMailFaults`) are written only where a gate (the reserved e2e auth gate, a local devnet) admits
// it and stay empty elsewhere; `noticeDeliveries` is written on every deployment. That placement is a
// finding, recorded as it is. One state machine: the delivery record's `status`.

import { Schema } from "effect";
import { defineMachine, defineTable } from "../../../packages/book/src/index.ts";
import { concept_operator } from "../shared/foundation.ts";

const O = "packages/backend/src/operator";
const SCHEMA = "packages/backend/convex/schema.ts:90";

const opt = Schema.optionalKey;
const S = Schema.String;
const N = Schema.Number;

// ── tables ──────────────────────────────────────────────────────────────────────────────────

export const table_e2e_receipt_holds = defineTable({
  id: "e2e-receipt-holds",
  title: "E2E receipt holds: user operations whose receipt the acceptance run withholds",
  about:
    "A06 (#1976): one row per user-operation hash whose receipt every backend observer must not see. Written only " +
    "through operator.receipts.hold and release, which refuse unless the reserved e2e auth gate is enabled; read by the " +
    "backend's chain seam through operator.receipts.is-held over this deployment's own HTTP query API " +
    "(platform/proof-controls/receipt-policy.ts:56). A test-only control table in the production schema: empty on " +
    "production, where the gate refuses every call, and an empty table leaves the receipt path untouched.",
  was: [`${O}/tables.ts:8`, `${O}/receipts/writes.ts:9`, "packages/backend/src/platform/proof-controls/receipt-policy.ts:12", SCHEMA],
  concept: concept_operator,
  tenancy: "global",
  scope: "Keyed by user-operation hash; no person or Organization.",
  fields: Schema.Struct({ userOpHash: S, heldAt: N }),
  key: ["userOpHash"],
  indexes: [
    {
      name: "by_user_op_hash",
      fields: ["userOpHash"],
      for: "The hold on one hash (`.unique()`): hold, release and is-held (receipts/reads.ts:7).",
      crossTenant: true,
    },
  ],
  retention: "Deleted by operator.receipts.release; a hold never released stays.",
});

export const table_devnet_mail = defineTable({
  id: "devnet-mail",
  title: "Devnet mail: every email a local devnet would have sent",
  about:
    "G4: on a local devnet the mail transport keeps each message here instead of sending it (keepInSink, " +
    "integrations/mail/service.ts:171), through operator.outboxes.record, which refuses anywhere else. Read by " +
    "operator.outboxes.list (`capxul dev mail list`). The address is trimmed and lowercased; `links` are the http(s) " +
    "links in the text; `sentAt` is backend (warped) time; `mailId` is `mail_` plus a ULID of that time. The HTML body " +
    "is not kept, although the views comment says it is. A devnet-only table in the production schema, empty on every " +
    "other deployment.",
  was: [`${O}/tables.ts:21`, `${O}/outboxes/writes.ts:58`, `${O}/outboxes/views.ts:2`, SCHEMA],
  concept: concept_operator,
  tenancy: "global",
  scope: "Keyed by recipient email address; no person or Organization column.",
  fields: Schema.Struct({
    mailId: S,
    to: S,
    from: S,
    subject: S,
    template: S,
    text: S,
    links: Schema.Array(S),
    sentAt: N,
  }),
  key: ["mailId"],
  indexes: [
    {
      name: "by_to_sent_at",
      fields: ["to", "sentAt"],
      for: "One address's messages since a time, newest first, 200 at most (outboxes/reads.ts:27).",
    },
    {
      name: "by_sent_at",
      fields: ["sentAt"],
      for: "Every message since a time, newest first, 200 at most (outboxes/reads.ts:22).",
    },
  ],
  retention: "Kept for the devnet's life: nothing deletes a sink message.",
});

export const table_devnet_mail_faults = defineTable({
  id: "devnet-mail-faults",
  title: "Devnet mail faults: the mail sink's fail switch",
  about:
    "The next `remaining` sink writes to `to` (or to any address when `to` is null) fail as the provider refusing them. " +
    "Armed by operator.outboxes.fail (`capxul dev mail fail`), which replaces an address's fault, and spent by " +
    "operator.outboxes.record in the write it refuses: an address's own fault first, then the any-address one; a fault " +
    "at zero is deleted. Both refuse anywhere but a local devnet. A devnet-only table in the production schema.",
  was: [`${O}/tables.ts:38`, `${O}/outboxes/writes.ts:14`, `${O}/outboxes/writes.ts:37`, SCHEMA],
  concept: concept_operator,
  tenancy: "global",
  scope: "Keyed by recipient email address or null (any address).",
  fields: Schema.Struct({ to: Schema.NullOr(S), remaining: N, armedAt: N }),
  key: ["to"],
  indexes: [
    {
      name: "by_to",
      fields: ["to"],
      for: "The armed fault for one address, or for any address with `to` null (outboxes/reads.ts:38).",
    },
  ],
  retention: "Deleted when spent to zero or cleared; at most one row per address.",
});

export const table_notice_deliveries = defineTable({
  id: "notice-deliveries",
  title: "Notice deliveries: each notice recipient's delivery record",
  about:
    "G5: one row per notice and recipient, so an operator reads what a notice did without the Convex log. Upserted by " +
    "the mail owner's sendNotice through operator.notices.record after each attempt, on every deployment, production " +
    "included; read by operator.notices.list (`capxul dev mail notices`), which runs on any deployment with `convex " +
    "run`. The recipient is trimmed and lowercased. `attempts` never goes back; `lastError` keeps the classified code " +
    "and message only, and stays after a later success. `operation` names the operation that sent the notice. Dates are " +
    "backend (business) time, which a devnet rewind sets back. Production notice bookkeeping kept in the operator " +
    "concept.",
  was: [`${O}/tables.ts:49`, `${O}/notices/writes.ts:27`, "packages/backend/src/integrations/mail/notices.ts:41", SCHEMA],
  concept: concept_operator,
  tenancy: "global",
  scope: "Keyed by notice id and recipient email address; no person or Organization column.",
  fields: Schema.Struct({
    noticeId: S,
    template: S,
    operation: S,
    recipient: S,
    status: Schema.Literals(["sent", "retrying", "failed"]),
    attempts: N,
    lastError: opt(Schema.Struct({ code: S, message: S })),
    mailId: opt(S),
    createdAt: N,
    updatedAt: N,
  }),
  key: ["noticeId", "recipient"],
  indexes: [
    {
      name: "by_notice_recipient",
      fields: ["noticeId", "recipient"],
      for: "The row one notice keeps for one recipient (`.unique()`), for the upsert (notices/reads.ts:8).",
    },
    {
      name: "by_recipient",
      fields: ["recipient"],
      for: "One address's delivery rows, most recently written first, 200 at most (notices/reads.ts:33).",
      crossTenant: true,
    },
  ],
  retention: "Kept indefinitely: nothing deletes a delivery row.",
});

// ── machines ────────────────────────────────────────────────────────────────────────────────

export const machine_notice_delivery = defineMachine({
  id: "notice-delivery",
  title: "Notice delivery status",
  about:
    "noticeDeliveries.status. The writer (upsertDelivery, notices/writes.ts:27) stores whatever status the caller sends, " +
    "from any status, with no guard; the transitions list every move it admits. The mail sender sends `sent` on a " +
    "taken message and, on a failure, `retrying` while attempts remain (three in all) and `failed` on the last " +
    "(integrations/mail/notices.ts:51), so a row is born `sent` or `retrying`. A recorded status that cannot be " +
    "written leaves one `[CAPXUL_NOTICE_RECORD_FAILED]` log line and nothing else.",
  was: [`${O}/tables.ts:54`, `${O}/notices/writes.ts:27`, "packages/backend/src/integrations/mail/notices.ts:28"],
  table: table_notice_deliveries,
  field: "status",
  initial: "sent",
  states: [
    { id: "sent", about: "The provider (or the devnet sink) took the message." },
    { id: "retrying", about: "An attempt failed and the sender will try again." },
    { id: "failed", about: "The last attempt failed; the sender stops." },
  ],
  transitions: {
    to_sent: {
      from: ["retrying", "failed"],
      to: "sent",
      about: "A retry the provider took (notices/writes.ts:51). Born `sent` when the first attempt is taken.",
      guard: "None in the writer.",
      emits: [],
    },
    to_retrying: {
      from: ["sent", "failed"],
      to: "retrying",
      about: "A failed attempt with attempts left. Born `retrying` when the first attempt fails.",
      guard: "None in the writer; the sender never sends it after `sent`.",
      emits: [],
    },
    to_failed: {
      from: ["sent", "retrying"],
      to: "failed",
      about: "The third failed attempt.",
      guard: "None in the writer; the sender sends it only on its last attempt.",
      emits: [],
    },
  },
});
