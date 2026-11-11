// The canonical error-code catalog as a runtime constant. `CapxulErrorCode`
// is derived from it so the type and any runtime check that needs to
// enumerate codes (e.g. the convex-error codec's `KNOWN_CODES`) share a
// single source of truth — a TypeScript union alone can't be introspected
// at runtime, which previously forced a hand-maintained duplicate. The
// platform's own codes are listed here; each concept's codes, classes,
// expected outcomes and refusal reasons live in `<concept>/error-codes.ts`
// (`#errors/code-table`), so a code added in one concept edits no shared file.

import { ACCESS_ERRORS } from "../access/error-codes.ts";
import { ACCOUNTS_ERRORS } from "../accounts/error-codes.ts";
import { ACTIVITY_ERRORS } from "../activity/error-codes.ts";
import { APPLICATIONS_ERRORS } from "../applications/error-codes.ts";
import { BANKING_ERRORS } from "../banking/error-codes.ts";
import { BOOKS_ERRORS } from "../books/error-codes.ts";
import { DOCUMENTS_ERRORS } from "../documents/error-codes.ts";
import { MEDIA_ERRORS } from "../media/error-codes.ts";
import { OPERATOR_ERRORS } from "../operator/error-codes.ts";
import { ORGANIZATIONS_ERRORS } from "../organizations/error-codes.ts";
import { PARTIES_ERRORS } from "../parties/error-codes.ts";
import { PAYMENTS_ERRORS } from "../payments/error-codes.ts";
import { PAYROLL_ERRORS } from "../payroll/error-codes.ts";
import { PERMISSIONS_ERRORS } from "../permissions/error-codes.ts";
import { PROFILES_ERRORS } from "../profiles/error-codes.ts";
import { REQUESTS_ERRORS } from "../requests/error-codes.ts";

export const CAPXUL_ERROR_CODES = [
  "NOT_AUTHENTICATED",
  "EMAIL_DELIVERY_FAILED",
  "PROFILE_NOT_FOUND",
  "SMART_ACCOUNT_MISSING",
  "PLAYER_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_CLAIMED_BY_OTHER_SIGNER",
  "PROVIDER_ERROR",
  "PROVIDER_RESPONSE_INVALID",
  "CAPABILITY_UNAVAILABLE",
  "INVALID_INPUT",
  "ENV_MISSING",
  "NOT_IMPLEMENTED",
  "VERIFICATION_REQUIRED",
  "INSUFFICIENT_BALANCE",
  "INVALID_RECIPIENT",
  "ROLE_PERMISSION_DENIED",
  "ROLE_CONFLICT",
  "TRANSACTION_FAILED",
  "RATE_LIMITED",
  "NETWORK_ERROR",
  "UNKNOWN",
  "OTP_EXPIRED",
  "SIGNER_REJECTED",
  "CANCELLED",
  "WRONG_STATE",
  "STALE_EPOCH",
  "SUPERSEDED",
  "WORK_DIED",
  "ACTOR_STOPPED",
  // A devnet tool asked of a backend that is not a local devnet (environments, slice 02).
  "WRONG_ENVIRONMENT",
  // A feature gate (or its ceiling in this environment) is off for the caller.
  "FEATURE_NOT_AVAILABLE",
  ...ACCESS_ERRORS.codes,
  ...ACCOUNTS_ERRORS.codes,
  ...ACTIVITY_ERRORS.codes,
  ...APPLICATIONS_ERRORS.codes,
  ...BANKING_ERRORS.codes,
  ...BOOKS_ERRORS.codes,
  ...DOCUMENTS_ERRORS.codes,
  ...MEDIA_ERRORS.codes,
  ...OPERATOR_ERRORS.codes,
  ...ORGANIZATIONS_ERRORS.codes,
  ...PARTIES_ERRORS.codes,
  ...PAYMENTS_ERRORS.codes,
  ...PAYROLL_ERRORS.codes,
  ...PERMISSIONS_ERRORS.codes,
  ...PROFILES_ERRORS.codes,
  ...REQUESTS_ERRORS.codes,
] as const;

export type CapxulErrorCode = (typeof CAPXUL_ERROR_CODES)[number];

const CODES: ReadonlySet<unknown> = new Set(CAPXUL_ERROR_CODES);

/** Whether a value, such as code text a peer sent, is a Capxul error code. */
export function isCapxulErrorCode(value: unknown): value is CapxulErrorCode {
  return CODES.has(value);
}

