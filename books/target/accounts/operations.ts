// The target operation records of the eleven frozen operations accounts designs (OPERATION_OWNERS):
// account retry and show, auth login and verify, referral, referral invite and list, the operator's
// waitlist invites grant, waitlist join and status, and dev fund. The owner's later collection of its claim escrows,
// booked here first as `account collect`, is payments' `payment claim` over accounts' rpc `accounts.setup.collect`
// (aaron.payment-claim; decisions accounts.collect-any-time and payments.claim-command).
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
import { WaitlistStatus } from "./admission.ts";
import { flow_client_auth_sign_in, flow_client_auth_verify_otp } from "./flows.ts";
import { rpc_accounts_grants_fund } from "./grants.ts";
import { rpc_accounts_setup_check, rpc_accounts_setup_lifecycle, SetupCheck, SetupLifecycle } from "./setup.ts";

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

// ── waitlist ────────────────────────────────────────────────────────────────────────────────

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
