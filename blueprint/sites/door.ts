// The document door (aaron.one-door): how the CLI and SDK reach Frappe's documents, actions and reports, as the calling person and never
// around the door. Each verb is one rpc that asks the site to run the person's own call (the app sets the session user to the Frappe user a
// hat created, so Frappe's permissions, workflows and validations decide). A part that is switched off refuses with FEATURE_NOT_AVAILABLE.
// A Payment Entry from the Safe's account is money: its submit goes through the signer (plugs.held-payment) and is answered `held`, and its
// cancel is a reversal or an abandon (plugs.reversal-not-deletion). The money guard of the old document family is gone: normal Frappe
// transactions work normally (aaron.one-door). These records were written from the coordinator's list and then checked against the spike's
// door section (FINDINGS, The door, the recorder and the clock); sites.door-awaits-spike says what it showed and what it did not.

import { Schema } from "effect";
import { concept_sites } from "../shared/foundation.ts";
import {
  error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_NOT_AUTHENTICATED, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID, error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { integration_frappe_site } from "../plugs/integrations.ts";
import { procedure_plugs_payments_abandon, procedure_plugs_payments_hold } from "../plugs/signer.ts";
import { table_site_users } from "../plugs/data.ts";
import { N, Null, S, B, rpc } from "../plugs/kit.ts";
import { table_door_calls, table_site_features, table_sites } from "./data.ts";

const AWAITS = "Shown by the spike's door (FINDINGS, The door: how a person is reached; What the door reaches), which reached it as the person through a signed assertion with nothing stored. Idempotency by call id was not tried: the first door eval proves it.";
const WHO = "A person or an agent signed in to Capxul who has a site user in the Organization (a hat created it). Frappe then decides what that user may do.";
const ERRS = [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_FEATURE_NOT_AVAILABLE, error_INVALID_INPUT, error_PROVIDER_ERROR, error_PROVIDER_RESPONSE_INVALID] as const;
const TOUCH = { reads: [table_sites, table_site_users, table_site_features], writes: [table_door_calls], calls: [integration_frappe_site.c.doorCall] } as const;

const TOUCH_R = { ...TOUCH, calls: [integration_frappe_site.c.doorReport] } as const;
const Row = Schema.Record(S, Schema.Unknown);
const Doc = Schema.Struct({ doctype: S, name: S, docstatus: N, fields: Row });
const Held = Schema.Struct({ held: Schema.Literal(true), requestId: S, approvalId: S, awaiting: S });
const Ref = { orgId: S, doctype: S, name: S };

export const rpc_sites_door_types = rpc({
  id: "sites.door.types", title: "List the document types the caller may reach",
  about: `Lists the DocTypes the caller's Frappe user can read, by module, with the app and the part (feature) that owns each, and whether it is reachable now. A type of a part that is off is listed unreachable, not hidden. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ orgId: S, module: Null(S) }),
  output: Schema.Struct({ types: Schema.Array(Schema.Struct({ doctype: S, module: S, app: S, feature: S, reachable: B })) }), errors: [...ERRS], ...TOUCH,

  spans: ["rpc.sites.door.types"],
});
export const rpc_sites_door_schema = rpc({
  id: "sites.door.schema", title: "Describe one document type: its fields, links, workflow and actions",
  about: `The DocType's fields (name, type, required, options), the link types, the child tables, its Workflow's states and transitions and the whitelisted actions the door can call on it. It is how an agent learns what to send. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ orgId: S, doctype: S }),
  output: Schema.Struct({ doctype: S, fields: Schema.Array(Row), workflow: Null(Row), actions: Schema.Array(S) }), errors: [...ERRS], ...TOUCH,

  spans: ["rpc.sites.door.schema"],
});
export const rpc_sites_door_list = rpc({
  id: "sites.door.list", title: "List documents of a type, as the caller",
  about: `Lists documents with the filters, fields, order and limit given, as the caller: Frappe's own row-level permissions and user permissions decide which. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO,
  input: Schema.Struct({ orgId: S, doctype: S, filters: Null(S), fields: Schema.Array(S), orderBy: Null(S), limit: N }),
  output: Schema.Struct({ rows: Schema.Array(Row), more: B }), errors: [...ERRS], ...TOUCH,

  spans: ["rpc.sites.door.list"],
});
export const rpc_sites_door_get = rpc({
  id: "sites.door.get", title: "Read one document, as the caller",
  about: `One document by type and name, with its docstatus and fields. A document the caller may not read is ROLE_PERMISSION_DENIED; one that does not exist is INVALID_INPUT. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct(Ref), output: Doc, errors: [...ERRS], ...TOUCH,

  spans: ["rpc.sites.door.get"],
});
export const rpc_sites_door_create = rpc({
  id: "sites.door.create", title: "Create a document as a draft, as the caller",
  about: `Inserts a document from the fields given; Frappe's validations decide. A Payment Entry from the Safe's account is created as a draft like any other; it is held, not posted, when submitted. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ orgId: S, doctype: S, fields: Row, callId: S }), output: Doc, errors: [...ERRS], ...TOUCH,

  spans: ["rpc.sites.door.create"],
});
export const rpc_sites_door_update = rpc({
  id: "sites.door.update", title: "Change fields of a draft document, as the caller",
  about: `Saves the fields given on a document that is still a draft (or, for a document type that allows it, on submit). A submitted document is WRONG_STATE: amend it. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, fields: Row, callId: S }),
  output: Doc, errors: [...ERRS, error_WRONG_STATE], ...TOUCH,

  spans: ["rpc.sites.door.update"],
});
export const rpc_sites_door_delete = rpc({
  id: "sites.door.delete", title: "Delete a draft document, as the caller",
  about: `Deletes a draft; Frappe keeps its own Deleted Document record. A submitted document cannot be deleted (cancel it); a document a posted payment references is WRONG_STATE. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, callId: S }),
  output: Schema.Struct({ deleted: B }), errors: [...ERRS, error_WRONG_STATE], ...TOUCH,

  spans: ["rpc.sites.door.delete"],
});
export const rpc_sites_door_submit = rpc({
  id: "sites.door.submit", title: "Submit a document; a Payment Entry from the Safe is held for the signer",
  about: `Submits a draft: Frappe posts it to the ledger. For a Payment Entry whose paid-from account is the Safe's, nothing posts: the door holds the payment (plugs.payments.hold), answers held with the request, the approval and whose signature is awaited, and the entry posts when the chain confirms. Any other credit to the Safe's account is refused by the site. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, callId: S }), output: Schema.Union([Doc, Held]),
  errors: [...ERRS, error_WRONG_STATE], ...TOUCH, invokes: [procedure_plugs_payments_hold],

  spans: ["rpc.sites.door.submit"],
});
export const rpc_sites_door_cancel = rpc({
  id: "sites.door.cancel", title: "Cancel a submitted document; a paid Safe payment is a reversal",
  about: `Cancels a submitted document. A Payment Entry still waiting for the signer is abandoned (plugs.payments.abandon); one already sent cannot be un-sent, so its cancel is refused WRONG_STATE and the way back is a refund payment (plugs.reversal-not-deletion). ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, callId: S }), output: Doc,
  errors: [...ERRS, error_WRONG_STATE], ...TOUCH, invokes: [procedure_plugs_payments_abandon],

  spans: ["rpc.sites.door.cancel"],
});
export const rpc_sites_door_amend = rpc({
  id: "sites.door.amend", title: "Amend a cancelled document into a new draft",
  about: `Makes a new draft from a cancelled document (Frappe's amend), with a new name and, for a payment, a new hash and its own payment. A document that is not cancelled is WRONG_STATE. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, callId: S }), output: Doc,
  errors: [...ERRS, error_WRONG_STATE], ...TOUCH,

  spans: ["rpc.sites.door.amend"],
});
export const rpc_sites_door_call = rpc({
  id: "sites.door.call", title: "Call a document's action: a workflow step or a whitelisted method",
  about: `Applies a Workflow action to a document (approve, reject) or calls a whitelisted method on it, as the caller. Frappe tells apart a state that allows no action, a role the user lacks, a condition that refuses and a self-approval, and the refusal says which. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, action: S, args: Null(Row), callId: S }),
  output: Doc, errors: [...ERRS, error_WRONG_STATE], ...TOUCH,

  spans: ["rpc.sites.door.call"],
});
export const rpc_sites_door_next = rpc({
  id: "sites.door.next",
  title: "Make the next document in a chain from one",
  about: `Makes the next document from one with Frappe's own mapper (Quotation to Sales Order to Delivery Note to Sales Invoice, Material Request to Purchase Order), as a draft prefilled from the source. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ ...Ref, target: S, callId: S }), output: Doc, errors: [...ERRS, error_WRONG_STATE], ...TOUCH,

  spans: ["rpc.sites.door.next"],
});
export const rpc_sites_door_reports_list = rpc({
  id: "sites.door.reports-list", title: "List the reports the caller may run",
  about: `The reports of every part the caller's roles reach, with the part that owns each and whether it is reachable now. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ orgId: S, module: Null(S) }),
  output: Schema.Struct({ reports: Schema.Array(Schema.Struct({ report: S, module: S, feature: S, reachable: B })) }), errors: [...ERRS], ...TOUCH_R,

  spans: ["rpc.sites.door.reports-list"],
});
export const rpc_sites_door_reports_run = rpc({
  id: "sites.door.reports-run", title: "Run a report with filters, as the caller",
  about: `Runs a report (General Ledger, Accounts Receivable, Salary Register, Stock Balance) with the filters given and answers its columns and rows; reads only. A report of a part that is off is FEATURE_NOT_AVAILABLE. ${AWAITS}`,
  concept: concept_sites, kind: "action", who: WHO, input: Schema.Struct({ orgId: S, report: S, filters: Null(Row) }),
  output: Schema.Struct({ columns: Schema.Array(Row), rows: Schema.Array(Row) }), errors: [...ERRS], ...TOUCH_R, budget: { class: "vendor", p50Ms: 1500, p95Ms: 8000, why: "A report reads many rows on the site; the spike timed no report run, so this is an assumption the first report eval replaces with a measurement." },

  spans: ["rpc.sites.door.reports-run"],
});
