// The target operation records of the eleven frozen operations accounts designs (OPERATION_OWNERS):
// account retry and show, auth login and verify, referral, referral invite and list, the operator's
// waitlist invites grant, waitlist join and status, and dev fund. One operation beyond the 215 (rule 4a):
// `account collect`, the owner of a claim escrow collecting it whenever it chooses (aaron.escrow-general, decision
// accounts.collect-any-time); it has no frozen text, so its title, about and who are written for the target.
//
// Every record is built from the frozen text (frozenText), never retyped. Acceptance lines keep the
// frozen claims word for word (none names a mechanism a black box cannot see), each with what its
// observers check and its old test citation in `was`. Refusal texts are the designed v4 text where
// the frozen record has one (P10), else the frozen text; a refusal the frozen text names only in a
// mistake or a note says so. Worlds are the devnet snapshots listed in `accounts.worlds`.

import { Schema } from "effect";
import { budget, defineOperation } from "../../../packages/book/src/index.ts";
import { frozen, frozenText, type FrozenId } from "../../frozen/index.ts";
import {
  error_CLI_USAGE,
  error_FEATURE_NOT_AVAILABLE,
  error_INVALID_INPUT,
  error_NOT_AUTHENTICATED,
  error_PROFILE_NOT_FOUND,
  error_SMART_ACCOUNT_MISSING,
  error_WRONG_ENVIRONMENT,
  error_WRONG_STATE,
} from "../shared/vocabulary.ts";
import { rpc_accounts_admission_join, rpc_accounts_admission_status, WaitlistStatus } from "./admission.ts";
import { flow_client_account_collect, flow_client_auth_sign_in, flow_client_auth_verify_otp } from "./flows.ts";
import { rpc_accounts_grants_fund } from "./grants.ts";
import {
  rpc_accounts_referrals_grant_invites,
  rpc_accounts_referrals_invite,
  rpc_accounts_referrals_list,
  rpc_accounts_referrals_show,
} from "./referrals.ts";
import { Collection, rpc_accounts_setup_check, rpc_accounts_setup_lifecycle, SetupCheck, SetupLifecycle } from "./setup.ts";

const S = Schema.String;
const Int = Schema.Int;

type FrozenRefusal = { readonly code: string; readonly when: string };
type FrozenLine = { readonly claim: string; readonly was: readonly string[] };

/** The refusal's text: the designed v4 text where there is one (P10), else the frozen text. */
const when = (id: FrozenId, code: string): string => {
  const f = frozen[id] as unknown as { refusals: readonly FrozenRefusal[]; designed: { refusals: readonly FrozenRefusal[] } | null };
  const found = f.designed?.refusals.find((r) => r.code === code) ?? f.refusals.find((r) => r.code === code);
  if (!found) throw new Error(`${id}: no frozen refusal ${code}`);
  return found.when;
};

/** Acceptance line n (from 1): the frozen claim word for word, what is observed, and its old test citation. */
const line = (id: FrozenId, n: number, observes: string) => {
  const a = (frozen[id].acceptance as unknown as readonly FrozenLine[])[n - 1];
  if (!a) throw new Error(`${id}: no acceptance line ${n}`);
  return { claim: a.claim, observes, was: [...a.was] };
};

/**
 * Acceptance line n (from 1) rewritten: the new claim, what is observed, and in `was` the frozen claim first, then its
 * old test citation. A decision on the operation says what changed.
 */
const rewritten = (id: FrozenId, n: number, claim: string, observes: string) => {
  const a = (frozen[id].acceptance as unknown as readonly FrozenLine[])[n - 1];
  if (!a) throw new Error(`${id}: no acceptance line ${n}`);
  return { claim, observes, was: [a.claim, ...a.was] };
};

// ── worlds (decision accounts.worlds) ───────────────────────────────────────────────────────

