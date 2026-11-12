// Slice zero's source-equal screens and observable money-path faults. The checks live in packages/evals.
import { defineAlert, defineDecision, defineDoctype, defineInsight, defineScreen } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { log_operation_row, log_process_row } from "../shared/signals.ts";
import { contract_erc20 } from "../shared/external.ts";
import { doctype_account } from "../plugs/doctypes.ts";
import { role_admin, role_budget_holder } from "../plugs/hats.ts";
import { feature_accounts } from "./features.ts";
import { screen_general_ledger, screen_payment_entry } from "./screens.ts";

export const doctype_purchase_invoice = defineDoctype({
  id: "purchase-invoice", title: "Purchase Invoice", name: "Purchase Invoice", app: "erpnext", concept: concept_sites,
  about: "ERPNext owns the supplier invoice and its outstanding amount; Core does not keep a second invoice ledger.",
  fields: [],
});

export const screen_supplier_invoice = defineScreen({
  id: "supplier-invoice", title: "Supplier invoice form", surface: "frappe-desk", kind: "form",
  about: "The slice zero supplier invoice, its company, supplier, currency, total and outstanding amount after payment.",
  record: doctype_purchase_invoice,
  shows: [{ label: "Invoice identity, company, supplier, currency, total and outstanding amount", from: doctype_purchase_invoice }],
  who: [role_admin, role_budget_holder], feature: feature_accounts,
});

export const screen_safe_trial_balance = defineScreen({
  id: "safe-trial-balance", title: "Safe account Trial Balance", surface: "frappe-desk", kind: "report",
  about: "The remaining Safe balance after founder funding and supplier payment, reconciled at one chain cutoff.",
  record: doctype_account,
  shows: [
    { label: "Safe account and closing debit/credit", from: doctype_account },
    { label: "Same-cutoff USDC balance", from: contract_erc20.f.balanceOf },
  ],
  who: [role_admin, role_budget_holder], feature: feature_accounts,
});

export const insight_slice_zero_health = defineInsight({
  id: "slice_zero_health", title: "Slice zero money-path diagnostics",
  about: "Core's authenticated operator diagnostics name the world and company, observation time, Ponder readiness and indexed head, due delivery age, and parked money event keys and reasons. Missing or stale diagnostics are not a healthy observation.",
  reads: [log_operation_row, log_process_row],
  query: "Read operation_row and process_row for the world's index readiness, oldest due unacknowledged delivery and parked money events, exposed by Core /admin/alerts with observedAt and stable alert ids.",
  display: "table", env: ["shared-world", "staging", "slice-zero-test"],
  answer: "On a healthy loaded world: indexer_unready, delivery_stuck and money_event_parked are all inactive.",
});

export const alert_indexer_unready = defineAlert({
  id: "indexer_unready", title: "The payment index is unavailable or stale", insight: insight_slice_zero_health,
  about: "A stopped or lagging Ponder must not look like a settled, quiet world.",
  condition: "Ponder is not ready, the chain or indexed head is unavailable or inconsistent, or its indexed observation is over 60 seconds old while the chain advances",
  cadence: "5s", severity: "page", route: ["operator"],
  runbook: "Restore Ponder and its database/RPC connection; wait for readiness and catch-up before accepting settlement.",
});

export const alert_delivery_stuck = defineAlert({
  id: "delivery_stuck", title: "A due site event is not acknowledged", insight: insight_slice_zero_health,
  about: "Ordinary brief retries are quiet; an outage must become visible before money can be called reconciled.",
  condition: "the oldest due unacknowledged site event is over 300 seconds old",
  cadence: "5s", severity: "page", route: ["operator"],
  runbook: "Restore the site's delivery endpoint, retry in order and require an explicit applied or duplicate acknowledgement.",
});

export const alert_money_event_parked = defineAlert({
  id: "money_event_parked", title: "A money event needs reconciliation", insight: insight_slice_zero_health,
  about: "A poisoned payment or funding fact remains visible by event key and reason, including a fact represented by an unmatched bank line.",
  condition: "at least one money event is parked or unmatched with an unresolved application error",
  cadence: "5s", severity: "page", route: ["operator"],
  runbook: "Inspect the event key and error, repair the invoice or mapping, then retry and reconcile without a second posting.",
});

export const decision_sites_slice_zero_acceptance = defineDecision({
  id: "sites.slice-zero-acceptance", title: "Slice zero keeps screen and fault evidence in its required run",
  question: "How do supplier payment acceptance checks distinguish healthy operation from missing instrumentation?",
  options: [
    { label: "source-equal-and-faulted", text: "Check actual Frappe invoice, payment and ledger screens against same-cutoff source values; retain screenshots and DOM assertions. Observe all three money-path alerts under load, seed one real fault at a time, observe one stable operator-visible alert, repair and check that all alerts clear. Store the observations in the eval run." },
    { label: "api-only", text: "Accept API readback and a quiet alert list without testing the screens or faults." },
  ],
  chosen: "source-equal-and-faulted",
  why: "Aaron's operation-done ruling requires tests, quiet alerts and seeded faults. An empty or stale diagnostic response is not evidence of quietness. A selected-stack run requires Postgres/Ponder/ERPNext/v4 provenance; skeleton results remain explicitly partial. Faults are restricted to disposable local test worlds and every seed has a repair in finally. The operator diagnostics API is the local test alert surface, not proof of hosted paging or notification transport.",
  source: "aaron.operation-done; Aaron's wave 0 slice 0 acceptance brief, 12 November 2026",
  affects: [screen_supplier_invoice, screen_payment_entry, screen_general_ledger, screen_safe_trial_balance, insight_slice_zero_health, alert_indexer_unready, alert_delivery_stuck, alert_money_event_parked],
});
