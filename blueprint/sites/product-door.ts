import { defineDecision, defineDoctype } from "../../packages/blueprint-engine/src/index.ts";
import { concept_sites } from "../shared/foundation.ts";
import { doctype_user } from "../plugs/doctypes.ts";
import { rpc_sites_door_create, rpc_sites_door_get, rpc_sites_door_reports_run, rpc_sites_door_submit } from "./door.ts";
import { table_door_calls, table_site_features, table_sites } from "./data.ts";
import { workflow_sites_create } from "./processes.ts";
import { integration_frappe_site } from "../plugs/integrations.ts";

export const doctype_capxul_door_call = defineDoctype({
  id: "capxul-door-call", title: "Capxul Door Call", name: "Capxul Door Call", app: "capxul", concept: concept_sites,
  about: "A private site-local retry receipt, committed in the same MariaDB transaction as a public document mutation. Its name hashes the call id. Core's door-calls table keeps only the outcome and document identity; no document fields leave Frappe for a second authoritative store.",
  fields: [
    { name: "person", type: "Link", link: doctype_user, required: true, readOnly: true },
    { name: "request_hash", type: "Data", required: true, readOnly: true },
    { name: "response_json", type: "Code", options: ["JSON"], readOnly: true },
  ],
  permissions: [],
});

export const decision_sites_door_retry_receipt = defineDecision({
  id: "sites.door-retry-receipt", title: "Document idempotency commits where the document lives",
  question: "How can a public document call survive losing its response between Frappe's commit and Core's audit write?",
  options: [
    { label: "site-transaction", text: "Core verifies an origin-bound caller signature and sends the trusted person's assertion through FrappeSite. The site commits a private call-id receipt atomically with create or submit. A replay by the same person with the same payload returns the saved response; a changed person or payload refuses. Core stores only the declared door-calls metadata. A Safe submit saves its stable Requesting receipt; Core waits for the durable collector answer before returning held with approvalId and awaiting. Neither caller nor site stores a new credential." },
    { label: "core-only", text: "Save Core's intent and result around the HTTP call. A crash after the site commits but before Core saves its result leaves an ambiguous mutation which cannot safely be replayed." },
  ],
  chosen: "site-transaction",
  why: "aaron.one-door and aaron.frappe-native keep documents in ERPNext. A remote SQL transaction cannot roll back a committed Frappe insertion. The site-local receipt closes that crash window without placing document bodies in Core or replacing the asynchronous payment request outbox.",
  source: "Slice-zero sites implementation assignment, 12 November 2026; packages/frappe-app/capxul/payments.py request_payment and answer_request; decision sites.door.",
  affects: [concept_sites, doctype_capxul_door_call, table_door_calls, rpc_sites_door_create, rpc_sites_door_submit],
});

export const decision_sites_assertion_readiness = defineDecision({
  id: "sites.assertion-readiness", title: "Site creation verifies the native assertion door, not the removed OAuth client",
  question: "What sign-in mechanism must site creation verify after the site stopped calling Core?",
  options: [
    { label: "native-assertion", text: "Read the actual site's assertion auth hook, app and immutable map versions, Company and default feature rows, with no legacy capxul Social Login Key. Mark ready only after Core retains applied acknowledgements for the initial events. This proves the configured programmatic door and hat-created users, not human browser OAuth." },
    { label: "legacy-client", text: "Recreate the removed Social Login Key and register a callback client before marking ready, bringing back a site-to-Core dependency that the landed boundary removed." },
  ],
  chosen: "native-assertion",
  why: "The landed Frappe boundary removes the legacy OAuth client on configure, migrate and restore, and the site never calls Core (plugs.service-calls-site). The CLI uses the native signed-person assertion. Keeping the old creation step would deliberately reintroduce that removed mechanism; browser sign-in remains outside slice-zero acceptance.",
  source: "Landed Frappe PR35; capxul.setup.remove_legacy_oauth, capxul.door.validate_assertion; plugs.door-assertion and aaron.one-door.",
  affects: [concept_sites, workflow_sites_create],
});

export const decision_sites_annotation_account = defineDecision({
  id: "sites.annotation-account", title: "Resolve an annotation's account on its own site as the saving person",
  question: "How does books validate an ERPNext Account given by number or name without copying the chart or weakening exact-name document reads?",
  options: [
    { label: "site-resolver", text: "FrappeSite resolves the reference through capxul.product_door.account as the saving person's signed assertion. The site derives its Company from Global Defaults, finds an Account by exact name or account_number through native permission-filtered reads, and checks document read permission. Only an enabled non-group Account of that Company is returned, as a canonical document with its native fields. Missing, ambiguous, disabled or group accounts refuse INVALID_INPUT; native permission refusal remains ROLE_PERMISSION_DENIED. Generic document get still requires an exact name." },
    { label: "replica", text: "Import the chart into Core and validate references against the copy, creating a second source of truth which can lag site permissions and chart changes." },
  ],
  chosen: "site-resolver",
  why: "books.chart-owner and books.annotate-site-chart keep ERPNext authoritative and require the saving person's permissions. Resolving a number is not an exact-name get, so a narrow internal resolver preserves the public document contract without storing accounts in Core.",
  source: "Books/sites/plugs interface agreement, 12 November 2026; blueprint/books/annotations.ts.",
  affects: [concept_sites, integration_frappe_site],
});

