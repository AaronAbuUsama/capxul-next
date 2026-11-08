// The target operation records of the 14 frozen operations organizations owns (OPERATION_OWNERS):
// `org create`, `org list`, `org me`, `org retry`, `org show`, `org wait`, `use org`,
// `org member list`, `org member get`, `invite list`, `invite decline`, `org invite list`,
// `org invite cancel` and `org invite resend`. `org member invite` is board's flow and
// `invite accept` banking's; organizations serves both with its invite and accept rpcs.
//
// Every record spreads the frozen text (frozenText); acceptance lines keep the frozen claim word for
// word unless it names a mechanism, and a rewritten line keeps the old one and its test citation in
// `was` (P1; the rewrites are decision organizations.acceptance-rewrites). Refusals are reached from
// the worlds of decision organizations.worlds.

import { Schema } from "effect";
import { budget, defineOperation, type ErrorRecord } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_DEADLINE,
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_RATE_LIMITED,
  error_ROLE_PERMISSION_DENIED,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import {
  flow_client_onboarding_begin_organization,
  flow_client_org_members_get,
  flow_client_org_setup_get,
  flow_client_org_setup_resume,
  flow_client_org_setup_subscribe,
  flow_client_orgs_invitations,
  flow_client_orgs_use,
} from "./flows.ts";
import { rpc_organizations_workspaces_list, rpc_organizations_workspaces_me } from "./workspaces.ts";
import { MemberView, rpc_organizations_members_list } from "./members.ts";
import { SetupView } from "./setups.ts";
import {
  InvitationView,
  rpc_organizations_invitations_cancel,
  rpc_organizations_invitations_decline,
  rpc_organizations_invitations_list,
  rpc_organizations_invitations_resend,
} from "./invitations.ts";

const S = Schema.String;

// ── helpers over the frozen text ────────────────────────────────────────────────────────────

type Line = { readonly claim: string; readonly was: readonly string[] };
const line = (id: FrozenId, n: number): Line => (frozen[id].acceptance as readonly Line[])[n - 1]!;

/** The frozen claim, word for word, with its old test citation. */
const keep = (id: FrozenId, n: number, observes: string) => {
  const l = line(id, n);
  return { claim: l.claim, observes, was: [...l.was] };
};
/** A claim that named a mechanism, rewritten as an outcome; the old line and its citation move to `was`. */
const rewrite = (id: FrozenId, n: number, claim: string, observes: string) => {
  const l = line(id, n);
  return { claim, observes, was: [l.claim, ...l.was] };
};
/** A refusal with the frozen `when` text for its code. */
const refusal = (id: FrozenId, error: ErrorRecord, given: string) => {
  const r = (frozen[id].refusals as readonly { code: string; when: string }[]).find((x) => x.code === error.id);
  if (!r) throw new Error(`${id}: the frozen record has no ${error.id} refusal`);
  return { error, given, when: r.when };
};

const Lifecycle = Schema.Struct({ organizationId: S, lifecycle: SetupView });

// ── organizations area ──────────────────────────────────────────────────────────────────────

export const operation_org_create = defineOperation({
  ...frozenText("org.create"),
  priority: "normal",
  implementedBy: flow_client_onboarding_begin_organization,
  acceptance: [
    keep("org.create", 1, "cli: from person-unclaimed it exits WRONG_STATE. world: no Organization, setup or Party is added."),
    keep("org.create", 2, "cli: from person-on-waitlist it exits FEATURE_NOT_AVAILABLE; after the operator admits them the same command succeeds. world: nothing is added before."),
    keep(
      "org.create",
      3,
      "cli: the same command twice prints the same Organization ID; a changed name or bio under the same handle exits WRONG_STATE; another founder's handle exits INVALID_INPUT. read: `org list` shows one Organization.",
    ),
    rewrite(
      "org.create",
      4,
      "An invalid logo is refused and leaves no Organization and no setup, and its handle stays free.",
      "cli: INVALID_INPUT. read: `org list` shows no Organization and no unfinished setup. world: no diff; the same handle with a valid logo then succeeds.",
    ),
    keep("org.create", 5, "world: the Organization's bio and size are the given text trimmed. cli: a bio of 281 characters exits INVALID_INPUT."),
    keep(
      "org.create",
      6,
      "chain: CompanySafeMinted names the Organization's Safe with the founder's personal Safe as founderSafe, at the minter's companySafeAddressFor. read: `org show` prints that Safe.",
    ),
    keep(
      "org.create",
      7,
      "cli: the Organization ID is printed before the approval page opens; with `--timeout-seconds 1` it exits CLI_DEADLINE and `org show` later reads the setup still moving.",
    ),
  ],
  returns: Lifecycle,
  refusals: [
    refusal("org.create", error_CLI_USAGE, "person-ready"),
    refusal("org.create", error_INVALID_INPUT, "two-founders"),
    refusal("org.create", error_WRONG_STATE, "person-unclaimed"),
    refusal("org.create", error_NOT_AUTHENTICATED, "signed-out"),
    {
      error: error_FEATURE_NOT_AVAILABLE,
      given: "person-on-waitlist",
      when: "You are still on the beta waitlist. Nothing is created until an operator admits you.",
    },
  ],
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  budget: {
    ...budget("chain-submit"),
    p50Ms: 4_000,
    p95Ms: 8_000,
    why: "two service-key sends (the mint and deployMoney) and the install's sponsorship run in series before the founder signs",
  },
});

