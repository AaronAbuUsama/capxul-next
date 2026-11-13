// The plugs' decisions: every judgment stage 3 made, sourced as the coordinator's on Aaron's delegation (so none reads as his ruling),
// each with the spike evidence it rests on, or marked as an assumption to be tested where nobody has tried it. Rulings they serve:
// aaron.one-door and aaron.frappe-native. Operations they govern are in `affects`, which is how rules.new-operations finds the ruling.

import { defineDecision } from "../../packages/blueprint-engine/src/index.ts";
import * as f from "../shared/foundation.ts";
import { BY, FIND } from "./kit.ts";
import * as d from "./data.ts";
import * as ops from "./operations.ts";
import * as sg from "./signer.ts";
import * as si from "./signin.ts";
import * as ro from "./roles.ts";
import * as ev from "./events.ts";
import * as pr from "./processes.ts";
import { doctype_gl_entry } from "./doctypes.ts";
import { integration_frappe_site, integration_site_service } from "./integrations.ts";

const dec = (spec: { id: string; title: string; question: string; options: { label: string; text: string }[]; chosen: string; why: string; evidence: string; affects: readonly never[] | readonly object[] }) =>
  defineDecision({ id: spec.id, title: spec.title, question: spec.question, options: spec.options, chosen: spec.chosen, why: spec.why, source: BY(spec.evidence), affects: spec.affects as never });

export const decision_plugs_surface_gap_audit = dec({
  id: "plugs.surface-gap-audit",
  title: "Place the site service and connect the world's clock",
  question: "Where is the site service hosted, and which surviving caller moves its clock?",
  options: [{ label: "host-and-connect", text: "Place it on the bench host; the supervisor site follower calls setClock at every authority version and stop. Remove the unused dropSite API record." }],
  chosen: "host-and-connect",
  why:
    "Hosted simulated and production environments place component:site-service on their bench host, explicitly planned rather than deployed. " +
    "devnet.site-clock-follower connects setClock inside the authority barrier, not after the move; it follows running rates too. " +
    "Full worlds move every site, core-only worlds have none. A retry repeats its epoch and version, never advances the authority twice. " +
    "site-service.dropSite has no surviving product workflow or customer command: teardown remains test/operator machinery, evidenced by the spike scripts, " +
    "not a promise of an unused Core API. Its removal changes no site's deletion semantics or retention policy.",
  evidence: "m1-gaps-surface; lane var/blueprint/findings.json; blueprint/devnet/world-rpcs.ts; blueprint/shared/cloud.ts; spikes/skeleton/FINDINGS.md",
  affects: [f.component_site_service, integration_site_service],
});

const RULINGS = "aaron.one-door and aaron.frappe-native";

export const decision_plugs_sign_in = dec({
  id: "plugs.sign-in",
  title: "Capxul is the sign-in; only a person a hat created can sign in",
  question: "How does a person get into their company's Frappe site?",
  options: [
    { label: "capxul-provider", text: "Capxul is an OAuth 2 and OpenID provider. Each site has one Social Login Key pointing at it, with sign-up denied on the site. A person's session on the site is obtained by the service calling the site (plugs.service-calls-site), and a person who only watches gets a one-time link the service asks the site to mint; only a person a hat created has a site user. The browser flow, in which the site's server exchanges a code with Capxul, needs a reachable service and is outside the current path. Frappe never holds a password or a key." },
    { label: "frappe-passwords", text: "Frappe keeps its own passwords and Capxul only mirrors users." },
    { label: "api-keys", text: "Each person gets a Frappe API key." },
  ],
  chosen: "capxul-provider",
  why: `Frappe never holds keys or signs (START-HERE section 2) and the product is one sign-in (${RULINGS}). The spike did it with a stand-in provider: the redirect chain took 0.6 s, sign-up was Deny, and only a person a hat created could sign in (FINDINGS, Frappe half: Social Login Key). The spike's server-to-server code exchange breaks plugs.service-calls-site, so it is outside the current path and People's sign-in stays a stand-in until the breadth is there (critical-path.md, Priorities).`,
  evidence: FIND.e2e,
  affects: [f.system_capxul, f.concept_plugs, d.table_oauth_clients, d.table_oauth_codes, si.rpc_plugs_oauth_authorize, si.rpc_plugs_oauth_token, si.rpc_plugs_oauth_userinfo, integration_site_service],
});

export const decision_plugs_user_from_hat = dec({
  id: "plugs.user-from-hat",
  title: "A Frappe user carries the person's address and exists only because a hat made it",
  question: "What identifies a Frappe user on the chain, and can a user exist without a hat?",
  options: [
    { label: "address-and-hat", text: "The site user's key is the person and their Capxul account address, stored on the user, never the email. A user is made only by a hat's grant, and is disabled, not deleted, when the last hat goes. Administrator and any user made by hand have no signer." },
    { label: "email", text: "Core finds the signer by the user's email, as the skeleton did." },
  ],
  chosen: "address-and-hat",
  why: "The skeleton keyed by email, so Administrator, a hand-made user and a person who changes email all fell outside it, and Core answered 400 that the Frappe half reported as 'could not be reached' (FINDINGS, End to end: What broke, 3; What the design must now decide, 1).",
  evidence: FIND.e2e,
  affects: [f.system_capxul, d.table_site_users, sg.procedure_plugs_payments_hold, ops.operation_payment_prepare_document],
});

