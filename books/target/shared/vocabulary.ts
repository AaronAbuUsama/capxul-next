// The target vocabulary: every error code the rebuilt Capxul answers with. There are no events here:
// each concept defines its machines' `<machine>_transitioned` events in its own data.ts (policy P7).
//
// How the list was made (decisions in ./decisions.ts, prefixed `vocabulary.`):
// - Start from the old codes (books/as-is/shared/vocabulary.ts, 50 codes).
// - Keep every code the frozen book names: in a refusal (top-level or designed), a mistake's fix or
//   an acceptance line (P10 rung 1: the surface is the book's).
// - Add the five codes the frozen book's equity refusals name that the old code never defined.
// - Keep the five unnamed codes the runtime needs (a defect, a revert, a malformed answer, an
//   unbuilt operation, a CLI crash), and drop or merge the rest, one decision each.
//
// Fields:
// - `class`: ADR-0039's classes, now with `auth` and `permission`, which the old code never used
//   (NOT_AUTHENTICATED was `input`, ROLE_PERMISSION_DENIED was `state`). The old `by-mode` codes get
//   one class each; the failure mode travels in `details.mode`, never in the code.
// - `actor`: who acts next, as the old book mapped it (input → caller, state → person,
//   provider-unavailable → system, the rest → operator), with auth → caller, permission → person.
// - `exit`: the frozen book's designed refusal exit wherever it names the code (its v4 text wins,
//   P10), else the old CLI's `exitClass`. One code, one exit: the designed text's two outliers are
//   settled in `vocabulary.exit-codes`.
// - `was`: the old code's definition, as `<path>:<line>` in /home/user/factory.

import { defineError } from "../../../packages/book/src/index.ts";

const CODES = "packages/protocol/src/errors/codes.ts";
const ORGS = "packages/protocol/src/organizations/error-codes.ts";
const PAYROLL = "packages/protocol/src/payroll/error-codes.ts";
const PERMISSIONS = "packages/protocol/src/permissions/error-codes.ts";
const CLI = "apps/cli/src/runtime/errors.ts";
const OPS = "apps/docs/factory/operations";

// ── who is calling ──────────────────────────────────────────────────────────────────────────

export const error_NOT_AUTHENTICATED = defineError({
  id: "NOT_AUTHENTICATED",
  title: "Not signed in",
  class: "auth",
  actor: "caller",
  message: "The request has no valid sign-in.",
  retryable: false,
  exit: 3,
  was: [`${CODES}:28`],
});

export const error_OTP_EXPIRED = defineError({
  id: "OTP_EXPIRED",
  title: "Sign-in code expired",
  class: "input",
  actor: "caller",
  message: "The sign-in code expired.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:50`, `${OPS}/auth.verify.yaml`],
});

export const error_PROFILE_NOT_FOUND = defineError({
  id: "PROFILE_NOT_FOUND",
  title: "No Capxul profile",
  class: "state",
  actor: "person",
  message: "The person has no Capxul profile yet. Run `capxul account retry` to finish setup.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:30`, `${OPS}/account.show.yaml`],
});

export const error_SMART_ACCOUNT_MISSING = defineError({
  id: "SMART_ACCOUNT_MISSING",
  title: "No account on chain yet",
  class: "state",
  actor: "person",
  message: "The person's own Safe is not claimed yet. Run `capxul account retry` to finish setup.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:31`],
});

export const error_ROLE_PERMISSION_DENIED = defineError({
  id: "ROLE_PERMISSION_DENIED",
  title: "Not allowed",
  class: "permission",
  actor: "person",
  message: "You are not allowed to do this, so nothing was signed.",
  retryable: false,
  exit: 4,
  was: [`${CODES}:44`],
});

export const error_ROLE_CONFLICT = defineError({
  id: "ROLE_CONFLICT",
  title: "Roles cannot be held together",
  class: "state",
  actor: "person",
  message: "One person cannot hold these two roles together.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:45`],
});

export const error_VERIFICATION_REQUIRED = defineError({
  id: "VERIFICATION_REQUIRED",
  title: "Verification required",
  class: "state",
  actor: "person",
  message: "The person or business must be verified first. Run `capxul verify start`.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:41`, `${OPS}/bank.pay.yaml`],
});

