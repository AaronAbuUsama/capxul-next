// The as-is book of the old operator concept: the outboxes area, the devnet mail sink (G4).
//
// Every operation registered at `operator/outboxes:*` (packages/backend/convex/operator/outboxes.ts):
// internal functions. The mail transport records through `record` on a local devnet; `capxul dev mail
// list` reads `list` and `capxul dev mail fail` arms `fail`, each through the devnet guardian. None is
// scheduled, so every one is an rpc.

import { Schema } from "effect";
import { defineRpc } from "../../../packages/book/src/index.ts";

import { concept_operator } from "../shared/foundation.ts";
import { error_INVALID_INPUT, error_UNKNOWN } from "../shared/vocabulary.ts";
import { table_devnet_mail, table_devnet_mail_faults } from "./data.ts";

const BACKEND = "packages/backend";
const CONVEX = `${BACKEND}/convex/operator/outboxes.ts`;
const OB = `${BACKEND}/src/operator/outboxes`;
const OPS = `${OB}/operations`;

/** requireLocalDevnet (operator/guards.ts:10): INVALID_INPUT `environment` anywhere but a local devnet. */
const LOCAL_WAS = [`${BACKEND}/src/operator/guards.ts:10`, `${BACKEND}/src/operator/errors.ts:6`];

const Faults = Schema.Array(Schema.Struct({ to: Schema.NullOr(Schema.String), remaining: Schema.Number }));

export const rpc_operator_outboxes_record = defineRpc({
  id: "operator.outboxes.record",
  title: "Keep one message in the devnet mail sink, or refuse it by the fail switch",
  about:
    "The internal mutation `operator/outboxes:record`. Local devnet only, so a real deployment can never swallow its " +
    "mail. A fault armed for the address, else for any address, is spent in this same write and the call answers " +
    "`refused: true` with what is left, not an error, so the fault stays spent and the transport reads it as the " +
    "provider refusing. Otherwise the message is kept (address lowercased, links extracted, backend time) and its " +
    "`mail_` id answered. The HTML body is never passed in.",
  was: [`${CONVEX}:8`, `${OPS}/record.ts:17`, `${OPS}/record.ts:28`, `${OB}/writes.ts:37`, `${OB}/writes.ts:58`, `${OB}/rules.ts:4`, ...LOCAL_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: "internal: the mail transport's devnet sink (`keepInSink`, integrations/mail/service.ts:171), on a resolved `local` environment.",
  input: Schema.Struct({
    to: Schema.String,
    from: Schema.String,
    subject: Schema.String,
    template: Schema.String,
    text: Schema.String,
  }),
  output: Schema.Union([
    Schema.Struct({ refused: Schema.Literal(true), remaining: Schema.Number }),
    Schema.Struct({ refused: Schema.Literal(false), mailId: Schema.String }),
  ]),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_devnet_mail_faults],
  writes: [table_devnet_mail_faults, table_devnet_mail],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_outboxes_list = defineRpc({
  id: "operator.outboxes.list",
  title: "The devnet mail sink, newest first",
  about:
    "The internal query `operator/outboxes:list` (`capxul dev mail list`). The 200 newest sink messages since a time, " +
    "to one address (lowercased) or to any; the template filter is applied after the 200 are taken, so a filtered list " +
    "can miss older matches. A sign-in code email's code is shown as `<code>`. No environment gate: it reads an empty " +
    "table on any deployment but a devnet.",
  was: [`${CONVEX}:7`, `${OPS}/list.ts:11`, `${OPS}/list.ts:25`, `${OB}/reads.ts:11`, `${OB}/views.ts:8`, `${OB}/views.ts:11`],
  concept: concept_operator,
  kind: "query",
  who: "internal: the devnet guardian with `convex run` (`capxul dev mail list`).",
  input: Schema.Struct({
    to: Schema.optionalKey(Schema.String),
    template: Schema.optionalKey(Schema.String),
    sinceMs: Schema.optionalKey(Schema.Number),
  }),
  output: Schema.Array(
    Schema.Struct({
      mailId: Schema.String,
      to: Schema.String,
      from: Schema.String,
      subject: Schema.String,
      template: Schema.String,
      text: Schema.String,
      sentAtMs: Schema.Number,
      links: Schema.Array(Schema.String),
    }),
  ),
  errors: [error_UNKNOWN],
  reads: [table_devnet_mail],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});

export const rpc_operator_outboxes_fail = defineRpc({
  id: "operator.outboxes.fail",
  title: "Arm, clear or list the devnet mail fail switch",
  about:
    "The internal mutation `operator/outboxes:fail` (`capxul dev mail fail`). Local devnet only, before anything is " +
    "read. `list` alone reads the armed faults; `clear` alone deletes every fault and answers how many; otherwise " +
    "`next` (a whole number 1..100) arms the next sink writes to `to` (lowercased) or to any address, replacing that " +
    "address's fault. Any other combination is INVALID_INPUT `next`. Answers the faults still armed.",
  was: [`${CONVEX}:6`, `${OPS}/fail.ts:20`, `${OPS}/fail.ts:29`, `${OPS}/fail.ts:43`, `${OB}/rules.ts:15`, `${OB}/errors.ts:6`, `${OB}/writes.ts:14`, `${OB}/writes.ts:25`, ...LOCAL_WAS],
  concept: concept_operator,
  kind: "mutation",
  who: "internal: the devnet guardian with `convex run` (`capxul dev mail fail`).",
  input: Schema.Struct({
    next: Schema.optionalKey(Schema.Number),
    to: Schema.optionalKey(Schema.String),
    clear: Schema.optionalKey(Schema.Boolean),
    list: Schema.optionalKey(Schema.Boolean),
  }),
  output: Schema.Struct({ cleared: Schema.Number, faults: Faults }),
  errors: [error_INVALID_INPUT, error_UNKNOWN],
  reads: [table_devnet_mail_faults],
  writes: [table_devnet_mail_faults],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
});
