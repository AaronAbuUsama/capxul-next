// The vocabulary of the old system as the payments concept sees it: every error code the
// protocol, its concepts and the CLI answer with, and every product event the payments concept
// sends. Read from /home/user/factory (integration/factory). Evidence, not the target design.
//
// How each error field was read from the old code:
// - `id`: the code. The platform's codes are `CAPXUL_ERROR_CODES` (packages/protocol/src/errors/
//   codes.ts:27-78); each concept adds its own in `<concept>/error-codes.ts` (only organizations,
//   payroll and permissions add any; payments adds none, payments/error-codes.ts:6-11). The
//   CLI-only codes are `CliErrorCode` (apps/cli/src/runtime/errors.ts:29-41): the old error
//   catalog lists them beside the protocol's (apps/cli/src/commands/schema/catalog.ts:45-62).
// - `class`: `CODE_CLASSES` (packages/protocol/src/errors/classes.ts:34-76), a concept table's
//   `classes`, or `CLI_CODE_CLASSES` (apps/cli/src/runtime/errors.ts:68-79). The old system has no
//   `auth` or `permission` class: NOT_AUTHENTICATED is `input`, ROLE_PERMISSION_DENIED is `state`.
//   PROVIDER_ERROR, NETWORK_ERROR, TRANSACTION_FAILED and EMAIL_DELIVERY_FAILED are `by-mode`
//   (classes.ts:70-73): their class is their failure mode's (classes.ts:82-106), and with no mode
//   it is `defect` (classes.ts:118-120). Each is booked here with that no-mode class, `defect`.
// - `actor`: ADR-0039 D2's "who acts" (docs/adr/0039-failure-contract-what-happened-who-acts.md:
//   95-102) mapped one to one: input → caller; state → person ("the person or another party");
//   provider-unavailable → system ("nobody now: retry later"); provider-refused, provider-answer
//   and defect → operator (Capxul operations or engineering). The generated error pages say the
//   same (`WHO_ACTS`, packages/tools/src/modules/docs/internal/product-reference/error-pages.ts:
//   13-21), and document the four catch-alls as `by-mode`, "Depends on the error's mode"
//   (apps/cli/src/commands/schema/catalog.ts:40-43); the book's class has no `by-mode`.
// - `message`: the copy's `summary` (packages/tools/src/modules/docs/internal/product-reference/
//   error-copy*.ts and error-copy/<concept>.ts). The CLI prints its own line instead
//   (apps/cli/src/runtime/errors.ts:137-170, outcome-message.ts:31-42).
// - `retryable`: the old code has no per-code retry table. It is true where the copy's `fix`
//   tells the reader the same request can succeed when sent again (after a wait, a re-read or a
//   fresh approval) without changing it, false otherwise. The SDK's identity machine has its own
//   predicate (packages/sdk/src/access/identity/model.ts:58-67) that also counts UNKNOWN as
//   retryable, which the CLI denies (apps/cli/src/runtime/outcome-message.ts:10).
// - `exit`: `exitClass` (apps/cli/src/runtime/errors.ts:216-225): 130 CANCELLED, 3
//   NOT_AUTHENTICATED, 4 ROLE_PERMISSION_DENIED and BELOW_THRESHOLD, 2 `REFUSED_INPUT_OR_STATE`
//   (apps/cli/src/runtime/refused-codes.ts:7-17), 6 another expected outcome
//   (`EXPECTED_OPERATION_OUTCOMES`, codes.ts:129-175), 5 the rest. CLI-only codes take
//   `CLI_CODE_EXITS` (apps/cli/src/commands/schema/catalog.ts:22-30).

import { Schema } from "effect";
import { defineError, defineEvent } from "../../../packages/book/src/index.ts";

const COPY = "packages/tools/src/modules/docs/internal/product-reference";
const CODES = "packages/protocol/src/errors/codes.ts";
const CLASSES = "packages/protocol/src/errors/classes.ts";
const EXIT = "apps/cli/src/runtime/errors.ts";
const REFUSED = "apps/cli/src/runtime/refused-codes.ts";
const CLI_EXITS = "apps/cli/src/commands/schema/catalog.ts";

// ── platform codes (packages/protocol/src/errors/codes.ts) ───────────────────────────────────

export const error_NOT_AUTHENTICATED = defineError({
  id: "NOT_AUTHENTICATED",
  title: "Not signed in",
  class: "input",
  actor: "caller",
  message: "The request has no valid sign-in.",
  retryable: false,
  exit: 3,
  was: [`${CODES}:28`, `${CLASSES}:38`, `${COPY}/error-copy-access.ts:7`, `${EXIT}:218`, `${CODES}:131`],
});

export const error_EMAIL_DELIVERY_FAILED = defineError({
  id: "EMAIL_DELIVERY_FAILED",
  title: "Email not sent",
  // by-mode (classes.ts:73); booked with its no-mode class.
  class: "defect",
  actor: "operator",
  message: "Capxul could not send an email that the request needs.",
  // Copy fix: "Try again later."
  retryable: true,
  exit: 5,
  was: [`${CODES}:29`, `${CLASSES}:73`, `${CLASSES}:120`, `${COPY}/error-copy-platform.ts:37`, `${EXIT}:224`],
});

export const error_PROFILE_NOT_FOUND = defineError({
  id: "PROFILE_NOT_FOUND",
  title: "No Capxul profile",
  class: "state",
  actor: "person",
  message: "The person has no Capxul profile yet.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:30`, `${CLASSES}:54`, `${COPY}/error-copy-access.ts:30`, `${EXIT}:224`],
});

export const error_SMART_ACCOUNT_MISSING = defineError({
  id: "SMART_ACCOUNT_MISSING",
  title: "No account on chain yet",
  class: "state",
  actor: "person",
  message: "The person has no account on chain yet.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:31`, `${CLASSES}:53`, `${COPY}/error-copy-access.ts:35`, `${EXIT}:223`, `${CODES}:136`],
});

export const error_PLAYER_NOT_FOUND = defineError({
  id: "PLAYER_NOT_FOUND",
  title: "Openfort player not found",
  class: "state",
  actor: "person",
  message: "Capxul has no record of the person the request names.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:32`, `${CLASSES}:55`, `${COPY}/error-copy-access.ts:40`, `${EXIT}:224`],
});

export const error_ACCOUNT_NOT_FOUND = defineError({
  id: "ACCOUNT_NOT_FOUND",
  title: "Account not found",
  class: "state",
  actor: "person",
  message: "Capxul has no account with the ID the request names.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:33`, `${CLASSES}:56`, `${COPY}/error-copy-access.ts:45`, `${EXIT}:224`],
});

