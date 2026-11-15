// The scenarios of the blueprint's domain "people" (who belongs to a company, and the invitations that bring a person
// in): the checks of each of its operations, the journeys it leads, and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { People } from "@capxul/blueprint";
import { inviteAccept } from "../checks/invite-accept.ts";
import { inviteDecline } from "../checks/invite-decline.ts";
import { inviteList } from "../checks/invite-list.ts";
import { orgMemberInvite } from "../checks/org-member-invite.ts";
import { orgMemberList } from "../checks/org-member-list.ts";
import { at, type Domain } from "../domain.ts";
import { inviteOlga } from "../journeys/invite-olga.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof People>["checks"] = {
  "org.member.invite": orgMemberInvite,
  "invite.list": inviteList,
  "invite.accept": inviteAccept,
  "invite.decline": inviteDecline,
  "org.member.list": orgMemberList,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof People>["journeys"] = [inviteOlga];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof People>["coverage"] = {
  "org.member.invite": [
    at(["org.member.invite"], [inviteOlga, 2], [inviteOlga, 3]),
    at(["org.member.invite"], [inviteOlga, 2], [inviteOlga, 7]),
    at(["org.member.invite"], [inviteOlga, 2], [inviteOlga, 5]),
    at(["org.member.invite"], [inviteOlga, 2], [inviteOlga, 5], [inviteOlga, 9]),
  ],
  "invite.list": [at(["invite.list"], [inviteOlga, 3], [inviteOlga, 7])],
  "invite.accept": [
    at(["invite.accept", "org.member.grant"], [inviteOlga, 6], [inviteOlga, 8], [inviteOlga, 10]),
    at(["invite.accept"], [inviteOlga, 6]),
    at(["invite.accept"], [inviteOlga, 6]),
  ],
  "invite.decline": [at(["invite.decline"], [inviteOlga, 4]), at(["invite.decline"], [inviteOlga, 4])],
  "org.member.list": [
    at(["org.member.list"], [inviteOlga, 1], [inviteOlga, 8]),
    at(["org.member.list"], [inviteOlga, 1]),
  ],
};
