// The refusals of the domain "record": reading a world's record. Each is declared once, here; ../errors.ts gathers
// them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { Grade } from "../values.ts";

/** A real world's record is not exported until a rule for its owners' consent exists. */
export class ExportNotAllowed extends Schema.TaggedError<ExportNotAllowed, { readonly brand: unique symbol }>()(
  "ExportNotAllowed",
  {
    grade: Grade,
  },
) {}

export const refusals = { ExportNotAllowed } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = { ExportNotAllowed: 4 };