export const error_ACCOUNT_CLAIMED_BY_OTHER_SIGNER = defineError({
  id: "ACCOUNT_CLAIMED_BY_OTHER_SIGNER",
  title: "Account owned by another signer",
  class: "state",
  actor: "person",
  message: "Another wallet already controls this account.",
  // factories.ts:60: "no simulation and no retry".
  retryable: false,
  exit: 6,
  was: [
    `${CODES}:34`,
    `${CLASSES}:52`,
    `${COPY}/error-copy-access.ts:50`,
    "packages/protocol/src/errors/factories.ts:60",
    `${EXIT}:223`,
    `${CODES}:139`,
  ],
});

export const error_PROVIDER_ERROR = defineError({
  id: "PROVIDER_ERROR",
  title: "Provider did not complete the request",
  // by-mode (classes.ts:70): timeout, upstream-down and rate-limited are provider-unavailable;
  // forbidden, rejected and refused are provider-refused; revert is state. No mode: defect.
  class: "defect",
  actor: "operator",
  message: "A service that Capxul uses did not complete the request.",
  // Copy fix: timeout, upstream-down and rate-limited "usually pass if you try again later";
  // other modes need support. The SDK's identity predicate retries it unless the mode is definitive.
  retryable: true,
  exit: 5,
  was: [
    `${CODES}:35`,
    `${CLASSES}:70`,
    `${CLASSES}:120`,
    `${COPY}/error-copy-platform.ts:18`,
    "packages/sdk/src/access/identity/model.ts:60",
    "packages/protocol/src/errors/factories.ts:86",
    "packages/protocol/src/errors/factories.ts:99",
    `${EXIT}:224`,
  ],
});

export const error_PROVIDER_RESPONSE_INVALID = defineError({
  id: "PROVIDER_RESPONSE_INVALID",
  title: "Provider answer unusable",
  class: "provider-answer",
  actor: "operator",
  message: "A service answered, but Capxul could not use the answer.",
  // Copy fix: "Do not retry: the same answer will come back."
  retryable: false,
  exit: 5,
  was: [`${CODES}:36`, `${CLASSES}:61`, `${COPY}/error-copy-platform.ts:29`, `${EXIT}:224`],
});

export const error_CAPABILITY_UNAVAILABLE = defineError({
  id: "CAPABILITY_UNAVAILABLE",
  title: "Deployment cannot do this",
  class: "state",
  actor: "person",
  message: "This deployment cannot do what the request asks.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:37`, `${CLASSES}:57`, `${COPY}/error-copy-platform.ts:7`, `${EXIT}:223`, `${CODES}:149`],
});

export const error_INVALID_INPUT = defineError({
  id: "INVALID_INPUT",
  title: "Invalid input",
  class: "input",
  actor: "caller",
  message: "A value in the request is not valid.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:38`, `${CLASSES}:35`, `${COPY}/error-copy-request.ts:7`, `${EXIT}:222`, `${REFUSED}:8`],
});

export const error_ENV_MISSING = defineError({
  id: "ENV_MISSING",
  title: "Deployment setting missing",
  class: "defect",
  actor: "operator",
  message: "The deployment is missing a setting it needs.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:39`, `${CLASSES}:66`, `${COPY}/error-copy-platform.ts:58`, `${EXIT}:224`],
});

export const error_NOT_IMPLEMENTED = defineError({
  id: "NOT_IMPLEMENTED",
  title: "Not built yet",
  class: "defect",
  actor: "operator",
  message: "This operation is not built yet.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:40`, `${CLASSES}:67`, `${COPY}/error-copy-platform.ts:63`, `${EXIT}:224`],
});

export const error_VERIFICATION_REQUIRED = defineError({
  id: "VERIFICATION_REQUIRED",
  title: "Verification required",
  class: "state",
  actor: "person",
  message: "The person or business must be verified first.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:41`, `${CLASSES}:49`, `${COPY}/error-copy-access.ts:58`, `${EXIT}:223`, `${CODES}:142`],
});

export const error_INSUFFICIENT_BALANCE = defineError({
  id: "INSUFFICIENT_BALANCE",
  title: "Not enough money",
  class: "state",
  actor: "person",
  message: "The account does not hold enough money for this payment.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:42`, `${CLASSES}:48`, `${COPY}/error-copy-request.ts:48`, `${EXIT}:223`, `${CODES}:143`],
});

export const error_INVALID_RECIPIENT = defineError({
  id: "INVALID_RECIPIENT",
  title: "Recipient cannot be paid",
  class: "input",
  actor: "caller",
  message: "The payment cannot go to this recipient.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:43`, `${CLASSES}:36`, `${COPY}/error-copy-request.ts:58`, `${EXIT}:223`, `${CODES}:144`],
});

export const error_ROLE_PERMISSION_DENIED = defineError({
  id: "ROLE_PERMISSION_DENIED",
  title: "Not allowed",
  // `details.reason` is one of ROLE_PERMISSION_DENIED_REASONS (codes.ts:90-119).
  class: "state",
  actor: "person",
  message: "You are not allowed to do this, so nothing was signed.",
  retryable: false,
  exit: 4,
  was: [`${CODES}:44`, `${CLASSES}:50`, `${COPY}/error-copy-access.ts:63`, `${EXIT}:220`, `${CODES}:90`],
});

export const error_ROLE_CONFLICT = defineError({
  id: "ROLE_CONFLICT",
  title: "Roles cannot be held together",
  class: "state",
  actor: "person",
  message: "One person cannot hold these two roles together.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:45`, `${CLASSES}:51`, `${COPY}/error-copy-access.ts:75`, `${EXIT}:223`, `${CODES}:148`],
});

export const error_TRANSACTION_FAILED = defineError({
  id: "TRANSACTION_FAILED",
  title: "Transaction failed on chain",
  // by-mode (classes.ts:72): revert is state, timeout is provider-unavailable. No mode: defect.
  class: "defect",
  actor: "operator",
  message: "The transaction did not complete on chain.",
  // Copy fix: re-read before a retry; a timeout can still settle, so wait before sending again.
  retryable: false,
  exit: 5,
  was: [`${CODES}:46`, `${CLASSES}:72`, `${CLASSES}:120`, `${COPY}/error-copy-request.ts:63`, `${EXIT}:224`],
});

export const error_RATE_LIMITED = defineError({
  id: "RATE_LIMITED",
  title: "Rate limited",
  class: "state",
  actor: "person",
  message: "Too many requests arrived in a short time.",
  // Copy fix: "Wait, then try again." `details.retryAfterMs` says how long when known.
  retryable: true,
  exit: 6,
  was: [`${CODES}:47`, `${CLASSES}:47`, `${COPY}/error-copy-request.ts:43`, `${EXIT}:223`, `${CODES}:150`],
});

