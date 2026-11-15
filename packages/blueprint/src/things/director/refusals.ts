// The ways the director's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { OrgId, PersonId } from "../../common/values.ts";

/** The person named is a Director of the company already: their Safe signs the company Safe. */
export class AlreadyADirector extends refusal<AlreadyADirector, { readonly brand: unique symbol }>()(
  "AlreadyADirector",
  {
    org: OrgId,
    person: PersonId,
  },
  2,
) {}

export const refusals = { AlreadyADirector } as const;
