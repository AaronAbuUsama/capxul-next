// The refusals of the contract about people, companies and a company's site. Each is declared once, here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import { Address, Amount, Asset, ChangeId, OrgHandle, OrgId, Permission, PersonId } from "../values.ts";

// People and companies.

export class PersonNotFound extends Schema.TaggedError<PersonNotFound, { readonly brand: unique symbol }>()(
  "PersonNotFound",
  {
    person: PersonId,
  },
) {}

export class OrgNotFound extends Schema.TaggedError<OrgNotFound, { readonly brand: unique symbol }>()("OrgNotFound", {
  org: OrgId,
}) {}

/** The founder has no claimed personal Safe, so no company Safe can be minted for them. */
export class FounderNotReady extends Schema.TaggedError<FounderNotReady, { readonly brand: unique symbol }>()(
  "FounderNotReady",
  {
    person: PersonId,
  },
) {}

/** Another founder holds this handle. */
export class HandleTaken extends Schema.TaggedError<HandleTaken, { readonly brand: unique symbol }>()("HandleTaken", {
  handle: OrgHandle,
}) {}

/** The same founder began this handle with a different name, profile, board, members or capital. */
export class FoundingChanged extends Schema.TaggedError<FoundingChanged, { readonly brand: unique symbol }>()(
  "FoundingChanged",
  {
    handle: OrgHandle,
    org: OrgId,
  },
) {}

/** The founder's earlier founding of another handle is not finished. */
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

/** The member's Safe already wears this permission's hat. */
export class AlreadyHeld extends Schema.TaggedError<AlreadyHeld, { readonly brand: unique symbol }>()("AlreadyHeld", {
  org: OrgId,
  person: PersonId,
  permission: Permission,
}) {}

/** A change to this member's permissions is still waiting for the Directors. */
export class ChangeWaiting extends Schema.TaggedError<ChangeWaiting, { readonly brand: unique symbol }>()(
  "ChangeWaiting",
  {
    org: OrgId,
    person: PersonId,
    change: ChangeId,
  },
) {}

/** The member has no claimed personal Safe, so there is nothing to give a hat to. */
export class MemberHasNoSafe extends Schema.TaggedError<MemberHasNoSafe, { readonly brand: unique symbol }>()(
  "MemberHasNoSafe",
  {
    org: OrgId,
    person: PersonId,
  },
) {}

export class InsufficientBalance extends Schema.TaggedError<InsufficientBalance, { readonly brand: unique symbol }>()(
  "InsufficientBalance",
  {
    safe: Address,
    asset: Asset,
    balance: Amount,
    amount: Amount,
  },
) {}

// A company's site.

/** The caller has no user on the company's site: no hat of theirs made one. No call is ever run as another user. */
export class NoSiteUser extends Schema.TaggedError<NoSiteUser, { readonly brand: unique symbol }>()("NoSiteUser", {
  org: OrgId,
  person: PersonId,
}) {}

/** The site refused the call by its own rules. `target` is the doctype or the report. Nothing changed. */
export class SiteRefused extends Schema.TaggedError<SiteRefused, { readonly brand: unique symbol }>()("SiteRefused", {
  org: OrgId,
  target: Schema.String,
  reason: Schema.Literals(["permission", "validation", "not_found", "part_off"]),
  message: Schema.String,
}) {}

/** The company's site cannot take calls now. */
export class SiteUnavailable extends Schema.TaggedError<SiteUnavailable, { readonly brand: unique symbol }>()(
  "SiteUnavailable",
  {
    org: OrgId,
    state: Schema.Literals(["creating", "stopped", "unreachable"]),
  },
) {}

export class NotADraft extends Schema.TaggedError<NotADraft, { readonly brand: unique symbol }>()("NotADraft", {
  doctype: Schema.String,
  // oxlint-disable-next-line effecttsgo/error-payload-shadows-name -- `name` is the Frappe document's name, part of the refusal's wire shape; renaming it changes the contract, which is the blueprint owner's call.
  name: Schema.String,
  docstatus: Schema.Int,
}) {}
