// The document family (aaron.sdk-reaches-everything): the Core SDK and the CLI reach what lives only
// on a connected Frappe head (recruitment, appraisal, training, onboarding, a Helpdesk ticket, any
// other app's documents) through one generic family, `org head doc list|get|create|change|submit|cancel|
// amend|apply|remove <DocType>` and `org head doctype list|get`, each one SDK method over one rpc here
// (organizations.doc-family). Every call goes through Capxul's backend to the head's Capxul app and
// runs there as the member's own head User, found by mailbox, so the head's permissions decide
// (organizations.doc-authority); it never reaches a DocType a native concept owns or one that is
// money (organizations.doc-reach); and every call is logged in `org-doc-calls`, on the world's clock
// (organizations.doc-log). The React SDK does not mirror it.
//
// The head's family methods are the `frappe-head` integration's `docRead` and `docWrite`: each read
// rpc calls `docRead` and each write `docWrite` (shared/external.ts).

import { Schema } from "effect";
import { budget, defineRpc } from "../../../packages/book/src/index.ts";
import { concept_organizations } from "../shared/foundation.ts";
import { integration_frappe_head } from "../shared/external.ts";
import {
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROVIDER_ERROR,
  error_PROVIDER_RESPONSE_INVALID,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  DocVerb,
  table_org_apps,
  table_org_deployments,
  table_org_doc_calls,
  table_org_fde_asks,
  table_org_members,
} from "./data.ts";
import { table_hat_wearers } from "../indexing/data.ts";
import { table_parties } from "../parties/data.ts";
import { MEMBER_GUARD } from "./apps.ts";

const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullOr = Schema.NullOr;
const opt = Schema.optionalKey;
const RULING = "books/target/shared/rulings.ts (aaron.sdk-reaches-everything, aaron.frappe-head); organizations.doc-family";
const FRAPPE =
  "/tmp/frappe/frappe/api/v2.py (document routes); /tmp/frappe/frappe/client.py (submit, cancel, delete); " +
  "frappe/model/workflow.py (validate_workflow, set_workflow_state_on_action, run_workflow_transition, has_approval_access), " +
  "document.py (check_if_latest, validate_amended_from), naming.py (_set_amended_name), delete_doc.py (check_if_doc_is_linked), " +
  "read from git objects at github.com/frappe/frappe@1a7ea577";

// ── shapes ──────────────────────────────────────────────────────────────────────────────────

/** A document's fields as the head User may read them: Frappe's field names, child tables as arrays of rows. */
const Fields = Schema.Record(S, Schema.Unknown);

/** What the caller's head User may do to a document, as Frappe's permissions answer for them. */
const DocPermissions = Schema.Struct({ read: B, write: B, submit: B, cancel: B, amend: B, remove: B });

/** One document as `org head doc get` prints it, and every write prints it after the change. */
export const DocView = Schema.Struct({
  doctype: S,
  /** The head's name for it: the id every other `org head doc` command takes. Capxul has no id of its own for it. */
  name: S,
  /** Frappe's docstatus (0 draft, 1 submitted, 2 cancelled), and the same in words. */
  docstatus: N,
  status: Schema.Literals(["draft", "submitted", "cancelled"]),
  /** Its Workflow's state, when its DocType has an active Workflow; else null. */
  workflowState: NullOr(S),
  /** The head User who made it, and the head's stamps: `modified` is what `org head doc change --modified` checks against. */
  owner: S,
  creation: S,
  modified: S,
  amendedFrom: NullOr(S),
  fields: Fields,
  /** The Workflow actions the caller's head User may take now (`org head doc apply`). */
  actions: Schema.Array(S),
  permissions: DocPermissions,
  /** The call that read or wrote it, as `org head doc-call list` prints it. */
  callId: S,
});

/** One row of `org head doc list`: the name, the stamps, and the fields asked for (by default the DocType's list-view fields). */
const DocSummary = Schema.Struct({ doctype: S, name: S, docstatus: N, modified: S, fields: Fields });

/** Why the family does or does not reach a DocType (organizations.doc-reach). */
const Reach = Schema.Literals(["reachable", "native", "money", "machinery", "child"]);

const DoctypeSummary = Schema.Struct({
  doctype: S,
  app: S,
  module: S,
  submittable: B,
  single: B,
  reach: Reach,
  /** For a native DocType, the commands that reach it instead (`org hr employee`); else null. */
  commands: NullOr(S),
});

