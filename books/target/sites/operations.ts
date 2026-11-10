// The sites' operations: the site and its feature switches (six), and the document door (fourteen). Booked under rules.new-operations; the
// decisions in ./decisions.ts name aaron.one-door and aaron.frappe-native. The door's operations replace the old `org head doc` family and
// `org head app` group (cut.organizations); they were written from the coordinator's list and checked against the spike's door section (sites.door-awaits-spike).

import { budget } from "../../../packages/book/src/index.ts";
import {
  error_CLI_USAGE, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_ROLE_PERMISSION_DENIED, error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { WORLD, operation } from "../plugs/kit.ts";
import {
  rpc_sites_features_list, rpc_sites_features_off, rpc_sites_features_on, rpc_sites_open, rpc_sites_retry, rpc_sites_show,
} from "./sites.ts";
import * as door from "./door.ts";
import * as ex from "./examples.ts";

const out = { error: error_NOT_AUTHENTICATED, given: WORLD.signedOut, when: "No one is signed in on this machine." } as const;
const notDirector = (what: string) => ({ error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: `A member who does not wear the Director hat tries to ${what}; nothing changes.` }) as const;
const off = (what: string) => ({ error: error_FEATURE_NOT_AVAILABLE, given: WORLD.siteFeatures, when: `${what} a document of a part that is switched off for this company; the site refuses and nothing changes.` }) as const;
const noUser = { error: error_ROLE_PERMISSION_DENIED, given: WORLD.member, when: "The caller has no site user in this Organization (no hat created one): the door never runs a call as another user." } as const;
const down = { error: error_PROVIDER_ERROR, given: WORLD.siteDown, when: "The site's bench is stopped." } as const;

export const operation_org_site_show = operation({
  id: "org.site.show", title: "Show the Organization's site", area: "organizations", command: "org site show", priority: "critical", implementedBy: rpc_sites_show,
  about: "The site's state, its world, address, bench and versions, and why a failed creation failed. It reads Capxul's row, so it answers while the site is down. Replaces `org head show`.",
  who: "Any member of the Organization.", changes: "Nothing: it only reads.",
  acceptance: [
    { claim: "A new Organization's site becomes ready, with its world and address.", observes: `cli: after \`org create acme --world town1\` completes, \`org wait\` then \`org site show --json\` prints state ready, worldId town1 and host \`acme-town1.<base>\`; read: the site answers at that address.` },
    { claim: "A failed creation shows its reason.", observes: `cli: in \`${WORLD.siteCreating}\` with the service stopped, \`org site show\` prints state failed and the failure.` },
  ],
  examples: ex.siteShow,
  returns: rpc_sites_show.output, errors: [error_CLI_USAGE], refusals: [out, { error: error_INVALID_INPUT, given: WORLD.siteReady, when: "The Organization named does not exist." }], budget: budget("read"),
});

export const operation_org_site_open = operation({
  id: "org.site.open", title: "Say where to open the site and whether the caller can sign in", area: "organizations", command: "org site open", priority: "normal", implementedBy: rpc_sites_open,
  about: "Prints the site's address and whether the caller has a site user there. A person without one is told which hat they need. It opens nothing in a browser by itself; a person opens the address and signs in through Capxul.",
  who: "Any member of the Organization.", changes: "Nothing: it only reads.",
  acceptance: [
    { claim: "A person a hat created can sign in; one without a hat is told what they need.", observes: `cli: in \`${WORLD.hatsOnSite}\`, Hannah's \`org site open --json\` prints canSignIn true; Sam (no hat) prints canSignIn false and \`needs\` naming the hat; neither changes any row.` },
  ],
  examples: ex.siteOpen,
  returns: rpc_sites_open.output, errors: [error_CLI_USAGE], refusals: [out, { error: error_WRONG_STATE, given: WORLD.siteCreating, when: "The site is not ready yet." }], budget: budget("read"),
});

export const operation_org_site_retry = operation({
  id: "org.site.retry", title: "Run a failed site creation again", area: "organizations", command: "org site retry", priority: "normal", implementedBy: rpc_sites_retry,
  about: "Runs the safe-to-repeat creation again for a site that failed. It resends the Organization's events from number 1 when the site is new.",
  who: "The wearer of the Organization's Director hat.", changes: "The site goes back to creating; the creation process runs.",
  acceptance: [
    { claim: "A failed site is made, and the books agree with the chain afterwards.", observes: `cli: in \`${WORLD.siteCreating}\` after the service is back, \`org site retry --json\` prints creating; the site then becomes ready and \`org events status\` shows every event applied with no gap.` },
  ],
  examples: ex.siteRetry,
  returns: rpc_sites_retry.output, errors: [error_CLI_USAGE], refusals: [out, notDirector("retry the site"), { error: error_WRONG_STATE, given: WORLD.siteReady, when: "The site is not failed." }],
});

export const operation_org_feature_list = operation({
  id: "org.feature.list", title: "List the Organization's features", area: "organizations", command: "org feature list", priority: "critical", implementedBy: rpc_sites_features_list,
  about: "Every feature with its state, whether it is on by default and what it is. On by default: accounts (with banking), people (staff records, leave and expenses), projects, CRM. Installed but off: payroll (until the UK filing route is chosen). Off: WhatsApp sending, attendance, recruitment, reviews, stock, manufacturing.",
  who: "Any member of the Organization.", changes: "Nothing: it only reads.",
  acceptance: [
    { claim: "A new company has the base set on and the rest off.", observes: `cli: in \`${WORLD.siteReady}\`, \`org feature list --json\` prints accounts, people, projects and crm on, and payroll, whatsapp, attendance, recruitment, reviews, stock and manufacturing off.` },
  ],
  examples: ex.featureList,
  returns: rpc_sites_features_list.output, errors: [error_CLI_USAGE], refusals: [out], budget: budget("read"),
});

export const operation_org_feature_on = operation({
  id: "org.feature.on", title: "Make a feature reachable", area: "organizations", command: "org feature on", priority: "critical", implementedBy: rpc_sites_features_on,
  about: "Makes a part of the site reachable to the people whose hats give a role in it. Only the Director hat may. Every supported app is already installed on every site, so nothing is installed: a switch controls only what is reachable. WhatsApp needs CRM.",
  who: "The wearer of the Organization's Director hat.", changes: "The feature goes to switching and then on; the site's request guard stops refusing it.",
  acceptance: [
    { claim: "A feature turned on becomes reachable and shows everything that was there.", observes: `cli: in \`${WORLD.siteFeatures}\`, after \`org feature off stock\` and \`org feature on stock --json\` prints switching then on; read: \`doc list "Stock Entry"\` works again and lists the entries made before it was off.` },
    { claim: "WhatsApp cannot be turned on without CRM, and the reason is said first.", observes: `cli: with crm off, \`org feature on whatsapp\` exits WRONG_STATE naming CRM; world: no row changes.` },
  ],
  examples: ex.featureOn,
  returns: rpc_sites_features_on.output, errors: [error_CLI_USAGE],
  refusals: [out, notDirector("turn a feature on"), { error: error_WRONG_STATE, given: WORLD.siteFeatures, when: "WhatsApp is turned on while CRM is off." }, { error: error_INVALID_INPUT, given: WORLD.siteFeatures, when: "The feature is not one of the eleven." }],
  budget: budget("write"),
});

export const operation_org_feature_off = operation({
  id: "org.feature.off", title: "Close a feature, keeping its data", area: "organizations", command: "org feature off", priority: "critical", implementedBy: rpc_sites_features_off,
  about: "Closes a part's screens and API: every request to it refuses with FEATURE_NOT_AVAILABLE, through the door and in the browser. Every record stays. It does not stop the bench, a scheduled job, a Server Script or a raw database read (sites.features-reachability).",
  who: "The wearer of the Organization's Director hat.", changes: "The feature goes to switching and then off.",
  acceptance: [
    { claim: "A feature turned off refuses everywhere it can be reached and keeps its data.", observes: `cli: in \`${WORLD.siteFeatures}\`, \`org feature off projects --json\` prints switching then off; \`doc list Project\` exits FEATURE_NOT_AVAILABLE; a browser request to a Project API route answers 403; \`org feature on projects\` then lists every project that was there.` },
    { claim: "CRM cannot be turned off while WhatsApp is on.", observes: "cli: `org feature off crm` with whatsapp on exits WRONG_STATE naming WhatsApp; world: no row changes." },
  ],
  examples: ex.featureOff,
  returns: rpc_sites_features_off.output, errors: [error_CLI_USAGE],
  refusals: [out, notDirector("turn a feature off"), { error: error_WRONG_STATE, given: WORLD.siteFeatures, when: "CRM is turned off while WhatsApp is on." }], budget: budget("write"),
});

// ── the document door ───────────────────────────────────────────────────────────────────────

const DOOR_EXAMPLES: Record<string, never> = {
  "doc.types": ex.docTypes as never,
  "doc.schema": ex.docSchema as never,
  "doc.list": ex.docList as never,
  "doc.get": ex.docGet as never,
  "doc.create": ex.docCreate as never,
  "doc.update": ex.docUpdate as never,
  "doc.delete": ex.docDelete as never,
  "doc.submit": ex.docSubmit as never,
  "doc.cancel": ex.docCancel as never,
  "doc.amend": ex.docAmend as never,
  "doc.call": ex.docCall as never,
  "doc.next": ex.docNext as never,
  "report.list": ex.reportList as never,
  "report.run": ex.reportRun as never,
};

const doorOp = (
  id: string, command: string, title: string, about: string, rpcRec: { output: unknown }, impl: never, changes: string, claims: { claim: string; observes: string }[],
  extra: { error: never; given: string; when: string }[] = [], priority: "critical" | "normal" = "normal",
) =>
  operation({
    id, title, area: "sites", command, priority, implementedBy: impl, about: `${about} Runs as the calling person; Frappe's permissions decide. Checked against the spike's door (sites.door-awaits-spike).`,
    who: "A person or an agent whose Frappe user a hat created.", changes, examples: DOOR_EXAMPLES[id], acceptance: claims, returns: rpcRec.output as never, errors: [error_CLI_USAGE],
    refusals: [out, noUser, off("The call reaches"), down, ...extra],
  } as never);

export const operation_doc_types = doorOp("doc.types", "doc types", "List the document types the caller may reach", "Lists the DocTypes the caller can read, with the part that owns each and whether it is reachable now.", door.rpc_sites_door_types, door.rpc_sites_door_types as never, "Nothing: it only reads.", [
  { claim: "A type of a part that is off is listed unreachable, not hidden.", observes: `cli: in \`${WORLD.siteFeatures}\`, \`doc types --json\` lists Project with reachable false and Sales Invoice with reachable true.` },
], [], "critical");
export const operation_doc_schema = doorOp("doc.schema", "doc schema", "Describe one document type", "Its fields, links, child tables, workflow states and the actions the door can call on it, so an agent knows what to send.", door.rpc_sites_door_schema, door.rpc_sites_door_schema as never, "Nothing: it only reads.", [
  { claim: "The schema names required fields and the workflow's actions.", observes: `cli: \`doc schema "Purchase Invoice" --json\` lists supplier as required and the actions a workflow allows.` },
]);
export const operation_doc_list = doorOp("doc.list", "doc list", "List documents of a type", "Lists documents with filters, fields, order and a limit.", door.rpc_sites_door_list, door.rpc_sites_door_list as never, "Nothing: it only reads.", [
  { claim: "A person sees only what Frappe's permissions let them see.", observes: `cli: in \`${WORLD.hatsOnSite}\`, Hannah's \`doc list "Purchase Invoice" --json\` lists the invoices her roles may read and not those of a department she is limited from.` },
], [], "critical");
export const operation_doc_get = doorOp("doc.get", "doc get", "Read one document", "One document by type and name, with its docstatus and fields.", door.rpc_sites_door_get, door.rpc_sites_door_get as never, "Nothing: it only reads.", [
  { claim: "A document is read as the caller, with its status.", observes: `cli: \`doc get "Purchase Invoice" ACC-PINV-2026-00001 --json\` prints docstatus and fields; a document that does not exist exits INVALID_INPUT.` },
], [{ error: error_INVALID_INPUT as never, given: WORLD.siteReady, when: "The document does not exist." }], "critical");
export const operation_doc_create = doorOp("doc.create", "doc create", "Create a document as a draft", "Inserts a document from the fields given.", door.rpc_sites_door_create, door.rpc_sites_door_create as never, "One draft document on the site.", [
  { claim: "A document is created as a draft and Frappe's validations apply.", observes: `cli: in \`${WORLD.hatsOnSite}\`, the Director's \`doc create Supplier --field supplier_name="Brightside Cleaning Ltd"\` prints the new name; a member without the role exits ROLE_PERMISSION_DENIED and nothing is made.` },
], [{ error: error_INVALID_INPUT as never, given: WORLD.siteReady, when: "A required field is missing or a link does not resolve." }], "critical");
export const operation_doc_update = doorOp("doc.update", "doc update", "Change a draft document", "Saves the fields given on a draft.", door.rpc_sites_door_update, door.rpc_sites_door_update as never, "The draft's fields.", [
  { claim: "A draft is changed; a submitted document must be amended.", observes: "cli: `doc update` on a draft prints the new fields; on a submitted document it exits WRONG_STATE." },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "The document is submitted." }]);
