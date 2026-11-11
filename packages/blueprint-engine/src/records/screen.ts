// What a person sees: a screen, on a Frappe site's desk or portal, or in the web app. It names where each value it shows
// comes from, what each button runs, who may open it, what it allows in each state, and the part it belongs to.

import { Schema } from "effect";
import { Common, Id, Line, make, Ref } from "./base.ts";

export const ScreenSpec = Schema.Struct({
  ...Common,
  surface: Schema.Literals(["frappe-desk", "frappe-portal", "web"]),
  kind: Schema.Literals(["form", "list", "report", "workspace", "page", "print-format"]),
  /** The DocType or table whose documents it shows, if any. */
  record: Schema.optionalKey(Schema.Union([Ref("doctype"), Ref("table")])),
  /** Each value it shows and where it comes from: a DocType or table field, a chain function or event, or an insight. */
  shows: Schema.Array(
    Schema.Struct({
      label: Line,
      from: Schema.Union([Ref("doctype"), Ref("table"), Ref("function"), Ref("chainEvent"), Ref("insight")]),
      /** The field of a DocType or table it reads. */
      field: Schema.optionalKey(Schema.String),
    }),
  ),
  /** Its buttons: each runs an operation, or a Frappe action named in words. */
  actions: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Id, runs: Schema.Union([Ref("operation"), Line]) }))),
  /** The roles that may open it; everyone else is refused. */
  who: Schema.Array(Ref("role")).pipe(Schema.check(Schema.isMinLength(1))),
  /** For a record with states: what it shows and which actions it allows in each. */
  states: Schema.optionalKey(Schema.Array(Schema.Struct({ state: Schema.String, shows: Line, allows: Schema.Array(Id) }))),
  /** The part it belongs to: when the part is off, the screen is closed. */
  feature: Schema.optionalKey(Ref("feature")),
});
export const defineScreen = make("screen")(ScreenSpec);
export type Screen = ReturnType<typeof defineScreen>;