export const decision_plugs_administrator = dec({
  id: "plugs.administrator",
  title: "Administrator is Capxul's break-glass account, never a customer's, and is logged",
  question: "Who is a site's Administrator?",
  options: [
    { label: "break-glass", text: "Administrator belongs to Capxul's operators alone. No customer holds it, no person signs in as it, and it has no signer. Every use is logged to the Organization's record and the drift check lists it. A customer's admin is a person with the Director hat's roles, not Administrator." },
    { label: "org-admin", text: "The Organization's admin may use Administrator." },
    { label: "nobody", text: "Disable it." },
  ],
  chosen: "break-glass",
  why: "Administrator holds every role, can edit anything a hook does not forbid, enable Server Scripts and use the bench, yet cannot pay (it has no signer), cannot edit a person's roles and cannot credit the Safe's account (FINDINGS, End to end: What the design must now decide, 5). A customer must never hold it.",
  evidence: FIND.e2e,
  affects: [f.system_capxul, d.table_site_users, pr.workflow_plugs_roles_drift_check, ops.operation_org_roles_drift],
});

export const decision_plugs_hat_map_ships = dec({
  id: "plugs.hat-map-ships",
  title: "The hat-to-role map ships with the app and is not editable on a site",
  question: "Is the map from a hat to Frappe roles data on the site, or part of the release?",
  options: [
    { label: "ships-with-app", text: "The map is a table inside the Capxul app, versioned; a site cannot edit it, Administrator included. A change is a new version that replays additions to people already wearing the hat. Core keeps the version each grant used." },
    { label: "editable", text: "The map is a DocType an admin edits, as in the skeleton." },
  ],
  chosen: "ships-with-app",
  why: "An editable map lets a person give a role the chain never granted (the chain still refused the payment, but a role is authority the site then shows) (FINDINGS, End to end: What broke, 4; What the design must now decide, 6). A top-up that replays additions worked (FINDINGS, CRM: Roles).",
  evidence: FIND.roles,
  affects: [f.system_capxul, d.table_hat_role_map, ro.rpc_plugs_roles_map, ops.operation_org_roles_show],
});

export const decision_plugs_hat_roles_by_job = dec({
  id: "plugs.hat-roles-by-job",
  title: "Each hat's roles are decided from the jobs that hat does, with one eval per job",
  question: "How is the role list of a hat decided and proven?",
  options: [
    { label: "jobs", text: "List each hat's real jobs on the site (create a Supplier, approve an Expense Claim, run payroll, work a lead) and give it exactly the roles those jobs need. Each job is one eval: a person wearing only that hat does it on a real site, and a job outside it is refused. Roles for features that are off are still given; the feature switch closes the part (sites.features-reachability)." },
    { label: "role-names", text: "Give a hat the roles whose names sound right." },
  ],
  chosen: "jobs",
  why: "The default map could not do the work: admin could not create a Supplier (it needed Purchase Master Manager) and budget-holder cannot either (FINDINGS, End to end: What broke, 1; CRM: Roles). A role existing is not a job done. Seven hats were needed, not four: the door's people needed `sales`, `hr-manager` and `project-manager` beside admin, budget-holder, payroll-approver and member, because each needs roles the others must not give (FINDINGS, The door: Seven hats); a new hat name must not need a contract redeploy (plugs.seven-hats). Assumption, not yet tested: the roles for the Books and Invoicing officer hats and the department scoping (a Department User Permission limits nothing on a Payment Entry); the job evals of m3 prove them.",
  evidence: FIND.e2e,
  affects: [f.system_capxul, d.table_hat_role_map, d.table_role_grants, pr.workflow_plugs_roles_project],
});

export const decision_plugs_roles_follow_hats = dec({
  id: "plugs.roles-follow-hats",
  title: "A hat granted or revoked on chain updates a person's roles; no hand edit",
  question: "Who may change a person's Frappe roles?",
  options: [
    { label: "chain-only", text: "Only a hat event. A hand edit of a person's roles, a Role Profile, `add_roles` and `remove_roles` are refused for every user, Administrator included. What can still bypass it (raw SQL, the bench console, `ignore_validate`, a patch, a Server Script) is closed by the nightly drift check, not claimed away. A role two hats give stays while one remains." },
    { label: "frappe-grants", text: "Frappe may grant roles itself and Capxul mirrors them." },
  ],
  chosen: "chain-only",
  why: `Authority flows down from the chain and Frappe's permissions are a projection of it (START-HERE section 3; ${RULINGS}). Measured on the spike: a validate hook on User refused every hand route; a grant reached roles in 54 to 307 ms (FINDINGS, Frappe half: Roles follow hats; Measured).`,
  evidence: FIND.roles,
  affects: [f.system_capxul, d.table_role_grants, d.machine_role_grant, pr.workflow_plugs_roles_project, pr.workflow_plugs_roles_drift_check, ro.rpc_plugs_roles_show, ro.rpc_plugs_roles_drift, ops.operation_org_roles_show, ops.operation_org_roles_drift],
});

export const decision_plugs_held_payment = dec({
  id: "plugs.held-payment",
  title: "A normal Frappe payment is held until the chain confirms it",
  question: "How does a payment started in Frappe move money without Frappe marking it moved first?",
  options: [
    { label: "held-until-chain", text: "Frappe's form writes a request in the site's outbox in the same transaction as the draft's waiting state; the service collects it, opens the approval and answers the site with whose signature is awaited (plugs.service-calls-site); the Payment Entry stays a draft in `waiting`. When the chain's PaymentSent carries the document's hash, Core enqueues payment_sent and the site submits the entry and posts the ledger. A before-submit hook refuses any other submit of a Safe Payment Entry and a ledger hook refuses any other credit to the Safe's account. No fork." },
    { label: "workflow", text: "A Frappe Workflow with a role only the chain holds." },
    { label: "refuse-money", text: "The site refuses money documents (the old optional-head rule)." },
  ],
  chosen: "held-until-chain",
  why: `${RULINGS}: normal Frappe transactions work normally, money included, and the cash leg goes through Capxul's signer and the chain. A Workflow does not gate because Administrator holds every role; the hook-and-form route did, in 40 of 40 checks (FINDINGS, Frappe half: Paying a document, routes 1 to 4). Measured: sign to posted 533 to 728 ms.`,
  evidence: FIND.paying,
  affects: [f.system_capxul, d.table_payment_requests, d.machine_payment_request, sg.procedure_plugs_payments_hold, sg.rpc_plugs_payments_prepare, sg.rpc_plugs_payments_get, pr.workflow_plugs_payments_settle, pr.workflow_plugs_payments_fail, ops.operation_payment_prepare_document, integration_frappe_site],
});