export const error_NETWORK_ERROR = defineError({
  id: "NETWORK_ERROR",
  title: "Network error",
  // by-mode (classes.ts:71); booked with its no-mode class.
  class: "defect",
  actor: "operator",
  message: "The request did not reach Capxul, or the answer did not come back.",
  // Copy fix: "Check your connection and try again." The SDK's identity predicate retries it.
  retryable: true,
  exit: 5,
  was: [
    `${CODES}:48`,
    `${CLASSES}:71`,
    `${CLASSES}:120`,
    `${COPY}/error-copy-platform.ts:45`,
    "packages/sdk/src/access/identity/model.ts:66",
    `${EXIT}:224`,
  ],
});

export const error_UNKNOWN = defineError({
  id: "UNKNOWN",
  title: "Unknown failure",
  class: "defect",
  actor: "operator",
  message: "Something failed and Capxul could not say why.",
  // The CLI offers no retry (outcome-message.ts:10); the SDK's identity predicate does (model.ts:66).
  retryable: false,
  exit: 5,
  was: [
    `${CODES}:49`,
    `${CLASSES}:65`,
    `${COPY}/error-copy-platform.ts:53`,
    "apps/cli/src/runtime/outcome-message.ts:10",
    "packages/sdk/src/access/identity/model.ts:66",
    `${EXIT}:224`,
  ],
});

export const error_OTP_EXPIRED = defineError({
  id: "OTP_EXPIRED",
  title: "Sign-in code expired",
  class: "input",
  actor: "caller",
  message: "The sign-in code expired.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:50`, `${CLASSES}:37`, `${COPY}/error-copy-access.ts:20`, `${EXIT}:222`, `${REFUSED}:9`],
});

export const error_SIGNER_REJECTED = defineError({
  id: "SIGNER_REJECTED",
  title: "Wallet declined to sign",
  class: "input",
  actor: "caller",
  message: "The wallet declined to sign.",
  // Copy fix: "Run the command again and approve the request. Nothing was submitted."
  retryable: true,
  exit: 6,
  was: [
    `${CODES}:51`,
    `${CLASSES}:39`,
    `${COPY}/error-copy-access.ts:25`,
    "packages/sdk/src/access/identity/model.ts:59",
    `${EXIT}:223`,
    `${CODES}:141`,
  ],
});

export const error_CANCELLED = defineError({
  id: "CANCELLED",
  title: "Cancelled",
  class: "input",
  actor: "caller",
  message: "The command stopped before it finished.",
  // Copy fix: "Run the command again if you still want it."
  retryable: true,
  exit: 130,
  was: [
    `${CODES}:52`,
    `${CLASSES}:40`,
    `${COPY}/error-copy-request.ts:38`,
    "packages/sdk/src/access/identity/model.ts:59",
    `${EXIT}:217`,
    `${EXIT}:246`,
  ],
});

export const error_WRONG_STATE = defineError({
  id: "WRONG_STATE",
  title: "Wrong state",
  class: "state",
  actor: "person",
  message: "The request is valid, but the current state does not allow it.",
  retryable: false,
  // exitClass gives 2, but `capxul payment cancel` raises WRONG_STATE by hand with exit 5,
  // outcome `failed`, when the void has not landed (commands/payment/internal/voids.ts:14-24).
  exit: 2,
  was: [
    `${CODES}:53`,
    `${CLASSES}:43`,
    `${COPY}/error-copy-request.ts:17`,
    `${EXIT}:222`,
    `${REFUSED}:10`,
    "apps/cli/src/commands/payment/internal/voids.ts:22",
    "apps/cli/src/commands/payment/internal/approval.ts:113",
  ],
});

export const error_STALE_EPOCH = defineError({
  id: "STALE_EPOCH",
  title: "Based on stale data",
  class: "state",
  actor: "person",
  message: "The request was based on an earlier version of the data.",
  // Copy fix: "Read the item again, then retry."
  retryable: true,
  exit: 6,
  was: [`${CODES}:54`, `${CLASSES}:45`, `${COPY}/error-copy-request.ts:28`, `${EXIT}:223`, `${CODES}:153`],
});

export const error_SUPERSEDED = defineError({
  id: "SUPERSEDED",
  title: "Superseded by a newer request",
  class: "state",
  actor: "person",
  message: "A newer request replaced this one.",
  // Copy fix: "Do not retry the older request."
  retryable: false,
  exit: 6,
  was: [`${CODES}:55`, `${CLASSES}:44`, `${COPY}/error-copy-request.ts:33`, `${EXIT}:223`, `${CODES}:154`],
});

export const error_WORK_DIED = defineError({
  id: "WORK_DIED",
  title: "Background work died",
  class: "defect",
  actor: "operator",
  message: "Background work for this request stopped unexpectedly.",
  retryable: false,
  exit: 5,
  was: [`${CODES}:56`, `${CLASSES}:68`, `${COPY}/error-copy-platform.ts:68`, `${EXIT}:224`],
});

export const error_ACTOR_STOPPED = defineError({
  id: "ACTOR_STOPPED",
  title: "Account or Organization stopped",
  class: "state",
  actor: "person",
  message: "The account or Organization that would do this is stopped.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:57`, `${CLASSES}:46`, `${COPY}/error-copy-access.ts:96`, `${EXIT}:223`, `${CODES}:155`],
});

export const error_WRONG_ENVIRONMENT = defineError({
  id: "WRONG_ENVIRONMENT",
  title: "Wrong environment",
  class: "input",
  actor: "caller",
  message: "This command does not run in the current environment.",
  retryable: false,
  exit: 2,
  was: [`${CODES}:59`, `${CLASSES}:41`, `${COPY}/error-copy-access.ts:80`, `${EXIT}:222`, `${REFUSED}:11`],
});

export const error_FEATURE_NOT_AVAILABLE = defineError({
  id: "FEATURE_NOT_AVAILABLE",
  title: "Feature not switched on",
  class: "state",
  actor: "person",
  message: "This feature is not switched on for you or your Organization.",
  retryable: false,
  exit: 6,
  was: [`${CODES}:61`, `${CLASSES}:58`, `${COPY}/error-copy-access.ts:91`, `${EXIT}:223`, `${CODES}:158`],
});

// ── organizations codes (packages/protocol/src/organizations/error-codes.ts) ───────────────────

const ORGS = "packages/protocol/src/organizations/error-codes.ts";

export const error_AUTHORISED_EXCEEDED = defineError({
  id: "AUTHORISED_EXCEEDED",
  title: "More shares than authorised",
  class: "input",
  actor: "caller",
  message: "The founders' shares and the option pool are more than the class authorises. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${ORGS}:9`, `${ORGS}:18`, `${ORGS}:25`, `${COPY}/error-copy/organizations.ts:8`, `${EXIT}:222`, `${REFUSED}:14`],
});

