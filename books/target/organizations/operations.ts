// The target operation records of the 14 frozen operations organizations owns (OPERATION_OWNERS):
// `org create`, `org list`, `org me`, `org retry`, `org show`, `org wait`, `use org`,
// `org member list`, `org member get`, `invite list`, `invite decline`, `org invite list`,
// `org invite cancel` and `org invite resend`. `org member invite` is budgets' flow and
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
  error_CANCELLED,
  error_CLI_DEADLINE,
  error_CLI_STORAGE,
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
import { rpc_organizations_apps_add, rpc_organizations_apps_list, rpc_organizations_apps_remove, WHO_DIRECTOR_OR_FDE, WHO_MEMBER } from "./apps.ts";
import { rpc_organizations_heads_show } from "./heads.ts";
import {
  rpc_organizations_fde_guests_add,
  rpc_organizations_fde_guests_list,
  rpc_organizations_fde_guests_remove,
  rpc_organizations_fde_show,
  rpc_organizations_fde_turn,
} from "./fde.ts";
import {
  rpc_organizations_doc_calls_list,
  rpc_organizations_docs_amend,
  rpc_organizations_docs_apply,
  rpc_organizations_docs_cancel,
  rpc_organizations_docs_change,
  rpc_organizations_docs_create,
  rpc_organizations_docs_get,
  rpc_organizations_docs_list,
  rpc_organizations_docs_submit,
  rpc_organizations_doctypes_get,
  rpc_organizations_doctypes_list,
  WHO_HEAD_USER,
} from "./docs.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import { flow_client_org_head_docs_remove, flow_client_org_fde_ask, flow_client_org_head_connect, flow_client_org_head_disconnect } from "./flows.ts";
import { error_PROVIDER_ERROR } from "../shared/vocabulary.ts";
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
  // CLI_STORAGE: this machine could not save the Organization's id (the flow's `save` step). No FDE key is made here any
  // more: Capxul's FDE host makes and keeps it (organizations.fde-at-start-up, aaron.fde-hosted).
  errors: [error_CLI_USAGE, error_CLI_DEADLINE, error_CANCELLED, error_CLI_STORAGE],
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
  errors: [error_CLI_USAGE, error_CLI_DEADLINE, error_CANCELLED],
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
  errors: [error_CLI_USAGE, error_CANCELLED],
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
  errors: [error_CLI_USAGE, error_CANCELLED],
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
  errors: [error_CLI_USAGE, error_CANCELLED],
  budget: budget("write"),
});

// ── the operations beyond the 215 (rules.new-operations, CONVENTIONS rule 4a) ───────────────
//
// Nine commands in docs/design/new-commands.md's one grammar: the eight of the pack
// organizations.commands (sections 5.4: `org head app list|add|remove`, `org head connect|show|disconnect`,
// `org fde show|ask`), which serve aaron.frappe-shape, aaron.frappe-head, aaron.fde-agent and
// aaron.fde-hosted, and `org seats show`, organizations' one command of the pack
// organizations.buy-seats (aaron.buy-seats). Each acts for the Organization `--org` names (else `use
// org`'s), its id is its command's words joined by dots, and it is one SDK method under
// `client.org(orgId)`. Who may run each is a Seat or a hat, never a named person
// (docs/design/authority.md). The commands an Organization's start-up needs are `critical`
// (organizations.command-priorities): `org head app list|add`, not the FDE's, which is not on the
// critical path (aaron.fde-anyone). Every refusal starts from a catalogued world
// (organizations.command-worlds).

const AREA = "organizations";
const claim = (text: string, observes: string) => ({ claim: text, observes });
const NOTHING_READ = "Nothing: it only reads.";

const W_SIGNED_OUT = "signed-out";
const W_TWO = "two-founders";
const W_READY = "org-ready";
const W_MEMBER = "org-with-member";
const W_SITE = "org-with-head-site";
const W_HEAD = "org-with-head";
const W_SITE_DOWN = "org-with-head-site-down";
const W_FDE = "org-with-fde";
const W_FDE_PAUSED = "org-with-fde-paused";
const W_FDE_HOST_DOWN = "org-with-fde-host-down";

const signedOut = { error: error_NOT_AUTHENTICATED, given: W_SIGNED_OUT, when: "No one is signed in on this machine: nothing is read or written." };
const outsider = (given: string = W_TWO) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when:
    given === W_TWO
      ? "Sam, founder of Globex and no member of Acme, names Acme with `--org`: refused as an Organization that does not exist is, and nothing is read or written."
      : "Olga, signed in and holding no Seat in Acme, names it with `--org`: refused as an Organization that does not exist is, and nothing is read or written.",
});
const notDirector = (given: string, what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when: `Sam, a member of Acme whose Safe wears no Director hat, ${what}: nothing is written.`,
});

// ── apps (organizations.app-commands; aaron.frappe-shape) ───────────────────────────────────

export const operation_org_head_app_list = defineOperation({
  id: "org.head.app.list",
  title: "List the Organization's Frappe apps",
  about:
    "Lists the Frappe apps the Organization runs: the fundamental ones (Frappe, ERPNext's accounting and projects, " +
    "Frappe HR's payroll, Frappe CRM), held natively by Capxul from the first day, head or no head; and every other app " +
    "it asked for, which lives only on a connected head: wanted until the head installs it, installed with the version " +
    "the head runs, or removed. Use it to see what the FDE or a Director added, and what a head still has to install.",
  area: AREA,
  command: "org head app list",
  priority: "critical",
  implementedBy: rpc_organizations_apps_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization runs the four fundamental apps, installed and native, and nothing else.",
      "cli: from org-ready, `org head app list --json` prints frappe, erpnext, hrms and crm, each `native: true`, `status: installed`, `addedBy: null`, no other app, and `nextCursor: null`.",
    ),
    claim(
      "An app asked for is listed as wanted, with who asked, until a head installs it.",
      "cli: from org-ready, after `org head app add helpdesk`, `org head app list` lists helpdesk once, `native: false`, `status: wanted`, `version: null` and addedBy Dana's member id.",
    ),
    claim(
      "The list is paged as every list is.",
      "cli: from org-ready, `org head app list --limit 2 --json` prints frappe and erpnext and a `nextCursor`; `--after <it>` prints hrms and crm and `nextCursor: null`.",
    ),
  ],
  returns: rpc_organizations_apps_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    outsider(),
    { error: error_INVALID_INPUT, given: W_READY, when: "`--limit` is outside 1 to 100, or `--after` is a cursor this list did not issue: nothing is read." },
  ],
  budget: budget("read"),
});

export const operation_org_head_app_add = defineOperation({
  id: "org.head.app.add",
  title: "Add a Frappe app the Organization needs",
  about:
    "Asks for a Frappe app beyond the fundamental ones, such as Helpdesk: one Capxul can ask a head's host to install. " +
    "It lives only on a connected head, so with no head it waits, wanted; with a head on Frappe Cloud, its host is asked " +
    "to install it, and on a self-hosted head its owner installs it with bench; either way it is listed installed once " +
    "the head shows it. Adding an app already wanted, or installed on the head, changes nothing; a fundamental app is " +
    "always installed and is refused. " +
    "A Director runs it, or the Organization's FDE for a Director who asks it in conversation.",
  area: AREA,
  command: "org head app add",
  priority: "critical",
  implementedBy: rpc_organizations_apps_add,
  who: WHO_DIRECTOR_OR_FDE,
  changes: "The app's row, wanted (or wanted again), with who asked; a connected head's process then asks its host to install it.",
  acceptance: [
    claim(
      "A Director adds an app; with no head it waits, wanted, and adding it again changes nothing.",
      "cli: from org-ready, `org head app add helpdesk --json` prints helpdesk `status: wanted` and addedBy Dana's member id; the same command again prints the same; read: `org head app list` lists helpdesk once; world: one row added in all.",
    ),
    claim(
      "The hosted FDE adds an app for a Director who asks it; a member without the Director hat may not, nor the FDE for them.",
      "cli: from org-with-fde with the stand-in host holding turns, after Dana's `org fde ask … --timeout-seconds 1` (CLI_DEADLINE, her ask open), the FDE's `org head app add helpdesk --org acme --json` under it (`capxul-devnet fde run acme --ask <Dana's askId> --`) prints it wanted with addedBy Dana's member id; from org-with-member, Sam's `org head app add helpdesk` exits ROLE_PERMISSION_DENIED and the world does not change.",
    ),
    claim(
      "With a head connected, an added app is installed on the head and listed installed with the head's version.",
      "cli: from org-with-head (a Frappe Cloud head), `org head app add helpdesk`; once the head connection's process has asked the head's host and read the site again, `org head app list` prints helpdesk `status: installed` with the version the stand-in head reports; read: `org head show` lists it installed.",
    ),
  ],
  returns: rpc_organizations_apps_add.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notDirector(W_MEMBER, "adds an app"),
    {
      error: error_INVALID_INPUT,
      given: W_READY,
      when: "The app is not one Capxul can ask a head's host to install (`nonsense`), or is a fundamental app (`crm`): the refusal names it and nothing is written.",
    },
  ],
  budget: budget("write"),
});