const NO_SESSION = "signed-out";
const PERSON_WAITING = "person-on-waitlist";
const PERSON_NO_PROFILE = "person-admitted-no-profile";
const PERSON_ADMITTED = "person-unclaimed";
const PERSON_NO_INVITES = "person-admitted-no-invites";
const TWO_ADMITTED = "two-people-admitted";
const PERSON_READY = "person-ready";
const REFUSED_OTHER_SIGNER = "setup-refused-other-signer";
const REFUSED_EMAIL = "setup-refused-non-ascii-email";
/** A person whose Safe is set up, with a claim escrow it owns still uncollected (devnet names it; accounts.collect-any-time). */
const PERSON_READY_MONEY_WAITING = "person-ready-money-waiting";
/** Money waits for a mailbox whose person has signed in but not set up (devnet's `person-with-money-waiting`). */
const PERSON_MONEY_WAITING = "person-with-money-waiting";
/** No devnet world runs off a devnet; the staging `live:*` evals reach it. */
const OFF_DEVNET = "?";

// ── account ─────────────────────────────────────────────────────────────────────────────────

export const operation_account_retry = defineOperation({
  ...frozenText("account.retry"),
  priority: "critical",
  implementedBy: rpc_accounts_setup_check,
  acceptance: [
    line(
      "account.retry",
      1,
      "cli: from person-unclaimed, exit 0 with `setupState` `setup-required`, `setupUrl` and `next.argv`; world: no setup row, " +
        "no claim transaction and no CapxulSafeClaimed appear; chain: Companies House still owns the derived Safe.",
    ),
  ],
  returns: SetupCheck,
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("account.retry", "NOT_AUTHENTICATED") },
    { error: error_WRONG_STATE, given: REFUSED_OTHER_SIGNER, when: when("account.retry", "WRONG_STATE") },
    { error: error_INVALID_INPUT, given: REFUSED_EMAIL, when: when("account.retry", "INVALID_INPUT") },
  ],
  budget: budget("read"),
  was: ["apps/docs/factory/operations/account.retry.yaml", "apps/cli/src/commands/account", "apps/cli/src/auth/profile-report.ts:18"],
});

export const operation_account_show = defineOperation({
  ...frozenText("account.show"),
  priority: "normal",
  implementedBy: rpc_accounts_setup_lifecycle,
  acceptance: [
    line("account.show", 1, "cli: from person-ready, the lifecycle `ready`; world: the before-and-after diff is empty (no setup row or process changes)."),
    line(
      "account.show",
      2,
      "cli: from setup-refused-other-signer, `failed` at `claiming` with code WRONG_STATE and its message; the output holds no revert data, stack or provider text.",
    ),
    line("account.show", 3, "cli: from signed-out, exit 3 with NOT_AUTHENTICATED; trace: the rpc span ends NOT_AUTHENTICATED with no table read."),
    line(
      "account.show",
      4,
      "cli and trace: from two-people-admitted, a call naming the other person's id is NOT_AUTHENTICATED, and its answer carries none of their fields.",
    ),
  ],
  returns: Schema.Struct({ lifecycle: SetupLifecycle }),
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("account.show", "NOT_AUTHENTICATED") },
    {
      error: error_PROFILE_NOT_FOUND,
      given: PERSON_NO_PROFILE,
      when: "Ran it before your account was set up (the frozen mistake): you have not completed your profile. Run `capxul account retry` for the link.",
    },
    {
      error: error_SMART_ACCOUNT_MISSING,
      given: PERSON_ADMITTED,
      when: "Ran it before your account was set up (the frozen mistake): your profile is done but your Safe's setup has not started.",
    },
  ],
  budget: budget("read"),
  was: ["apps/docs/factory/operations/account.show.yaml", "apps/cli/src/commands/account"],
});

// ── account collect: beyond the 215 (rules.new-operations; decision accounts.collect-any-time) ──────