const DocField = Schema.Struct({
  fieldname: S,
  label: NullOr(S),
  fieldtype: S,
  /** A Link's DocType, a Select's choices, a Table's child DocType. */
  options: NullOr(S),
  required: B,
  readOnly: B,
  allowOnSubmit: B,
});

/** A DocType as `org head doctype get` prints it. */
export const DoctypeView = Schema.Struct({
  ...DoctypeSummary.fields,
  /** Its naming rule, as Frappe's `autoname` gives it, and its title field. */
  naming: NullOr(S),
  titleField: NullOr(S),
  fields: Schema.Array(DocField),
  tables: Schema.Array(Schema.Struct({ field: S, doctype: S, fields: Schema.Array(DocField) })),
  workflow: NullOr(
    Schema.Struct({
      name: S,
      stateField: S,
      states: Schema.Array(Schema.Struct({ state: S, docstatus: N })),
      actions: Schema.Array(Schema.Struct({ action: S, from: S, to: S })),
    }),
  ),
  /** What the caller's head User may do with this DocType. */
  permissions: Schema.Struct({ read: B, write: B, create: B, submit: B, cancel: B, amend: B, remove: B }),
  callId: S,
});

/** One logged call as `org head doc-call list` prints it. */
export const DocCallView = Schema.Struct({
  callId: S,
  verb: DocVerb,
  doctype: NullOr(S),
  name: NullOr(S),
  /** Whose authority it ran with, by member id; and the ask, when the hosted FDE made it for them. */
  memberId: S,
  askId: NullOr(S),
  headUser: NullOr(S),
  outcome: Schema.Literals(["done", "refused"]),
  code: NullOr(S),
  reason: NullOr(S),
  fieldNames: Schema.Array(S),
  count: NullOr(N),
  headModified: NullOr(S),
  docstatus: NullOr(N),
  at: N,
  /** When a retry completed a call the head had not answered; null otherwise. */
  completedAt: NullOr(N),
});

/** One `--filter <field><op><value>`: the CLI's `~` is like and `!~` not like, with Frappe's `%` wildcards in the value. */
const Filter = Schema.Struct({
  field: S,
  op: Schema.Literals(["=", "!=", ">", ">=", "<", "<=", "like", "not like"]),
  value: S,
});

/** Every family call carries the id its SDK method made once and repeats on a retry. */
const Call = { orgId: S, callId: S };
const OneDoc = { ...Call, doctype: S, name: S };

// ── the guards, in the order every family rpc runs them ─────────────────────────────────────

/** Who: a person member, as their own head User; the head's permissions decide (organizations.doc-authority). */
export const WHO_HEAD_USER =
  "Any person who is a member of the Organization, acting on the head as their own User (matched by their mailbox), " +
  "with the roles their hats give at that moment: the head's own permissions decide what that User may do. An agent " +
  "has no User on the head; the hosted FDE acts as the member who asked it (aaron.fde-anyone).";

const HEAD_GUARD =
  `${MEMBER_GUARD} The Seat must be a person's (an agent has no head User: ROLE_PERMISSION_DENIED) and the head ` +
  "connected (none, or one connecting or failing: WRONG_STATE, and nothing is called).";

const REACH_GUARD =
  "The DocType must be one the family reaches (organizations.doc-reach): Capxul refuses the ones it names before any " +
  "call, the head's app the rest (one it lacks, a child table, a native module's, money), each INVALID_INPUT saying " +
  "why and naming a native one's commands.";

const AS_USER =
  "It runs on the head as the member's own User (mailbox and member id), with the roles their hats give now " +
  "(organizations.doc-authority), under Frappe's own permissions and validations: not permitted is ROLE_PERMISSION_DENIED; a name, field or value the head " +
  "refuses, INVALID_INPUT with its message; a step its docstatus, Workflow or links forbid, WRONG_STATE.";

const LOGGED =
  "It is logged once, done or refused, in `org-doc-calls` at the world's now; a logged call id answers as logged " +
  "unless the head never answered it (organizations.doc-log).";

const WRITE_ONCE = "Its `docWrite` is idempotent by the call id, so a retry never writes twice.";

const CLOCK =
  "The head stamps it with its own now, the world's (organizations.head-clock, devnet.head-follows-world).";