export const decision_plugs_document_canon = dec({
  id: "plugs.document-canon",
  title: "The canonical form a document's hash covers (CANON v1)",
  question: "What exactly is hashed, so a draft edited after the prepare is detected?",
  options: [
    { label: "canon-v1", text: "UTF-8 JSON with sorted keys and no spaces: canon (1), doctype, name, company, payment_type, posting_date (YYYY-MM-DD), party_type, party, paid_from (the ledger account), paid_amount (string, 2 decimals), asset, to_address (lower case, from the party's wallet address), and references sorted by doctype and name with allocated as a 2-decimal string. The hash is 0x and the sha-256 hex. Left out because they change during signing: reference_no, reference_date, docstatus, modified and the Capxul status fields." },
    { label: "whole-document", text: "Hash the whole document as stored." },
  ],
  chosen: "canon-v1",
  why: "The stored document changes during signing (ERPNext demands a reference number on a Bank payment even as a draft, so the hook writes PENDING-CHAIN and later the transaction hash). Editing the draft changes the hash, so the later payment no longer matches and the request is a mismatch (FINDINGS, Frappe half: Canonical JSON for document_hash).",
  evidence: FIND.canon,
  affects: [f.system_capxul, d.table_payment_requests, sg.procedure_plugs_payments_hold, ops.operation_payment_prepare_document],
});

export const decision_plugs_payment_fields = dec({
  id: "plugs.payment-fields",
  title: "Every payment carries the document hash, the cost centre and the account code",
  question: "What does an on-chain payment say about the document it pays?",
  options: [
    { label: "hash-centre-code", text: "payments.prepare-command takes the document hash, a cost centre and an account code and keeps them on the Payment, so the chain event posts to Frappe mechanically. Core does not hold the chart of accounts: a code is a label (START-HERE section 4). The zero hash is refused." },
    { label: "hash-only", text: "Only the hash travels; Frappe infers the account." },
  ],
  chosen: "hash-centre-code",
  why: "Every on-chain spend carries the document hash, the cost centre and the account code so that posting to Frappe is mechanical (START-HERE section 4). Assumption, not yet tested, settled by m1-contracts-reconcile and the real-contracts test (m2-contracts-under-sites): the real Payments contract and prepare-command carry the two labels; the skeleton's stand-in carried the hash and the department only. The contract change is designed by stage 3's decision plugs.contract-changes and built at the contracts milestone.",
  evidence: FIND.core,
  affects: [f.system_capxul, f.concept_payments, d.table_payment_requests, sg.procedure_plugs_payments_hold, ops.operation_payment_prepare_document],
});

export const decision_plugs_reversal = dec({
  id: "plugs.reversal-not-deletion",
  title: "Cancelling or amending a paid document is a reversal payment, never a deletion",
  question: "What happens in Frappe when a document that was paid is cancelled or amended?",
  options: [
    { label: "reversal", text: "Cancelling a posted Safe payment is refused: money cannot be un-sent. The way back is a refund, a new payment on chain, whose event posts a reversing entry matched to the original. An amended document is a new draft with a new hash and its own payment. Chain events that arrive after a fiscal period has closed post into the open period (plugs.late-and-closed)." },
    { label: "delete", text: "Let Frappe cancel the entry and delete the ledger lines." },
  ],
  chosen: "reversal",
  why: "The skeleton refuses to cancel a posted Safe payment and a refund must be a chain event (FINDINGS, Frappe half: Paying a document). START-HERE section 3 says a cancelled or amended paid document becomes a reversal transaction, never a deletion.",
  evidence: FIND.paying,
  affects: [f.system_capxul, d.machine_payment_request, sg.procedure_plugs_payments_abandon, pr.workflow_plugs_payments_settle],
});

export const decision_plugs_waiting_shows_whose = dec({
  id: "plugs.waiting-shows-whose",
  title: "A waiting payment shows whose signature it awaits, and the signer has a list",
  question: "What does the person in Frappe, and the person who must sign, see while a payment waits?",
  options: [
    { label: "named-and-listed", text: "The form's headline says 'waiting for <name>'s signature' and keeps a link to the approval; if the pop-up is closed or blocked the link remains. The signer's `payment awaiting` lists everything they have been asked to sign. Whoever signs may differ from whoever asked." },
    { label: "status-line", text: "A status line and a pop-up, as in the skeleton." },
  ],
  chosen: "named-and-listed",
  why: "The skeleton showed a status line, a pop-up a browser may block and a 3 s poll; nothing said whose signature was awaited when the signer differs from the requester (FINDINGS, End to end: What the design must now decide, 4).",
  evidence: FIND.e2e,
  affects: [f.system_capxul, sg.rpc_plugs_payments_awaiting, sg.rpc_plugs_payments_get, ops.operation_payment_awaiting],
});

export const decision_plugs_no_openfort = dec({
  id: "plugs.no-openfort",
  title: "OpenFort is out of the path: every signature is made with a key",
  question: "How are the approvals this plug opens signed in the first build?",
  options: [
    { label: "keys", text: "An agent signs with its own key under its hat, or deterministic code signs with a test key; there is no browser pop-up and no wallet iframe. A person's sign-in stays a stand-in until the breadth is there. The approval record and the signer's list are the same as they would be with a wallet, so OpenFort can return later behind the same seam." },
    { label: "openfort", text: "Sign through the OpenFort iframe as the old product did." },
  ],
  chosen: "keys",
  why: "Aaron, 10 November (docs/mission/critical-path.md, Priorities): OpenFort adds testing friction; every signature is made with a key by an agent or by deterministic code.",
  evidence: FIND.path,
  affects: [f.system_capxul, f.concept_approvals, sg.rpc_plugs_payments_awaiting, ops.operation_payment_awaiting],
});