export const operation_account_collect = defineOperation({
  id: "account.collect",
  title: "Collect the money waiting for you",
  about:
    "Collects into your own Safe every payment waiting for you in a claim escrow: money someone sent your email before " +
    "you had an account and that you did not collect at setup, or a dated payment that reached its escrow after you set " +
    "up. One approval from your Safe collects them all; you sign it on the approval page. Until you collect, the sender " +
    "may still take the money back (for an Organization's payment, whoever wears the paying budget's hat then, or its " +
    "Board). Nothing waiting: it says so and opens nothing.",
  who: "A signed-in person whose own Safe is set up, for the payments waiting for that Safe.",
  area: "accounts",
  command: "account collect",
  priority: "normal",
  implementedBy: flow_client_account_collect,
  acceptance: [
    {
      claim:
        "A person whose Safe is set up collects, in one approval, every claim escrow their Safe owns that holds its amount, and each of those payments then reads settled for its payer and for them.",
      observes:
        `From ${PERSON_READY_MONEY_WAITING}: chain: one UserOperation from the person's Safe calls \`collect\` on each open escrow, and one PaymentSent per escrow with the escrow as sender and the Safe as recipient; read: the payer's \`payment get\` reads settled; world: each escrow reads paid.`,
    },
    {
      claim: "With nothing waiting for the person's Safe, nothing is opened and the command says so.",
      observes: "cli: from person-ready, exit 0 with an empty `escrows` list and no `approval_id`; world: the before-and-after diff holds no approval.",
    },
    {
      claim: "Money its sender took back is not offered, and a collection pays only the person's own Safe.",
      observes:
        `From ${PERSON_READY_MONEY_WAITING} after the payer's \`payment cancel\` of it landed: cli: \`escrows\` no longer lists it and no approval is opened for it; chain: every collection's PaymentSent names the person's Safe as recipient.`,
    },
  ],
  returns: Collection,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: "You are not signed in." },
    {
      error: error_SMART_ACCOUNT_MISSING,
      given: PERSON_MONEY_WAITING,
      when: "Your Safe is not set up yet. Setting it up collects what waits for you; `capxul account retry` gives the link.",
    },
  ],
  budget: budget("chain-submit"),
  was: ["apps/docs/factory/operations/account.retry.yaml (designed: Escrow.collect() at setup)"],
});

// ── auth ────────────────────────────────────────────────────────────────────────────────────

export const operation_auth_login = defineOperation({
  ...frozenText("auth.login"),
  priority: "critical",
  implementedBy: flow_client_auth_sign_in,
  acceptance: [
    line(
      "auth.login",
      1,
      "cli: from signed-out, without a terminal, `authenticated` false, `status` `otp-required` and the `capxul auth verify` argv; world: the mail sink holds one code for the email; read: `auth list` shows no session.",
    ),
    line("auth.login", 2, "cli: from signed-out, with the sink's code on `--otp-stdin`, `authenticated` true; read: `auth list` marks the person current."),
  ],
  returns: flow_client_auth_sign_in.output,
  errors: [error_CLI_USAGE],
  refusals: [
    { error: error_CLI_USAGE, given: NO_SESSION, when: when("auth.login", "CLI_USAGE") },
    { error: error_INVALID_INPUT, given: NO_SESSION, when: when("auth.login", "INVALID_INPUT") },
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("auth.login", "NOT_AUTHENTICATED") },
  ],
  budget: { ...budget("vendor"), excludes: ["sdk.step.code"] },
  was: ["apps/docs/factory/operations/auth.login.yaml", "apps/cli/src/commands/auth"],
});

export const operation_auth_verify = defineOperation({
  ...frozenText("auth.verify"),
  priority: "critical",
  implementedBy: flow_client_auth_verify_otp,
  acceptance: [
    line(
      "auth.verify",
      1,
      "cli: after `auth login` without a terminal from signed-out, `auth verify <code>` with the sink's code prints `authenticated` true; read: `auth list` marks the person current and no sign-in waits.",
    ),
    line("auth.verify", 2, "cli: from signed-out with nothing waiting, exit 2 with CLI_USAGE and a pointer to `capxul auth login`; world: unchanged."),
  ],
  returns: flow_client_auth_verify_otp.output,
  errors: [error_CLI_USAGE],
  refusals: [{ error: error_CLI_USAGE, given: NO_SESSION, when: when("auth.verify", "CLI_USAGE") }],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/auth.verify.yaml", "apps/cli/src/commands/auth"],
});

