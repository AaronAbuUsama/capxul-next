// The ways the history's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { Grade } from "../../common/values.ts";

/**
 * A real world's record is not exported until a rule for its owners' consent exists. Aaron has not been asked yet
 * (13 November 2026): it matters only for real worlds (phase 8), so until then the export refuses on one.
 */
export class ExportNotAllowed extends Schema.TaggedError<ExportNotAllowed, { readonly brand: unique symbol }>()(
  "ExportNotAllowed",
  {
    grade: Grade,
  },
) {}

export const refusals = { ExportNotAllowed } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  ExportNotAllowed: 4,
};
