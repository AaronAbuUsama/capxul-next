// Where every responsibility of the old system lands: each area folder of the 17 old backend
// concepts (packages/backend/src/<concept>/<area>/ in /home/user/factory at 0d2be303e, and each
// concept's root files as `<concept>/(root)`), the target concepts it lands in, and the decision
// record that put it there. An empty `to` means the responsibility is dropped, or leaves the
// concepts for an integration or the runtime; its decision says which. Not a record: the build
// follows the decisions' `affects`. Decision `responsibilities.landings`.

import type { Concept, Decision } from "../../../packages/book/src/index.ts";
import * as f from "./foundation.ts";
import * as d from "./decisions.ts";

/** One old area: where it goes, and the decision that says so. */
export interface Landing {
  readonly to: readonly Concept[];
  readonly by: Decision;
  readonly note: string;
}

/** The old concepts' area folders, as `ls packages/backend/src/<concept>/` shows them (kind folders such as reads/ excluded). */
export type OldArea =
  | "access/agents" | "access/clients" | "access/features" | "access/referrals" | "access/sessions" | "access/waitlist"
  | "accounts/agents" | "accounts/approvals" | "accounts/balances" | "accounts/claims" | "accounts/grants" | "accounts/lanes"
  | "accounts/safes" | "accounts/summaries"
  | "activity/annotations" | "activity/documents" | "activity/items" | "activity/overlays"
  | "applications/bootstraps" | "applications/keys" | "applications/quickstarts" | "applications/registrations"
  | "applications/repairs"
  | "banking/bank-details" | "banking/deposits" | "banking/payouts" | "banking/reconcile" | "banking/webhooks"
  | "books/accounts" | "books/assets" | "books/exports" | "books/facts" | "books/keepers" | "books/postings" | "books/reports"
  | "documents/(root)" | "documents/memos"
  | "indexing/drifts" | "indexing/movements"
  | "media/images"
  | "operator/clocks" | "operator/diagnostics" | "operator/faucets" | "operator/fixtures" | "operator/identities"
  | "operator/jobs" | "operator/notices" | "operator/outboxes" | "operator/probes" | "operator/receipts"
  | "organizations/directors" | "organizations/equity" | "organizations/invitations" | "organizations/members"
  | "organizations/proposals" | "organizations/roles" | "organizations/rounds" | "organizations/setups"
  | "organizations/treasuries" | "organizations/votes" | "organizations/workspaces"
  | "parties/(root)" | "parties/accounts" | "parties/contacts" | "parties/destinations" | "parties/recipients"
  | "parties/verifications"
  | "payments/commands" | "payments/executions" | "payments/lifecycles" | "payments/movements" | "payments/notices"
  | "payments/records" | "payments/schedules" | "payments/verifications"
  | "payroll/agreements" | "payroll/departments" | "payroll/groups" | "payroll/runs" | "payroll/terms"
  | "permissions/allowances" | "permissions/authorities" | "permissions/commands" | "permissions/configurations"
  | "permissions/grants" | "permissions/replacements" | "permissions/verifications"
  | "profiles/details" | "profiles/onboardings"
  | "requests/checkouts" | "requests/inboxes" | "requests/offers" | "requests/receivables";

const c = f;

