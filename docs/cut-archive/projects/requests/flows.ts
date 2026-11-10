// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/flows.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineFlow } from "../../../packages/book/src/index.ts";
import { component_core_sdk } from "../shared/foundation.ts";
import { error_CANCELLED, error_PROVIDER_RESPONSE_INVALID, error_WRONG_STATE } from "../shared/vocabulary.ts";
import { integration_openfort } from "../shared/external.ts";
import { rpc_approvals_signing_get, rpc_approvals_signing_sign } from "../approvals/signing.ts";
import { rpc_requests_checkout_get, rpc_requests_checkout_open } from "./checkout.ts";
import { rpc_requests_deposits_candidates, rpc_requests_deposits_match } from "./deposits.ts";
import { rpc_requests_inbox_decline, rpc_requests_inbox_get, rpc_requests_inbox_pay } from "./inbox.ts";
import {
  rpc_requests_issuing_bill_time,
  rpc_requests_issuing_cancel,
  rpc_requests_issuing_get,
  rpc_requests_issuing_issue,
  rpc_requests_issuing_list,
} from "./issuing.ts";
import {
  rpc_requests_services_create,
  rpc_requests_services_deactivate,
  rpc_requests_services_get,
  rpc_requests_services_revise,
} from "./services.ts";
import { RequestView, ServiceTerms, ServiceView } from "./shapes.ts";

export const flow_client_org_projects_timesheets_bill = defineFlow({
  id: "client.org.projects.timesheets.bill",
  title: "Bill timesheets' unbilled hours as one Invoice, recovering an uncertain reply",
  about:
    "`org projects timesheet bill <timesheet>… [--to <payer>]` (requests.bill-time): one request key for the call (`--request-key`, " +
    "else one the flow makes), then `requests.issuing.bill-time`, which issues the Invoice and marks the logs it bills in " +
    "one write. When the reply is lost after sending, it reads the issued list in the same session and returns the " +
    "request that carries its key instead of billing again; none found is the original error. It asks nothing: the " +
    "hours were submitted, and `request cancel` clears the marks.",
  was: ["docs/design/new-commands.md (section 6)", "books/target/requests/flows.ts (client.account.requests.issue, the pattern)"],
  component: component_core_sdk,
  sdk: "client.org(orgId).projects.timesheets.bill",
  input: Schema.Struct({ org: S, timesheets: Schema.Array(S), to: opt(S), request_key: opt(S) }),
  output: rpc_requests_issuing_bill_time.output,
  steps: [
    { name: "key", local: "cache", about: "The request key for this call, kept through an uncertain reply." },
    { name: "bill", rpc: rpc_requests_issuing_bill_time, about: "Issues the Invoice and marks the hours under the key." },
    { name: "recover", rpc: rpc_requests_issuing_list, about: "Only after an uncertain reply: the issued list, newest first, for the request with the key." },
  ],
  errors: [],
  calls: [],
  spans: [],
  budget: budget("write"),
});
