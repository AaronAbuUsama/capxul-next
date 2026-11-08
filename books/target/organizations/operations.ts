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
import { rpc_organizations_heads_disconnect, rpc_organizations_heads_show } from "./heads.ts";
import { rpc_organizations_fde_show } from "./fde.ts";
import { rpc_organizations_seats_show } from "./members.ts";
import { flow_client_org_fde_ask, flow_client_org_head_connect } from "./flows.ts";
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
// organizations.commands (sections 5.4: `org app list|add|remove`, `org head connect|show|disconnect`,
// `org fde show|ask`), which serve aaron.frappe-shape, aaron.frappe-head, aaron.fde-agent and
// aaron.fde-hosted, and `org seats show`, organizations' one command of the pack
// organizations.buy-seats (aaron.buy-seats). Each acts for the Organization `--org` names (else `use
// org`'s), its id is its command's words joined by dots, and it is one SDK method under
// `client.org(orgId)`. Who may run each is a Seat or a hat, never a named person
// (docs/design/authority.md). The commands an Organization's start-up needs are `critical`
// (organizations.command-priorities). Every refusal starts from a catalogued world
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

export const operation_org_app_list = defineOperation({
  id: "org.app.list",
  title: "List the Organization's Frappe apps",
  about:
    "Lists the Frappe apps the Organization runs: the fundamental ones (Frappe, ERPNext's accounting and projects, " +
    "Frappe HR's payroll, Frappe CRM), held natively by Capxul from the first day, head or no head; and every other app " +
    "it asked for, which lives only on a connected head: wanted until the head installs it, installed with the version " +
    "the head runs, or removed. Use it to see what the FDE or a Director added, and what a head still has to install.",
  area: AREA,
  command: "org app list",
  priority: "critical",
  implementedBy: rpc_organizations_apps_list,
  who: WHO_MEMBER,
  changes: NOTHING_READ,
  acceptance: [
    claim(
      "A new Organization runs the four fundamental apps, installed and native, and nothing else.",
      "cli: from org-ready, `org app list --json` prints frappe, erpnext, hrms and crm, each `native: true`, `status: installed`, `addedBy: null`, and no other app.",
    ),
    claim(
      "An app asked for is listed as wanted, with who asked, until a head installs it.",
      "cli: from org-ready, after `org app add helpdesk`, `org app list` lists helpdesk once, `native: false`, `status: wanted`, `version: null` and addedBy Dana's member id.",
    ),
  ],
  returns: rpc_organizations_apps_list.output,
  errors: [error_CLI_USAGE],
  refusals: [signedOut, outsider()],
  budget: budget("read"),
});