export const error_FEATURE_NOT_AVAILABLE = defineError({
  id: "FEATURE_NOT_AVAILABLE",
  title: "Feature not switched on",
  class: "state",
  actor: "person",
  message: "This feature is not switched on for you or your Organization.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:61`],
});

export const error_CAPABILITY_UNAVAILABLE = defineError({
  id: "CAPABILITY_UNAVAILABLE",
  title: "Deployment cannot do this",
  class: "state",
  actor: "person",
  message: "This deployment cannot do what the request asks.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:37`],
});

export const error_WRONG_ENVIRONMENT = defineError({
  id: "WRONG_ENVIRONMENT",
  title: "Wrong environment",
  class: "input",
  actor: "caller",
  message: "This command does not run in the current environment.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:59`],
});

// ── the request and the state it meets ──────────────────────────────────────────────────────

export const error_INVALID_INPUT = defineError({
  id: "INVALID_INPUT",
  title: "Invalid input",
  class: "input",
  actor: "caller",
  message: "A value in the request is not valid, or names nothing you can see.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:38`, `${CODES}:33`],
});

export const error_WRONG_STATE = defineError({
  id: "WRONG_STATE",
  title: "Wrong state",
  class: "state",
  actor: "person",
  // P9 retires the `pre_v4` reason; ACCOUNT_CLAIMED_BY_OTHER_SIGNER and ACTOR_STOPPED merge here.
  message: "The request is valid, but the current state does not allow it.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:53`, `${CODES}:34`, `${CODES}:57`],
});

export const error_SUPERSEDED = defineError({
  id: "SUPERSEDED",
  title: "Superseded by a newer request",
  class: "state",
  actor: "person",
  message: "A newer request replaced this one. Do not retry the older request.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:55`, `${OPS}/payment.send.yaml`],
});

export const error_RATE_LIMITED = defineError({
  id: "RATE_LIMITED",
  title: "Rate limited",
  class: "state",
  actor: "person",
  message: "Too many requests arrived in a short time. Wait, then try again.",
  retryable: true,
  exit: 6,
  was: [`${CODES}:47`],
});

export const error_CANCELLED = defineError({
  id: "CANCELLED",
  title: "Cancelled",
  class: "input",
  actor: "caller",
  // SIGNER_REJECTED merges here: a person declining on the approval page is a cancel (frozen fixes).
  message: "The command stopped before it finished, or the approval was declined. Nothing was sent.",
  retryable: true,
  exit: 130,
  was: [`${CODES}:52`, `${CODES}:51`],
});

// ── money ───────────────────────────────────────────────────────────────────────────────────

export const error_INSUFFICIENT_BALANCE = defineError({
  id: "INSUFFICIENT_BALANCE",
  title: "Not enough money",
  class: "state",
  actor: "person",
  message: "The paying Safe or budget does not hold enough money for this payment.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:42`, `${OPS}/payment.send.yaml`],
});

export const error_INVALID_RECIPIENT = defineError({
  id: "INVALID_RECIPIENT",
  title: "Recipient cannot be paid",
  class: "input",
  actor: "caller",
  message: "The payment cannot go to this recipient: the address is zero, Payments itself or nothing at all.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:43`, `${OPS}/payment.send.yaml`],
});

export const error_PAYER_BALANCE_TOO_LOW = defineError({
  id: "PAYER_BALANCE_TOO_LOW",
  title: "Organization balance too low",
  class: "state",
  actor: "person",
  message: "The Organization's account holds less than this collection pays.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:11`],
});

export const error_PAYROLL_BUDGET_EXCEEDED = defineError({
  id: "PAYROLL_BUDGET_EXCEEDED",
  title: "Budget exceeded",
  class: "state",
  actor: "person",
  message: "The payment, offer or raise needs more than the budget has left this period, or more than its payout ceiling. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${PAYROLL}:9`],
});

export const error_TOKEN_NOT_SUPPORTED = defineError({
  id: "TOKEN_NOT_SUPPORTED",
  title: "Token not supported",
  class: "input",
  actor: "caller",
  message: "The token is not one Capxul pays in on this network. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${PAYROLL}:13`],
});

export const error_TOKEN_REQUIRED = defineError({
  id: "TOKEN_REQUIRED",
  title: "Token must be named",
  class: "input",
  actor: "caller",
  message: "The budget is in more than one token, so the request must name the one it pays in. Nothing was signed.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:15`],
});