/** The existing Organization authority refusal vocabulary. */
export const ROLE_PERMISSION_DENIED_REASONS = [
  "over_cap",
  "daily_cap",
  "not_member",
  // A member of the Organization whose personal Safe is not one of its Safe's Directors.
  "not_owner",
  // A payment agreement write by someone who holds no role for the department.
  "not_holder",
  "disallowed_recipient",
  "condition_violation",
  "budget_exhausted",
  // A books change by a Seat that does not hold Manage books.
  "manage_books_required",
  ...ACCESS_ERRORS.reasons,
  ...ACCOUNTS_ERRORS.reasons,
  ...ACTIVITY_ERRORS.reasons,
  ...APPLICATIONS_ERRORS.reasons,
  ...BANKING_ERRORS.reasons,
  ...BOOKS_ERRORS.reasons,
  ...DOCUMENTS_ERRORS.reasons,
  ...MEDIA_ERRORS.reasons,
  ...OPERATOR_ERRORS.reasons,
  ...ORGANIZATIONS_ERRORS.reasons,
  ...PARTIES_ERRORS.reasons,
  ...PAYMENTS_ERRORS.reasons,
  ...PAYROLL_ERRORS.reasons,
  ...PERMISSIONS_ERRORS.reasons,
  ...PROFILES_ERRORS.reasons,
  ...REQUESTS_ERRORS.reasons,
] as const;

/**
 * The error codes that represent an expected product outcome rather than a
 * defect. The SDK and backend observation boundaries both classify failures
 * against this set to route expected outcomes to their own PostHog event
 * stream; keeping the single copy here (adjacent to `CAPXUL_ERROR_CODES`, so a
 * code rename forces this set to move with it) stops the two sides of the wire
 * from drifting and silently splitting one outcome across two streams.
 */
export const EXPECTED_OPERATION_OUTCOMES: ReadonlySet<CapxulErrorCode> = new Set([
  "INVALID_INPUT",
  "NOT_AUTHENTICATED",
  // A user with no Safe yet — the normal post-OTP / pre-provision state. Reading
  // the account, current user, or balance in that window is an expected outcome,
  // not a defect, so both observation boundaries route it to their
  // `*_expected_outcome` stream instead of an unexpected `$exception` (#1031).
  "SMART_ACCOUNT_MISSING",
  // A Safe that another signer owns cannot be claimed by the current signer.
  // This is a refused product outcome, not an infrastructure defect (#1760).
  "ACCOUNT_CLAIMED_BY_OTHER_SIGNER",
  "CANCELLED",
  "SIGNER_REJECTED",
  "VERIFICATION_REQUIRED",
  "INSUFFICIENT_BALANCE",
  "INVALID_RECIPIENT",
  "ROLE_PERMISSION_DENIED",
  // One person may not hold two roles that defeat each other: a department
  // holder and Manage Budgets (ADR-0040). The Directors choose someone else.
  "ROLE_CONFLICT",
  "CAPABILITY_UNAVAILABLE",
  "RATE_LIMITED",
  "OTP_EXPIRED",
  "WRONG_STATE",
  "STALE_EPOCH",
  "SUPERSEDED",
  "ACTOR_STOPPED",
  "WRONG_ENVIRONMENT",
  // The feature exists but is not on for this person or Organization (scenario oracle 06).
  "FEATURE_NOT_AVAILABLE",
  ...ACCESS_ERRORS.expected,
  ...ACCOUNTS_ERRORS.expected,
  ...ACTIVITY_ERRORS.expected,
  ...APPLICATIONS_ERRORS.expected,
  ...BANKING_ERRORS.expected,
  ...BOOKS_ERRORS.expected,
  ...DOCUMENTS_ERRORS.expected,
  ...MEDIA_ERRORS.expected,
  ...OPERATOR_ERRORS.expected,
  ...ORGANIZATIONS_ERRORS.expected,
  ...PARTIES_ERRORS.expected,
  ...PAYMENTS_ERRORS.expected,
  ...PAYROLL_ERRORS.expected,
  ...PERMISSIONS_ERRORS.expected,
  ...PROFILES_ERRORS.expected,
  ...REQUESTS_ERRORS.expected,
]);

const EXPECTED_OUTCOME_CODES: ReadonlySet<string> = EXPECTED_OPERATION_OUTCOMES;

/** Each concept code's fixed class, for `failureClass`. */
export const CONCEPT_CODE_CLASSES = {
  ...ACCESS_ERRORS.classes,
  ...ACCOUNTS_ERRORS.classes,
  ...ACTIVITY_ERRORS.classes,
  ...APPLICATIONS_ERRORS.classes,
  ...BANKING_ERRORS.classes,
  ...BOOKS_ERRORS.classes,
  ...DOCUMENTS_ERRORS.classes,
  ...MEDIA_ERRORS.classes,
  ...OPERATOR_ERRORS.classes,
  ...ORGANIZATIONS_ERRORS.classes,
  ...PARTIES_ERRORS.classes,
  ...PAYMENTS_ERRORS.classes,
  ...PAYROLL_ERRORS.classes,
  ...PERMISSIONS_ERRORS.classes,
  ...PROFILES_ERRORS.classes,
  ...REQUESTS_ERRORS.classes,
};

/** Whether a code, or any code text a peer sent, names an expected product outcome, not a defect. */
export function isExpectedOutcome(code: string): boolean {
  return EXPECTED_OUTCOME_CODES.has(code);
}
