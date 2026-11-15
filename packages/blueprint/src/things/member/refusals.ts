// The ways the member's verbs say no, each declared once, here, with its exit code. src/generated/refusals.ts
// gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../../generated/refusals.ts";
import { ChangeId, OrgId, Permission, PersonId } from "../../common/values.ts";

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

export const refusals = { AlreadyHeld, ChangeWaiting } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  AlreadyHeld: 2,
  ChangeWaiting: 2,
};