export const operation_org_head_app_remove = defineOperation({
  id: "org.head.app.remove",
  title: "Stop wanting a Frappe app",
  about:
    "Stops wanting an app the Organization added, so Capxul no longer asks a head's host to install it; it stays listed " +
    "as removed. The head's owner uninstalls it on the head, and Capxul deletes none of the head's documents. A " +
    "fundamental app is never removed. Adding it again wants it again.",
  area: AREA,
  command: "org head app remove",
  priority: "normal",
  implementedBy: rpc_organizations_apps_remove,
  who: WHO_DIRECTOR_OR_FDE,
  changes: "The app's row moves to removed.",
  acceptance: [
    claim(
      "A removed app stays listed as removed, and adding it again wants it again.",
      "cli: from org-ready, after `org head app add helpdesk`, `org head app remove helpdesk --json` prints `status: removed`; `org head app list` lists it removed; `org head app add helpdesk` then prints it wanted.",
    ),
    claim(
      "A fundamental app is never removed.",
      "cli: from org-ready, `org head app remove crm` exits WRONG_STATE; read: `org head app list` still prints crm installed; world: no diff.",
    ),
  ],
  returns: rpc_organizations_apps_remove.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notDirector(W_MEMBER, "removes an app"),
    { error: error_INVALID_INPUT, given: W_READY, when: "The Organization never had that app (`helpdesk` in org-ready): nothing is written." },
    { error: error_WRONG_STATE, given: W_READY, when: "The app is fundamental (frappe, erpnext, hrms or crm): every Organization keeps it, and nothing is written." },
  ],
  budget: budget("write"),
});

// ── the head (organizations.head-commands; aaron.frappe-head) ───────────────────────────────

const WHO_DIRECTOR =
  "A Director of the Organization: a member whose own Safe wears the Director hat, as indexing reads the chain. Never " +
  "an agent, and never the hosted FDE for a Director (the preview is the Director's own): it may prepare it and ask a " +
  "Director to run it.";

export const operation_org_head_connect = defineOperation({
  id: "org.head.connect",
  title: "Connect a Frappe site as the Organization's head",
  about:
    "Connects a Frappe site, on Frappe Cloud or self-hosted, as the Organization's head: once connected, accounting, " +
    "payroll, the CRM and projects sync with it, and Capxul stays the record of money and identity. It reads the head " +
    "user's API key and secret, and on Frappe Cloud the team's token, from a prompt or from `--key-file` and " +
    "`--team-token-file`, never from a flag; previews what connecting shares and asks (`--confirm` answers yes in a " +
    "script); then follows the site's check until the head is connected, or failing with the reason. An Organization " +
    "has at most one live head.",
  area: AREA,
  command: "org head connect",
  priority: "normal",
  implementedBy: flow_client_org_head_connect,
  who: WHO_DIRECTOR,
  changes:
    "One head connection, its secrets sealed; its process checks the site, installs the wanted apps and pushes the " +
    "members as Users, and every fundamental app's sync starts once it is connected.",
  acceptance: [
    claim(
      "A Director connects a site after a preview, and the command follows the check until the head is connected.",
      "cli: from org-with-head-site, `org head connect <the stand-in's URL> --host frappe-cloud --key-file <its key file> --team-token-file <its team token file> --confirm --json` prints `status: connected` with the stand-in's Frappe and Capxul app versions and Acme's time zone; read: `org head show` prints the same connection.",
    ),
    claim(
      "No key, secret or token is ever printed or read back.",
      "cli: neither the command's `--json` nor `org head show` carries the API key, the secret or the ring secret; trace: no span attribute holds them.",
    ),
    claim(
      "Declining the preview connects nothing.",
      "cli: from org-with-head-site, answering no exits CANCELLED; read: `org head show` prints null; world: no diff.",
    ),
    claim(
      "A site that does not answer leaves the connection failing, and the command says so.",
      "cli: from org-with-head-site-down, the command exits PROVIDER_ERROR once its check fails; read: `org head show` prints `status: failing` with issue `unreachable`.",
    ),
  ],
  returns: flow_client_org_head_connect.output,
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  refusals: [
    signedOut,
    notDirector(W_SITE, "connects the site"),
    {
      error: error_INVALID_INPUT,
      given: W_SITE,
      when: "The site URL is not https, or has a path, query or credentials, or the key file or team token file is not in its form: the refusal names the field and nothing is written.",
    },
    { error: error_WRONG_STATE, given: W_HEAD, when: "Acme already has a live head (connecting, connected or failing): disconnect it first. Nothing is written." },
    { error: error_CANCELLED, given: W_SITE, when: "Dana answers no at the preview: nothing is sent or written." },
    {
      error: error_CLI_USAGE,
      given: W_SITE,
      when: "A script runs it without `--confirm`, or with no terminal to prompt at and no `--key-file` (or, for `--host frappe-cloud`, no `--team-token-file`) to read a secret from: nothing is read or sent.",
    },
    { error: error_PROVIDER_ERROR, given: W_SITE_DOWN, when: "The site does not answer: the connection is kept failing, with the reason, and its process checks it again." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_show = defineOperation({
  id: "org.head.show",
  title: "Show the Organization's head",
  about:
    "Shows the Organization's live head: its site and host, whether it is connecting, connected or failing and why, " +
    "Frappe's and the Capxul app's versions, its time zone, who connected it, when it was last checked and last rang, " +
    "and the Organization's apps as the head runs them. Null when there is none. It never shows a key or a token.",
  area: AREA,
  command: "org head show",
  priority: "normal",
  implementedBy: rpc_organizations_heads_show,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "With no head it prints null; with one, any member reads its state and its apps, and never a secret.",
      "cli: from org-with-member, `org head show --json` prints null; from org-with-head, Sam (a member with no hat) reads `status: connected`, the site, both versions, Acme's time zone and its apps, and no key, token or ring secret.",
    ),
    claim(
      "The head's apps are listed as the head runs them.",
      "cli: from org-with-head, `org head show --json` lists frappe, erpnext, hrms and crm, each `native: true`, `status: installed` and the version the stand-in head reports; read: `org head app list` prints the same four with the same versions.",
    ),
    claim(
      "It reads only what Capxul holds, so it answers while the head is down and never calls it.",
      "cli: from org-with-head-down, `org head show --json` prints `status: connected` and the `checkedAt` of the connection's last check; trace: no frappe-head span; world: no diff.",
    ),
    claim(
      "A head that stops answering shows failing, with the reason, once its daily check has failed, and connected again once a check succeeds.",
      "cli: from org-with-head-down, after `dev time warp 1d` (the connection's daily check, failing past its retries), `org head show --json` prints `status: failing` with issue `unreachable` at the warped day (the stall records the issue's `at`); after `capxul-devnet fault frappe-head clear` and another `dev time warp 1d`, it prints `status: connected`.",
    ),
    claim(
      "When the head last rang is shown on the world's clock.",
      "cli: from org-with-head, after `dev time warp 1h` and an edit by the stand-in head's own Administrator (`capxul-devnet head edit acme Designation new designation_name=Accountant --as Administrator`, which rings), `org head show --json` prints `rungAt` the warped instant.",
    ),
  ],
  returns: rpc_organizations_heads_show.output,
  errors: [error_CLI_USAGE],
  refusals: [signedOut, outsider(W_HEAD)],
  budget: budget("read"),
});

export const operation_org_head_disconnect = defineOperation({
  id: "org.head.disconnect",
  title: "Disconnect the Organization's head",
  about:
    "After a preview, disconnects the Organization's live head: every sync stops, Capxul keeps every record it holds and " +
    "the head keeps its own documents. The head's key is never used again, and its later rings are refused. A new " +
    "connection can be made afterwards.",
  area: AREA,
  command: "org head disconnect",
  priority: "normal",
  implementedBy: flow_client_org_head_disconnect,
  who: WHO_DIRECTOR,
  changes: "The live connection moves to disconnected, and every app concept's sync of it ends.",
  acceptance: [
    claim(
      "A Director disconnects the live head after a preview; Capxul keeps its records, and the head's next ring is refused.",
      "cli: from org-with-head, `org head disconnect --confirm --json` prints `status: disconnected` and disconnectedBy Dana's member id; read: `org head show` prints null and `org projects list` prints what it printed before; trace: the ring of the stand-in head's next edit (`capxul-devnet head edit acme …`) is answered NOT_AUTHENTICATED.",
    ),
    claim(
      "Declining the preview disconnects nothing.",
      "cli: from org-with-head, answering no exits CANCELLED; read: `org head show` still prints `status: connected`; world: no diff.",
    ),
  ],
  returns: flow_client_org_head_disconnect.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notDirector(W_HEAD, "disconnects the head"),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no live head: nothing is asked or written." },
    { error: error_CANCELLED, given: W_HEAD, when: "Dana answers no at the preview: nothing is written." },
    { error: error_CLI_USAGE, given: W_HEAD, when: "A script runs it without `--confirm`." },
  ],
  budget: budget("write"),
});

// ── the hosted FDE (organizations.fde-commands; aaron.fde-agent, aaron.fde-hosted, aaron.fde-anyone) ──

const W_FDE_MEMBER = "org-with-fde-member";
const W_FDE_GUEST = "org-with-fde-guest";
const W_FDE_ALLOWANCE = "org-with-fde-allowance";

const WHO_ASKER =
  "Any member of the Organization, a person or an agent, or a guest its management named (`org fde guest add`): " +
  "aaron.fde-anyone. The FDE then acts as the asker, so it does for them only what their own Seat and hats allow; a " +
  "guest, with no Seat, is allowed only what a counterparty is admitted to. The FDE never asks itself.";

const WHO_MANAGEMENT =
  "People or Director: a member whose own Safe wears the People hat or the Director hat, as indexing reads the chain " +
  "(the Organization's management, which names the outside people it works with).";

/** Olga is outside Acme: no Seat and, in these worlds, no guest row. */
const notAsker = (given: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given,
  when: "Olga, signed in and neither a member nor a guest of Acme, names it with `--org`: refused as an Organization that does not exist is, and nothing is sent or written.",
});
const notManagement = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W_FDE_MEMBER,
  when: `Sam, a member of Acme whose Safe wears neither the People nor the Director hat, ${what}: nothing is written.`,
});

