// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/issuing.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_requests } from "../shared/foundation.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { integration_indexer } from "../shared/external.ts";
import { machine_request, table_requests } from "./data.ts";
import { Org, PageInput, RequestPage, RequestView } from "./shapes.ts";
import { GUARD_WAS, READER, WRITER } from "./guards.ts";
import { procedure_documents_store } from "../documents/procedures.ts";
import { table_payments } from "../payments/data.ts";
import { procedure_parties_resolve_recipient } from "../parties/procedures.ts";
import { procedure_projects_bill_time } from "../projects/procedures.ts";
import { table_activity_types, table_projects, table_timesheet_logs, table_timesheets } from "../projects/data.ts";

export const rpc_requests_issuing_bill_time = defineRpc({
  id: "requests.issuing.bill-time",
  title: "Issue one Invoice for timesheets' unbilled hours and mark them billed",
  about:
    "ERPNext's 'Make Sales Invoice' from timesheets (requests.bill-time). The guard: a member whose Safe wears the " +
    "Organization's Invoicing hat. Each timesheet named must be the Organization's (INVALID_INPUT) and submitted or " +
    "partly billed (WRONG_STATE for a draft, a cancelled or a wholly billed one); the logs it bills are their billable " +
    "logs that name no sales invoice yet (none at all is WRONG_STATE). The payer is `--to` (an email, @handle or Party " +
    "id), else the one customer Party the timesheets' projects name (none, a customer that is only a name, or several " +
    "is INVALID_INPUT naming `--to`). The timesheets share one currency, which names the admitted token the Invoice " +
    "asks in (USD is USDC, EUR is EURC; another currency, or two, is INVALID_INPUT): no rate is converted. The Invoice " +
    "has one line per activity and billing rate, its quantity the billing hours and its unit amount the rate, in the " +
    "token's raw units; the amount is their sum; the reference names the projects (1 to 120 characters). The request " +
    "key makes it idempotent, as `request issue`. In one transaction: the payer's Party (`parties.resolve-recipient`, " +
    "provisional for a new mailbox, as a request's payer is named), the document (`documents.store`), the request born " +
    "through `issue` as `requests.issuing.issue` births an Invoice (an outside payer's invoice escrow included) with " +
    "its `billed_logs`, and the marks: `projects.bill-time` with `bill` for exactly those logs and the payer's Party, " +
    "whose WRONG_STATE (a log another invoice took first) or INVALID_INPUT (another customer's log) rolls the whole " +
    "write back. Nothing is written on chain and no mail is sent here: notices follow `request_transitioned`.",
  was: [
    "/tmp/erpnext/erpnext/projects/doctype/timesheet/timesheet.py (make_sales_invoice)",
    "/tmp/erpnext/erpnext/accounts/doctype/sales_invoice/services/timesheet_billing.py:19",
    ...GUARD_WAS,
  ],
  concept: concept_requests,
  kind: "mutation",
  who: "A member of the Organization whose Safe wears its Invoicing hat.",
  input: Schema.Struct({
    org: S,
    request_key: S,
    /** `<timesheet>…`: one to fifty timesheet ids (`ts_…`), as `org projects timesheet list` prints them. */
    timesheets: Schema.Array(S),
    /** `--to <payer>`: an email, an `@handle` or a Party id; absent, the projects' one customer. */
    to: opt(S),
  }),
  output: Schema.Struct({
    scope: Schema.Literal("organization"),
    direction: Schema.Literal("issued"),
    item: RequestView,
  }),
  errors: [error_NOT_AUTHENTICATED, error_INVALID_INPUT, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE],
  reads: [table_requests, ...WRITER, table_timesheets, table_timesheet_logs, table_activity_types, table_projects],
  writes: [table_requests],
  drives: [machine_request.t.issue],
  invokes: [procedure_parties_resolve_recipient, procedure_documents_store, procedure_projects_bill_time],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("write"),
});