export const operation_doc_delete = doorOp("doc.delete", "doc delete", "Delete a draft document", "Deletes a draft; Frappe keeps its Deleted Document record.", door.rpc_sites_door_delete, door.rpc_sites_door_delete as never, "The draft is gone.", [
  { claim: "A draft is deleted and a submitted document is not.", observes: "cli: `doc delete` on a draft prints deleted true; on a submitted document it exits WRONG_STATE." },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "The document is submitted, or a posted payment references it." }]);
export const operation_doc_submit = doorOp("doc.submit", "doc submit", "Submit a document; a Safe payment is held for the signer", "Submits a draft so Frappe posts it. A Payment Entry from the Safe's account is not posted: it is held and the signer is named.", door.rpc_sites_door_submit, door.rpc_sites_door_submit as never, "The document is submitted, or a held payment is waiting for its signature.", [
  { claim: "An ordinary document posts to the ledger when submitted.", observes: `cli: \`doc submit "Purchase Invoice" ACC-PINV-2026-00001\` prints docstatus 1; read: \`report run "General Ledger"\` shows its lines.` },
  { claim: "A Payment Entry from the Safe is held, not posted, and the signer is named.", observes: `cli: in \`${WORLD.held}\`, \`doc submit "Payment Entry" ACC-PAY-2026-00001 --json\` prints held true, an approvalId and \`awaiting\`; read: no ledger line yet; after the signature lands it posts once.` },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "The document is not a draft." }], "critical");