export const error_TOKEN_NOT_BUDGETED = defineError({
  id: "TOKEN_NOT_BUDGETED",
  title: "No budget in that token",
  class: "state",
  actor: "person",
  message: "There is no budget in the token the request names. Nothing was signed.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:17`],
});

export const error_AMOUNT_BELOW_USE = defineError({
  id: "AMOUNT_BELOW_USE",
  title: "Budget below what it uses",
  class: "state",
  actor: "person",
  message: "The new budget is below what it already uses this period. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${PAYROLL}:20`],
});

export const error_CHILDREN_EXCEED_PARENT = defineError({
  id: "CHILDREN_EXCEED_PARENT",
  title: "More than the parent budget has left",
  class: "state",
  actor: "person",
  message: "The budget asks its parent for more than the parent has left to give. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${PERMISSIONS}:9`],
});

// ── equity (low priority, off the critical path) ────────────────────────────────────────────

export const error_AUTHORISED_EXCEEDED = defineError({
  id: "AUTHORISED_EXCEEDED",
  title: "More shares than authorised",
  class: "input",
  actor: "caller",
  message: "The shares asked for are more than the class authorises. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${ORGS}:9`],
});

export const error_BELOW_THRESHOLD = defineError({
  id: "BELOW_THRESHOLD",
  title: "Too few votes to propose",
  class: "permission",
  actor: "person",
  message: "You hold fewer votes than the company Governor needs to propose a vote. Nothing was signed.",
  retryable: false,
  exit: 4,
  was: [`${ORGS}:11`],
});

export const error_POOL_EXCEEDED = defineError({
  id: "POOL_EXCEEDED",
  title: "More options than the pool has left",
  class: "input",
  actor: "caller",
  message: "The option grant is more than the pool has left. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${ORGS}:13`],
});

export const error_SHARES_LOCKED = defineError({
  id: "SHARES_LOCKED",
  title: "Shares still vesting",
  class: "state",
  actor: "person",
  message: "Some of the shares you offered are still vesting. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${ORGS}:15`],
});

export const error_NOT_VESTED = defineError({
  id: "NOT_VESTED",
  title: "Not vested yet",
  class: "state",
  actor: "person",
  message: "You asked for more than has vested. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${OPS}/shares.exercise.yaml`],
});

export const error_INSUFFICIENT_FUNDS = defineError({
  id: "INSUFFICIENT_FUNDS",
  title: "Not enough of the strike token",
  class: "state",
  actor: "person",
  message: "Your Safe holds less of the strike token than the exercise costs. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${OPS}/shares.exercise.yaml`],
});

export const error_ROUND_CLOSED = defineError({
  id: "ROUND_CLOSED",
  title: "Round closed",
  class: "state",
  actor: "person",
  message: "The round has closed, or its pay-by date has passed. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${OPS}/invest.commit.yaml`, `${OPS}/org.round.invite.yaml`, `${OPS}/org.safe.close.yaml`],
});

export const error_CONSENT_MISSING = defineError({
  id: "CONSENT_MISSING",
  title: "A class has not consented",
  class: "state",
  actor: "person",
  message: "A share class this round affects has not consented. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${OPS}/org.round.close.yaml`, `${OPS}/org.round.create.yaml`],
});

export const error_RESERVED_MATTER = defineError({
  id: "RESERVED_MATTER",
  title: "Reserved for another body",
  class: "state",
  actor: "person",
  message: "This matter belongs to the shareholders or the Board, not to you here. Put it to a vote.",
  retryable: false,
  exit: 2,
  was: [`${OPS}/org.board.director.add.yaml`, `${OPS}/org.vote.create.yaml`, `${OPS}/org.round.preview.yaml`],
});

// ── providers and the chain ─────────────────────────────────────────────────────────────────

export const error_PROVIDER_ERROR = defineError({
  id: "PROVIDER_ERROR",
  title: "Provider did not complete the request",
  // The frozen book names it both for "cannot be reached" and "refuses the call"; `details.mode`
  // (timeout, upstream-down, rate-limited, refused) tells them apart. Its class is the common case.
  class: "provider-unavailable",
  actor: "system",
  message: "A service that Capxul uses did not complete the request. Nothing was made up.",
  retryable: true,
  exit: 5,
  // EMAIL_DELIVERY_FAILED merges here: a mail provider failing is a provider failing.
  was: [`${CODES}:35`, `${CODES}:29`],
});