export const decision_plugs_poison_event = dec({
  id: "plugs.poison-event",
  title: "A non-money event can be set aside; a money event always reaches the books",
  question: "What happens to the stream when one event can never be applied?",
  options: [
    { label: "set-aside-or-unmatched", text: "After three failures a non-money event is set aside, the cursor moves on, and an operator can release it with `org events retry`. A money event is never set aside: it posts to the site's books as an unmatched bank line, carries an alert to the Organization's admin, and stays in the stream as applied-by-line. Transient and permanent errors are told apart by the site's answer: 5xx retries; a refusal that names the cause is permanent." },
    { label: "block", text: "Stop the stream and wait for a person." },
    { label: "drop", text: "Drop the event." },
  ],
  chosen: "set-aside-or-unmatched",
  why: "One permanently failing event blocked every later event for the site, money included, and was reproduced for real: a hat granted to an address Core could not name crashed the handler (FINDINGS, End to end: What broke, 5; Core half: Head-of-line blocking). The spike parked after 3 tries and a parked payment_sent became an unmatched bank line, so the books still showed the money leave; there was no retry tool and no alert (FINDINGS, What the design must now decide, 2).",
  evidence: FIND.e2e,
  affects: [f.system_capxul, d.machine_site_event, pr.workflow_plugs_events_deliver, ev.rpc_plugs_events_retry, ev.rpc_plugs_events_status, ops.operation_org_events_retry, ops.operation_org_events_status],
});

export const decision_plugs_event_order = dec({
  id: "plugs.event-order",
  title: "Events are numbered by Core, keyed by log, applied at least once, deduplicated",
  question: "How do the chain's events reach the books exactly once and in order?",
  options: [
    { label: "numbered-outbox", text: "Core assigns a gap-free number per Organization at enqueue and keeps every event. The key is `chainId:txHash:logIndex` (never the block hash, which a reorg changes), delivered only after the finality depth. The site answers a repeated key as already applied and a number ahead of its cursor with 409 and the number it expects; Core moves to it, even backwards. A reorg that removes a log enqueues a reversal." },
    { label: "unordered", text: "Send events as they come and let the site sort them." },
  ],
  chosen: "numbered-outbox",
  why: "Exactly once is at-least-once plus dedupe, proven with hard kills of Core and of the site: each key applied once, numbers gap-free (FINDINGS, Core half: What the ordering guarantee really costs). The skeleton's blockHash key is not reorg-safe; anvil never reorgs, so that is untested.",
  evidence: FIND.core,
  affects: [f.system_capxul, d.table_site_events, d.table_site_cursors, ev.procedure_plugs_events_enqueue, pr.workflow_plugs_events_deliver, ops.operation_org_events_resend, ops.operation_org_events_status, integration_frappe_site],
});

export const decision_plugs_history_in_core = dec({
  id: "plugs.history-lives-in-core",
  title: "Core's outbox is the log of record; a new site receives it from number 1",
  question: "Where does the history live, and what does a re-created or restored site receive?",
  options: [
    { label: "core-outbox", text: "Core keeps every event for ever. `org create` for an Organization that already has events resends from number 1; a site restored from a backup is brought up by `org events resend`. Chain events can be rebuilt from the logs; `payment_failed` cannot, so it is rebuilt from payment-requests." },
    { label: "site-history", text: "The site is the history." },
  ],
  chosen: "core-outbox",
  why: "Re-creating a site for an Organization Core had already delivered to left the new site empty and Core recovered only on the next event (FINDINGS, End to end: What broke, 2). `release` replays from 1, a 409 replays from the site's cursor and `payment_failed` cannot be rebuilt from the chain (FINDINGS, What the design must now decide, 3).",
  evidence: FIND.e2e,
  affects: [f.system_capxul, d.table_site_events, ev.rpc_plugs_events_resend, ops.operation_org_events_resend],
});

export const decision_plugs_contract_changes = dec({
  id: "plugs.contract-changes",
  title: "Contract changes the skeleton forced, to be built with the real contracts",
  question: "What must the v4 contracts and the indexer say that the stand-in's did not?",
  options: [
    { label: "changes", text: "PaymentSent names the signer, not only the Safe. An organisation's slug is recoverable from logs alone (the skeleton's admin HatGranted preceded OrgCreated in one transaction). A cheap `canPay(org, person)` view lets Frappe grey out Submit before Sign. A department is budget authority: budgets are enforced per department (cut.department-budgets). Core attests a refusal that leaves no log and says so. Assumption, not yet tested, settled by m1-contracts-reconcile and m2-contracts-under-sites: each of these on the real v4 contracts; the skeleton's contracts were stand-ins." },
    { label: "none", text: "Use the contracts as they are." },
  ],
  chosen: "changes",
  why: "FINDINGS, Core half: What a chain cannot tell Frappe: a revert leaves no log; a log names an org only by hash and people only by address; PaymentSent carries no signer; the chain knows a document only as a hash; a department is not authority; refusal is only known at Sign.",
  evidence: FIND.core,
  affects: [f.system_capxul, f.concept_payments, f.concept_budgets, f.concept_indexing, pr.workflow_plugs_payments_settle],
});

export const decision_plugs_books_currency = dec({
  id: "plugs.books-currency",
  title: "Books currency when the Safe holds USDC: untested for a GBP company",
  question: "In which currency does a company's books record a USDC payment?",
  options: [
    { label: "usd-one-to-one-for-now", text: "The skeleton booked USDC 1:1 as USD in a USD company with a USD bank account. A UK company in GBP needs a rate in the Payment Entry and in the hash (CANON v1 has no rate field). That is not decided and not tried; a spike on a company in the chosen jurisdiction's currency must come first (aaron.jurisdiction-open leaves the place open)." },
    { label: "gbp", text: "Book in GBP with a revaluation of the USDC account." },
  ],
  chosen: "usd-one-to-one-for-now",
  why: "FINDINGS, Frappe half: Currency: GBP books with a USD-denominated account were not tried; a Payment Entry from a USD account to a GBP invoice needs a rate. critical-path.md, Known risks, 4. Marked as an assumption to be tested by that spike.",
  evidence: FIND.paying,
  affects: [f.system_capxul, d.table_payment_requests, pr.workflow_plugs_payments_settle],
});

