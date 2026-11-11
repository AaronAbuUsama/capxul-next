// Moved out of the built book by the cut, 10 November 2026, from books/target/requests/operations.ts. The records are intact;
// the imports below are as the file had them, so they point at the folder the file was written in (as docs/as-is/archive does).
// What each record became is in docs/cut-archive/INDEX.md.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_INSUFFICIENT_BALANCE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PAYROLL_BUDGET_EXCEEDED,
  error_ROLE_PERMISSION_DENIED,
  error_TOKEN_NOT_SUPPORTED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_account_inbox_decline,
  flow_client_account_inbox_get,
  flow_client_account_inbox_pay,
  flow_client_account_requests_cancel,
  flow_client_account_requests_get,
  flow_client_account_requests_issue,
  flow_client_account_services_create,
  flow_client_account_services_deactivate,
  flow_client_account_services_revise,
  flow_client_banking_deposits_match,
  flow_client_org_projects_timesheets_bill,
} from "./flows.ts";
import { rpc_requests_inbox_list } from "./inbox.ts";
import { rpc_requests_issuing_bill_time, rpc_requests_issuing_list } from "./issuing.ts";
import { rpc_requests_services_get, rpc_requests_services_list } from "./services.ts";
import { RequestPage, RequestView, ServicePage, ServiceView } from "./shapes.ts";

export const operation_org_projects_timesheet_bill = defineOperation({
  id: "org.projects.timesheet.bill",
  title: "Bill timesheets' unbilled hours as one Invoice",
  about:
    "Issues one Invoice from the Organization for the billable hours its submitted timesheets log and no invoice has " +
    "billed yet, to the projects' customer or the payer `--to` names, with one line per activity and billing rate (the " +
    "hours at the rate), in the token of the timesheets' currency. The same write marks those hours billed, so no " +
    "second invoice, Capxul's or a connected head's, can ask for them; cancelling or declining the Invoice clears the " +
    "marks, and paying it keeps them. It is then a request like any other: `request get`, `request cancel`, and the " +
    "payer's inbox or invoice escrow.",
  area: "payments",
  command: "org projects timesheet bill",
  priority: "normal",
  implementedBy: flow_client_org_projects_timesheets_bill,
  who: "A member of the Organization whose Safe wears its Invoicing hat.",
  changes:
    "One request (an Invoice) with its document and the logs it bills; each billed log names the request, and each " +
    "timesheet's billed totals and status follow (partly billed, or billed).",
  acceptance: [
    {
      claim:
        "One Invoice asks for the timesheets' unbilled billable hours, one line per activity at its billing rate, and marks those hours billed.",
      observes:
        "cli: from org-with-projects, Dana's `org projects timesheet bill <Sam's submitted Website timesheet> --org acme --json` prints " +
        "an issued Invoice to Olga (Website's customer) with one Execution line of 2 hours at 90, 180.00 in all, in the " +
        "token of Acme's currency; read: " +
        "`org projects timesheet get <it>` prints status billed with totalBilledHours 2, and `request get <the request> --org acme` " +
        "names the same amount; trace: one request_transitioned (issue).",
    },
    {
      claim: "Hours are billed once: billing the same timesheet again finds nothing left to bill.",
      observes:
        "cli: from org-with-projects, `org projects timesheet bill <Dana's timesheet for Sam, already billed> --org acme` exits " +
        "WRONG_STATE naming nothing left to bill; world: no request is added.",
    },
    {
      claim: "Cancelling the Invoice clears the marks, so the hours can be billed again.",
      observes:
        "cli: from org-with-projects, after the claim-1 Invoice, `request cancel <it> --org acme --confirm` then " +
        "`org projects timesheet get <the timesheet>` prints status submitted and totalBilledHours 0, and a second " +
        "`org projects timesheet bill` of it issues a new Invoice for the same 2 hours.",
    },
    {
      claim: "Asking twice under one request key issues one Invoice.",
      observes:
        "cli: from org-with-projects, `org projects timesheet bill <ts> --request-key k1 --org acme --json` run twice prints the same " +
        "request id; world: one request.",
    },
  ],
  returns: rpc_requests_issuing_bill_time.output,
  errors: [error_CLI_USAGE],
  refusals: [
    NOT_SIGNED_IN,
    { error: error_CLI_USAGE, given: W_PROJECTS, when: "No timesheet is named, or an id is not a timesheet's (`ts_…`): nothing is sent." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_PROJECTS,
      when: "Your Safe does not wear the Organization's Invoicing hat (Sam), or `--org` names an Organization you hold no Seat in: nothing is written.",
    },
    {
      error: error_INVALID_INPUT,
      given: W_PROJECTS,
      when:
        "A timesheet is not the Organization's, a log belongs to another customer than the payer, the projects name no " +
        "customer Party and `--to` is not given, or the timesheets' currency has no admitted token: nothing is written.",
    },
    {
      error: error_WRONG_STATE,
      given: W_PROJECTS,
      when: "A timesheet is a draft or cancelled, or nothing billable is left unbilled on it: nothing is written.",
    },
  ],
  budget: budget("write"),
});