export const operation_org_fde_show = defineOperation({
  id: "org.fde.show",
  title: "Show the Organization's hosted FDE and what its hosting costs",
  about:
    "Shows the Organization's Forward Deployed Engineer, which Capxul hosts: its handle and Safe, whether it is running, " +
    "due, paused or resuming on the host, the hats its Safe wears (it acts with each asker's, not these), the instant " +
    "its hosting is paid to and the day it falls due, the price of a month (FDE_HOSTING_PRICE), what has been paid, and " +
    "who last asked it something. Null for an Organization started without one.",
  area: AREA,
  command: "org fde show",
  priority: "normal",
  implementedBy: rpc_organizations_fde_show,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "An Organization started with its FDE shows it running on Capxul's host, with no hat, its start-up month paid and the price of a month.",
      "cli: from org-with-fde, `org fde show --json` prints handle acme-fde, `status: running`, `hats: []`, paidThrough one calendar month after the setup was ready, dueAt seven days before that, price 20 USDC and monthsPaid 0.",
    ),
    claim(
      "An Organization started without one shows none.",
      "cli: from org-ready (founded with `--no-fde`), `org fde show --json` prints null.",
    ),
    claim(
      "A settled hosting payment moves the paid-through instant on by whole calendar months, counted once.",
      "cli: from org-with-fde-allowance, after Dana's `org fde pay 2 --from capxul` settles, `org fde show --json` prints monthsPaid 2, lastPaidAt the settlement's time and paidThrough two calendar months after the start-up month's end; after a devnet reorg that takes the settling block away and mines the payment again (`capxul-devnet chain`), it prints the same monthsPaid and paidThrough.",
    ),
    claim(
      "A month left unpaid pauses the FDE on the host, and nothing on chain changes.",
      "cli: from org-with-fde-paused, `status: paused` with pausedAt equal to paidThrough; read: `org member list` still lists the FDE's Seat and `agent show @acme-fde --org acme` still prints it active.",
    ),
  ],
  returns: rpc_organizations_fde_show.output,
  errors: [error_CLI_USAGE],
  refusals: [signedOut, outsider()],
  budget: budget("read"),
});

