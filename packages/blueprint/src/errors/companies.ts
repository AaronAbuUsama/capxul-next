// The refusals of the contract that several domains share: a company that is not there, a Safe that cannot pay, and
// a company's site. Each is declared once, here; ../errors.ts gathers them all.
import * as Schema from "effect/Schema";
import type { ExitCode } from "../errors.ts";
import { Address, Amount, Asset, OrgId, PersonId } from "../values.ts";

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

export const refusals = { OrgNotFound, InsufficientBalance, NoSiteUser, SiteRefused, SiteUnavailable } as const;

export const exitCode: { readonly [Tag in keyof typeof refusals]: ExitCode } = {
  OrgNotFound: 2,
  InsufficientBalance: 2,
  NoSiteUser: 4,
  SiteRefused: 2,
  SiteUnavailable: 5,
};
