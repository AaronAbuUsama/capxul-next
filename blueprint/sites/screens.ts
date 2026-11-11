// The Frappe screens where a person sees the thin line's data: the payment from draft to sent, its request to the chain,
// the ledger it posted, the hats granted and the chain events applied. Each value names where it comes from, so an eval
// opens the screen as a permitted role and checks it against that source, keeping a screenshot. The judgment is the
// decision at the end of this file.
//
// ERPNext's own fields (a Payment Entry's paid amount, a GL Entry's debit) are shown without `field`: the DocType records
// list only the Custom Fields Capxul adds, so a standard field cannot be checked by name yet.

import { defineDecision, defineScreen } from "../../packages/blueprint-engine/src/index.ts";
import { contract_payments } from "../shared/external.ts";
import {
  doctype_capxul_chain_event,
  doctype_capxul_hat_grant,
  doctype_capxul_payment_request,
  doctype_gl_entry,
  doctype_payment_entry,
} from "../plugs/doctypes.ts";
import { role_admin, role_budget_holder } from "../plugs/hats.ts";
import { operation_payment_send } from "../payments/operations.ts";
import { feature_accounts } from "./features.ts";
import { operation_doc_create, operation_doc_submit, operation_report_run } from "./operations.ts";

export const screen_payment_entry = defineScreen({
  id: "payment-entry",
  title: "Payment Entry form",
  about: "A payment from the Safe: drafted, submitted and held for the signer, then sent and posted once the chain confirms it.",
  surface: "frappe-desk",
  kind: "form",
  record: doctype_payment_entry,
  shows: [
    { label: "Paid amount and party", from: doctype_payment_entry },
    { label: "Capxul status", from: doctype_payment_entry, field: "capxul_status" },
    { label: "Approval link for the signer", from: doctype_payment_entry, field: "capxul_approval_url" },
    { label: "Transaction hash", from: doctype_capxul_payment_request, field: "tx_hash" },
    { label: "The payment on chain", from: contract_payments.e.PaymentSent },
  ],
  actions: [
    { name: "save", runs: operation_doc_create },
    { name: "submit", runs: operation_doc_submit },
    { name: "sign", runs: operation_payment_send },
  ],
  who: [role_admin, role_budget_holder],
  states: [
    { state: "Draft", shows: "The entry as typed; nothing posted.", allows: ["save", "submit"] },
    { state: "Waiting for signature", shows: "Held: the signer and the approval link; still a draft, nothing posted.", allows: ["sign"] },
    { state: "Sent", shows: "Submitted, with the transaction hash; the ledger posted once.", allows: [] },
    { state: "Failed", shows: "Still a draft, with why the chain refused it.", allows: ["submit"] },
  ],
  feature: feature_accounts,
});

export const screen_payment_requests = defineScreen({
  id: "payment-requests",
  title: "Capxul Payment Request list",
  about: "Every payment the site asked the chain to make: its status, transaction and why one failed.",
  surface: "frappe-desk",
  kind: "list",
  record: doctype_capxul_payment_request,
  shows: [
    { label: "Payment Entry", from: doctype_capxul_payment_request, field: "payment_entry" },
    { label: "Status", from: doctype_capxul_payment_request, field: "status" },
    { label: "Transaction hash", from: doctype_capxul_payment_request, field: "tx_hash" },
    { label: "Why it failed", from: doctype_capxul_payment_request, field: "reason" },
  ],
  who: [role_admin, role_budget_holder],
  feature: feature_accounts,
});

export const screen_general_ledger = defineScreen({
  id: "general-ledger",
  title: "General Ledger report",
  about: "The ledger lines the payment posted, each stamped with the trace that posted it, set against the Safe's balance on chain.",
  surface: "frappe-desk",
  kind: "report",
  record: doctype_gl_entry,
  shows: [
    { label: "Debit, credit and account", from: doctype_gl_entry },
    { label: "Trace that posted it", from: doctype_gl_entry, field: "capxul_trace" },
  ],
  actions: [{ name: "run", runs: operation_report_run }],
  who: [role_admin, role_budget_holder],
  feature: feature_accounts,
});

export const screen_hat_grants = defineScreen({
  id: "hat-grants",
  title: "Capxul Hat Grant list",
  about: "Who wears which hat in which department, and the Frappe roles each grant gave.",
  surface: "frappe-desk",
  kind: "list",
  record: doctype_capxul_hat_grant,
  shows: [
    { label: "User", from: doctype_capxul_hat_grant, field: "user" },
    { label: "Hat", from: doctype_capxul_hat_grant, field: "hat" },
    { label: "Department", from: doctype_capxul_hat_grant, field: "department" },
    { label: "Roles given", from: doctype_capxul_hat_grant, field: "roles_given" },
  ],
  who: [role_admin],
});

export const screen_chain_events = defineScreen({
  id: "chain-events",
  title: "Capxul Chain Event list",
  about: "Every chain event Core sent the site: applied, failed and retried, or parked, with the error.",
  surface: "frappe-desk",
  kind: "list",
  record: doctype_capxul_chain_event,
  shows: [
    { label: "Event key", from: doctype_capxul_chain_event, field: "event_key" },
    { label: "Kind", from: doctype_capxul_chain_event, field: "kind" },
    { label: "Status", from: doctype_capxul_chain_event, field: "status" },
    { label: "Attempts", from: doctype_capxul_chain_event, field: "attempts" },
    { label: "Error", from: doctype_capxul_chain_event, field: "error" },
  ],
  who: [role_admin],
});

export const decision_sites_thin_line_screens = defineDecision({
  id: "sites.thin-line-screens",
  title: "The thin line is seen on five Frappe screens",
  question: "Where does a person see that the thin line's steps happened, so a passing run comes with pictures?",
  options: [
    { label: "five-screens", text: "The Payment Entry form, the Payment Request list, the General Ledger, the Hat Grant list and the Chain Event list." },
    { label: "api-only", text: "Check the data through the door only." },
  ],
  chosen: "five-screens",
  why:
    "Aaron, 18:49 UTC: screens are in, because otherwise nobody can see the data; the evidence should be the actual " +
    "Frappe screens. These five cover every value the thin line changes on a site: the payment's states, its request to " +
    "the chain, the ledger it posted, the hats a grant gave and the chain events applied. The Director (admin hat) sees all " +
    "five; the budget holder sees the payment, its requests and the ledger, which is what they make and pay.",
  source: "Aaron, 18:49 UTC 11 November 2026",
  affects: [screen_payment_entry, screen_payment_requests, screen_general_ledger, screen_hat_grants, screen_chain_events],
});