export const decision_plugs_late_and_closed = dec({
  id: "plugs.late-and-closed",
  title: "A chain event after a fiscal period closed posts into the open period",
  question: "Where does a late chain event post when its period is closed in Frappe?",
  options: [
    { label: "open-period", text: "It posts into the open period with the original date in the remarks; a closed period is never reopened by an event." },
    { label: "reopen", text: "Reopen the period." },
  ],
  chosen: "open-period",
  why: "START-HERE section 3: Frappe's habits need chain equivalents. The spike showed the door refuses a document in a closed accounting period with Frappe's own message (FINDINGS, What the door reaches); an event posting into the open period with the original date in remarks was not tried: the eval is a late payment_sent after a period close.",
  evidence: FIND.core,
  affects: [f.system_capxul, pr.workflow_plugs_events_deliver],
});

export const decision_plugs_employee_for_member = dec({
  id: "plugs.employee-for-member",
  title: "The member hat creates an Employee; the chain knows no HR facts",
  question: "Where do the HR facts of a new member come from?",
  options: [
    { label: "placeholders-then-hr", text: "ERPNext strips the Employee role from a user with no Employee, so the member hat's grant creates one. The chain knows neither gender nor date of birth, so the skeleton used placeholders (Prefer not to say, 1990-01-01). The design: the grant creates the Employee with those placeholders and the person's HR facts are entered in Frappe by the People officer; they are never asked of the chain." },
    { label: "ask-chain", text: "Put HR facts on chain." },
  ],
  chosen: "placeholders-then-hr",
  why: "FINDINGS, Frappe half: Roles follow hats (ERPNext strips the Employee role). Frappe HR is the HR (${RULINGS}). Placeholders were proven, and the `hr-manager` hat then created employees for others through the door, with ERPNext's per-Employee user permission switched off at creation so it does not confine the HR person to their own record (FINDINGS, The door).".replace("${RULINGS}", RULINGS),
  evidence: FIND.roles,
  affects: [f.system_capxul, d.table_site_users, pr.workflow_plugs_roles_project],
});

export const decision_plugs_repoint_money_fact = dec({
  id: "plugs.repoint-money-fact",
  title: "books.record-money-fact feeds the outbox; Frappe's books are written from it",
  question: "Where does a money fact go now that Frappe is the books?",
  options: [
    { label: "outbox", text: "The chain reader still records each money fact (gap-free, append-only), and plugs.payments.settle and the movement records enqueue the corresponding event for the site, which posts a Payment Entry matched to its document with the transaction hash. Capxul's own ledger tables remain the chain's side of the books until the site's entries are proven to agree month by month (milestone 5); they are not a second book of record." },
    { label: "drop-ledger", text: "Delete Capxul's ledger now." },
  ],
  chosen: "outbox",
  why: "The cut left the chain reader and the ledger tables it writes (cut.books). The books are Frappe's (aaron.books-first-principles, rewritten by aaron.one-door); the check that they agree is the month-end eval.",
  evidence: FIND.core,
  affects: [f.system_capxul, f.concept_books, d.table_site_events, pr.workflow_plugs_payments_settle],
});

export const decision_plugs_worlds = dec({
  id: "plugs.worlds",
  title: "The templates the plugs' refusals and claims are reached from",
  question: "Which named templates (snapshots of a world) do the plugs' operations start from?",
  options: [
    { label: "templates", text: "org-with-site (a company with its site ready), org-with-hats-on-site (the four hats worn on it), org-with-held-payment and org-with-held-payment-other-signer (a payment waiting, and one awaiting another signer), org-with-site-events (a stream with events applied), org-with-unappliable-event (one the site cannot apply), org-with-site-down (the bench stopped), org-with-member, signed-out. Each is built from the world template by running operations, and saved as a snapshot (devnet.worlds). Per docs/mission/worlds.md these are templates, not worlds." },
  ],
  chosen: "templates",
  why: "A refusal is only provable from a state that produces it. docs/mission/worlds.md section 1 renames the eval 'worlds' to templates; the ids here stay as they are because renaming them would churn every refusal's `given`.",
  evidence: FIND.path,
  affects: [f.system_capxul, ops.operation_payment_prepare_document, ops.operation_payment_awaiting, ops.operation_org_events_status, ops.operation_org_roles_drift],
});