export const OLD_AREAS: { readonly [A in OldArea]: Landing } = {
  // access
  "access/agents": { to: [c.concept_access], by: d.decision_concepts_access, note: "OAuth for MCP clients and its OIDC routes." },
  "access/clients": { to: [c.concept_access], by: d.decision_concepts_access, note: "The CLI's native client grants (device flow); the daily sweep cron stays (P3)." },
  "access/features": { to: [c.concept_access], by: d.decision_concepts_access, note: "Feature gates and the PostHog flag sync; the devnet's gate writes are devnet's." },
  "access/referrals": { to: [c.concept_accounts], by: d.decision_concepts_accounts, note: "Referral codes, invites and earned invites, counted from CapxulSafeClaimed." },
  "access/sessions": { to: [c.concept_access, c.concept_accounts], by: d.decision_operations_sign_in, note: "Sessions, codes and the cooldown stay access'; the `auth login` and `auth verify` flows are accounts'." },
  "access/waitlist": { to: [c.concept_accounts], by: d.decision_procedures_accounts_admit, note: "Admission and the beta gate, checked only above accounts." },
  // accounts
  "accounts/agents": { to: [c.concept_agents], by: d.decision_concepts_agents, note: "Agents become their own concept above the Board." },
  "accounts/approvals": { to: [c.concept_approvals], by: d.decision_concepts_approvals, note: "Every approval and its one send." },
  "accounts/balances": { to: [c.concept_activity], by: d.decision_concepts_activity, note: "Balances for whoever you act as." },
  "accounts/claims": { to: [c.concept_accounts], by: d.decision_concepts_accounts, note: "The personal Safe's claim, one durable process per setup." },
  "accounts/grants": { to: [c.concept_accounts], by: d.decision_concepts_devnet, note: "Faucet and welcome grants, with old operator's faucet." },
  "accounts/lanes": { to: [], by: d.decision_responsibilities_service_lanes, note: "One send in flight per key moves into the service-signer integration." },
  "accounts/safes": { to: [c.concept_accounts], by: d.decision_concepts_accounts, note: "The personal Safe, its address a pure function of the email." },
  "accounts/summaries": { to: [c.concept_activity], by: d.decision_responsibilities_summaries, note: "Deposit instructions become `address`; home and me need a named surface." },
  // activity
  "activity/annotations": { to: [c.concept_books], by: d.decision_concepts_books, note: "An account given to a row is a book fact." },
  "activity/documents": { to: [c.concept_activity], by: d.decision_concepts_activity, note: "Activity reads a row's documents from documents." },
  "activity/items": { to: [c.concept_activity], by: d.decision_concepts_activity, note: "The feed, its summary and its change cursor." },
  "activity/overlays": { to: [], by: d.decision_responsibilities_overlays, note: "Dropped: one Postgres needs no overlay." },
  // applications
  "applications/bootstraps": { to: [c.concept_applications], by: d.decision_concepts_applications, note: "The bootstrap envelope." },
  "applications/keys": { to: [c.concept_applications], by: d.decision_concepts_applications, note: "Publishable keys and origins." },
  "applications/quickstarts": { to: [c.concept_applications], by: d.decision_concepts_applications, note: "`dev key` test keys." },
  "applications/registrations": { to: [c.concept_applications], by: d.decision_concepts_applications, note: "Registered applications, a person's or an Organization's." },
  "applications/repairs": { to: [], by: d.decision_responsibilities_repairs, note: "Dropped: operator repairs." },
  // banking
  "banking/bank-details": { to: [c.concept_banking], by: d.decision_concepts_banking, note: "Receiving accounts per Party and currency." },
  "banking/deposits": { to: [c.concept_banking], by: d.decision_concepts_banking, note: "Bank deposits and their book facts; the match to a request is requests'." },
  "banking/payouts": { to: [c.concept_banking], by: d.decision_dependencies_payments_banking, note: "One durable process per payout, its Payment through payments.prepare-command." },
  "banking/reconcile": { to: [c.concept_banking], by: d.decision_concepts_banking, note: "The Bridge catch-up cron (P3 keeps it)." },
  "banking/webhooks": { to: [c.concept_banking], by: d.decision_concepts_banking, note: "The signed webhook inbox." },
  // books
  "books/accounts": { to: [c.concept_books], by: d.decision_concepts_books, note: "The chart of accounts." },
  "books/assets": { to: [c.concept_books], by: d.decision_concepts_books_token_scan, note: "Tracked assets, and the scan of added tokens." },
  "books/exports": { to: [c.concept_books], by: d.decision_concepts_books, note: "The QuickBooks export: two files written by the SDK." },
  "books/facts": { to: [c.concept_books], by: d.decision_dependencies_books, note: "Book facts, written by payments and banking through books' procedures." },
  "books/keepers": { to: [c.concept_books], by: d.decision_responsibilities_keepers, note: "Manage books is the Books hat; books reads its wearers." },
  "books/postings": { to: [c.concept_books], by: d.decision_concepts_books, note: "The posting rules behind the reports." },
  "books/reports": { to: [c.concept_books], by: d.decision_concepts_books, note: "Reports and the reconcile against the chain." },
  // documents
  "documents/(root)": { to: [c.concept_documents], by: d.decision_concepts_documents, note: "The content store and its links, with participants given at store time." },
  "documents/memos": { to: [c.concept_documents], by: d.decision_concepts_documents, note: "Memos Movements carry." },
  // indexing
  "indexing/drifts": { to: [], by: d.decision_concepts_indexing, note: "Dropped: nothing copies chain rows, so nothing drifts." },
  "indexing/movements": { to: [c.concept_indexing, c.concept_payments, c.concept_books], by: d.decision_concepts_books_token_scan, note: "Ponder indexes admitted assets; payments attributes Movements; books scans added tokens." },
  // media
  "media/images": { to: [c.concept_media], by: d.decision_concepts_media, note: "Stored files, now pointed at by their owners." },
  // operator
  "operator/clocks": { to: [c.concept_devnet], by: d.decision_concepts_devnet, note: "`dev time`, through the supervisor." },
  "operator/diagnostics": { to: [c.concept_applications], by: d.decision_concepts_devnet, note: "The deployment's health (`doctor --online`)." },
  "operator/faucets": { to: [c.concept_accounts], by: d.decision_concepts_devnet, note: "The faucet is a test-network grant (`dev fund`)." },
  "operator/fixtures": { to: [], by: d.decision_responsibilities_operator_proof_tools, note: "Dropped: worlds are built by running operations." },
  "operator/identities": { to: [], by: d.decision_responsibilities_operator_proof_tools, note: "Dropped: codes come from the mail sink, identities from worlds." },
  "operator/jobs": { to: [c.concept_devnet], by: d.decision_concepts_devnet, note: "`dev jobs run`: run due timers now." },
  "operator/notices": { to: [c.concept_notices], by: d.decision_concepts_notices, note: "Notice delivery records; devnet's `dev mail notices` reads them." },
  "operator/outboxes": { to: [c.concept_devnet], by: d.decision_concepts_devnet, note: "The devnet mail sink and its fail switch." },
  "operator/probes": { to: [], by: d.decision_concepts_devnet, note: "Dropped: the generated tenancy evals test tenancy (P8)." },
  "operator/receipts": { to: [], by: d.decision_responsibilities_operator_proof_tools, note: "Dropped: the bundler fake's fault switch holds a receipt." },
  // organizations
  "organizations/directors": { to: [c.concept_board], by: d.decision_concepts_board, note: "Directors and the threshold." },
  "organizations/equity": { to: [c.concept_equity], by: d.decision_concepts_equity, note: "Cap table, options, exits." },
  "organizations/invitations": { to: [c.concept_organizations, c.concept_budgets], by: d.decision_operations_member_invite, note: "Invitations stay; the one proposal of their grants, and their return, is budgets'." },
  "organizations/members": { to: [c.concept_organizations], by: d.decision_concepts_organizations, note: "Seats, human or agent." },
  "organizations/proposals": { to: [c.concept_board], by: d.decision_concepts_board, note: "Board proposals, one durable process each." },
  "organizations/roles": { to: [], by: d.decision_responsibilities_roles, note: "Dropped: pre-v4 invitable roles." },
  "organizations/rounds": { to: [c.concept_equity], by: d.decision_concepts_equity, note: "Rounds and SAFEs." },
  "organizations/setups": { to: [c.concept_organizations], by: d.decision_concepts_organizations, note: "Setup and install, one durable process each." },
  "organizations/treasuries": { to: [c.concept_activity], by: d.decision_concepts_activity, note: "The treasury read is a balance of whoever you act as." },
  "organizations/votes": { to: [c.concept_equity], by: d.decision_concepts_equity, note: "Shareholder votes on the Governor." },
  "organizations/workspaces": { to: [c.concept_organizations], by: d.decision_concepts_organizations, note: "`org list` and `org me`." },
  // parties
  "parties/(root)": { to: [c.concept_parties], by: d.decision_concepts_parties, note: "The directory: Party, handle, Safe and owner." },
  "parties/accounts": { to: [c.concept_banking], by: d.decision_concepts_banking, note: "Saved bank accounts." },
  "parties/contacts": { to: [c.concept_contacts], by: d.decision_concepts_contacts, note: "The address book, above organizations." },
  "parties/destinations": { to: [c.concept_parties], by: d.decision_responsibilities_destinations, note: "Receiving destinations stay; the Solana cleanup goes." },
  "parties/recipients": { to: [c.concept_parties], by: d.decision_concepts_parties, note: "Recipient resolution." },
  "parties/verifications": { to: [c.concept_banking], by: d.decision_concepts_banking, note: "Bridge KYC and KYB." },
  // payments
  "payments/commands": { to: [c.concept_payments], by: d.decision_concepts_payments, note: "One request key, one command." },
  "payments/executions": { to: [c.concept_approvals], by: d.decision_concepts_approvals, note: "The sponsored operation, its one send and its chain proof." },
  "payments/lifecycles": { to: [c.concept_payments], by: d.decision_concepts_payments, note: "Cancel, reschedule and retry." },
  "payments/movements": { to: [c.concept_payments], by: d.decision_concepts_payments, note: "Movements from indexed Transfers." },
  "payments/notices": { to: [c.concept_notices], by: d.decision_concepts_notices, note: "Payment notices, from payment_transitioned." },
  "payments/records": { to: [c.concept_payments], by: d.decision_concepts_payments, note: "The Payment ledger's reads." },
  "payments/schedules": { to: [c.concept_payments], by: d.decision_concepts_payments, note: "Dated payments, one durable process each." },
  "payments/verifications": { to: [c.concept_payments], by: d.decision_concepts_payments, note: "Settlement from the indexed PaymentSent, one path." },
  // payroll
  "payroll/agreements": { to: [c.concept_payroll], by: d.decision_concepts_payroll, note: "v4 Agreements, one durable process each." },
  "payroll/departments": { to: [c.concept_budgets], by: d.decision_concepts_budgets, note: "Departments are budgets." },
  "payroll/groups": { to: [], by: d.decision_concepts_payroll, note: "Dropped: no frozen operation (P2)." },
  "payroll/runs": { to: [], by: d.decision_concepts_payroll, note: "Dropped: no frozen operation (P2)." },
  "payroll/terms": { to: [], by: d.decision_concepts_payroll, note: "Dropped with runs; agreements carry their terms." },
  // permissions
  "permissions/allowances": { to: [c.concept_budgets], by: d.decision_concepts_budgets, note: "A spending allowance is a budget under a hat." },
  "permissions/authorities": { to: [c.concept_budgets], by: d.decision_concepts_permissions, note: "Who may spend and what is left, read from the chain." },
  "permissions/commands": { to: [], by: d.decision_concepts_permissions, note: "Dropped: pre-v4 Zodiac Roles commands (P9)." },
  "permissions/configurations": { to: [c.concept_budgets], by: d.decision_operations_member_invite, note: "An invitation's grant configuration is budgets' proposal of its grants." },
  "permissions/grants": { to: [c.concept_board], by: d.decision_concepts_permissions, note: "Grants by Board proposal; the granter key goes." },
  "permissions/replacements": { to: [c.concept_budgets], by: d.decision_concepts_budgets, note: "`org allowance replace`, answered by budgets." },
  "permissions/verifications": { to: [c.concept_indexing], by: d.decision_concepts_permissions, note: "Indexing's views are the chain record." },
  // profiles
  "profiles/details": { to: [c.concept_parties], by: d.decision_concepts_parties, note: "A person's profile is their Party's." },
  "profiles/onboardings": { to: [c.concept_parties], by: d.decision_procedures_accounts_admit, note: "Onboarding stays with the profile; its beta hold moves to the Safe's setup." },
  // requests
  "requests/checkouts": { to: [c.concept_requests], by: d.decision_concepts_requests, note: "Link checkout into an invoice escrow." },
  "requests/inboxes": { to: [c.concept_requests], by: d.decision_concepts_requests, note: "The payer's inbox." },
  "requests/offers": { to: [c.concept_requests], by: d.decision_concepts_requests, note: "Fixed-price services with revisions." },
  "requests/receivables": { to: [c.concept_requests], by: d.decision_concepts_requests, note: "Requests and invoices." },
};

/** The target concepts each old concept's areas land in, derived from OLD_AREAS. */
export const ABSORBS: { readonly [target: string]: readonly string[] } = (() => {
  const out: Record<string, Set<string>> = {};
  for (const [area, landing] of Object.entries(OLD_AREAS) as [OldArea, Landing][])
    for (const t of landing.to) (out[t.id] ??= new Set()).add(area.slice(0, area.indexOf("/")));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
})();