export const operation_org_app_add = defineOperation({
  id: "org.app.add",
  title: "Add a Frappe app the Organization needs",
  about:
    "Asks for a Frappe app beyond the fundamental ones, such as Helpdesk: one Capxul can ask a head's host to install. " +
    "It lives only on a connected head, so with no head it waits, wanted; with one, the head's host is asked to install " +
    "it, and it is listed installed once the head shows it. Adding an app already wanted or installed changes nothing. " +
    "A Director runs it, or the Organization's FDE in conversation with its people.",
  area: AREA,
  command: "org app add",
  priority: "critical",
  implementedBy: rpc_organizations_apps_add,
  who: WHO_DIRECTOR_OR_FDE,
  changes: "The app's row, wanted (or wanted again), with who asked; a connected head's process then asks its host to install it.",
  acceptance: [
    claim(
      "A Director adds an app; with no head it waits, wanted, and adding it again changes nothing.",
      "cli: from org-ready, `org app add helpdesk --json` prints helpdesk `status: wanted` and addedBy Dana's member id; the same command again prints the same; read: `org app list` lists helpdesk once; world: one row added in all.",
    ),
    claim(
      "The Organization's own FDE may add an app; a member without the Director hat may not.",
      "cli: from org-with-fde, the FDE's own `org app add helpdesk --org acme --json`, run with its key through the stand-in host (`capxul-devnet fde run acme --`), prints it wanted with addedBy the FDE's member id; from org-with-member, Sam's `org app add helpdesk` exits ROLE_PERMISSION_DENIED and the world does not change.",
    ),
    claim(
      "With a head connected, an added app is installed on the head and listed installed with the head's version.",
      "cli: from org-with-head, `org app add helpdesk`; once the head connection's check has run, `org app list` prints helpdesk `status: installed` with the version the stand-in head reports; read: `org head show` lists it installed.",
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

export const operation_org_app_remove = defineOperation({
  id: "org.app.remove",
  title: "Stop wanting a Frappe app",
  about:
    "Stops wanting an app the Organization added, so Capxul no longer asks a head's host to install it; it stays listed " +
    "as removed. The head's owner uninstalls it on the head, and Capxul deletes none of the head's documents. A " +
    "fundamental app is never removed. Adding it again wants it again.",
  area: AREA,
  command: "org app remove",
  priority: "normal",
  implementedBy: rpc_organizations_apps_remove,
  who: WHO_DIRECTOR_OR_FDE,
  changes: "The app's row moves to removed.",
  acceptance: [
    claim(
      "A removed app stays listed as removed, and adding it again wants it again.",
      "cli: from org-ready, after `org app add helpdesk`, `org app remove helpdesk --json` prints `status: removed`; `org app list` lists it removed; `org app add helpdesk` then prints it wanted.",
    ),
    claim(
      "A fundamental app is never removed.",
      "cli: from org-ready, `org app remove crm` exits WRONG_STATE; read: `org app list` still prints crm installed; world: no diff.",
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
  "an agent, so never the FDE, which may prepare it and ask a Director to run it.";

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
      "cli: from org-with-head-site, `org head connect <the stand-in's URL> --host self-hosted --key-file <its key file> --confirm --json` prints `status: connected` with the stand-in's Frappe and Capxul app versions and Acme's time zone; read: `org head show` prints the same connection.",
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
      when: "The site URL is not https, or has a path, query or credentials, or a Frappe Cloud head has no team token: the refusal names the field and nothing is written.",
    },
    { error: error_WRONG_STATE, given: W_HEAD, when: "Acme already has a live head (connecting, connected or failing): disconnect it first. Nothing is written." },
    { error: error_CANCELLED, given: W_SITE, when: "Dana answers no at the preview: nothing is sent or written." },
    { error: error_CLI_USAGE, given: W_SITE, when: "A script runs it without `--confirm`, or with neither a terminal nor `--key-file` to read the key from." },
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
  implementedBy: rpc_organizations_heads_disconnect,
  who: WHO_DIRECTOR,
  changes: "The live connection moves to disconnected, and every app concept's sync of it ends.",
  acceptance: [
    claim(
      "A Director disconnects the live head after a preview; Capxul keeps its records, and the head's next ring is refused.",
      "cli: from org-with-head, `org head disconnect --confirm --json` prints `status: disconnected` and disconnectedBy Dana's member id; read: `org head show` prints null and `org project list` prints what it printed before; trace: the stand-in head's next ring is answered NOT_AUTHENTICATED.",
    ),
    claim(
      "Declining the preview disconnects nothing.",
      "cli: from org-with-head, answering no exits CANCELLED; read: `org head show` still prints `status: connected`; world: no diff.",
    ),
  ],
  returns: rpc_organizations_heads_disconnect.output,
  errors: [error_CLI_USAGE, error_CANCELLED],
  refusals: [
    signedOut,
    notDirector(W_HEAD, "disconnects the head"),
    { error: error_WRONG_STATE, given: W_MEMBER, when: "Acme has no live head: nothing is written." },
    { error: error_CANCELLED, given: W_HEAD, when: "Dana answers no at the preview: nothing is written." },
    { error: error_CLI_USAGE, given: W_HEAD, when: "A script runs it without `--confirm`." },
  ],
  budget: budget("write"),
});

// ── the hosted FDE (organizations.fde-commands; aaron.fde-agent, aaron.fde-hosted) ──────────

export const operation_org_fde_show = defineOperation({
  id: "org.fde.show",
  title: "Show the Organization's hosted FDE and what its hosting costs",
  about:
    "Shows the Organization's Forward Deployed Engineer, which Capxul hosts: its handle and Safe, whether it is running, " +
    "due, paused or resuming on the host, the hats the Board granted it, the instant its hosting is paid to and the day " +
    "it falls due, the price of a month (FDE_HOSTING_PRICE), what has been paid, and who last asked it something. Null " +
    "for an Organization started without one.",
  area: AREA,
  command: "org fde show",
  priority: "critical",
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
    "turn ends. The FDE acts with the hats the Board granted it, so only a Director instructs it. Whatever it does in " +
    "return it does through its own commands, signed with its own key and each traced. At the deadline " +
    "(`--timeout-seconds`, 300 by default) the command stops waiting and prints the turn's id, and the FDE carries on. " +
    "A paused FDE takes no message until its hosting is paid (`org fde pay`).",
  area: AREA,
  command: "org fde ask",
  priority: "critical",
  implementedBy: flow_client_org_fde_ask,
  who: WHO_DIRECTOR,
  changes: "One ask recorded (who asked, and when; never the message), and one turn of the FDE on the host.",
  acceptance: [
    claim(
      "A Director's message reaches the hosted FDE, and the command prints its reply when the turn ends.",
      "cli: from org-with-fde, `org fde ask \"What do you need from me first?\" --json` prints `status: ended` and the stand-in FDE's reply; read: `org fde show` prints lastAskedBy Dana's member id.",
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
    notDirector(W_MEMBER, "asks the FDE"),
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

/** The operations beyond the 215 organizations books, for its pack decisions' `affects`. */
export const NEW_OPERATIONS = [
  operation_org_app_list, operation_org_app_add, operation_org_app_remove, operation_org_head_connect, operation_org_head_show,
  operation_org_head_disconnect, operation_org_fde_show, operation_org_fde_ask,
];
