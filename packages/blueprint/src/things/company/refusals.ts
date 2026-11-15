// The ways the company's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import { refusal } from "@capxul/blueprint-tools";
import { OrgHandle, OrgId, PersonId } from "../../common/values.ts";

export class PersonNotFound extends refusal<PersonNotFound, { readonly brand: unique symbol }>()(
  "PersonNotFound",
  {
    person: PersonId,
  },
  2,
) {}

export class FounderNotReady extends refusal<FounderNotReady, { readonly brand: unique symbol }>()(
  "FounderNotReady",
  {
    person: PersonId,
  },
  2,
) {}

export class HandleTaken extends refusal<HandleTaken, { readonly brand: unique symbol }>()(
  "HandleTaken",
  {
    handle: OrgHandle,
  },
  2,
) {}

export class FoundingChanged extends refusal<FoundingChanged, { readonly brand: unique symbol }>()(
  "FoundingChanged",
  {
    handle: OrgHandle,
    org: OrgId,
  },
  2,
) {}

export class SetupUnfinished extends refusal<SetupUnfinished, { readonly brand: unique symbol }>()(
  "SetupUnfinished",
  {
    org: OrgId,
    handle: OrgHandle,
  },
  2,
) {}

export class NotADirector extends refusal<NotADirector, { readonly brand: unique symbol }>()(
  "NotADirector",
  {
    org: OrgId,
    person: PersonId,
  },
  4,
) {}

export class NotAMember extends refusal<NotAMember, { readonly brand: unique symbol }>()(
  "NotAMember",
  {
    org: OrgId,
    person: PersonId,
  },
  2,
) {}

export class MemberHasNoSafe extends refusal<MemberHasNoSafe, { readonly brand: unique symbol }>()(
  "MemberHasNoSafe",
  {
    org: OrgId,
    person: PersonId,
  },
  2,
) {}

export const refusals = {
  PersonNotFound,
  FounderNotReady,
  HandleTaken,
  FoundingChanged,
  SetupUnfinished,
  NotADirector,
  NotAMember,
  MemberHasNoSafe,
} as const;