// ── referrals ───────────────────────────────────────────────────────────────────────────────

export const operation_referral_invite = defineOperation({
  ...frozenText("referral.invite"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_invite,
  acceptance: [
    line(
      "referral.invite",
      1,
      "cli: from person-unclaimed, `invitesLeft` 2; read: `waitlist status` as the friend is `admitted` with `referredBy` masked, and the referrer's `referral list` shows the friend `invite` at `admitted`; world: the mail sink holds the friend's invite email.",
    ),
    line("referral.invite", 2, "cli: from person-on-waitlist, exit 6 with FEATURE_NOT_AVAILABLE; world: unchanged."),
    line(
      "referral.invite",
      3,
      "cli: from person-unclaimed, the referrer's own mailbox (with a +tag) is INVALID_INPUT; from two-people-admitted, the other's mailbox is WRONG_STATE `already_admitted`; from person-admitted-no-invites, WRONG_STATE `no_invites_left`; world: unchanged each time.",
    ),
  ],
  returns: Schema.Struct({ email: S, access: Schema.Literal("admitted"), invitesLeft: Int }),
  refusals: [
    { error: error_WRONG_STATE, given: PERSON_NO_INVITES, when: when("referral.invite", "WRONG_STATE") },
    { error: error_FEATURE_NOT_AVAILABLE, given: PERSON_WAITING, when: when("referral.invite", "FEATURE_NOT_AVAILABLE") },
    { error: error_INVALID_INPUT, given: PERSON_ADMITTED, when: when("referral.invite", "INVALID_INPUT") },
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("referral.invite", "NOT_AUTHENTICATED") },
  ],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/referral.invite.yaml", "apps/cli/src/commands/referral"],
});