export const operation_org_fde_ask = defineOperation({
  id: "org.fde.ask",
  title: "Ask the Organization's hosted FDE something",
  about:
    "Sends a message to the Organization's Forward Deployed Engineer on Capxul's host, and prints its reply when its " +
    "turn ends. Any member may ask, and so may a guest the Organization's management named. The FDE then works as the " +
    "asker: it does for them only what their own hats allow, and anything that needs a signature comes to the asker to " +
    "approve. At the deadline (`--timeout-seconds`, 300 by default) the command stops waiting and prints the turn's id " +
    "(`org fde turn get` reads it later), and the FDE carries on. A guest names the Organization with `--org`. A paused " +
    "FDE takes no message until its hosting is paid (`org fde pay`).",
  area: AREA,
  command: "org fde ask",
  priority: "normal",
  implementedBy: flow_client_org_fde_ask,
  who: WHO_ASKER,
  changes:
    "One ask recorded (who asked, when, and until when the FDE may act for them; never the message), and one turn of " +
    "the FDE on the host, whose every call is the asker's.",
  acceptance: [
    claim(
      "Any member's message reaches the hosted FDE, and the command prints its reply when the turn ends.",
      "cli: from org-with-fde-member, Sam's (a member with no hat) `org fde ask \"What do you need from me first?\" --org acme --json` prints `status: ended` and the stand-in FDE's reply; read: `org fde show` prints lastAskedBy Sam's member id.",
    ),
    claim(
      "The FDE does for the asker only what the asker's own hats allow.",
      "cli: from org-with-fde-member with the stand-in host holding turns (`capxul-devnet fault fde-host hold`), Sam's and then Dana's `org fde ask \"Add the helpdesk\" --timeout-seconds 1` each exit CLI_DEADLINE with their askId, their asks open; the FDE's `org head app add helpdesk` under Sam's ask (`capxul-devnet fde run acme --ask <Sam's askId> -- org head app add helpdesk --org acme`) exits ROLE_PERMISSION_DENIED; under Dana's it prints helpdesk wanted with addedBy Dana's member id; trace: each call's span names the FDE as actor and its asker.",
    ),
    claim(
      "What needs a signature, the FDE hands to the asker; it never signs for them.",
      "cli: from org-with-fde-allowance with turns held, under Dana's open ask the FDE's `payment send` of 5 USDC to olga@outside.test `--from capxul --json` answers the hand-over, an approval whose signer is Dana's own Safe (she holds `capxul`); chain: nothing moves until Dana approves it (`dev approve <it> --as dana@acme.test`), then one Payment settles from `capxul`, once.",
    ),
    claim(
      "A guest the management named may ask, and the FDE reads nothing of the Organization's for them.",
      "cli: from org-with-fde-guest, Olga's `org fde ask \"Where is my invoice?\" --org acme --json` prints the reply; with turns held, under the ask she then makes (`--timeout-seconds 1`, open), the FDE's `org member list --org acme` exits ROLE_PERMISSION_DENIED.",
    ),
    claim(
      "An ask stops acting for its asker once its turn has ended.",
      "cli: from org-with-fde-member with turns held, under Sam's open ask the FDE's `org head show --org acme` prints null (Acme has no head); after `capxul-devnet fault fde-host clear` and Sam's `org fde turn get` reads the turn ended, the same exits ROLE_PERMISSION_DENIED; world: no write.",
    ),
    claim(
      "The FDE's turn is a wait: at the deadline the command stops waiting, and the FDE carries on.",
      "cli: from org-with-fde with the stand-in host holding turns (`capxul-devnet fault fde-host hold`), `--timeout-seconds 1` exits CLI_DEADLINE and prints the turn id; trace: the turn's wait span is not counted in the budget.",
    ),
    claim(
      "A paused FDE takes no message.",
      "cli: from org-with-fde-paused, the command exits WRONG_STATE naming the instant its hosting lapsed and `org fde pay`; world: no ask recorded.",
    ),
  ],
  returns: flow_client_org_fde_ask.output,
  errors: [error_CLI_USAGE, error_CLI_DEADLINE],
  refusals: [
    signedOut,
    notAsker(W_FDE_MEMBER),
    { error: error_INVALID_INPUT, given: W_FDE, when: "The message is empty or longer than 8,000 characters: nothing is sent." },
    {
      error: error_WRONG_STATE,
      given: W_FDE_PAUSED,
      when: "The FDE is paused because its hosting lapsed unpaid (or Acme has none, as in org-ready): nothing is sent, and the refusal names `org fde pay`.",
    },
    { error: error_PROVIDER_ERROR, given: W_FDE_HOST_DOWN, when: "The FDE host does not answer: nothing is recorded, and asking again later sends the message." },
  ],
  budget: budget("vendor"),
});

export const operation_org_fde_turn_get = defineOperation({
  id: "org.fde.turn.get",
  title: "Read one of your turns with the hosted FDE, and its reply",
  about:
    "Reads a turn the hosted FDE took for a message you sent: still working, ended with its reply, or failed with the " +
    "host's reason. Use it after `org fde ask` stopped waiting at its deadline. Only the asker reads a turn: the reply " +
    "may hold what only they may see.",
  area: AREA,
  command: "org fde turn get",
  priority: "normal",
  implementedBy: rpc_organizations_fde_turn,
  who: "The turn's own asker: the member or the guest who sent its message.",
  changes: "Nothing but a stamp: once read ended or failed, the ask acts for its asker no longer.",
  acceptance: [
    claim(
      "A turn the ask stopped waiting for is read later: working, then ended with the reply.",
      "cli: from org-with-fde with the stand-in host holding turns, after `org fde ask \"Hi\" --timeout-seconds 1` exits CLI_DEADLINE with a turn id, `org fde turn get <it> --json` prints `status: working`; after `capxul-devnet fault fde-host clear`, it prints `status: ended` and the stand-in's reply.",
    ),
    claim(
      "Only its asker reads a turn.",
      "cli: from org-with-fde-member, after Dana's ask, Sam's `org fde turn get <Dana's turn> --org acme` exits INVALID_INPUT and prints nothing of it.",
    ),
  ],
  returns: rpc_organizations_fde_turn.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notAsker(W_FDE_MEMBER),
    { error: error_INVALID_INPUT, given: W_FDE_MEMBER, when: "The turn is not one the caller asked here (another member's, or a made-up id): nothing is read." },
  ],
  budget: budget("vendor"),
});

export const operation_org_fde_guest_add = defineOperation({
  id: "org.fde.guest.add",
  title: "Let an outside person the Organization works with talk to its FDE",
  about:
    "Names someone outside the Organization whom it works with (a customer, a supplier, an accountant, someone it may " +
    "hire) as a guest who may talk to its hosted FDE, by email or a person's @handle, with an optional note of who they " +
    "are. A guest holds no Seat and no hat, so the FDE does for them only what they may do themselves: see their own " +
    "dealings with the Organization, never its members' records. Someone not yet on Capxul is admitted so they can " +
    "sign in, and is told how to ask. Naming someone twice changes nothing.",
  area: AREA,
  command: "org fde guest add",
  priority: "normal",
  implementedBy: rpc_organizations_fde_guests_add,
  who: WHO_MANAGEMENT,
  changes: "One guest row, active, with who named them; a mailbox new to Capxul is named a provisional Party and admitted to the beta.",
  acceptance: [
    claim(
      "A Director names an outside person a guest; naming them twice is one guest.",
      "cli: from org-with-fde-member, Dana's `org fde guest add olga@outside.test --note \"Our accountant\" --org acme --json` prints Olga `status: active`, namedBy Dana's member id and the note; the same command again prints the same; read: `org fde guest list` lists Olga once.",
    ),
    claim(
      "Someone not yet on Capxul is named by email, and can then sign in and ask.",
      "cli: from org-with-fde-member, `org fde guest add newcomer@outside.test --org acme` prints an active guest; then newcomer@outside.test signs in (`auth login`, `auth verify`) and `org fde ask \"Hello\" --org acme` prints the FDE's reply.",
    ),
  ],
  returns: rpc_organizations_fde_guests_add.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notManagement("names a guest"),
    {
      error: error_INVALID_INPUT,
      given: W_FDE_MEMBER,
      when: "The person is a member here (sam@acme.test), an agent's or an Organization's @handle, a malformed email, or the note is longer than 200 characters: the refusal names it and nothing is written.",
    },
  ],
  budget: budget("write"),
});

export const operation_org_fde_guest_remove = defineOperation({
  id: "org.fde.guest.remove",
  title: "Stop an outside person talking to the Organization's FDE",
  about:
    "Removes a guest: from then on they may not ask the FDE, and the FDE no longer acts for them on anything they asked " +
    "before. Their past asks stay recorded. Naming them again lets them ask again.",
  area: AREA,
  command: "org fde guest remove",
  priority: "normal",
  implementedBy: rpc_organizations_fde_guests_remove,
  who: WHO_MANAGEMENT,
  changes: "The guest row moves to removed, with who removed them.",
  acceptance: [
    claim(
      "A removed guest can no longer ask, and naming them again lets them ask again.",
      "cli: from org-with-fde-guest, Dana's `org fde guest remove olga@outside.test --org acme --json` prints `status: removed`; Olga's `org fde ask \"Hi\" --org acme` then exits ROLE_PERMISSION_DENIED; after `org fde guest add olga@outside.test`, her ask prints the reply.",
    ),
    claim(
      "An ask a guest made before removal acts for them no more.",
      "cli: from org-with-fde-guest with turns held, Olga asks (`--timeout-seconds 1`: CLI_DEADLINE, her ask open); under that ask the FDE's `payment list --json` prints Olga's own payments (a guest's own records, which her ask allows); after Dana removes her, the same exits ROLE_PERMISSION_DENIED. (`org fde show` would be refused before the removal too: a guest has no Seat.)",
    ),
  ],
  returns: rpc_organizations_fde_guests_remove.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    notManagement("removes a guest"),
    { error: error_INVALID_INPUT, given: W_FDE_MEMBER, when: "The email, @handle or id names no guest of Acme: nothing is written." },
  ],
  budget: budget("write"),
});