export const operation_org_list = defineOperation({
  ...frozenText("org.list"),
  priority: "normal",
  implementedBy: rpc_organizations_workspaces_list,
  acceptance: [
    keep("org.list", 1, "read: as an invitee who accepted, and as the founder of two Organizations, each Organization appears once, in Organization ID order."),
    keep("org.list", 2, "read: from org-awaiting-founder, unfinishedSetups lists the setup on every page, and items does not."),
    keep("org.list", 3, "read: from two-founders, each founder sees only their own Organizations and only their own email."),
    keep("org.list", 4, "read: from org-with-member, the member sees the Organization with founderEmail null."),
    keep("org.list", 5, "cli: from person-ready the human output says there are no Organizations and no unfinished setups."),
  ],
  returns: rpc_organizations_workspaces_list.output,
  refusals: [refusal("org.list", error_CLI_USAGE, "person-ready"), refusal("org.list", error_NOT_AUTHENTICATED, "signed-out")],
  errors: [error_CLI_USAGE],
  budget: budget("read"),
});

export const operation_org_me = defineOperation({
  ...frozenText("org.me"),
  priority: "normal",
  implementedBy: rpc_organizations_workspaces_me,
  acceptance: [
    rewrite(
      "org.me",
      1,
      "A founder who wears the People hat and one allowance's office hat reports both capabilities and that one labelled spending allowance.",
      "read: from org-with-allowance, capabilities.managePeople and capabilities.spend are true and budgets holds the one allowance with its label and cap.",
    ),
    rewrite(
      "org.me",
      2,
      "A Director is whoever the company Safe's signers on chain name, with no Capxul grant.",
      "chain: the company Safe's owners that the Gate holds valid. read: `org me` reports director for exactly those Seats, in org-ready and org-with-member.",
    ),
    keep("org.me", 3, "read: from org-with-member, the hatless member sees the Organization, role Member and every capability false."),
    rewrite(
      "org.me",
      4,
      "An allowance with no per-payment limit reports an unlimited cap.",
      "read: from org-with-uncapped-allowance, the allowance's perPaymentCap is null and the CLI prints no cap.",
    ),
    keep("org.me", 5, "cli: from org-with-removed-agent as the agent, and from two-founders as the other founder, it exits ROLE_PERMISSION_DENIED."),
    keep("org.me", 6, "cli: the human output names the same capabilities and the exact per-payment caps the `--json` result carries."),
  ],
  returns: rpc_organizations_workspaces_me.output,
  refusals: [refusal("org.me", error_ROLE_PERMISSION_DENIED, "two-founders"), refusal("org.me", error_NOT_AUTHENTICATED, "signed-out")],
  budget: budget("read"),
});

export const operation_org_retry = defineOperation({
  ...frozenText("org.retry"),
  priority: "normal",
  implementedBy: flow_client_org_setup_resume,
  acceptance: [
    rewrite(
      "org.retry",
      1,
      "A setup that stopped before anything was sent starts exactly once when its founder resumes it.",
      "chain: from org-setup-stalled-unsent, one CompanySafeMinted and one MoneyDeployed follow the retry, and a second retry adds none. world: one install approval.",
    ),
    keep("org.retry", 2, "cli: with the backend unreachable on the first read, it prints `capxul org retry --org <id>` with the exact id."),
    keep("org.retry", 3, "cli: with no browser available, it names the approval page and the retry that finishes setup."),
    keep("org.retry", 4, "cli: from org-setup-failed, it exits WRONG_STATE and the setup does not move. world: no diff."),
  ],
  returns: Lifecycle,
  refusals: [
    refusal("org.retry", error_CLI_USAGE, "org-setup-stalled"),
    refusal("org.retry", error_INVALID_INPUT, "two-founders"),
    refusal("org.retry", error_NOT_AUTHENTICATED, "signed-out"),
    { error: error_WRONG_STATE, given: "org-setup-failed", when: "The setup failed for good: nothing a retry does can finish it." },
  ],
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  budget: budget("chain-submit"),
});

