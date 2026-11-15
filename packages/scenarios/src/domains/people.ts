// The scenarios of the blueprint's domain "people" (who belongs to a company, and the invitations that bring a person
// in): the checks of each of its operations, the journeys it leads, and where each claim of its operations is checked
// (../domain.ts). ../domains.ts lists it once.
import type { People } from "@capxul/blueprint";
import { invitationAccept } from "../checks/invite-accept.ts";
import { invitationDecline } from "../checks/invite-decline.ts";
import { invitationList } from "../checks/invite-list.ts";
import { invitationSend } from "../checks/org-member-invite.ts";
import { orgMemberList } from "../checks/org-member-list.ts";
import { at, type Domain } from "../domain.ts";
import { inviteOlga } from "../journeys/invite-olga.ts";
import { noGoingBack } from "../journeys/no-going-back.ts";

/** The checks of each of its operations. */
export const checks: Domain<typeof People>["checks"] = {
  "invitation.send": invitationSend,
  "invitation.list": invitationList,
  "invitation.accept": invitationAccept,
  "invitation.decline": invitationDecline,
  "org.member.list": orgMemberList,
};

/** The journeys it leads, in the order they run. */
export const journeys: Domain<typeof People>["journeys"] = [inviteOlga, noGoingBack];

/** Where each claim of each of its operations is checked, in claims.md's order. */
export const coverage: Domain<typeof People>["coverage"] = {
  "invitation.send": [
    at(["invitation.send"], [inviteOlga, 2], [inviteOlga, 3]),
    at(["invitation.send"], [inviteOlga, 2], [inviteOlga, 7]),
    at(["invitation.send"], [inviteOlga, 2], [inviteOlga, 5]),
    at(["invitation.send"], [inviteOlga, 2], [inviteOlga, 5], [inviteOlga, 9]),
  ],
  "invitation.list": [at(["invitation.list"], [inviteOlga, 3], [inviteOlga, 7])],
  "invitation.accept": [
    at(["invitation.accept", "org.member.grant"], [inviteOlga, 6], [inviteOlga, 8], [inviteOlga, 10]),
    at(["invitation.accept"], [inviteOlga, 6]),
    at(["invitation.accept"], [inviteOlga, 6]),
  ],
  "invitation.decline": [
    at(["invitation.decline"], [inviteOlga, 4]),
    at(["invitation.decline"], [inviteOlga, 4], [noGoingBack, 3]),
  ],
  "org.member.list": [
    at(["org.member.list"], [inviteOlga, 1], [inviteOlga, 8]),
    at(["org.member.list"], [inviteOlga, 1]),
  ],
};
