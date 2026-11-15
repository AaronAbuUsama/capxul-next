// The ways the document's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import * as Schema from "effect/Schema";

export class NotADraft extends refusal<NotADraft, { readonly brand: unique symbol }>()(
  "NotADraft",
  {
    doctype: Schema.String,
    name: Schema.String,
    docstatus: Schema.Int,
  },
  2,
) {}

export const refusals = { NotADraft } as const;