export const operation_org_show = defineOperation({
  ...frozenText("org.show"),
  priority: "normal",
  implementedBy: flow_client_org_setup_get,
  acceptance: [
    keep("org.show", 1, "world: no diff after `org show` from org-awaiting-founder and from org-setup-stalled. trace: no workflow step runs."),
    keep("org.show", 2, "cli: from two-founders, the other founder's Organization exits ROLE_PERMISSION_DENIED exactly as an id that names nothing does."),
    rewrite(
      "org.show",
      3,
      "Until setup is ready only its founder reads it; once ready, only a current member does.",
      "cli: from org-awaiting-founder a signed-in non-founder exits ROLE_PERMISSION_DENIED; from org-with-member the member reads it.",
    ),
    rewrite("org.show", 4, "A ready setup offers no recovery.", "read: from org-ready, recovery is `none` and the CLI prints no command to run."),
    keep("org.show", 5, "cli: with the backend unreachable, it names the saved Organization and prints `capxul org retry --org <id>`."),
    keep("org.show", 6, "cli: after a ROLE_PERMISSION_DENIED it prints no command that writes, only its own read commands."),
  ],
  returns: SetupView,
  refusals: [
    refusal("org.show", error_CLI_USAGE, "org-two-unfinished-setups"),
    refusal("org.show", error_ROLE_PERMISSION_DENIED, "two-founders"),
    refusal("org.show", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  errors: [error_CLI_USAGE],
  budget: budget("read"),
});

export const operation_org_wait = defineOperation({
  ...frozenText("org.wait"),
  priority: "normal",
  implementedBy: flow_client_org_setup_subscribe,
  acceptance: [
    rewrite(
      "org.wait",
      1,
      "It waits on one live subscription to the setup, without polling, and prints each change.",
      "trace: one subscription to organizations.setups.get for the whole wait and no repeated reads. cli: one line per setup change.",
    ),
    rewrite(
      "org.wait",
      2,
      "It stops when the setup needs attention and nothing but `org retry` will move it.",
      "cli: from org-setup-stalled it returns at once with status needs_attention and recovery checkAgain.",
    ),
    keep("org.wait", 3, "world: interrupting the wait leaves the setup as it was. trace: no resume and no send follows."),
    keep("org.wait", 4, "cli: in a fresh CLI home signed in as the founder of org-awaiting-founder, with no `--org`, it follows that setup."),
  ],
  returns: flow_client_org_setup_subscribe.output,
  refusals: [
    refusal("org.wait", error_CLI_USAGE, "two-founders"),
    refusal("org.wait", error_CLI_DEADLINE, "org-awaiting-founder"),
    refusal("org.wait", error_ROLE_PERMISSION_DENIED, "two-founders"),
  ],
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  budget: budget("live-read"),
});

// ── accounts area: use org ──────────────────────────────────────────────────────────────────

export const operation_use_org = defineOperation({
  ...frozenText("use.org"),
  priority: "normal",
  implementedBy: flow_client_orgs_use,
  acceptance: [
    keep("use.org", 1, "cli: from org-ready, `use org acme` and then `use org @ACME` save it, and `org show` without `--org` reads that Organization."),
    keep("use.org", 2, "cli: from two-founders, naming the other Organization exits CLI_USAGE and `org show` still reads the one saved before."),
  ],
  returns: flow_client_orgs_use.output,
  refusals: [refusal("use.org", error_CLI_USAGE, "two-founders"), refusal("use.org", error_NOT_AUTHENTICATED, "signed-out")],
  errors: [error_CLI_USAGE],
  budget: budget("read"),
});

// ── governance area: members ────────────────────────────────────────────────────────────────

export const operation_org_member_list = defineOperation({
  ...frozenText("org.member.list"),
  priority: "normal",
  implementedBy: rpc_organizations_members_list,
  acceptance: [
    keep(
      "org.member.list",
      1,
      "read: from org-with-pending-invitation, each Seat's accountId is its holder's own, and the invitee is listed as pending with no accountId and their own email.",
    ),
    keep("org.member.list", 2, "read: from org-with-agent-member and org-with-pending-invitation, every row's memberId is distinct, the agent's with no email."),
    keep("org.member.list", 3, "cli: with `--limit 1` it prints one member and the `--after` for the next page; the last page says there are no more."),
  ],
  returns: rpc_organizations_members_list.output,
  refusals: [
    refusal("org.member.list", error_ROLE_PERMISSION_DENIED, "two-founders"),
    refusal("org.member.list", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  budget: budget("read"),
});

export const operation_org_member_get = defineOperation({
  ...frozenText("org.member.get"),
  priority: "normal",
  implementedBy: flow_client_org_members_get,
  acceptance: [
    keep("org.member.get", 1, "read: from org-with-member, the member it returns is the row `org member list` returns for that Account ID. trace: one call of organizations.members.list."),
    keep("org.member.get", 2, "cli: with the backend unreachable, it names the signed-in actor and the Organization it read."),
  ],
  returns: MemberView,
  refusals: [
    refusal("org.member.get", error_ROLE_PERMISSION_DENIED, "two-founders"),
    refusal("org.member.get", error_CLI_USAGE, "two-founders"),
    refusal("org.member.get", error_INVALID_INPUT, "org-ready"),
    refusal("org.member.get", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  errors: [error_CLI_USAGE],
  budget: budget("read"),
});

// ── governance area: invitations ────────────────────────────────────────────────────────────

export const operation_invite_list = defineOperation({
  ...frozenText("invite.list"),
  priority: "normal",
  implementedBy: flow_client_orgs_invitations,
  acceptance: [
    rewrite(
      "invite.list",
      1,
      "It lists only the caller's offers, and the `--after` one page names returns the next.",
      "read: from org-with-pending-invitation, the invitee sees their one offer and the founder sees none; with `--limit 1` over two offers, `--after` reaches the second.",
    ),
    keep("invite.list", 2, "read: with two `--phase` values, the page is in (createdAt, invitationId) order across both."),
    keep("invite.list", 3, "cli: `--phase pending --phase pending` exits INVALID_INPUT. trace: no read of an invitation."),
  ],
  returns: flow_client_orgs_invitations.output,
  refusals: [
    refusal("invite.list", error_INVALID_INPUT, "org-with-pending-invitation"),
    refusal("invite.list", error_WRONG_STATE, "?"),
    refusal("invite.list", error_ROLE_PERMISSION_DENIED, "org-with-member"),
    refusal("invite.list", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  budget: budget("read"),
});

export const operation_invite_decline = defineOperation({
  ...frozenText("invite.decline"),
  priority: "normal",
  implementedBy: rpc_organizations_invitations_decline,
  acceptance: [
    rewrite(
      "invite.decline",
      1,
      "The invitee's decline is refused while the offer is still authorizing.",
      "cli: from org-with-authorizing-invitation, the invitee exits WRONG_STATE. world: no diff.",
    ),
    rewrite(
      "invite.decline",
      2,
      "Declining a pending offer whose grants are on chain begins their cleanup, and declining again changes nothing.",
      "cli: from org-with-granted-invitation the phase is revoking with recovery cleanup_pending; a second decline prints the same. world: one change.",
    ),
    keep("invite.decline", 3, "cli: from org-with-pending-invitation, another signed-in person exits ROLE_PERMISSION_DENIED. world: no diff."),
    rewrite(
      "invite.decline",
      4,
      "A decline and the cleanup it begins commit together: an offer is never declined without its cleanup, or its cleanup without the decline.",
      "world: from org-with-granted-invitation, either the phase is revoking with ending reason declined, or nothing changed. trace: one transaction.",
    ),
    rewrite(
      "invite.decline",
      5,
      "It reports one org_invite_transitioned for the grantee's decline, and none on a replay or a refusal.",
      "trace: one org_invite_transitioned with transition decline or begin_cleanup; none for the replay and none for the refused outsider.",
    ),
  ],
  returns: InvitationView,
  refusals: [
    refusal("invite.decline", error_ROLE_PERMISSION_DENIED, "org-with-pending-invitation"),
    refusal("invite.decline", error_WRONG_STATE, "org-with-accepted-invitation"),
    refusal("invite.decline", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  errors: [error_CLI_USAGE],
  budget: budget("write"),
});

export const operation_org_invite_list = defineOperation({
  ...frozenText("org.invite.list"),
  priority: "normal",
  implementedBy: rpc_organizations_invitations_list,
  acceptance: [
    keep("org.invite.list", 1, "read: from org-with-pending-invitation, after a second People-hat wearer invites someone, the founder's list shows both offers."),
    keep(
      "org.invite.list",
      2,
      "cli: from org-with-member the hatless member, from two-founders the other founder, and an id that names nothing each exit ROLE_PERMISSION_DENIED with no page.",
    ),
    rewrite(
      "org.invite.list",
      3,
      "Pages walk in (createdAt, invitationId) order, and an `--after` from another Organization's list is refused.",
      "read: page by page the order holds. cli: from two-founders, the other Organization's `--after` exits INVALID_INPUT.",
    ),
    keep("org.invite.list", 4, "cli: each exits CLI_USAGE. trace: no rpc call."),
  ],
  returns: rpc_organizations_invitations_list.output,
  refusals: [
    refusal("org.invite.list", error_ROLE_PERMISSION_DENIED, "org-with-member"),
    refusal("org.invite.list", error_CLI_USAGE, "org-ready"),
    refusal("org.invite.list", error_INVALID_INPUT, "two-founders"),
    refusal("org.invite.list", error_WRONG_STATE, "?"),
    refusal("org.invite.list", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  errors: [error_CLI_USAGE],
  budget: budget("read"),
});

export const operation_org_invite_cancel = defineOperation({
  ...frozenText("org.invite.cancel"),
  priority: "normal",
  implementedBy: rpc_organizations_invitations_cancel,
  acceptance: [
    rewrite(
      "org.invite.cancel",
      1,
      "An authorizing offer whose grants' proposal can no longer run is cancelled at once, with nothing to clean up on chain, and its grants can be offered again.",
      "cli: from org-with-rejected-grant-proposal it prints cancelled with no recovery; a new invite of the same grants to the same person succeeds. chain: no hat changes.",
    ),
    rewrite(
      "org.invite.cancel",
      2,
      "An authorizing offer whose grants' proposal may still run is refused.",
      "cli: from org-with-authorizing-invitation it exits WRONG_STATE. world: no diff.",
    ),
    rewrite(
      "org.invite.cancel",
      3,
      "A pending offer whose grants are on chain begins their cleanup.",
      "cli: from org-with-granted-invitation the phase is revoking with recovery cleanup_pending. read: once the Board removes the hats, `org invite list` shows it cancelled.",
    ),
    keep("org.invite.cancel", 4, "cli: from org-with-member, the member without the People hat exits ROLE_PERMISSION_DENIED. world: no diff."),
    rewrite(
      "org.invite.cancel",
      5,
      "It reports one org_invite_transitioned for the cancel, and none on a replay.",
      "trace: one org_invite_transitioned with transition cancel or begin_cleanup, and none when the cancel is repeated.",
    ),
  ],
  returns: InvitationView,
  refusals: [
    refusal("org.invite.cancel", error_ROLE_PERMISSION_DENIED, "org-with-member"),
    refusal("org.invite.cancel", error_WRONG_STATE, "org-with-authorizing-invitation"),
    refusal("org.invite.cancel", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  errors: [error_CLI_USAGE],
  budget: budget("write"),
});

export const operation_org_invite_resend = defineOperation({
  ...frozenText("org.invite.resend"),
  priority: "normal",
  implementedBy: rpc_organizations_invitations_resend,
  acceptance: [
    keep("org.invite.resend", 1, "cli: from org-with-authorizing-invitation and from org-with-expired-invitation it exits WRONG_STATE. world: no message in the mail sink."),
    rewrite(
      "org.invite.resend",
      2,
      "Each resend delivers exactly one message, and an offer is never sent twice for one resend.",
      "world: from org-with-pending-invitation, the mail sink gains one message for the invitee per resend.",
    ),
    rewrite(
      "org.invite.resend",
      3,
      "A mail provider's refusal leaves the offer pending and unchanged, and an offer with no mailbox sends nothing.",
      "world: with `dev mail fail` the offer's phase, digest and expiry do not change. cli: an offer to an `@handle` exits WRONG_STATE and the mail sink is unchanged.",
    ),
    keep("org.invite.resend", 4, "cli: from org-with-accepted-invitation it exits WRONG_STATE. world: no diff and no message."),
  ],
  returns: InvitationView,
  refusals: [
    refusal("org.invite.resend", error_ROLE_PERMISSION_DENIED, "org-with-member"),
    refusal("org.invite.resend", error_WRONG_STATE, "org-with-expired-invitation"),
    refusal("org.invite.resend", error_RATE_LIMITED, "org-with-pending-invitation"),
    refusal("org.invite.resend", error_NOT_AUTHENTICATED, "signed-out"),
  ],
  errors: [error_CLI_USAGE],
  budget: budget("write"),
});