export const decision_plugs_service_calls_site = dec({
  id: "plugs.service-calls-site",
  title: "Every call goes from the service to a site; a site never reaches the service",
  question: "In which direction do the calls between the Capxul service and a company's site go?",
  options: [
    { label: "service-calls-site", text: "Always the service to the site. (a) A person's request to pay becomes a row the site writes in an outbox in the same transaction as the document's waiting state; the service collects requests by asking the site for those after a cursor (a poll or a long-poll), holds each, and answers by calling the site with the approval or the refusal; the trace id and the idempotency key travel with the request. (b) The service reaches a person on a site by a signed short-lived assertion on each call (plugs.door-assertion); a person who only watches gets a one-time link the service asks the site to mint. A browser sign-in that needs the site to call the service is marked as needing a reachable service and is outside the current path. (c) The world's clock, features, roles and events are already pushed by the service. Consequence: a developer's local devnet, whose service runs on a laptop the hosted bench cannot reach, registers itself as a world with the hosted site service: a world id, a secret and a name are issued, its companies' sites are created on the hosted bench, and idle sites are parked after a stated time (assumption: 30 minutes without a call, measured by m3b-first-shared-world); a core-only world, with no sites, is the offline fallback. A hosted world's service needs no inbound route from the bench." },
    { label: "site-calls-service", text: "The site posts payment requests to the service and the sign-in exchanges its code with the service's server, as the skeleton did." },
  ],
  chosen: "service-calls-site",
  why: "The owner, 10 November: one hosted bench should be shared by everything, including developers' local devnets whose service a hosted bench cannot reach, and a hosted world's service should need no inbound route from the bench. The precedent is the old head design: 'Capxul always calls; the head only rings a doorbell' (the archived integration frappe-head). The spike breaks the rule in two places (spikes/skeleton/INTERFACE.md: the site posts /prepare to the service; the sign-in exchanges the code server to server); both are replaced here. Assumption, not yet tested: the site's outbox of requests, the poll and its latency (the skeleton's sign to posted was 533 to 728 ms and Frappe-down recovery 2.0 to 3.8 s with the site calling); m3-site-stops-calling proves them.",
  evidence: FIND.e2e,
  affects: [f.system_capxul, d.table_site_request_cursors, d.table_site_links, d.table_payment_requests, pr.workflow_plugs_payments_collect, sg.rpc_plugs_payments_prepare, si.rpc_plugs_oauth_authorize, si.rpc_plugs_oauth_token, ops.operation_org_site_link, ops.operation_payment_prepare_document, integration_frappe_site],
});

export const decision_plugs_site_request_boundary = dec({
  id: "plugs.site-request-boundary",
  title: "Durable site requests, with Core-initiated wake-up subscriptions",
  question: "How does slice zero replace the site's outbound prepare and OAuth calls without periodic request polling?",
  options: [
    { label: "durable-with-hints", text: "Submit locks the draft and a site request counter, writes an immutable prepare body and trace with the draft's Requesting state, then commits once. Signed service-only collect/answer methods use a monotonic integer cursor and stable request id; duplicate answers succeed, conflicting answers refuse, late answers never overwrite settlement or a newer draft. Core subscribes outbound to the existing site Socket.IO server and collects at startup, reconnect and after after-commit hints; hints contain only org and cursor. A 60-second, site-bound CapxulListener Authorization token authenticates only the socket server's get_user_info callback as a dedicated Website User with no business roles, never Administrator. It is not a customer session or a document credential. Legacy Capxul Social Login Keys are removed on configure/migrate/restore; agent assertions remain the caller door and human sign-in remains outside this slice. Restore rewrites names without resuming the scheduler. The hat map is read only from shipped app data, its content hash is the version recorded on grants and returned to Core, and migration removes the legacy editable map DocTypes and reprojects existing grants." },
    { label: "periodic-poll", text: "Keep a periodic service-to-site poll, with the same durable outbox." },
  ],
  chosen: "durable-with-hints",
  why: "Implements plugs.service-calls-site and plugs.hat-map-ships while honoring Aaron's parked concern about polling in aaron.postgres-and-ponder. Socket.IO already authenticates an Authorization header through the site's get_user_info callback and automatically joins that user's private room. Notifications only wake the durable collector; they never acknowledge money or advance its cursor. A missing hint is recovered on reconnect. No inbound Core route, customer API key, or Administrator session is introduced. Parked-event repair reruns stored facts under the cursor lock; only successful application and reconciliation of any fallback Bank Transaction changes it to Applied, never clearing an alert row alone. Hat repair instead reprojects the newest later Applied grant/revocation for the same normalized person, hat and department if one supersedes the parked event, preserving current authority rather than restoring revoked access or removing a regrant. Submit retries a rolled-back database conflict up to three times: MariaDB 11.8 snapshot isolation can reject a waiting row lock after another Submit commits, even though the request identity remains idempotent.",
  evidence: "Slice zero Frappe/Core boundary agreement, 12 November 2026; Frappe v16.54.0 realtime/middlewares/authenticate.js, realtime/handlers.js and frappe/realtime/__init__.py",
  affects: [f.component_frappe_app, integration_frappe_site, d.table_hat_role_map, d.table_role_grants, d.table_payment_requests, d.table_site_request_cursors, pr.workflow_plugs_payments_collect],
});

export const decision_plugs_ledger_trace_display = dec({
  id: "plugs.ledger-trace-display",
  title: "Show persisted traces on the native General Ledger",
  question: "How can a person verify the command trace on the actual ledger row without forking ERPNext?",
  options: [
    { label: "report-extension", text: "Use Frappe's Report extension hook. Run the unchanged ERPNext General Ledger, retain its name, filters and permission checks, then add Capxul Trace from persisted GL Entry.capxul_trace keyed by the returned gl_entry. Totals without a ledger identity have no trace. Never substitute the current request trace. Place Payment Entry's read-only Capxul status and approval reference alongside its posting date, visible on the primary details tab before and after settlement. An approval answer arriving after settlement fills the reference only when its request matches the posted transaction and document hash, without changing Sent or the posted voucher." },
    { label: "api-only", text: "Keep the trace field in the API without displaying it in General Ledger." },
  ],
  chosen: "report-extension",
  why: "Slice zero acceptance requires a person to see the same trace as the settled payment's persisted GL rows. ERPNext v16.54.0 returns each row's gl_entry identity but does not select or render this custom field. A narrow Report mixin adds the field while preserving native calculations and access controls, rather than copying or editing ERPNext. The Payment Entry's existing approval URL remains an ordinary read-only URL field after settlement: the signing action is draft-only, but the source approval reference is a permanent part of the readable audit trail. Purchase Invoice and Payment Entry explicitly show their native Company control even on a one-company site, retaining ERPNext's edit/read-only rules so the readable transaction context does not disappear.",
  evidence: "Slice zero screens/alerts acceptance contract, 12 November 2026; pinned erpnext/accounts/report/general_ledger/general_ledger.py and Frappe extend_doctype_class hook",
  affects: [f.component_frappe_app, doctype_gl_entry],
});