export const operation_org_fde_guest_list = defineOperation({
  id: "org.fde.guest.list",
  title: "List the outside people who may talk to the Organization's FDE",
  about:
    "Lists the Organization's guests, the active ones first (newest named first), then the removed ones, or only one " +
    "kind with `--status active|removed`: each with who they are, the note, who named them and when, and when they were " +
    "removed. Paged with `--limit` and `--after`.",
  area: AREA,
  command: "org fde guest list",
  priority: "normal",
  implementedBy: rpc_organizations_fde_guests_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "Any member lists the guests, each with the note and who named them.",
      "cli: from org-with-fde-guest, Sam's `org fde guest list --org acme --json` lists Olga `status: active` with the note and namedBy Dana's member id, and `nextCursor: null`.",
    ),
    claim(
      "Removed guests follow the active ones, each with when it was removed, and `--status` keeps one kind.",
      "cli: from org-with-fde-guest, after Dana's `org fde guest add newcomer@outside.test --org acme` and `org fde guest remove olga@outside.test --org acme`, `org fde guest list --org acme --json` lists newcomer@outside.test `status: active` first, then Olga `status: removed` with her `removedAt`; `--status removed` lists only Olga and `--status active` only newcomer@outside.test.",
    ),
    claim(
      "The list pages as every list does, and reading it writes nothing.",
      "cli: from the same, `org fde guest list --org acme --limit 1 --json` prints newcomer@outside.test and a `nextCursor`; `--after <it>` prints Olga and `nextCursor: null`; world: no diff from either read.",
    ),
  ],
  returns: rpc_organizations_fde_guests_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: W_FDE_GUEST,
      when: "Olga, a guest and no member, lists Acme's guests: a guest only asks; nothing is read.",
    },
    { error: error_INVALID_INPUT, given: W_FDE_GUEST, when: "`--limit` is outside 1 to 100, or `--after` is a cursor this list did not issue: nothing is read." },
  ],
  budget: budget("read"),
});

// ── seats (organizations.seats-show; aaron.buy-seats) ───────────────────────────────────────

export const operation_org_seats_show = defineOperation({
  id: "org.seats.show",
  title: "Show the Organization's seats and the price of one more",
  about:
    "Shows how many Seats the Organization may fill (ten to start, plus what it bought or a Capxul operator raised), " +
    "how many its people's Seats and its open offers use, whether its own agent holds its place beside the ten, the " +
    "seats it bought, and the price of one more seat (SEAT_PRICE, paid once). `org seats buy` buys more.",
  area: AREA,
  command: "org seats show",
  priority: "normal",
  implementedBy: rpc_organizations_seats_show,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization has ten seats, its founder's Seat using one, none bought, and the price of one more.",
      "cli: from org-ready, `org seats show --json` prints seatLimit 10, seatsUsed 1, offersReserved 0, seatsBought 0 and price 10 USDC.",
    ),
    claim(
      "An open offer reserves a seat, and the Organization's own FDE rides beside the ten.",
      "cli: from org-with-pending-invitation, offersReserved 1; from org-with-fde, seatsUsed 1 and ownAgent true.",
    ),
  ],
  returns: rpc_organizations_seats_show.output,
  errors: [error_CLI_USAGE],
  refusals: [signedOut, outsider()],
  budget: budget("read"),
});

// ── the document family (organizations.doc-family; aaron.sdk-reaches-everything) ────────────

const W_HEAD_DOCS = "org-with-head-docs";
const W_HEAD_DOWN = "org-with-head-down";

/** The refusals every document command shares, each from a catalogued world (organizations.doc-worlds). */
const docRefusals = (command: string) => [
  signedOut,
  outsider(W_HEAD),
  {
    error: error_WRONG_STATE,
    given: W_MEMBER,
    when: "Acme has no connected head (none, or one still connecting or failing): the refusal names its status, and the head is not called.",
  },
  {
    error: error_INVALID_INPUT,
    given: W_HEAD_DOCS,
    when: `${command} names a DocType Capxul names itself: a native concept's (\`Employee\`, naming \`org hr employee\`), the head's machinery (\`Webhook\`) or unhooked money (\`Repost Item Valuation\`): the head is not called.`,
  },
  {
    error: error_INVALID_INPUT,
    given: W_HEAD_DOCS,
    when: `${command} names a native module's DocType (\`Project\`, naming \`org projects\`), money (\`Stock Entry\`, which ERPNext's hooks list as posting to the ledger), a child table, or a DocType the head does not have: the head's Capxul app refuses it with its reason.`,
  },
  { error: error_PROVIDER_ERROR, given: W_HEAD_DOWN, when: "The head does not answer: nothing is written there, and the refused call is logged." },
];
const notPermitted = (what: string) => ({
  error: error_ROLE_PERMISSION_DENIED,
  given: W_HEAD_DOCS,
  when: `Sam, whose head User has no HR role (his Safe wears no People hat), ${what}: the head refuses it, nothing is written there, and the call is logged refused.`,
});
const unknownDoc = { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "The name is one the head does not have (`HR-OPN-2026-9999`): nothing is read or written." };
const DOC_ERRORS = [error_CLI_USAGE];
const DOC_AREA = AREA;

export const operation_org_head_doc_list = defineOperation({
  id: "org.head.doc.list",
  title: "List documents of a DocType on the Organization's head",
  about:
    "Lists the documents of one DocType that lives only on the connected head, such as `Job Opening` or `Appraisal`, " +
    "as your own User on the head may see them: newest change first, with each one's name, status and list fields. " +
    "`--filter <field><op><value>` (repeatable, all applying together; the operator is the longest of `=`, `!=`, `>`, " +
    "`>=`, `<`, `<=`, `~` like and `!~` not like after the field's name, and `%` in the value is like's wildcard), " +
    "`--field` (repeatable) and `--order-by` shape it. What a native concept holds (projects, the CRM, payroll and HR's " +
    "leave and expenses, the books) has its own commands, and money is never read here.",
  area: DOC_AREA,
  command: "org head doc list",
  priority: "normal",
  implementedBy: rpc_organizations_docs_list,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged (`org head doc-call list`).",
  acceptance: [
    claim(
      "A member lists a head-only DocType's documents as their own head User sees them, newest change first.",
      "cli: from org-with-head-docs, Dana's `org head doc list \"Job Opening\" --org acme --json` prints HR-OPN-2026-0002 then HR-OPN-2026-0001 (the world changed -0002 a second later), each with docstatus 0 and its `modified`; Sam's exits ROLE_PERMISSION_DENIED, since his head User may not read Job Openings.",
    ),
    claim(
      "Filters apply together, and the list pages as every list does.",
      "cli: from org-with-head-docs, `org head doc list \"Job Opening\" --filter status=Open --limit 1 --json` prints one opening and a `nextCursor`; `--after <it>` prints the other open one and `nextCursor: null`.",
    ),
    claim(
      "A DocType a native concept owns is refused, naming its own commands: by Capxul before any call when Capxul names it, by the head's Capxul app when its module is native.",
      "cli: from org-with-head-docs, `org head doc list Employee --org acme` exits INVALID_INPUT naming `org hr employee`, with no frappe-head span in its trace; `org head doc list Project` exits INVALID_INPUT naming `org projects`, refused by the head's Capxul app; read: `org head doc-call list` shows both calls refused.",
    ),
    claim(
      "Every call is logged with whose authority it ran.",
      "read: from org-with-head-docs, after Dana's list, `org head doc-call list --org acme --json` prints one call: verb list, Job Opening, Dana's member id, head user dana@acme.test, outcome done, count 2, `at` the world's now.",
    ),
  ],
  returns: rpc_organizations_docs_list.output,
  errors: DOC_ERRORS,
  refusals: [...docRefusals("The list"), notPermitted("lists Job Openings")],
  budget: budget("vendor"),
});

