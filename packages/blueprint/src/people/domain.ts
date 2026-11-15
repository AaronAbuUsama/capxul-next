// The door of the domain "people": who belongs to a company, and the invitations that bring a person in. Its
// operations by name, its share of the two Rpc groups and its claims, which ../domains.ts gathers with every other
// domain's. Its values are in values.ts, its events and declarations in operations.ts, its claims in claims.ts, its
// own refusals in refusals.ts. It asks for no approvals, so it has no subjects.
import * as RpcGroup from "effect/rpc/RpcGroup";
import type { ClaimsOf } from "../claims/claim.ts";
import * as Claims from "./claims.ts";
import { Invitation } from "./machines.ts";
import * as People from "./operations.ts";

export * from "./operations.ts";

/** Its operations, by name. */
export const operations = {
  "org.member.invite": People.memberInvite,
  "invite.list": People.inviteList,
  "invite.accept": People.inviteAccept,
  "invite.decline": People.inviteDecline,
  "org.member.list": People.memberList,
} as const;

/** Its operations that move no thing with a lifecycle (src/machine-format.ts), each with why. */
export const stateless: { readonly [Name in keyof typeof operations]?: string } = {
  "invite.list": "a read: lists the caller's invitations and changes nothing",
  "org.member.list": "a read: lists a company's members and changes nothing",
};

/** Its machines, by name (src/machine.ts): the invitation's lifecycle. */
export const machines = { invitation: Invitation } as const;

/** What the platform's world service serves of it (`PlatformRpcs`). */
export const platformRpcs = RpcGroup.make();

/** What a world's Core serves of it, through the world's door (`WorldRpcs`). */
export const worldRpcs = RpcGroup.make(
  People.memberInvite.rpc,
  People.inviteList.rpc,
  People.inviteAccept.rpc,
  People.inviteDecline.rpc,
  People.memberList.rpc,
);

/** The claims of each of its operations. */
export const claims: { readonly [Name in keyof typeof operations]: ClaimsOf } = {
  "org.member.invite": Claims.memberInvite,
  "invite.list": Claims.inviteList,
  "invite.accept": Claims.inviteAccept,
  "invite.decline": Claims.inviteDecline,
  "org.member.list": Claims.memberList,
};