export const error_BELOW_THRESHOLD = defineError({
  id: "BELOW_THRESHOLD",
  title: "Too few votes to propose",
  class: "state",
  actor: "person",
  message: "You hold fewer votes than the company Governor needs to propose a vote. Nothing was signed.",
  retryable: false,
  exit: 4,
  was: [`${ORGS}:11`, `${ORGS}:19`, `${ORGS}:27`, `${COPY}/error-copy/organizations.ts:20`, `${EXIT}:220`],
});

export const error_POOL_EXCEEDED = defineError({
  id: "POOL_EXCEEDED",
  title: "More options than the pool has left",
  class: "input",
  actor: "caller",
  message: "The option grant is more than the pool has left. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${ORGS}:13`, `${ORGS}:20`, `${ORGS}:29`, `${COPY}/error-copy/organizations.ts:32`, `${EXIT}:222`, `${REFUSED}:15`],
});

export const error_SHARES_LOCKED = defineError({
  id: "SHARES_LOCKED",
  title: "Shares still vesting",
  class: "state",
  actor: "person",
  message: "Some of the shares you offered are still vesting. Nothing was signed.",
  retryable: false,
  exit: 2,
  was: [`${ORGS}:15`, `${ORGS}:21`, `${ORGS}:31`, `${COPY}/error-copy/organizations.ts:40`, `${EXIT}:222`, `${REFUSED}:16`],
});

// ── payroll codes (packages/protocol/src/payroll/error-codes.ts) ───────────────────────────────

const PAYROLL = "packages/protocol/src/payroll/error-codes.ts";

export const error_PAYROLL_BUDGET_EXCEEDED = defineError({
  id: "PAYROLL_BUDGET_EXCEEDED",
  title: "Department budget exceeded",
  class: "state",
  actor: "person",
  message: "An offer or a raise would commit more than the department has left this year. Nothing was signed.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:9`, `${PAYROLL}:23`, `${PAYROLL}:33`, `${COPY}/error-copy/payroll.ts:8`, `${EXIT}:223`],
});

export const error_PAYER_BALANCE_TOO_LOW = defineError({
  id: "PAYER_BALANCE_TOO_LOW",
  title: "Organization balance too low",
  class: "state",
  actor: "person",
  message: "The Organization's account holds less than this collection pays.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:11`, `${PAYROLL}:24`, `${PAYROLL}:34`, `${COPY}/error-copy/payroll.ts:44`, `${EXIT}:223`],
});

export const error_TOKEN_NOT_SUPPORTED = defineError({
  id: "TOKEN_NOT_SUPPORTED",
  title: "Token not supported",
  class: "input",
  actor: "caller",
  message: "The token is not one Capxul pays payroll in on this network. Nothing was proposed.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:13`, `${PAYROLL}:25`, `${PAYROLL}:37`, `${COPY}/error-copy/payroll.ts:22`, `${EXIT}:223`],
});

export const error_TOKEN_REQUIRED = defineError({
  id: "TOKEN_REQUIRED",
  title: "Token must be named",
  class: "input",
  actor: "caller",
  message: "The department budgets in more than one token, so the offer must name the one it pays in. Nothing was signed.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:15`, `${PAYROLL}:26`, `${PAYROLL}:38`, `${COPY}/error-copy/payroll.ts:30`, `${EXIT}:223`],
});

export const error_TOKEN_NOT_BUDGETED = defineError({
  id: "TOKEN_NOT_BUDGETED",
  title: "No budget in that token",
  class: "state",
  actor: "person",
  message: "The department has no budget in the token the offer names. Nothing was signed.",
  retryable: false,
  exit: 6,
  was: [`${PAYROLL}:17`, `${PAYROLL}:27`, `${PAYROLL}:39`, `${COPY}/error-copy/payroll.ts:36`, `${EXIT}:223`],
});

export const error_AMOUNT_BELOW_USE = defineError({
  id: "AMOUNT_BELOW_USE",
  title: "Budget below what it uses",
  class: "state",
  actor: "person",
  message: "The new budget is below what the department already uses this period. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${PAYROLL}:20`, `${PAYROLL}:28`, `${PAYROLL}:41`, `${COPY}/error-copy/payroll.ts:52`, `${EXIT}:222`, `${REFUSED}:12`],
});

// ── permissions codes (packages/protocol/src/permissions/error-codes.ts) ───────────────────────

const PERMISSIONS = "packages/protocol/src/permissions/error-codes.ts";

export const error_CHILDREN_EXCEED_PARENT = defineError({
  id: "CHILDREN_EXCEED_PARENT",
  title: "Allowance exceeds its parent budget",
  class: "state",
  actor: "person",
  message: "The allowance asks its parent budget for more than the parent has left to give. Nothing was proposed.",
  retryable: false,
  exit: 2,
  was: [`${PERMISSIONS}:9`, `${PERMISSIONS}:11`, `${PERMISSIONS}:14`, `${COPY}/error-copy/permissions.ts:8`, `${EXIT}:222`, `${REFUSED}:13`],
});

// ── CLI-only codes (apps/cli/src/runtime/errors.ts:29-41) ──────────────────────────────────────
// Only the CLI answers with these; the SDK never returns them (error-pages.ts:53-55).

export const error_CLI_USAGE = defineError({
  id: "CLI_USAGE",
  title: "Invalid command line",
  class: "input",
  actor: "caller",
  message: "The command line is not valid.",
  retryable: false,
  exit: 2,
  was: [`${EXIT}:31`, `${EXIT}:69`, `${COPY}/error-copy-platform.ts:73`, `${CLI_EXITS}:23`, "apps/cli/src/runtime/errors.ts:256"],
});

export const error_CLI_CONFIG = defineError({
  id: "CLI_CONFIG",
  title: "Invalid CLI configuration",
  class: "input",
  actor: "caller",
  message: "The CLI configuration is not valid.",
  retryable: false,
  exit: 2,
  was: [`${EXIT}:32`, `${EXIT}:70`, `${COPY}/error-copy-platform.ts:78`, `${CLI_EXITS}:24`, `${EXIT}:227`],
});

export const error_CLI_STORAGE = defineError({
  id: "CLI_STORAGE",
  title: "CLI local files unusable",
  class: "input",
  actor: "caller",
  message: "The CLI could not read or write its local files.",
  retryable: false,
  exit: 2,
  was: [`${EXIT}:33`, `${EXIT}:71`, `${COPY}/error-copy-platform.ts:83`, `${CLI_EXITS}:25`, `${EXIT}:294`],
});