export const operation_referral_list = defineOperation({
  ...frozenText("referral.list"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_list,
  acceptance: [
    line(
      "referral.list",
      1,
      "cli: from person-unclaimed, after one friend joins with the person's `--ref` and another is invited, two rows newest first: the invite at `admitted`, the link at `attributed`, each email shown as first letter and domain.",
    ),
  ],
  returns: rpc_accounts_referrals_list.output,
  refusals: [{ error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("referral.list", "NOT_AUTHENTICATED") }],
  budget: budget("read"),
  was: ["apps/docs/factory/operations/referral.list.yaml", "apps/cli/src/commands/referral"],
});

export const operation_referral_show = defineOperation({
  ...frozenText("referral.show"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_show,
  acceptance: [
    line(
      "referral.show",
      1,
      "cli: from person-unclaimed, the first run prints a code and `invitesLeft` 3, a second run the same code and still 3; world: one code row, made once.",
    ),
    line("referral.show", 2, "cli: from person-on-waitlist, a code and its link with `invitesLeft` 0."),
  ],
  returns: rpc_accounts_referrals_show.output,
  refusals: [{ error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("referral.show", "NOT_AUTHENTICATED") }],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/referral.show.yaml", "apps/cli/src/commands/referral"],
});

export const operation_waitlist_invites_grant = defineOperation({
  ...frozenText("waitlist.invites.grant"),
  priority: "normal",
  implementedBy: rpc_accounts_referrals_grant_invites,
  acceptance: [],
  returns: Schema.Struct({ email: S, invitesLeft: Int }),
  refusals: [{ error: error_INVALID_INPUT, given: PERSON_ADMITTED, when: when("waitlist.invites.grant", "INVALID_INPUT") }],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/waitlist.invites.grant.yaml", "packages/backend/scripts/beta-waitlist.ts"],
});

// ── waitlist ────────────────────────────────────────────────────────────────────────────────

export const operation_waitlist_join = defineOperation({
  ...frozenText("waitlist.join"),
  priority: "normal",
  implementedBy: rpc_accounts_admission_join,
  acceptance: [
    line(
      "waitlist.join",
      1,
      "cli: from person-signed-in (not on the list), `waitlist join --note A` then `--note B` both print one `requestedAt`, the second with note B; read: `waitlist status` shows note B and that `requestedAt`.",
    ),
    line("waitlist.join", 2, "cli: from person-unclaimed, `waitlist join --note X` still prints `access` `admitted`; read: `waitlist status` keeps `admittedAt`."),
    line("waitlist.join", 3, "cli: from person-on-waitlist, a 501-character note is exit 2 with INVALID_INPUT on `note`; world: unchanged."),
  ],
  returns: Schema.Struct({
    email: S,
    access: WaitlistStatus.fields.access,
    requestedAt: WaitlistStatus.fields.requestedAt,
    note: WaitlistStatus.fields.note,
    referredBy: WaitlistStatus.fields.referredBy,
  }),
  refusals: [
    { error: error_INVALID_INPUT, given: PERSON_WAITING, when: when("waitlist.join", "INVALID_INPUT") },
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("waitlist.join", "NOT_AUTHENTICATED") },
  ],
  budget: budget("write"),
  was: ["apps/docs/factory/operations/waitlist.join.yaml", "apps/cli/src/commands/waitlist"],
});

export const operation_waitlist_status = defineOperation({
  ...frozenText("waitlist.status"),
  priority: "normal",
  implementedBy: rpc_accounts_admission_status,
  acceptance: [
    line(
      "waitlist.status",
      1,
      "cli: from person-on-waitlist-open-beta (on the list, never admitted, the deployment's `beta-access` gate on for everyone), `access` `open` and `admittedAt` null.",
    ),
    rewritten(
      "waitlist.status",
      2,
      "In a closed beta a person stays `waiting` until an operator admits them, or money waits for them in a claim escrow, then gets `admitted` with `admittedAt`.",
      "cli: from person-on-waitlist with the gate closed, `access` `waiting`; after the operator's waitlist tool admits the email, `access` `admitted` with `admittedAt`. " +
        "From person-with-money-waiting (never on the list, the gate closed, 5 USDC waiting for the mailbox in a claim escrow), `access` `admitted` with `admittedAt` " +
        "the instant the escrow was indexed; world: its admissions row is `escrow:<the Payment>`, and `dev mail notices --to nobody@outside.test` shows `money-waiting` and no `beta-welcome`.",
    ),
  ],
  returns: WaitlistStatus,
  refusals: [{ error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("waitlist.status", "NOT_AUTHENTICATED") }],
  budget: budget("read"),
  was: ["apps/docs/factory/operations/waitlist.status.yaml", "apps/cli/src/commands/waitlist"],
});

// ── dev fund ────────────────────────────────────────────────────────────────────────────────

export const operation_dev_fund = defineOperation({
  ...frozenText("dev.fund"),
  priority: "normal",
  implementedBy: rpc_accounts_grants_fund,
  acceptance: [],
  returns: Schema.Struct({ amount: Schema.Struct({ asset: S, value: S }), txHash: S }),
  refusals: [
    { error: error_INVALID_INPUT, given: PERSON_READY, when: when("dev.fund", "INVALID_INPUT") },
    { error: error_WRONG_ENVIRONMENT, given: OFF_DEVNET, when: when("dev.fund", "WRONG_ENVIRONMENT") },
    { error: error_NOT_AUTHENTICATED, given: NO_SESSION, when: when("dev.fund", "NOT_AUTHENTICATED") },
    {
      error: error_FEATURE_NOT_AVAILABLE,
      given: PERSON_WAITING,
      when: "You are still on the waitlist: until Capxul admits you the faucet refuses (the frozen note of `waitlist status`).",
    },
    { error: error_SMART_ACCOUNT_MISSING, given: PERSON_ADMITTED, when: "Your Safe's setup has not started, so there is no Safe of yours to fund yet." },
  ],
  budget: budget("chain-submit"),
  was: ["apps/docs/factory/operations/dev.fund.yaml", "apps/cli/src/commands/dev"],
});