export const error_PROVIDER_RESPONSE_INVALID = defineError({
  id: "PROVIDER_RESPONSE_INVALID",
  title: "Provider answer unusable",
  class: "provider-answer",
  actor: "operator",
  message: "A service answered, but Capxul could not use the answer. Do not retry: the same answer will come back.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:36`],
});

export const error_NETWORK_ERROR = defineError({
  id: "NETWORK_ERROR",
  title: "Network error",
  class: "provider-unavailable",
  actor: "system",
  message: "The request did not reach Capxul, or the answer did not come back. Check your connection and try again.",
  retryable: true,
  exit: 5,
  was: [`${CODES}:48`, `${OPS}/doctor.yaml`],
});

export const error_TRANSACTION_FAILED = defineError({
  id: "TRANSACTION_FAILED",
  title: "Transaction reverted on chain",
  class: "state",
  actor: "person",
  message: "The chain refused the transaction, so nothing it carried happened. Read the item again before you retry.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:46`],
});

// ── Capxul itself ───────────────────────────────────────────────────────────────────────────

export const error_UNKNOWN = defineError({
  id: "UNKNOWN",
  title: "Unexpected failure",
  class: "defect",
  actor: "operator",
  message: "Something failed that Capxul did not expect. The trace id names it for support.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:49`],
});

export const error_WORK_DIED = defineError({
  id: "WORK_DIED",
  title: "Background work died",
  class: "defect",
  actor: "operator",
  message: "Background work for this request stopped unexpectedly. The command names the work.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:56`, `${OPS}/dev.jobs.run.yaml`],
});

export const error_NOT_IMPLEMENTED = defineError({
  id: "NOT_IMPLEMENTED",
  title: "Not built yet",
  class: "defect",
  actor: "operator",
  message: "This operation is not built yet in this deployment.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:40`],
});

// ── the CLI's own codes (the SDK never returns these) ───────────────────────────────────────

export const error_CLI_USAGE = defineError({
  id: "CLI_USAGE",
  title: "Invalid command line",
  class: "input",
  actor: "caller",
  message: "The command line is not valid.",
  retryable: false,
  exit: 2,
  was: [`${CLI}:31`],
});

export const error_CLI_CONFIG = defineError({
  id: "CLI_CONFIG",
  title: "Invalid CLI configuration",
  class: "input",
  actor: "caller",
  message: "The CLI configuration is not valid.",
  retryable: false,
  exit: 2,
  was: [`${CLI}:32`],
});

export const error_CLI_STORAGE = defineError({
  id: "CLI_STORAGE",
  title: "CLI local files unusable",
  class: "input",
  actor: "caller",
  message: "The CLI could not read or write its local files.",
  retryable: false,
  exit: 2,
  was: [`${CLI}:33`],
});

export const error_CLI_DEFECT = defineError({
  id: "CLI_DEFECT",
  title: "CLI failed unexpectedly",
  class: "defect",
  actor: "operator",
  message: "The CLI failed unexpectedly.",
  retryable: false,
  exit: 1,
  was: [`${CLI}:34`],
});

export const error_CLI_DEADLINE = defineError({
  id: "CLI_DEADLINE",
  title: "Stopped waiting before the work finished",
  class: "state",
  actor: "person",
  message: "The command stopped waiting before the work finished. The work carries on: read it again later.",
  retryable: false,
  exit: 5,
  was: [`${CLI}:35`],
});

export const error_EXPERIMENTAL_NOT_ACCEPTED = defineError({
  id: "EXPERIMENTAL_NOT_ACCEPTED",
  title: "Production not accepted",
  class: "input",
  actor: "caller",
  message: "Production was chosen without accepting that it is experimental.",
  retryable: false,
  exit: 2,
  was: [`${CLI}:39`],
});

export const error_ENVIRONMENT_NOT_CHOSEN = defineError({
  id: "ENVIRONMENT_NOT_CHOSEN",
  title: "No environment chosen",
  class: "input",
  actor: "caller",
  message: "No environment is chosen, and this command needs one. Run `capxul use env devnet` or `capxul use env staging`.",
  retryable: false,
  exit: 2,
  was: [`${CLI}:41`],
});