export const operation_org_head_doc_get = defineOperation({
  id: "org.head.doc.get",
  title: "Show one document on the Organization's head",
  about:
    "Shows one head document by its DocType and its name on the head: every field your head User may read, its child " +
    "rows, whether it is a draft, submitted or cancelled, its Workflow state and the actions you may take, and what you " +
    "may do to it (change, submit, cancel, amend, remove). `--field` (repeatable) prints only those fields.",
  area: DOC_AREA,
  command: "org head doc get",
  priority: "normal",
  implementedBy: rpc_organizations_docs_get,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged.",
  acceptance: [
    claim(
      "A member reads one document with its child rows, its status, and what they may do to it.",
      "cli: from org-with-head-docs, Dana's `org head doc get \"Training Event\" \"Safety training\" --org acme --json` prints docstatus 1, `status: submitted`, its `employees` rows, `permissions.cancel: true` and `permissions.remove: false`.",
    ),
    claim(
      "Under a Workflow, the actions the member may take are listed.",
      "cli: from org-with-head-docs, Dana's `org head doc get \"Job Applicant\" kim@applicants.test --json` (Frappe HR names a Job Applicant by its email) prints `workflowState: Open` and `actions: [Shortlist, Reject]`, the actions her head User's HR Manager role may take.",
    ),
  ],
  returns: rpc_organizations_docs_get.output,
  errors: DOC_ERRORS,
  refusals: [...docRefusals("The read"), unknownDoc],
  budget: budget("vendor"),
});

