// The refusals several things share: who is calling, the server itself, a company that is not there, a Safe that
// cannot pay, and a company's site; and the one refusal no operation declares, a payload its operation's schema
// rejects. Each is declared once, here; src/generated/refusals.ts gathers them with the things' own.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../generated/refusals.ts";
import { Address, Amount, Asset, OperatorName, OrgId, PersonId, WorldName } from "./values.ts";

/** No caller could be established: no credential, or one this world or the platform does not know. */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn, { readonly brand: unique symbol }>()("NotSignedIn", {
  reason: Schema.Literals(["no_credential", "unknown_caller"]),
}) {}

/** Only the world's owner may do this; the caller is someone else (another operator, or a person of the world). */
export class NotWorldOwner extends Schema.TaggedError<NotWorldOwner, { readonly brand: unique symbol }>()(
  "NotWorldOwner",
  {
    world: WorldName,
    owner: OperatorName,
  },
) {}

/**
 * The payload is not of its operation's schema (a hyphen too many, a negative duration, a bio of 281 characters),
 * so the caller's own client refused to send it (decisions.md, 43). Nothing reached a door: no handler ran, no span
 * was kept and nothing was recorded. `operation` is the operation's name and `issue` what the schema found.
 */
export class PayloadRejected extends Schema.TaggedError<PayloadRejected, { readonly brand: unique symbol }>()(
  "PayloadRejected",
  {
    operation: Schema.String,
    issue: Schema.String,
  },
) {}

/**
 * The server serves this operation but does not do it yet: its handler is empty (decisions.md, entry 33). Every
 * operation declares it, so a Core with empty handlers answers each call with a typed refusal rather than a defect,
 * and a scenario run against it fails on its own expectations. `operation` is the operation's name.
 */
export class NotImplemented extends Schema.TaggedError<NotImplemented, { readonly brand: unique symbol }>()(
  "NotImplemented",
  {
    operation: Schema.String,
  },
) {}

export class OrgNotFound extends Schema.TaggedError<OrgNotFound, { readonly brand: unique symbol }>()("OrgNotFound", {
  org: OrgId,
}) {}

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

export class NoSiteUser extends Schema.TaggedError<NoSiteUser, { readonly brand: unique symbol }>()("NoSiteUser", {
  org: OrgId,
  person: PersonId,
}) {}

export class SiteRefused extends Schema.TaggedError<SiteRefused, { readonly brand: unique symbol }>()("SiteRefused", {
  org: OrgId,
  target: Schema.String,
  reason: Schema.Literals(["permission", "validation", "not_found", "part_off"]),
  message: Schema.String,
}) {}

export class SiteUnavailable extends Schema.TaggedError<SiteUnavailable, { readonly brand: unique symbol }>()(
  "SiteUnavailable",
  {
    org: OrgId,
    state: Schema.Literals(["creating", "stopped", "unreachable"]),
  },
) {}

export const refusals = {
  NotSignedIn,
  NotWorldOwner,
  PayloadRejected,
  NotImplemented,
  OrgNotFound,
  InsufficientBalance,
  NoSiteUser,
  SiteRefused,
  SiteUnavailable,
} as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  NotSignedIn: 3,
  NotWorldOwner: 4,
  PayloadRejected: 2,
  NotImplemented: 6,
  OrgNotFound: 2,
  InsufficientBalance: 2,
  NoSiteUser: 4,
  SiteRefused: 2,
  SiteUnavailable: 5,
};