export const error_CLI_DEFECT = defineError({
  id: "CLI_DEFECT",
  title: "CLI failed unexpectedly",
  class: "defect",
  actor: "operator",
  message: "The CLI failed unexpectedly.",
  retryable: false,
  exit: 1,
  was: [`${EXIT}:34`, `${EXIT}:72`, `${COPY}/error-copy-platform.ts:93`, `${CLI_EXITS}:26`, `${EXIT}:308`],
});

export const error_CLI_DEADLINE = defineError({
  id: "CLI_DEADLINE",
  title: "Stopped waiting before the work finished",
  // "The wait ended, not the work: the Payment may still settle, so re-read it." (errors.ts:73)
  class: "state",
  actor: "person",
  message: "The command stopped waiting before the work finished.",
  // Copy fix: read the item again later, or wait for it; not a resend.
  retryable: false,
  exit: 5,
  was: [
    `${EXIT}:35`,
    `${EXIT}:74`,
    `${COPY}/error-copy-platform.ts:101`,
    `${CLI_EXITS}:27`,
    "apps/cli/src/commands/payment/internal/wait-recovery.ts:72",
    "apps/cli/src/commands/payment/internal/approval.ts:120",
  ],
});

export const error_EXPERIMENTAL_NOT_ACCEPTED = defineError({
  id: "EXPERIMENTAL_NOT_ACCEPTED",
  title: "Production not accepted",
  class: "input",
  actor: "caller",
  message: "Production was chosen without accepting that it is experimental.",
  retryable: false,
  exit: 2,
  was: [`${EXIT}:39`, `${EXIT}:76`, `${COPY}/error-copy-platform.ts:106`, `${CLI_EXITS}:28`],
});

export const error_ENVIRONMENT_NOT_CHOSEN = defineError({
  id: "ENVIRONMENT_NOT_CHOSEN",
  title: "No environment chosen",
  class: "input",
  actor: "caller",
  message: "No environment is chosen, and this command needs one.",
  retryable: false,
  exit: 2,
  was: [`${EXIT}:41`, `${EXIT}:78`, `${COPY}/error-copy-platform.ts:111`, `${CLI_EXITS}:29`],
});

// ── events ──────────────────────────────────────────────────────────────────────────────────
// Props are the old catalog schemas (packages/observability/src/events/*.ts) without the old
// envelope, `TelemetryEnvelopeProps` (capxul_env, producer, journey_id, correlation_id,
// sdk_version, delivery_id, delivery_item_index; catalog/envelope.ts:156-176), which every event
// spreads. Fields an event lists itself are kept, even where they repeat the book's envelope.

const MONEY = "packages/observability/src/events/money.ts";
const ENVELOPE = "packages/observability/src/catalog/envelope.ts";
const PAYMENTS_CATALOG = "packages/observability/src/catalog/domains/payments.ts";
const PAYMENTS = "packages/backend/src/payments";

const OptionalString = Schema.optional(Schema.String);
/** `AddressSchema`: lowercased, then 0x + 40 hex (catalog/values.ts:22-30). */
const Address = Schema.String.pipe(Schema.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/)));
/** `OrgIdTelemetrySchema` (catalog/values.ts:136-142). */
const OrgId = Schema.String.pipe(Schema.check(Schema.isPattern(/^org_[0-9A-Za-z]+$/)));
/** `DurationMsSchema`: a non-negative safe integer (catalog/values.ts:50-54). */
const DurationMs = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

/** `FAILURE_MODES` (packages/protocol/src/errors/failure-modes.ts:10-54). */
const FailureMode = Schema.Literals([
  "auth-origin-mismatch",
  "stale-openfort-cache",
  "app-env-allowlist",
  "no-secure-context",
  "signer-not-ready",
  "rate-limited",
  "timeout",
  "upstream-down",
  "revert",
  "insufficient-balance",
  "insufficient-allowance",
  "rejected",
  "unauthorized",
  "forbidden",
  "bad-request",
  "method-unsupported",
  "refused",
  "defect",
  "unknown",
]);

/** `CHAIN_UPSTREAMS`: the RPC nodes, the bundler and the gateway (errors/chain-cause.ts:12). */
const ChainUpstream = Schema.Literals(["node_1", "node_2", "node_3", "node_4", "alto", "gateway"]);

/** `ChainCauseTelemetryProps` (catalog/envelope.ts:213-229). */
const ChainCauseProps = {
  failure_mode: Schema.optional(FailureMode),
  chain_upstream: Schema.optional(ChainUpstream),
  chain_method: OptionalString,
  chain_retryable: Schema.optional(Schema.Boolean),
  chain_http_status: Schema.optional(Schema.Finite),
  chain_rpc_code: Schema.optional(Schema.Finite),
  chain_revert_name: OptionalString,
  chain_revert_selector: OptionalString,
  chain_revert_args: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  chain_provider_message: OptionalString,
  chain_attempts: Schema.optional(
    Schema.Array(
      Schema.Struct({
        upstream: ChainUpstream,
        failure_mode: FailureMode,
        http_status: Schema.optional(Schema.Finite),
        rpc_code: Schema.optional(Schema.Finite),
        duration_ms: Schema.Finite,
      }),
    ),
  ),
  chain_response_headers: Schema.optional(
    Schema.Struct({
      "retry-after": OptionalString,
      "www-authenticate": OptionalString,
      "content-type": OptionalString,
      "x-request-id": OptionalString,
      "cf-ray": OptionalString,
      "x-ratelimit-remaining": OptionalString,
      "x-ratelimit-reset": OptionalString,
      server: OptionalString,
    }),
  ),
};

/** `PayoutTelemetryProps` (events/banking.ts:6-13) and `RecipientTelemetryProps` (events/money.ts:112-122). */
const RecipientProps = {
  recipient_kind: Schema.optional(Schema.Literals(["capxul", "wallet", "bank"])),
  rail: Schema.optional(Schema.Literals(["direct", "bridge"])),
  recipient_on_capxul: Schema.optional(Schema.Boolean),
  party_account_id: OptionalString,
  quote_id: OptionalString,
  rail_operation_id: OptionalString,
  recipient_locator_kind: Schema.optional(Schema.Literals(["handle", "email", "address", "party", "party_account"])),
  recipient_resolution_status: Schema.optional(
    Schema.Literals(["known_party", "new_email", "external_address", "bank_account"]),
  ),
  recipient_party_id: OptionalString,
  recipient_party_kind: Schema.optional(Schema.Literals(["person", "organization", "unresolved"])),
  recipient_is_capxul_account: Schema.optional(Schema.Boolean),
  recipient_handle: OptionalString,
  recipient_address: Schema.optional(Address),
  external_address_acknowledged: Schema.optional(Schema.Boolean),
};