export const operation_doc_cancel = doorOp("doc.cancel", "doc cancel", "Cancel a submitted document", "Cancels a submitted document; a waiting Safe payment is abandoned and a sent one cannot be un-sent.", door.rpc_sites_door_cancel, door.rpc_sites_door_cancel as never, "The document is cancelled, or a waiting payment abandoned.", [
  { claim: "A waiting payment is abandoned; a sent one refuses and the way back is a refund.", observes: `cli: in \`${WORLD.held}\`, \`doc cancel\` on the waiting entry abandons it and withdraws the approval; on one already sent it exits WRONG_STATE and money is unchanged.` },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "A payment already sent, or a document not submitted." }]);
export const operation_doc_amend = doorOp("doc.amend", "doc amend", "Amend a cancelled document into a new draft", "Makes a new draft from a cancelled document.", door.rpc_sites_door_amend, door.rpc_sites_door_amend as never, "One new draft.", [
  { claim: "An amended document is a new draft with a new name.", observes: "cli: `doc amend` on a cancelled document prints a new name ending -1; on a document not cancelled it exits WRONG_STATE." },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "The document is not cancelled." }]);
export const operation_doc_call = doorOp("doc.call", "doc call", "Apply a workflow action or call a document's method", "Applies a Workflow action or a whitelisted method on a document.", door.rpc_sites_door_call, door.rpc_sites_door_call as never, "The document's workflow state or what the method does.", [
  { claim: "A workflow action is applied by a person its roles allow, and refused with the real reason otherwise.", observes: `cli: the approver's \`doc call "Expense Claim" EXP-1 --action Approve\` prints the new workflow state; the claimant's own approval is refused naming self-approval.` },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "The state allows no such action." }]);
