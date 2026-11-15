// The ways the director's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { OrgId, PersonId } from "../../common/values.ts";

/** The person named is a Director of the company already: their Safe signs the company Safe. */
export class AlreadyADirector extends Schema.TaggedError<AlreadyADirector, { readonly brand: unique symbol }>()(
  "AlreadyADirector",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

export const refusals = { AlreadyADirector } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  AlreadyADirector: 2,
};
