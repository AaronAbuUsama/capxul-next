// The refusals of the domain "organizations": founding a company and granting its members permissions. Each is
// declared once, here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { ChangeId, OrgHandle, OrgId, Permission, PersonId } from "../values.ts";

export class PersonNotFound extends Schema.TaggedError<PersonNotFound, { readonly brand: unique symbol }>()(
  "PersonNotFound",
  {
    person: PersonId,
  },
) {}

export class FounderNotReady extends Schema.TaggedError<FounderNotReady, { readonly brand: unique symbol }>()(
  "FounderNotReady",
  {
    person: PersonId,
  },
) {}

export class HandleTaken extends Schema.TaggedError<HandleTaken, { readonly brand: unique symbol }>()("HandleTaken", {
  handle: OrgHandle,
}) {}

export class FoundingChanged extends Schema.TaggedError<FoundingChanged, { readonly brand: unique symbol }>()(
  "FoundingChanged",
  {
    handle: OrgHandle,
    org: OrgId,
  },
) {}

export class SetupUnfinished extends Schema.TaggedError<SetupUnfinished, { readonly brand: unique symbol }>()(
  "SetupUnfinished",
  {
    org: OrgId,
    handle: OrgHandle,
  },
) {}

export class NotADirector extends Schema.TaggedError<NotADirector, { readonly brand: unique symbol }>()(
  "NotADirector",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

export class NotAMember extends Schema.TaggedError<NotAMember, { readonly brand: unique symbol }>()("NotAMember", {
  org: OrgId,
  person: PersonId,
}) {}

export class AlreadyHeld extends Schema.TaggedError<AlreadyHeld, { readonly brand: unique symbol }>()("AlreadyHeld", {
  org: OrgId,
  person: PersonId,
  permission: Permission,
}) {}

export class ChangeWaiting extends Schema.TaggedError<ChangeWaiting, { readonly brand: unique symbol }>()(
  "ChangeWaiting",
  {
    org: OrgId,
    person: PersonId,
    change: ChangeId,
  },
) {}

export class MemberHasNoSafe extends Schema.TaggedError<MemberHasNoSafe, { readonly brand: unique symbol }>()(
  "MemberHasNoSafe",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

export const refusals = {
  PersonNotFound,
  FounderNotReady,
  HandleTaken,
  FoundingChanged,
  SetupUnfinished,
  NotADirector,
  NotAMember,
  AlreadyHeld,
  ChangeWaiting,
  MemberHasNoSafe,
} as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  PersonNotFound: 2,
  FounderNotReady: 2,
  HandleTaken: 2,
  FoundingChanged: 2,
  SetupUnfinished: 2,
  NotADirector: 4,
  NotAMember: 2,
  AlreadyHeld: 2,
  ChangeWaiting: 2,
  MemberHasNoSafe: 2,
};