export const operation_doc_next = doorOp("doc.next", "doc next", "Make the next document in a chain", "Makes the next document from one with Frappe's own mapper.", door.rpc_sites_door_next, door.rpc_sites_door_next as never, "One new draft prefilled from the source.", [
  { claim: "A won deal becomes a quotation and onwards as drafts.", observes: `cli: \`doc next Quotation QTN-1 --to "Sales Order"\` prints a Sales Order draft with the quotation's items; the quotation is unchanged.` },
], [{ error: error_WRONG_STATE as never, given: WORLD.siteReady, when: "The source cannot be mapped to that target in its state." }]);
export const operation_report_list = doorOp("report.list", "report list", "List the reports the caller may run", "The reports of every part the caller reaches, with whether each is reachable now.", door.rpc_sites_door_reports_list, door.rpc_sites_door_reports_list as never, "Nothing: it only reads.", [
  { claim: "A report of a part that is off is listed unreachable.", observes: `cli: in \`${WORLD.siteFeatures}\`, \`report list --json\` lists Stock Balance with reachable false.` },
]);
export const operation_report_run = doorOp("report.run", "report run", "Run a report with filters", "Runs a report and prints its columns and rows; reads only.", door.rpc_sites_door_reports_run, door.rpc_sites_door_reports_run as never, "Nothing: it only reads.", [
  { claim: "A report runs as the caller and the books agree with the chain.", observes: `cli: \`report run "General Ledger" --filter account="Capxul Safe"\` prints a ledger whose total equals the Safe's balance on chain at the world's now; a report of an off part exits FEATURE_NOT_AVAILABLE.` },
], [{ error: error_INVALID_INPUT as never, given: WORLD.siteReady, when: "No such report, or a filter it does not take." }], "critical");