/** The head's failures, as the `frappe-head` integration maps them; a Capxul app older than the family is WRONG_STATE. */
const HEAD_FAILURES = [error_PROVIDER_ERROR, error_RATE_LIMITED, error_PROVIDER_RESPONSE_INVALID] as const;
const ERRORS = [
  error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT, error_WRONG_STATE, ...HEAD_FAILURES,
] as const;
const READS = [
  table_org_members, table_org_fde_asks, table_parties, table_org_deployments, table_hat_wearers, table_org_apps,
  table_org_doc_calls,
] as const;

const familyRpc = (spec: {
  id: string;
  title: string;
  about: string;
  input: Schema.Top;
  output: Schema.Top;
  write?: boolean;
}) =>
  defineRpc({
    id: spec.id,
    title: spec.title,
    about: spec.about,
    was: [RULING, FRAPPE],
    concept: concept_organizations,
    kind: "action",
    who: WHO_HEAD_USER,
    input: spec.input,
    output: spec.output,
    errors: [...ERRORS],
    reads: [...READS],
    writes: [table_org_doc_calls],
    drives: [],
    invokes: [],
    emits: [],
    calls: [spec.write ? integration_frappe_head.c.docWrite : integration_frappe_head.c.docRead],
    chain: [],
    spans: [],
    budget: spec.write
      ? { ...budget("vendor"), why: "one write to the head (Frappe's own validations run there) before one log write" }
      : { ...budget("vendor"), why: "one read of the head before one log write" },
  });

// ── documents ───────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_docs_list = familyRpc({
  id: "organizations.docs.list",
  title: "List a head DocType's documents as the member's own head User sees them",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It reads one page through the integration's \`docRead\` (Frappe's document list, ` +
    "with its permission query conditions, so a User sees only the documents the head lets them see): the filters given " +
    "applied together, the fields asked for (by default the name, docstatus, `modified` and the DocType's list-view " +
    "fields), ordered by a field (by default `modified`, newest change first), then by name (a frozen clock stamps " +
    "many at one instant). Pages are 20 by default (`limit` 1 to " +
    "100); `nextCursor` is the `after` of the next page, null on the last. A filter or field the DocType does not have, " +
    `a limit outside 1 to 100, or a cursor this list did not issue, is INVALID_INPUT. ${AS_USER} ${LOGGED}`,
  input: Schema.Struct({
    ...Call,
    doctype: S,
    filters: opt(Schema.Array(Filter)),
    fields: opt(Schema.Array(S)),
    orderBy: opt(S),
    ascending: opt(B),
    limit: opt(N),
    after: opt(S),
  }),
  output: Schema.Struct({ items: Schema.Array(DocSummary), nextCursor: NullOr(S), callId: S }),
});

export const rpc_organizations_docs_get = familyRpc({
  id: "organizations.docs.get",
  title: "Read one head document, its child rows, its Workflow actions and permissions",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It reads the document through \`docRead\`: every field the User may read (Frappe's ` +
    "field-level permissions mask the rest), its child tables' rows, its docstatus and Workflow state, the Workflow " +
    "actions the User may take now, and what the User may do to it (write, submit, cancel, amend, remove). `fields` " +
    `narrows what is printed. A name the head does not have, or one the User may not read, is INVALID_INPUT. ${AS_USER} ` +
    LOGGED,
  input: Schema.Struct({ ...OneDoc, fields: opt(Schema.Array(S)) }),
  output: DocView,
});

export const rpc_organizations_docs_create = familyRpc({
  id: "organizations.docs.create",
  title: "Create a document on the head, as the member's own head User",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It inserts a new document through \`docWrite\` with the fields given (child tables ` +
    "as arrays of rows; a Capxul Custom Field such as `capxul_id` is never set here), as a draft when its DocType is " +
    "submittable. Frappe names it, sets its defaults, fetches linked fields and runs its validations; a missing " +
    "mandatory field, a link to nothing or a value of the wrong type is INVALID_INPUT with Frappe's message, and " +
    `nothing is made. It answers the document as made, with the name to use from then on. ${WRITE_ONCE} ${AS_USER} ` +
    `${CLOCK} ${LOGGED}`,
  input: Schema.Struct({ ...Call, doctype: S, fields: Fields }),
  output: DocView,
  write: true,
});