/** `PaymentLifecycleProps` (events/money.ts:124-131). */
const PaymentLifecycleProps = {
  payment_state: OptionalString,
  execution_state: OptionalString,
  occurred_at: Schema.optional(Schema.Finite),
  causal_sequence: Schema.optional(Schema.Finite),
  sponsorship_valid_until: Schema.optional(Schema.Finite),
  terminal_event_id: OptionalString,
};

export const event_payment_transitioned = defineEvent({
  id: "payment_transitioned",
  about:
    "One Payment's life as one event (the merge of payment_initiated, payment_settled, payment_failed and payment_lifecycle_transition). `transition` says which step. `initiated` is sent by the SDK client, fire and forget and only when a telemetry port is set, one event per Payment item of a command, when the prepare's backend claimInitiated mutation grants the command's one claim (paymentCommands.paymentInitiatedClaimedAt). The backend claims only while the execution has not succeeded (and, on the shared build path, only for a request with items); a request checkout never sends it; the claim is spent even when the client never sends. `progressed`, `settled` and `failed` are scheduled by the backend payment writer in the committing mutation, one job per Payment the write names (or every Payment of its command), and delivered by the internal payments.records.emitTransition action. Scheduling patches the Payment row: it bumps lifecycleSequence (the event's causal_sequence) and, for a terminal, claims terminalOutcome, terminalEventId and terminalAt, so a second terminal for the same Payment is skipped (a rail return after settled is the one exception). The delivery drops a record that lacks a fact its transition needs (settled: purposeKind and settlementId; failed: paymentId, purposeKind, reasonCode; progressed: paymentId, paymentLifecycleId, commandId, paymentOutcome, occurredAt, causalSequence) and reports it as dropped. Only `settled` carries chain_id, which defaults to Base Sepolia when the write names none. Jobs scheduled under the old names payment_settled, payment_failed and payment_lifecycle_transition still deliver as this event. A failed delivery also spreads the cause props, including pool_cause, which the catalog schema does not list.",
  props: Schema.Struct({
    ...PaymentLifecycleProps,
    ...ChainCauseProps,
    ...RecipientProps,
    transition: Schema.Literals(["initiated", "progressed", "settled", "failed"]),
    payer_kind: Schema.optional(Schema.Literals(["person", "organization", "agent"])),
    agent_id: OptionalString,
    surface: Schema.optional(Schema.Literals(["web", "cli", "agent", "sdk", "unspecified"])),
    kind: OptionalString,
    chain_id: Schema.optional(Schema.Finite),
    settlement_id: OptionalString,
    payment_id: OptionalString,
    payment_ids: OptionalString,
    reason_code: OptionalString,
    command_id: OptionalString,
    payment_lifecycle_id: OptionalString,
    execution_id: OptionalString,
    user_op_hash: OptionalString,
    transaction_hash: OptionalString,
  }),
  was: [
    `${MONEY}:142`,
    `${MONEY}:246`,
    `${ENVELOPE}:272`,
    `${PAYMENTS_CATALOG}:17`,
    "packages/sdk/src/payments/events.ts:63",
    "packages/sdk/src/payments/execution.ts:167",
    "packages/sdk/src/payments/prepared-execution.ts:65",
    "packages/sdk/src/requests/checkout-payments.ts:166",
    `${PAYMENTS}/commands/writes/initiations.ts:9`,
    `${PAYMENTS}/commands/writes/initiations.ts:20`,
    `${PAYMENTS}/commands/operations/claim-initiated.ts:13`,
    `${PAYMENTS}/commands/operations/prepare.ts:33`,
    `${PAYMENTS}/executions/external/builds.ts:270`,
    `${PAYMENTS}/events/writer.ts:62`,
    `${PAYMENTS}/events/writer.ts:72`,
    `${PAYMENTS}/events/writer.ts:202`,
    `${PAYMENTS}/events/writer.ts:217`,
    `${PAYMENTS}/events/writer.ts:228`,
    `${PAYMENTS}/events/deliveries.ts:31`,
    `${PAYMENTS}/events/deliveries.ts:110`,
    `${PAYMENTS}/events/deliveries.ts:206`,
    // terminal producers (settled / failed)
    `${PAYMENTS}/writes/settlements.ts:147`,
    `${PAYMENTS}/writes/rails.ts:65`,
    `${PAYMENTS}/writes/outcomes.ts:110`,
    `${PAYMENTS}/verifications/writes/claims.ts:91`,
    `${PAYMENTS}/verifications/writes/sends.ts:234`,
    // progressed producers
    `${PAYMENTS}/commands/writes/bindings.ts:140`,
    `${PAYMENTS}/commands/writes/links.ts:128`,
    `${PAYMENTS}/commands/writes/links.ts:160`,
    `${PAYMENTS}/commands/writes/links.ts:234`,
    `${PAYMENTS}/commands/writes/submissions.ts:169`,
    `${PAYMENTS}/verifications/writes/inclusions.ts:28`,
    `${PAYMENTS}/verifications/writes/sends.ts:215`,
    `${PAYMENTS}/verifications/writes/finishes.ts:62`,
    `${PAYMENTS}/verifications/writes/finishes.ts:242`,
    `${PAYMENTS}/verifications/writes/voids.ts:118`,
    `${PAYMENTS}/writes/settlements.ts:133`,
    `${PAYMENTS}/writes/outcomes.ts:54`,
  ],
});

export const event_payment_verification_retry = defineEvent({
  id: "payment_verification_retry",
  about:
    "A committed verification retry of a payment command: the verify step scheduled another attempt (`outcome: scheduled`) or gave up unresolved (`outcome: unresolved`). Scheduled by the verifications area's finish writes in the committing mutation, with chain id hard-coded to Base Sepolia, through the same payment writer as payment_transitioned: it names no Payment, so the writer schedules one event per Payment of the command (none when the command has none) and bumps each Payment's lifecycleSequence. Delivered by the payments.records.emitTransition action; a record missing commandId, paymentLifecycleId, attempt, reasonCode, delayMs or outcome is dropped. The producer also passes pool_cause, when the bundler could not say what became of the operation, which the catalog schema does not list.",
  props: Schema.Struct({
    ...PaymentLifecycleProps,
    ...RecipientProps,
    command_id: Schema.String,
    payment_lifecycle_id: Schema.String,
    attempt: Schema.Finite,
    reason_code: Schema.String,
    chain_id: Schema.Finite,
    delay_ms: DurationMs,
    outcome: Schema.Literals(["scheduled", "unresolved"]),
    payment_id: OptionalString,
    payment_ids: OptionalString,
    execution_id: OptionalString,
    user_op_hash: OptionalString,
  }),
  was: [
    `${MONEY}:172`,
    `${MONEY}:251`,
    `${PAYMENTS_CATALOG}:18`,
    `${PAYMENTS}/verifications/events.ts:14`,
    `${PAYMENTS}/verifications/events.ts:33`,
    `${PAYMENTS}/verifications/events.ts:36`,
    `${PAYMENTS}/verifications/writes/finishes.ts:88`,
    `${PAYMENTS}/verifications/writes/finishes.ts:115`,
    `${PAYMENTS}/events/writer.ts:93`,
    `${PAYMENTS}/events/deliveries.ts:174`,
    "packages/backend/src/platform/observation/cause-properties.ts:53",
  ],
});