export const decision_plugs_request_starts_trace = dec({
  id: "plugs.request-starts-trace",
  title: "A payment request starts the money trail's trace when no caller sent one",
  question: "A person who presses Submit in the desk sends no X-Capxul-Trace, so the request, its chain event and its ledger rows carry an empty trace. Where does the trace come from then?",
  options: [
    { label: "request-starts", text: "request_payment keeps a caller's trace and otherwise starts one (tr_ plus 24 random lowercase characters) before writing the request row. The request body carries it to Core, the approval and PaymentSent bring it back, and the posted GL rows are stamped with it." },
    { label: "caller-only", text: "Only callers that send a trace get one; desk submissions post untraced ledger rows." },
  ],
  chosen: "request-starts",
  why: "plugs.ledger-trace-display requires the settled payment's GL rows to show one persisted trace, and the desk is the ordinary way a person requests a payment. On world scrz1 (run run-20261113054032098-f6e9c408) the hat holder's request carried no trace, both GL rows of the settled payment had a null capxul_trace and ACCEPT.money-reconciled failed. A trace started at the request is the earliest point both the site and Core share.",
  evidence: "Selected-stack run run-20261113054032098-f6e9c408 on world scrz1, 13 November 2026",
  affects: [f.component_frappe_app, d.table_payment_requests, doctype_gl_entry],
});

export const decision_plugs_later_deposits = dec({
  id: "plugs.later-deposits",
  title: "Later incoming transfers are not founder capital",
  question: "Which site event represents ordinary money arriving after the founding deposit?",
  options: [{ label: "unmatched-deposit", text: "Core delivers deposit_received with amount, asset, tx_hash, block_time, from and to. The site creates one idempotent unreconciled Bank Transaction deposit per stable chain event key, preserving distinct Transfer logs within the same transaction hash. Only founder_capital creates the founding Shareholder and Journal Entry." }],
  chosen: "unmatched-deposit",
  why: "Preserves books.founder-funding and books.party-lines. A later incoming Transfer with no founding person is not capital and must not attempt to create a nameless Shareholder or hide ordinary incoming money behind a parked capital event.",
  evidence: "Core/Frappe slice zero protocol agreement, 12 November 2026; capxul.capital.unmatched_deposit",
  affects: [f.component_frappe_app, integration_frappe_site, pr.workflow_plugs_books_founder_capital],
});

export const decision_plugs_answer_origin = dec({
  id: "plugs.answer-origin",
  title: "Retry the saved approval link; rewrite origins only during restore",
  question: "How can a lost answer acknowledgement survive a changed gateway origin without conflicting with the site's accepted answer?",
  options: [{ label: "saved-answer-explicit-rewrite", text: "Core commits the complete answer, including its approval URL, before sending it. Ordinary restart or reconnect replays that answer exactly even when CORE_URL changed. Explicit clone/restore, while both Core and the site are paused, rewrites the transport origin in Core's saved answers and the site's answer_json, request approval URLs and Payment Entry approval URLs to the restored world's public Core origin. Approval identities, request bodies except restored site names, statuses, posted money and hashed records do not change. Resume only after both rewrites succeed." }],
  chosen: "saved-answer-explicit-rewrite",
  why: "A site commits an answer before Core knows it was accepted. Regenerating the URL from runtime configuration makes a legitimate retry conflict with the full answer_json. Persisting the exact answer closes that crash window; coordinated explicit restore rebasing keeps links inside the cloned world without weakening conflicting-answer checks or rewriting financial history.",
  evidence: "PR #34 mirror finding 4548573454, 12 November 2026; capxul.payments.answer_request durable answer comparison",
  affects: [f.component_frappe_app, integration_frappe_site, d.table_payment_requests, d.table_site_request_cursors, pr.workflow_plugs_payments_collect],
});

export const decision_plugs_typed_site_transport = dec({
  id: "plugs.typed-site-transport",
  title: "One typed, signed site transport for workflows and product calls",
  question: "How do the collector, event delivery and public document door agree on site failures and successful acknowledgements?",
  options: [{ label: "typed-provider", text: "The backend FrappeSite Effect service owns a configured transport origin and secret, signs exact request bytes and short-lived user assertions, refuses redirects, bounds timeouts/retries and validates response schemas and request/tenant/cursor identities. Network failures, 401 and 5xx map to PROVIDER_ERROR; invalid successful answers map to PROVIDER_RESPONSE_INVALID. Product run/report responses carry explicit ok/data or ok/error envelopes. A native FeatureNotAvailable PermissionError subclass distinguishes disabled features without matching translated text. Native permission and missing-document failures retain the declared public error vocabulary. A missing readSite method is WRONG_STATE. HTTP 409 event cursor conflicts retain the site's expected sequence for durable replay; they never acknowledge money. The existing checked-out SQL connection and complete saved collector answer remain authoritative." }],
  chosen: "typed-provider",
  why: "The durable workflow's narrow fetch calls do not implement the declared FrappeSite error contract. Sharing one schema-checked provider prevents public handlers and workflows from interpreting the same failed site call differently, while keeping all requests inbound to the site and all transaction ownership in the existing invoker.",
  evidence: "Slice-zero plugs binding audit and product-door/provider ownership agreement, 12 November 2026; packages/backend/src/plugs/collector.ts and door.ts",
  affects: [f.component_backend, f.component_frappe_app, integration_frappe_site, pr.workflow_plugs_payments_collect, pr.workflow_plugs_events_deliver],
});

