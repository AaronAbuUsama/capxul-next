// What a hosted Frappe site holds that Capxul decides: the DocTypes its app defines or extends, and the roles people take
// in it (a role is a hat: the chain grants it, and it gives a fixed list of Frappe roles).
//
// A DocType record is checked against the code by the site app's agreement check: its fields, their types, links and
// flags, its naming and its permissions must be the DocType's JSON (for Capxul's own) or the Custom Fields the app adds
// (for Frappe's and ERPNext's). A role is checked against the hat map the app ships. A difference fails the merge.

import { Schema } from "effect";
import { Common, Line, make, Ref, Title } from "./base.ts";

/** Frappe's field types that Capxul uses. A new one is added here when a DocType needs it. */
export const FrappeFieldType = Schema.Literals([
  "Data", "Int", "Float", "Currency", "Check", "Select", "Link", "Dynamic Link", "Table", "Small Text", "Text",
  "Long Text", "Code", "JSON", "Password", "Date", "Datetime", "Attach",
]);

export const DoctypeField = Schema.Struct({
  /** Frappe's fieldname: `roles_given`. */
  name: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/))),
  type: FrappeFieldType,
  /** For a Link, the DocType it points at; for a Table, the child DocType its rows are. Every other type has none. */
  link: Schema.optionalKey(Ref("doctype")),
  /** A Select's choices, in order; a Code field's language (`["JSON"]`). */
  options: Schema.optionalKey(Schema.Array(Schema.String)),
  required: Schema.optionalKey(Schema.Boolean),
  unique: Schema.optionalKey(Schema.Boolean),
  readOnly: Schema.optionalKey(Schema.Boolean),
  /** Frappe's default, as Frappe stores it: a string (`"0"`, `"USDC"`). */
  default: Schema.optionalKey(Schema.String),
  about: Schema.optionalKey(Line),
});

export const DoctypePermission = Schema.Struct({
  /** A Frappe role: `System Manager`. */
  role: Schema.String,
  read: Schema.Boolean,
  write: Schema.Boolean,
  create: Schema.Boolean,
  delete: Schema.Boolean,
});

export const DoctypeSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  /** Frappe's name for it: `Capxul Hat Grant`. */
  name: Title,
  /** Whose DocType it is. For `frappe` and `erpnext`, `fields` lists only the Custom Fields Capxul's app adds to it. */
  app: Schema.Literals(["capxul", "frappe", "erpnext"]),
  /** One document per site (Frappe's `issingle`). */
  single: Schema.optionalKey(Schema.Boolean),
  /** Rows of another DocType's Table field (Frappe's `istable`). */
  child: Schema.optionalKey(Schema.Boolean),
  /** Frappe's `autoname`: `hash`, `field:event_key`, `format:CPR-{#####}`. */
  naming: Schema.optionalKey(Schema.String),
  fields: Schema.Array(DoctypeField),
  permissions: Schema.optionalKey(Schema.Array(DoctypePermission)),
  /** The decision that removes it: it is in the code today and is visible work until it goes. */
  retiredBy: Schema.optionalKey(Ref("decision")),
});
export const defineDoctype = make("doctype")(DoctypeSpec);
export type Doctype = ReturnType<typeof defineDoctype>;

export const RoleSpec = Schema.Struct({
  ...Common,
  concept: Ref("concept"),
  /** The Frappe roles the hat gives on a site. */
  frappeRoles: Schema.Array(Schema.String).pipe(Schema.check(Schema.isMinLength(1))),
});
/** A role a person takes in an Organization: a hat. Its id is the hat's name on chain (`budget-holder`). */
export const defineRole = make("role")(RoleSpec);
export type Role = ReturnType<typeof defineRole>;