export const event_quick_pay_external_address_acknowledged = defineEvent({
  id: "quick_pay_external_address_acknowledged",
  about:
    "The payer acknowledged that a quick pay goes to an external address that is not a Capxul account. Sent by the SDK client's captureExternalAddressAcknowledged, fire and forget, only when a telemetry port is set; a dropped emit is logged, never raised. Its one caller is the React recipient-resolution hook, once per resolved outcome, so the CLI never sends it. It carries the raw recipient address.",
  props: Schema.Struct({
    recipient_locator_kind: Schema.Literal("address"),
    recipient_resolution_status: Schema.Literal("external_address"),
    recipient_address: Address,
    external_address_acknowledged: Schema.Literal(true),
    organization_id: Schema.optional(OrgId),
  }),
  was: [
    `${MONEY}:189`,
    `${MONEY}:256`,
    `${PAYMENTS_CATALOG}:19`,
    "packages/sdk/src/platform/client/internal-surface.ts:64",
    "packages/sdk/src/platform/client/internal-surface.ts:70",
    "packages/sdk-react/src/payments/use-recipient-resolution.ts:171",
  ],
});

export const event_deposit_initiated = defineEvent({
  id: "deposit_initiated",
  about:
    "Retired (ADR-0020 M00): the catalog keeps its decoder but rejects new producers, and no code sends it. It recorded a successful read of deposit instructions, not an incoming transfer.",
  props: Schema.Struct({
    scope_kind: Schema.optional(Schema.Literals(["account", "organization"])),
    account_kind: Schema.optional(Schema.Literals(["personalSafe", "orgTreasury"])),
    chain_id: Schema.optional(Schema.Finite),
    network: Schema.optional(Schema.Literal("base-sepolia")),
    organization_id: Schema.optional(OrgId),
    $groups: Schema.optional(Schema.Struct({ organization: Schema.optional(OrgId) })),
    actor_id: OptionalString,
    actor_kind: Schema.optional(Schema.Literal("authenticated")),
    distinct_id: OptionalString,
    trace_id: OptionalString,
    span_id: OptionalString,
  }),
  was: [`${MONEY}:199`, `${MONEY}:261`, `${PAYMENTS_CATALOG}:20`, "packages/observability/src/catalog/schemas.ts:53"],
});

export const event_deposit_settled = defineEvent({
  id: "deposit_settled",
  about:
    "Retired (ADR-0020 M00): the catalog keeps its decoder but rejects new producers, and no code sends it. It recorded an incoming deposit settled on chain.",
  props: Schema.Struct({
    chain_id: Schema.Finite,
    tx_hash: Schema.String,
    log_index: Schema.Finite,
  }),
  was: [`${MONEY}:214`, `${MONEY}:266`, `${PAYMENTS_CATALOG}:21`, "packages/observability/src/catalog/schemas.ts:53"],
});

/** `PAYOUT_TRANSITION_STATES` (events/banking.ts:100-113). */
const PayoutState = [
  "Creating",
  "Quoted",
  "Funding",
  "InTransit",
  "Delivered",
  "Returning",
  "Refunded",
  "Cancelling",
  "Cancelled",
  "ClosedUnfunded",
  "Refused",
  "NeedsAttention",
] as const;

export const event_payout_transitioned = defineEvent({
  id: "payout_transitioned",
  about:
    "One move of a bank payout, a banking catalog event, booked here because payments mutations send it. The banking payout door schedules it in the same save as the move's line (logMoveInTx), only for a line that moves the payout (a refused line has no `to` and sends nothing). Payments calls the door's write functions directly, by deep import, with source `payments`: it binds the Payment to the quote when its birth command admits the bank payout Payment (bindPayoutPaymentInTx, event payment_bound), claims the payout's send when the execution takes its submission claim (acceptPayoutQuoteInTx, event send_claimed), reports funding verified on chain (payoutFundingVerifiedInTx, funding_verified) and a send that did not land (payoutSendFailedInTx, send_not_landed). A banking event may carry amounts as decimal strings (funding_value, locked_output).",
  props: Schema.Struct({
    release: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{40}$/)))),
    payout_id: Schema.String,
    payout_version: Schema.Finite,
    from_state: Schema.Literals([...PayoutState, "new"]),
    to_state: Schema.Literals(PayoutState),
    event: Schema.Literals([
      "quote_requested",
      "call_claimed",
      "bridge_answered",
      "bridge_answer_unusable",
      "bridge_refused",
      "bridge_call_failed",
      "cancel_answered",
      "payment_bound",
      "balance_check_failed",
      "send_claimed",
      "funding_verified",
      "send_not_landed",
      "funding_reverted",
      "bridge_news",
      "bridge_news_unusable",
      "refund_seen",
      "timer_fired",
      "timer_overdue",
      "person_resolved",
      "converted",
    ]),
    source: Schema.Literals(["quote", "dispatcher", "webhook", "timer", "payments", "person", "watchdog", "conversion"]),
    reason: Schema.optional(
      Schema.Literals([
        "stale_news",
        "duplicate_news",
        "late_answer",
        "unknown_payout",
        "field_invalid",
        "transfer_conflict",
        "not_allowed_in_state",
        "cancel_not_awaiting_funds",
        "lease_lost",
        "create_no_answer",
        "create_answer_unreadable",
        "create_key_expired",
        "send_unknown",
        "delivered_amount_missing",
        "delivered_amount_wrong",
        "delivery_stalled",
        "refund_missing",
        "cancel_failed",
        "bridge_moved_unfunded",
        "bridge_refused_capxul",
        "timer_lost",
        "funding_short",
        "bridge_refused_amount",
        "quote_expired_unpaid",
        "balance_check_failed",
        "approval_expired",
        "send_not_landed",
        "bridge_answered_late",
        "bridge_answer_unusable",
      ]),
    ),
    currency: Schema.Literals(["usd", "eur", "gbp"]),
    bank_rail: Schema.Literals(["ach", "wire", "sepa", "faster_payments"]),
    source_token: Schema.optional(Schema.Literals(["usdc", "eurc"])),
    recipient_kind: Schema.Literal("bank"),
    rail: Schema.Literal("bridge"),
    quote_id: OptionalString,
    /** `DecimalStringSchema`: a non-negative decimal string (protocol/src/money/schema.ts:34-43). */
    funding_value: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+(?:\.[0-9]+)?$/)))),
    locked_output: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+(?:\.[0-9]+)?$/)))),
    ms_in_previous_state: Schema.optional(Schema.Finite),
    payment_id: OptionalString,
    bridge_transfer_id: OptionalString,
  }),
  was: [
    "packages/observability/src/events/banking.ts:270",
    "packages/observability/src/catalog/domains/banking.ts:23",
    "packages/backend/src/banking/payouts/events.ts:111",
    "packages/backend/src/banking/payouts/events.ts:121",
    "packages/backend/src/banking/payouts/writes/lines.ts:82",
    "packages/backend/src/banking/payouts/writes/door.ts:142",
    "packages/backend/src/banking/payouts/writes/payments.ts:1",
    "packages/backend/src/banking/payouts/writes/payments.ts:55",
    "packages/backend/src/banking/payouts/writes/payments.ts:78",
    "packages/backend/src/banking/payouts/writes/payments.ts:113",
    "packages/backend/src/banking/payouts/writes/payments.ts:132",
    `${PAYMENTS}/commands/writes/payouts.ts:4`,
    `${PAYMENTS}/commands/writes/payouts.ts:76`,
    `${PAYMENTS}/executions/writes/claims.ts:12`,
    `${PAYMENTS}/executions/writes/claims.ts:182`,
    `${PAYMENTS}/verifications/writes/sends.ts:5`,
    `${PAYMENTS}/verifications/writes/sends.ts:214`,
    `${PAYMENTS}/writes/outcomes.ts:5`,
    `${PAYMENTS}/writes/outcomes.ts:108`,
  ],
});

