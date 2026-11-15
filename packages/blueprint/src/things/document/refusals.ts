// The ways the document's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";

export class NotADraft extends Schema.TaggedError<NotADraft, { readonly brand: unique symbol }>()("NotADraft", {
  doctype: Schema.String,
  // oxlint-disable-next-line effecttsgo/error-payload-shadows-name -- `name` is the Frappe document's name, part of the refusal's wire shape; renaming it changes the contract, which is the blueprint owner's call.
  name: Schema.String,
  docstatus: Schema.Int,
}) {}

export const refusals = { NotADraft } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  NotADraft: 2,
};
