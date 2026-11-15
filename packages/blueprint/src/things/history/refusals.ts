// The ways the history's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { Grade } from "../../common/values.ts";

/** A real world's record is not exported until a rule for its owners' consent exists. */
export class ExportNotAllowed extends refusal<ExportNotAllowed, { readonly brand: unique symbol }>()(
  "ExportNotAllowed",
  {
    grade: Grade,
  },
  4,
) {}

export const refusals = { ExportNotAllowed } as const;
