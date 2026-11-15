// The ways the member's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { ChangeId, OrgId, Permission, PersonId } from "../../common/values.ts";

export class AlreadyHeld extends refusal<AlreadyHeld, { readonly brand: unique symbol }>()(
  "AlreadyHeld",
  {
    org: OrgId,
    person: PersonId,
    permission: Permission,
  },
  2,
) {}

export class ChangeWaiting extends refusal<ChangeWaiting, { readonly brand: unique symbol }>()(
  "ChangeWaiting",
  {
    org: OrgId,
    person: PersonId,
    change: ChangeId,
  },
  2,
) {}

export const refusals = { AlreadyHeld, ChangeWaiting } as const;