export const rpc_organizations_docs_change = familyRpc({
  id: "organizations.docs.change",
  title: "Change a head document's fields, never its docstatus",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It saves the document through \`docWrite\` with the fields given and those in ` +
    "`clear` emptied, keeping the rest; nothing given, or `docstatus`, `name`, `owner` or a stamp, is INVALID_INPUT. " +
    "A submitted document takes only its allow-on-submit fields, a cancelled one none (else WRONG_STATE). With " +
    "`modified`, a read's stamp, a document changed since is WRONG_STATE (Frappe's timestamp check, `check_if_latest`) " +
    `and nothing is written (it sees only a change at a later world instant). ${WRITE_ONCE} ${AS_USER} ${CLOCK} ${LOGGED}`,
  input: Schema.Struct({ ...OneDoc, fields: opt(Fields), clear: opt(Schema.Array(S)), modified: opt(S) }),
  output: DocView,
  write: true,
});

export const rpc_organizations_docs_submit = familyRpc({
  id: "organizations.docs.submit",
  title: "Submit a draft head document",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It submits the document through \`docWrite\` (Frappe's \`submit\`): a draft of a ` +
    "submittable DocType becomes submitted, its `on_submit` running on the head. A DocType that is not submittable is " +
    "INVALID_INPUT; a document already submitted or cancelled, or one whose DocType has an active Workflow, is " +
    "WRONG_STATE naming its status (the last is the Capxul app's refusal: Frappe's server would let the submit skip " +
    "the Workflow's transitions); a validation the submit runs is INVALID_INPUT. " +
    `${WRITE_ONCE} ${AS_USER} ${CLOCK} ${LOGGED}`,
  input: Schema.Struct(OneDoc),
  output: DocView,
  write: true,
});

export const rpc_organizations_docs_cancel = familyRpc({
  id: "organizations.docs.cancel",
  title: "Cancel a submitted head document",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It cancels the document through \`docWrite\` (Frappe's \`cancel\`): a submitted ` +
    "document becomes cancelled for good, its `on_cancel` running on the head; it is kept, and `org head doc amend` makes " +
    "its correction. A draft, one already cancelled, one under an active Workflow (refused by the Capxul app, as a " +
    "submit is), or one that submitted documents still link to (Frappe names them), is WRONG_STATE. " +
    `${WRITE_ONCE} ${AS_USER} ${CLOCK} ${LOGGED}`,
  input: Schema.Struct(OneDoc),
  output: DocView,
  write: true,
});

export const rpc_organizations_docs_amend = familyRpc({
  id: "organizations.docs.amend",
  title: "Amend a cancelled head document into a new draft",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It makes the amendment through \`docWrite\`, as Frappe's Amend does: a copy of a ` +
    "cancelled document, a draft whose `amended_from` names it, named by the head's rule (Frappe's default Amend " +
    "Counter: `<name>-1`, an amendment's amendment `<name>-2`; Default Naming: the series' next). Only a cancelled " +
    "document is amended (else WRONG_STATE, as `validate_amended_from` refuses), by a User Frappe lets amend. It " +
    `answers the new draft. ${WRITE_ONCE} ${AS_USER} ${CLOCK} ${LOGGED}`,
  input: Schema.Struct(OneDoc),
  output: DocView,
  write: true,
});

export const rpc_organizations_docs_apply = familyRpc({
  id: "organizations.docs.apply",
  title: "Take one Workflow action on a head document",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It applies the action through \`docWrite\` (Frappe's \`apply_workflow\`): the ` +
    "document moves to the action's next state, and submits or cancels when that state's docstatus says so. The " +
    "DocType must have an active Workflow (else INVALID_INPUT); an action that is not one of the document's current " +
    "state's transitions is WRONG_STATE naming its state; one the User's roles, the condition or a ban on " +
    "self-approval refuse is ROLE_PERMISSION_DENIED (the app tells these apart, which Frappe does not). " +
    `${WRITE_ONCE} ${AS_USER} ${CLOCK} ${LOGGED}`,
  input: Schema.Struct({ ...OneDoc, action: S }),
  output: DocView,
  write: true,
});