export const event_payment_writer_incident = defineEvent({
  id: "payment_writer_incident",
  about:
    "Not a catalog event: a leak-safe engineering line the payment writer prints with console.error as JSON, never sent to PostHog as a product event. It never replaces the Payment result, and a failure to print it is swallowed. Props are its JSON keys besides `event`.",
  props: Schema.Struct({
    reason_code: Schema.String,
    command_id: Schema.optional(Schema.String),
    payment_id: Schema.optional(Schema.String),
    movement_id: Schema.optional(Schema.String),
  }),
  was: [
    `${PAYMENTS}/events/writer.ts:27`,
    `${PAYMENTS}/events/writer.ts:35`,
    `${PAYMENTS}/verifications/writes/conflicts.ts:214`,
    `${PAYMENTS}/verifications/writes/finishes.ts:97`,
    `${PAYMENTS}/verifications/writes/finishes.ts:196`,
    `${PAYMENTS}/verifications/writes/finishes.ts:277`,
    `${PAYMENTS}/writes/rollbacks.ts:52`,
    `${PAYMENTS}/writes/rollbacks.ts:65`,
    `${PAYMENTS}/writes/deposits.ts:144`,
    `${PAYMENTS}/writes/deposits.ts:173`,
    `${PAYMENTS}/writes/deposits.ts:182`,
    `${PAYMENTS}/writes/deposits.ts:198`,
    `${PAYMENTS}/writes/deposits.ts:205`,
  ],
});

// ── neighbours' events that payments mutations send ──────────────────────────────────────
// Like payout_transitioned: another concept's catalog event, scheduled inside a payments
// mutation because payments calls that concept's write function directly.

/** `ScopeKindSchema` (catalog/values.ts:163). */
const ScopeKind = Schema.Literals(["account", "organization"]);

export const event_payroll_run_transitioned = defineEvent({
  id: "payroll_run_transitioned",
  about:
    "A payroll run's committed transition, a payroll catalog event. Payments mutations send two of its three transitions by calling payroll's progression writes directly: `authorized` when the bundler accepts the UserOperation of a command whose Payments name the run (advanceRunsToAuthorized, from the submission write), and `settled` when the last Payment of the run's batch command settles (settleRunForSettledPayment, called from four payments settle paths). Payroll schedules it in the same mutation and delivers it in its own action, as the command's person or the settlement job. A run with no batch command sends nothing, and an un-settle after a reorg sends no transition.",
  props: Schema.Struct({
    organization_id: OrgId,
    transition: Schema.Literals(["prepared", "authorized", "settled"]),
    run_id: Schema.String,
    command_id: OptionalString,
    payment_count: Schema.optional(Schema.Finite),
    occurred_at: Schema.Finite,
  }),
  was: [
    "packages/observability/src/events/workflows.ts:161",
    "packages/observability/src/catalog/domains/payroll.ts:16",
    "packages/backend/src/payroll/runs/events.ts:54",
    "packages/backend/src/payroll/runs/events.ts:64",
    "packages/backend/src/payroll/runs/events.ts:143",
    "packages/backend/src/payroll/runs/writes/progression.ts:38",
    "packages/backend/src/payroll/runs/writes/progression.ts:62",
    `${PAYMENTS}/verifications/writes/submissions.ts:131`,
    `${PAYMENTS}/verifications/writes/claims.ts:88`,
    `${PAYMENTS}/verifications/writes/sends.ts:226`,
    `${PAYMENTS}/verifications/writes/commitments.ts:171`,
    `${PAYMENTS}/writes/settlements.ts:143`,
  ],
});

export const event_invoice_request_transitioned = defineEvent({
  id: "invoice_request_transitioned",
  about:
    "One guarded decision on an invoice request, a requests catalog event. A payments mutation sends `approval_prepared`: preparing the payment of a confirmed request calls the requests concept's prepareConfirmedRequestInTx directly, which schedules it unless the prepare is a replay. Requests delivers it in its own action. `declined` and `cancelled` come from requests' own operations.",
  props: Schema.Struct({
    request_id: Schema.String,
    transition: Schema.Literals(["approval_prepared", "declined", "cancelled"]),
    actor_scope_kind: ScopeKind,
    actor_scope_id: Schema.String,
    occurred_at: Schema.Finite,
  }),
  was: [
    "packages/observability/src/events/workflows.ts:43",
    "packages/observability/src/catalog/domains/requests.ts:19",
    "packages/backend/src/requests/events.ts:108",
    "packages/backend/src/requests/events.ts:201",
    "packages/backend/src/requests/writes/approvals.ts:157",
    "packages/backend/src/requests/writes/approvals.ts:209",
    `${PAYMENTS}/commands/writes/requests.ts:8`,
    `${PAYMENTS}/commands/writes/requests.ts:28`,
  ],
});