export const operation_org_head_doc_create = defineOperation({
  id: "org.head.doc.create",
  title: "Create a document on the Organization's head",
  about:
    "Creates a document of a DocType that lives only on the head, as your own User there, with `--set <field>=<value>` " +
    "(repeatable; the value sent as text, for the head to read as its field's type) and `--file <path>` (a JSON object " +
    "of fields with their types, child tables as arrays of rows); with both, each `--set` overrides the file's field " +
    "of that name. The head names it, " +
    "fills its defaults and runs its own checks; a submittable one is made a draft. It is the head's document: Capxul " +
    "keeps no copy of it, only the call in its log.",
  area: DOC_AREA,
  command: "org head doc create",
  priority: "normal",
  implementedBy: rpc_organizations_docs_create,
  who: WHO_HEAD_USER,
  changes: "One document on the head, made by the member's head User; one call logged.",
  acceptance: [
    claim(
      "A member creates a head document as their own head User, and Capxul keeps only the call.",
      "cli: from org-with-head-docs, Dana's `org head doc create \"Job Opening\" --set job_title=Bookkeeper --set designation=Accountant --set company=\"Acme Ltd\" --org acme --json` prints a draft named HR-OPN-2026-0003 owned by dana@acme.test; read: `org head doc get` prints it; world: no Capxul table changes but `org-doc-calls`.",
    ),
    claim(
      "The head's own checks refuse a document they would refuse in its desk, and nothing is made.",
      "cli: from org-with-head-docs, the same without `--set job_title` exits INVALID_INPUT naming the field; read: `org head doc list \"Job Opening\"` still prints two; `org head doc-call list` shows the call refused with the head's message.",
    ),
    claim(
      "It is made on the world's clock.",
      "cli: from org-with-head-docs after `dev time warp 3d`, Dana's create prints `creation` on the warped day; read: `org head doc-call list` prints `at` the warped instant.",
    ),
    claim(
      "A retried create makes one document.",
      "trace: from org-with-head-docs with the stand-in head holding its first answer back (`capxul-devnet fault frappe-head drop-answer`), the first attempt is logged refused PROVIDER_ERROR, the SDK's retry repeats the call id, the head answers the document it made, and that row is completed; read: `org head doc list \"Job Opening\"` prints three, not four, and `org head doc-call list` prints the create once, done, with `completedAt`.",
    ),
  ],
  returns: rpc_organizations_docs_create.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The create"),
    notPermitted("creates a Job Opening"),
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "A mandatory field is missing, a link names nothing, or `--file` is not a JSON object of fields: the refusal names it and nothing is made." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_change = defineOperation({
  id: "org.head.doc.change",
  title: "Change a document on the Organization's head",
  about:
    "Changes a head document's fields with `--set`, `--file` or `--clear <field>` (repeatable; as create takes them, " +
    "a `--set` over the file's field and a field both set and cleared CLI_USAGE), keeping the rest. Its " +
    "status never changes here: `org head doc submit`, `cancel` and `apply` do that. A submitted document takes only the " +
    "fields its DocType lets change after submission. `--modified <stamp>`, from `org head doc get`, refuses the change if " +
    "someone changed the document since.",
  area: DOC_AREA,
  command: "org head doc change",
  priority: "normal",
  implementedBy: rpc_organizations_docs_change,
  who: WHO_HEAD_USER,
  changes: "The document's fields on the head; one call logged with the field names.",
  acceptance: [
    claim(
      "A member changes the fields given and keeps the rest.",
      "cli: from org-with-head-docs, Dana's `org head doc change \"Job Opening\" HR-OPN-2026-0001 --set planned_vacancies=2 --org acme --json` prints `planned_vacancies: 2` and the same job title; read: `org head doc-call list` names the field, not its value.",
    ),
    claim(
      "A change based on an older read is refused, and nothing is written.",
      "cli: from org-with-head-docs, Dana reads HR-OPN-2026-0001's `modified` (`org head doc get`), and after `dev time warp 90s` changes it (`--set planned_vacancies=2`); then `org head doc change \"Job Opening\" HR-OPN-2026-0001 --modified <the stamp first read> --set planned_vacancies=3` exits WRONG_STATE; read: `org head doc get` prints planned_vacancies 2. The warp is needed: the head stamps with the world's now, so on a frozen clock both changes would carry one stamp.",
    ),
  ],
  returns: rpc_organizations_docs_change.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The change"),
    notPermitted("changes a Job Opening"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is cancelled, or submitted and the field is not one it allows after submission, or it changed since `--modified`: nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_submit = defineOperation({
  id: "org.head.doc.submit",
  title: "Submit a draft document on the Organization's head",
  about:
    "Submits a draft of a submittable DocType on the head, such as a Training Event or an Appraisal, as your own User " +
    "there: it becomes submitted and its fields are fixed, as Frappe's Submit does. A DocType under a Workflow moves by " +
    "`org head doc apply` instead.",
  area: DOC_AREA,
  command: "org head doc submit",
  priority: "normal",
  implementedBy: rpc_organizations_docs_submit,
  who: WHO_HEAD_USER,
  changes: "The document's docstatus on the head becomes submitted; one call logged.",
  acceptance: [
    claim(
      "A draft is submitted, and submitting it again is refused.",
      "cli: from org-with-head-docs, Dana's `org head doc submit \"Training Event\" \"Onboarding week\" --org acme --json` prints docstatus 1, `status: submitted`; the same again exits WRONG_STATE naming submitted.",
    ),
    claim(
      "It submits as the member's own head User, on the world's clock, and the call is logged with the docstatus it left.",
      "cli: from org-with-head-docs after `dev time warp 1d`, Dana's submit of \"Onboarding week\" prints `modified` on the warped day; read: `org head doc-call list --doctype \"Training Event\" --name \"Onboarding week\" --org acme --json` prints it: verb submit, outcome done, head user dana@acme.test, docstatus 1 and headModified that `modified`.",
    ),
    claim(
      "A DocType that is never submitted is refused, and its document stays as it was.",
      "cli: from org-with-head-docs, `org head doc submit \"Job Opening\" HR-OPN-2026-0001 --org acme` exits INVALID_INPUT; read: `org head doc get \"Job Opening\" HR-OPN-2026-0001` still prints docstatus 0; world: no diff on the head.",
    ),
    claim(
      "A retried submit submits once.",
      "trace: from org-with-head-docs with the stand-in head holding its first answer back (`capxul-devnet fault frappe-head drop-answer`), the submit of \"Onboarding week\" is logged refused PROVIDER_ERROR on its first attempt, the SDK's retry repeats the call id and the head's Capxul app answers the submit it already applied; cli: the command prints docstatus 1; read: `org head doc-call list --doctype \"Training Event\" --name \"Onboarding week\"` prints the submit once, done, with `completedAt`.",
    ),
  ],
  returns: rpc_organizations_docs_submit.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The submit"),
    notPermitted("submits a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is already submitted or cancelled, or its DocType is under an active Workflow: nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_cancel = defineOperation({
  id: "org.head.doc.cancel",
  title: "Cancel a submitted document on the Organization's head",
  about:
    "Cancels a submitted head document, as Frappe's Cancel does: it is kept, cancelled for good, and `org head doc amend` " +
    "makes its correction. A document that submitted documents still link to cannot be cancelled until they are, and " +
    "one under a Workflow moves only by `org head doc apply`.",
  area: DOC_AREA,
  command: "org head doc cancel",
  priority: "normal",
  implementedBy: rpc_organizations_docs_cancel,
  who: WHO_HEAD_USER,
  changes: "The document's docstatus on the head becomes cancelled; one call logged.",
  acceptance: [
    claim(
      "A submitted document is cancelled and kept.",
      "cli: from org-with-head-docs, Dana's `org head doc cancel \"Training Event\" \"Safety training\" --org acme --json` prints docstatus 2, `status: cancelled`; read: `org head doc get` still prints it.",
    ),
    claim(
      "A draft cannot be cancelled.",
      "cli: from org-with-head-docs, `org head doc cancel \"Training Event\" \"Onboarding week\"` exits WRONG_STATE naming draft; world: no diff on the head.",
    ),
  ],
  returns: rpc_organizations_docs_cancel.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The cancel"),
    notPermitted("cancels a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is a draft or already cancelled, under an active Workflow, or still linked from a submitted document: nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_amend = defineOperation({
  id: "org.head.doc.amend",
  title: "Amend a cancelled document on the Organization's head",
  about:
    "Makes the correction of a cancelled head document, as Frappe's Amend does: a new draft copied from it, whose " +
    "`amended_from` names it and whose name, by Frappe's default, is the old one with `-1` (an amendment's amendment " +
    "`-2`). Change and submit the draft as any other.",
  area: DOC_AREA,
  command: "org head doc amend",
  priority: "normal",
  implementedBy: rpc_organizations_docs_amend,
  who: WHO_HEAD_USER,
  changes: "One new draft on the head; one call logged.",
  acceptance: [
    claim(
      "A cancelled document is amended into a new draft that names it.",
      "cli: from org-with-head-docs, Dana's `org head doc amend \"Training Event\" \"Old induction\" --org acme --json` prints a draft named `Old induction-1` with `amendedFrom: Old induction`; amending a submitted one exits WRONG_STATE.",
    ),
    claim(
      "The amendment is a draft like any other, and the cancelled document it corrects stays cancelled.",
      "cli: from org-with-head-docs, after Dana's amend of \"Old induction\", `org head doc submit \"Training Event\" \"Old induction-1\" --org acme --json` prints docstatus 1; read: `org head doc get \"Training Event\" \"Old induction\"` still prints `status: cancelled`.",
    ),
    claim(
      "An amendment's amendment takes the next number.",
      "cli: from org-with-head-docs, after amending \"Old induction\", submitting `Old induction-1` and cancelling it (`org head doc cancel`), `org head doc amend \"Training Event\" \"Old induction-1\" --org acme --json` prints a draft named `Old induction-2` with `amendedFrom: Old induction-1`.",
    ),
    claim(
      "A retried amend makes one amendment.",
      "trace: from org-with-head-docs with the stand-in head holding its first answer back (`capxul-devnet fault frappe-head drop-answer`), the amend's first attempt is logged refused PROVIDER_ERROR, the SDK's retry repeats the call id and the head answers the draft it made; cli: the command prints the draft `Old induction-1` with `amendedFrom: Old induction`; read: `org head doc list \"Training Event\" --filter \"amended_from=Old induction\" --org acme` lists one document, `Old induction-1`, and `org head doc-call list` prints the amend once, done, with `completedAt`.",
    ),
  ],
  returns: rpc_organizations_docs_amend.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The amend"),
    notPermitted("amends a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is not cancelled: nothing is made." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_apply = defineOperation({
  id: "org.head.doc.apply",
  title: "Take a Workflow action on a document on the Organization's head",
  about:
    "Takes one action of the Workflow a head DocType runs under (such as Shortlist or Reject on a Job Applicant), as " +
    "your own User there: the document moves to the action's next state, submitting or cancelling it when that state " +
    "says so. `org head doc get` lists the actions you may take.",
  area: DOC_AREA,
  command: "org head doc apply",
  priority: "normal",
  implementedBy: rpc_organizations_docs_apply,
  who: WHO_HEAD_USER,
  changes: "The document's Workflow state on the head, and its docstatus where the next state sets one; one call logged.",
  acceptance: [
    claim(
      "An action moves the document to its next state.",
      "cli: from org-with-head-docs, Dana's `org head doc apply \"Job Applicant\" kim@applicants.test Shortlist --org acme --json` prints `workflowState: Shortlisted` and its next actions.",
    ),
    claim(
      "An action the document's state does not offer is refused.",
      "cli: from org-with-head-docs, `org head doc apply \"Job Applicant\" kim@applicants.test Accept` while it is Open exits WRONG_STATE naming Open; world: no diff on the head.",
    ),
  ],
  returns: rpc_organizations_docs_apply.output,
  errors: DOC_ERRORS,
  refusals: [
    ...docRefusals("The action"),
    notPermitted("shortlists a Job Applicant"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The action is not one the document's current state offers: the refusal names the state and nothing is written." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_remove = defineOperation({
  id: "org.head.doc.remove",
  title: "Delete a document on the Organization's head",
  about:
    "Deletes a head document that is not submitted (a draft, a cancelled one, or one of a DocType that is never " +
    "submitted), as Frappe's Delete does, after a preview, since it cannot be undone from Capxul; `--confirm` answers " +
    "yes in a script. A submitted document is cancelled, never deleted.",
  area: DOC_AREA,
  command: "org head doc remove",
  priority: "normal",
  implementedBy: flow_client_org_head_docs_remove,
  who: `${WHO_HEAD_USER} Never the hosted FDE for its asker: the preview is the member's own (organizations.fde-for-the-asker).`,
  changes: "The document is deleted on the head (which keeps its own Deleted Document record); two calls logged, the read and the delete.",
  acceptance: [
    claim(
      "A draft is deleted after a preview.",
      "cli: from org-with-head-docs, Dana's `org head doc remove \"Training Event\" \"Onboarding week\" --confirm --org acme --json` prints `removed: true`; read: `org head doc get` of it then exits INVALID_INPUT.",
    ),
    claim(
      "A submitted document is never deleted, and declining the preview deletes nothing.",
      "cli: from org-with-head-docs, removing \"Safety training\" exits WRONG_STATE; answering no at the preview for \"Onboarding week\" exits CANCELLED; world: no diff on the head after either.",
    ),
  ],
  returns: flow_client_org_head_docs_remove.output,
  errors: [error_CLI_USAGE],
  refusals: [
    ...docRefusals("The delete"),
    notPermitted("deletes a Training Event"),
    unknownDoc,
    { error: error_WRONG_STATE, given: W_HEAD_DOCS, when: "The document is submitted, or a document that is not cancelled still links to it: nothing is deleted." },
    { error: error_CANCELLED, given: W_HEAD_DOCS, when: "Dana answers no at the preview: nothing is deleted." },
    {
      error: error_ROLE_PERMISSION_DENIED,
      given: "org-with-fde-head-docs",
      when: "The hosted FDE runs it under Dana's open ask (the stand-in host holding her turn, `capxul-devnet fault fde-host hold`): the preview is Dana's own to answer (organizations.fde-for-the-asker), and nothing is deleted.",
    },
    { error: error_CLI_USAGE, given: W_HEAD_DOCS, when: "A script runs it without `--confirm`: nothing is read or deleted." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doctype_list = defineOperation({
  id: "org.head.doctype.list",
  title: "List the head's DocTypes that the document family reaches",
  about:
    "Lists the DocTypes of the apps on the connected head that `org head doc` reaches, by name, with each one's app and " +
    "module and whether it is submitted. `--all` lists every other one too, with why it is not reached: a native one " +
    "names the commands that reach it, a money one is Capxul's, and the head's machinery is never reached. `--app` and " +
    "`--module` narrow it.",
  area: DOC_AREA,
  command: "org head doctype list",
  priority: "normal",
  implementedBy: rpc_organizations_doctypes_list,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged.",
  acceptance: [
    claim(
      "A member sees which head DocTypes the family reaches, and with `--all` why the rest are not.",
      "cli: from org-with-head-docs, `org head doctype list --app hrms --org acme --json` lists Job Opening, Job Applicant and Training Event `reach: reachable` and no Leave Application; with `--all` it also lists Leave Application `reach: native` naming `hr leave` and `org hr leave`, and Expense Claim `reach: native` naming `hr expense-claim` and `org hr expense-claim`; `--app erpnext --all` lists Stock Entry `reach: money`.",
    ),
    claim(
      "`--module` narrows it, and a native module's DocType names that module's commands.",
      "cli: from org-with-head-docs, `org head doctype list --app erpnext --module Projects --all --org acme --json` lists Project `reach: native` with `commands` naming `org projects`, and no DocType of another module.",
    ),
    claim(
      "Child tables are never listed: each is reached only through its parent.",
      "cli: from org-with-head-docs, `org head doctype list --app hrms --all --org acme --json` lists Training Event and no Training Event Employee, whose rows `org head doc get \"Training Event\" \"Safety training\"` prints under `employees`.",
    ),
    claim(
      "The list pages by name.",
      "cli: from org-with-head-docs, `org head doctype list --app hrms --limit 2 --org acme --json` prints two DocTypes in name order and a `nextCursor`; `--after <it>` prints those that follow them by name, neither repeated.",
    ),
    claim(
      "Every call is logged, as a read of the head.",
      "read: from org-with-head-docs, after Dana's `org head doctype list --app hrms`, `org head doc-call list --org acme --json` prints the call: verb doctypes, outcome done, Dana's member id and head user dana@acme.test; world: no Capxul table changes but `org-doc-calls`, and none on the head.",
    ),
  ],
  returns: rpc_organizations_doctypes_list.output,
  errors: DOC_ERRORS,
  refusals: [
    signedOut,
    outsider(W_HEAD),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no connected head: the head is not called." },
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "`--app` or `--module` names none the head has, or `--limit` or `--after` is not one this list takes: nothing is read." },
    { error: error_PROVIDER_ERROR, given: W_HEAD_DOWN, when: "The head does not answer." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doctype_get = defineOperation({
  id: "org.head.doctype.get",
  title: "Show one of the head's DocTypes: its fields, Workflow and your rights",
  about:
    "Shows one DocType on the connected head: its fields and child tables with their types and which are mandatory, " +
    "whether it is submitted, its Workflow's states and actions, what your head User may do with it, and whether " +
    "`org head doc` reaches it or which commands do. Use it to know what `org head doc create --set` takes.",
  area: DOC_AREA,
  command: "org head doctype get",
  priority: "normal",
  implementedBy: rpc_organizations_doctypes_get,
  who: WHO_HEAD_USER,
  changes: "Nothing on the head: the call is logged.",
  acceptance: [
    claim(
      "A member reads a DocType's fields, child tables, Workflow and their own rights on it.",
      "cli: from org-with-head-docs, Dana's `org head doctype get \"Job Opening\" --org acme --json` prints `reach: reachable`, job_title, company and designation `required: true`, and `permissions.create: true`; Sam's prints `permissions.create: false`.",
    ),
    claim(
      "A native DocType is described, with the commands that reach it.",
      "cli: from org-with-head-docs, `org head doctype get Employee --json` prints `reach: native` and `commands` naming `org hr employee`.",
    ),
  ],
  returns: rpc_organizations_doctypes_get.output,
  errors: DOC_ERRORS,
  refusals: [
    signedOut,
    outsider(W_HEAD),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no connected head: the head is not called." },
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "The head has no DocType of that name: nothing is read." },
    { error: error_PROVIDER_ERROR, given: W_HEAD_DOWN, when: "The head does not answer." },
  ],
  budget: budget("vendor"),
});

export const operation_org_head_doc_call_list = defineOperation({
  id: "org.head.doc-call.list",
  title: "List the document family's calls to the head: who, what and when",
  about:
    "Lists the calls `org head doc` and `org head doctype` made to the head, newest first: whose authority each ran with (a " +
    "member's, or the FDE's for the member who asked it), the head User, what it did to which document, and whether it " +
    "was done or refused and why; never a field's value. A Director sees every call; any other member sees the calls " +
    "made with their own authority. `--doctype`, `--name` and, for a Director, `--member` narrow it.",
  area: DOC_AREA,
  command: "org head doc-call list",
  priority: "normal",
  implementedBy: rpc_organizations_doc_calls_list,
  who: "Any member: a Director reads every call; anyone else the calls made with their own authority (organizations.doc-log).",
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A Director sees every call; another member sees only their own.",
      "cli: from org-with-head-docs, after Dana's and Sam's `org head doc list \"Job Opening\"`, Dana's `org head doc-call list --org acme --json` prints both calls, Sam's refused; Sam's prints only his own.",
    ),
    claim(
      "A call the FDE made for a member is logged under that member, with the ask.",
      "cli: from org-with-fde-head-docs with turns held, after Dana's `org fde ask … --timeout-seconds 1` (CLI_DEADLINE, her ask open), the FDE's `org head doc list \"Job Opening\"` under her ask (`capxul-devnet fde run acme --ask <it> --`) is printed by `org head doc-call list` with memberId Dana's, her askId and head user dana@acme.test.",
    ),
  ],
  returns: rpc_organizations_doc_calls_list.output,
  errors: [error_CLI_USAGE],
  refusals: [
    signedOut,
    outsider(W_HEAD),
    { error: error_INVALID_INPUT, given: W_HEAD_DOCS, when: "`--name` without `--doctype`, `--member` from someone who is not a Director or naming no member, or a bad `--limit` or `--after`: nothing is read." },
  ],
  budget: budget("read"),
});

/** The eight operations of the pack organizations.commands, for its `affects`; `org seats show` is organizations.buy-seats'. */
export const NEW_OPERATIONS = [
  operation_org_head_app_list, operation_org_head_app_add, operation_org_head_app_remove, operation_org_head_connect, operation_org_head_show,
  operation_org_head_disconnect, operation_org_fde_show, operation_org_fde_ask,
];

/** The FDE commands aaron.fde-anyone adds: reading a turn later, and the guests the management names (organizations.fde-guests). */
export const FDE_ANYONE_OPERATIONS = [
  operation_org_fde_turn_get, operation_org_fde_guest_add, operation_org_fde_guest_remove, operation_org_fde_guest_list,
];

/** The document family's twelve operations, the pack organizations.doc-family's. */
export const DOC_OPERATIONS = [
  operation_org_head_doc_list, operation_org_head_doc_get, operation_org_head_doc_create, operation_org_head_doc_change, operation_org_head_doc_submit,
  operation_org_head_doc_cancel, operation_org_head_doc_amend, operation_org_head_doc_apply, operation_org_head_doc_remove,
  operation_org_head_doctype_list, operation_org_head_doctype_get, operation_org_head_doc_call_list,
];