export const decision_plugs_native_feature_defaults = dec({
  id: "plugs.native-feature-defaults",
  title: "Native feature readiness reports the eleven declared switches",
  question: "How does native feature setup satisfy Sites' recorded defaults without hiding existing choices?",
  options: [{ label: "seed-and-observe", text: "New native sites seed accounts, people, projects and crm on; payroll, whatsapp, attendance, recruitment, reviews, stock and manufacturing off. Migration adds missing switches and refreshes caches and user module blocks, preserving existing choices rather than resetting them during configure or restore. On pinned HRMS the split attendance, recruitment and performance DocTypes still live in HR, so feature records name those DocTypes explicitly; their document APIs close without closing Employee, leave, expenses or shared project timesheets. readSite returns the actual native rows, never substituted defaults." }],
  chosen: "seed-and-observe",
  why: "PR57's real readiness comparison exposed the native eight-feature/payroll-on catalog. Module names alone cannot close the split features on this HRMS release. Recording explicit DocTypes makes the blueprint comparison cover the native guard as well as the default list; discovery types/schema and disabled-DocType guards use this same explicit ownership before falling back to module ownership. A shared native module cannot be blocked wholesale while it contains an enabled feature's explicitly owned DocTypes: those DocTypes remain reachable and the disabled feature's other DocTypes are still refused individually. Existing enabled payroll cannot safely be guessed to be an old default rather than an intentional choice; readiness must report that drift honestly.",
  evidence: "PR57 mirror finding4549544850; native boundary.localhost read_site and HRMS DocType/module observation, 12 November 2026",
  affects: [f.component_frappe_app, integration_frappe_site],
});

export const decision_plugs_role_projections = dec({
  id: "plugs.role-projections",
  title: "Persist role authority and its exact transitions in the source transaction",
  question: "How do a finalized hat occurrence and the site's acknowledgement survive a Core restart?",
  options: [{ label: "transactional-projections", text: "Tenant-keyed site-users and role-grants live in Postgres, readable in exact organization owner scope and writable only by the trusted worker. The source transaction records the grant and user, enqueues native delivery and appends the exact role_grant_transitioned event together. It receives canonical person identity and finalized occurrence identity from authoritative composition, never invents a person from email or an address. A matching native map-version acknowledgement applies the grant; a failed acknowledgement records failure. A finalized revoke retires a pending grant or revokes an applied/failed grant, queues removal and preserves roles supplied by other applied grants. Caller-supplied world milliseconds date rows and events; there is no host-time business fallback." }],
  chosen: "transactional-projections",
  why: "The legacy organization directory and native grant rows do not establish Core's declared projections or exact events. A caller-owned transaction closes the state/event/delivery crash window without copying ERPNext documents or sending a provider request inside the common outbox ACK. Native hats treat null and empty departments as the same unscoped identity: new rows use null and retention compares that equivalence, without rewriting committed transition history. This storage boundary does not manufacture the still-pending authoritative person/finalized-fact export or claim the workflow is mounted.",
  evidence: "Slice-zero plugs continuation; landed common outbox and canonical clock contracts, 12 November 2026",
  affects: [d.table_site_users, d.table_role_grants, d.machine_role_grant, pr.workflow_plugs_roles_project],
});

export const decision_plugs_role_delivery = dec({
  id: "plugs.role-delivery",
  title: "Settle native role acknowledgements with the authoritative clock",
  question: "Where does a native role acknowledgement become durable Core authority?",
  options: [{ label: "atomic-ack", text: "Existing delivery and parked repair settle the site's ACK, grant transition and exact outbox emission on the same caller Sql. worldNow reads that transaction's stored stopped clock; missing, malformed or running clocks refuse without a host/block-time fallback. Historical projected grants still validate that clock and date each new ACK at stored world-ms without changing the original grant or outbox event. Legacy events with no projection retain their existing behavior. Only provider transport failures enter delivery retry handling; settlement failures propagate and roll back. A successful matching native map applies a pending/failed grant, parked failure fails a pending grant, and historical applied/revoked replay cannot resurrect authority. Native readHatMap observes release DEFAULT_HAT_ROLES, its canonical hash and actual installed Role availability. The backend admits only its known release hash and refuses altered maps or unavailable roles. The map contains no numeric chain-hat admission, departments, jobs, scope or person names; those remain separate authoritative composition prerequisites." }],
  chosen: "atomic-ack",
  why: "Catching a clock or transition failure after ACK writes can commit delivery without its authority event. A read-only native map observation closes the release/availability gap without accepting editable hat registration as chain admission or inventing department/name metadata.",
  evidence: "Integrator's same-Sql worldNow and migration agreement, landed wave458a747; native setup.DEFAULT_HAT_ROLES and hats.map_version, 12 November 2026",
  affects: [integration_frappe_site, d.machine_role_grant, pr.workflow_plugs_events_deliver],
});

export const decision_plugs_selected_observations = dec({
  id: "plugs.selected-observations",
  title: "Selected Plugs checks do not inherit skeleton acceptance",
  question: "What can the selected Plugs runner establish before the authority and public lifecycle composition is complete?",
  options: [{ label: "same-run-observations", text: "Require a running selected Postgres/Ponder/ERPNext/v4 receipt for the current source, private configuration and matching live world/epoch/site. Read the native release map, actual site readiness and committed saved answers against the native request outbox. These are near-only observations, not grants, public commands, replay/crash controls or lifecycle acceptance. Remove the legacy main-world JSON skeleton replay binding instead of reusing its evidence. No selected claim passes until its complete public scenario executes in that fresh run." }],
  chosen: "same-run-observations",
  why: "The old Plugs binding launches a main-world skeleton and cannot prove the selected backend. Release-map availability does not authorize a numeric hat or bootstrap a native user; a consistent saved answer alone does not prove lost-ACK replay. Keeping those limits explicit prevents component history or synthetic fixture grants from silently satisfying selected evals.",
  evidence: "Wave0 integrator source/selected-run ownership agreement, 12 November 2026; evals/bindings/plugs.json legacy skeleton binding",
  affects: [integration_frappe_site, pr.workflow_plugs_payments_collect, pr.workflow_plugs_events_deliver],
});

void ops; 