export const rpc_organizations_docs_remove = familyRpc({
  id: "organizations.docs.remove",
  title: "Delete a head document that is not submitted",
  about:
    `${HEAD_GUARD} ${REACH_GUARD} It deletes the document through \`docWrite\` (Frappe's \`delete_doc\`, as the ` +
    "desk's Delete): a draft, a cancelled document, or one of a DocType that is not submittable. A submitted document is " +
    "WRONG_STATE (cancel it first), and so is one that a document not cancelled still links to (Frappe's " +
    "`check_if_doc_is_linked`). The hosted FDE's call is " +
    "ROLE_PERMISSION_DENIED: the preview is the member's own (organizations.fde-for-the-asker). The head keeps its " +
    `Deleted Document record; Capxul keeps only the log. ${WRITE_ONCE} ${AS_USER} ${LOGGED}`,
  input: Schema.Struct(OneDoc),
  output: Schema.Struct({ doctype: S, name: S, removed: Schema.Literal(true), callId: S }),
  write: true,
});

// ── DocTypes ────────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_doctypes_list = familyRpc({
  id: "organizations.doctypes.list",
  title: "The head's DocTypes, and whether the family reaches each one",
  about:
    `${HEAD_GUARD} It reads the head's DocTypes through \`docRead\`, every installed app's but child tables, and says ` +
    "of each whether the family reaches it or why not (native, with the commands that reach it; money; the head's " +
    "machinery), by the rules of organizations.doc-reach. By default it lists only those it reaches; `all` lists the " +
    "rest too. `app` and `module` narrow it. Pages are 50 by default, by name (`limit` 1 to 200), with `nextCursor` " +
    `as every list's; an unknown app or module, a bad limit or cursor is INVALID_INPUT. ${AS_USER} ${LOGGED}`,
  input: Schema.Struct({ ...Call, app: opt(S), module: opt(S), all: opt(B), limit: opt(N), after: opt(S) }),
  output: Schema.Struct({ items: Schema.Array(DoctypeSummary), nextCursor: NullOr(S), callId: S }),
});

export const rpc_organizations_doctypes_get = familyRpc({
  id: "organizations.doctypes.get",
  title: "One head DocType's fields, child tables, Workflow and the member's rights",
  about:
    `${HEAD_GUARD} It reads one DocType's meta through \`docRead\`: its app and module, whether it is submittable or ` +
    "single, its naming rule and title field, its fields (name, label, type, options, mandatory, read-only, " +
    "allow-on-submit) and each child table's, its active Workflow's states and actions, what the User may do with it, " +
    "and whether the family reaches it or why not. It describes any DocType the head has, a native or a money one " +
    "included, since it reads no document; one the head does not have is INVALID_INPUT. " +
    `${AS_USER} ${LOGGED}`,
  input: Schema.Struct({ ...Call, doctype: S }),
  output: DoctypeView,
});

// ── the log ─────────────────────────────────────────────────────────────────────────────────

export const rpc_organizations_doc_calls_list = defineRpc({
  id: "organizations.doc-calls.list",
  title: "The document family's log: who reached the head's documents, how, and when",
  about:
    `${MEMBER_GUARD} A Director (the Director hat, from indexing) reads every call; any other member reads the calls ` +
    "made with their own authority, the hosted FDE's for them included. Newest first, narrowed by `doctype`, `name` " +
    "(with `doctype`) and, for a Director, `member` (an email or an agent's @handle, as `org member get` takes). Pages " +
    "are 25 by default (`limit` 1 to 100) with `nextCursor` as every list's; a name without a DocType, a member who is " +
    "none here, a bad limit or cursor, or `member` from someone who is not a Director, is INVALID_INPUT. It never calls " +
    "the head and never writes.",
  was: [RULING],
  concept: concept_organizations,
  kind: "query",
  who:
    "Any member of the Organization: a Director reads every call; anyone else the calls made with their own authority " +
    "(organizations.doc-log).",
  input: Schema.Struct({
    orgId: S,
    doctype: opt(S),
    name: opt(S),
    member: opt(S),
    limit: opt(N),
    after: opt(S),
  }),
  output: Schema.Struct({ items: Schema.Array(DocCallView), nextCursor: NullOr(S) }),
  errors: [error_NOT_AUTHENTICATED, error_ROLE_PERMISSION_DENIED, error_INVALID_INPUT],
  reads: [table_org_members, table_org_deployments, table_hat_wearers, table_parties, table_org_doc_calls],
  writes: [],
  drives: [],
  invokes: [],
  emits: [],
  calls: [],
  chain: [],
  spans: [],
  budget: budget("read"),
});