export const decision_sites_restore_identity = defineDecision({
  id: "sites.restore-identity", title: "Rebind site routing only inside the paused native world restore",
  question: "How does a cloned world retain durable site state while its world, host and bench identities change?",
  options: [
    { label: "offline-rewrite", text: "The recovery owner invokes rewriteSites with the existing migration-authority SQL connection while Core and the bench are paused. Require the saved sites and target company-to-host mapping to agree exactly; replace only world_id, host and bench. Preserve states, versions, failures, timestamps, feature rows, call receipts and the saved event cut. Normal provisioning continues to reject rebinding." },
    { label: "provision-again", text: "Treat restore as a fresh creation and replace durable site state, losing the saved lifecycle or incorrectly claiming a new ready transition." },
  ],
  chosen: "offline-rewrite",
  why: "A native restore preserves the accounting and event cut; changed host routing is recovery metadata, not a new site transition. Only the paused recovery path may change immutable serving identity. Missing mappings must fail before any row changes rather than silently leaving a source-world host.",
  source: "Sites/runtime integration agreement, 12 November 2026; devnet localRuntime.rewrite and whole-world recovery.",
  affects: [table_sites],
});

export const decision_sites_business_clock = defineDecision({
  id: "sites.business-clock", title: "Site rows use the world's clock inside their transaction",
  question: "Which instant dates site lifecycle, feature and document-call rows in a stopped world?",
  options: [
    { label: "transaction-clock", text: "Core supplies its canonical worldNow(Sql) authority to SitesStore. Each mutation reads it on the same checked-out tenant transaction before recording its rows and event. There is no host-time fallback. A missing or unsupported authority fails the transaction. Offline restore preserves the saved timestamps. Real elapsed time still bounds provider waits and transport freshness; it never becomes a business row instant." },
    { label: "host-clock", text: "Date the rows from the host clock even when the site's world is frozen, causing the business story to advance while its authority is stopped." },
  ],
  chosen: "transaction-clock",
  why: "aaron.world-clock and time.real-elapsed separate product instants from transport time. Injecting the existing Core authority keeps one clock and one SQL transaction without a site-service replica or a guessed running-clock calculation.",
  source: "Sites source review, 12 November 2026; canonical backend/devnet worldNow contract owned by Runtime.",
  affects: [table_sites, table_site_features, table_door_calls],
});

export const decision_sites_document_principal = defineDecision({
  id: "sites.document-principal", title: "Document admission uses the real Access principal and active Seat",
  question: "Which authority admits a public document request to a company's native site?",
  options: [
    { label: "access-seat", text: "Core injects authorization that authenticates the raw Bearer session and requires an active Seat on the same SQL transaction and actor context. The returned human Access principal supplies the native email; Sites reads the trusted host from its durable site row and Frappe verifies the actual site's Hat Grant and native permissions. Missing, expired or revoked sessions refuse before native calls. Mutation receipt keys bind the authenticated personId and public callId, not caller fields or email alone. The SDK supplies its current opaque bearer through a callback; no key, caller email, expiry or signature goes in the operation body. Agents explicitly refuse until a documented native-person delegation capability exists." },
    { label: "directory-key", text: "Treat a signing EOA found in org.people as sufficient authority even when its Access session or Seat has expired or been revoked." },
    { label: "bearer-and-signature", text: "Also require an EIP-191 proof matching Principal.signerAddress. Published Access intentionally gives humans a null signerAddress, so this refuses every human; an invented Safe-owner or directory-key binding cannot repair it." },
  ],
  chosen: "access-seat",
  why: "The canonical Access Principal to active Seat chain is authoritative. Human principals have an email but no signer binding; agents have a signer but no native email delegation. Bearer admission uses that real contract rather than guessing either binding. This supersedes the caller-signature admission mechanism in sites.door-retry-receipt, not its atomic native retry receipt. Frappe still checks current native permissions on every call and replay. Core alone composes the existing authorities; Sites implements neither authentication nor membership.",
  source: "Integrator's explicit Access56/Seat67 contract and Access owner's inspected Principal invariants, 12 November 2026. Dependency review and the composed selected run remain required.",
  affects: [concept_sites, rpc_sites_door_create, rpc_sites_door_get, rpc_sites_door_submit, rpc_sites_door_reports_run],
});
