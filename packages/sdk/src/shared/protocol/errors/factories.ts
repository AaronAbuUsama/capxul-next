import type { AssetAmount } from "../money/model.ts";
import { isFailureMode, type FailureMode } from "./failure-modes.ts";
import { networkErrorDetails, type NetworkErrorOptions } from "./network-details.ts";
import { CapxulError, type VerificationRequiredDetails, type SignerSource } from "./model.ts";
import {
  httpStatusMode,
  isProviderUnavailableMode,
  providerDetails,
  providerFailureOptions,
  type Caught,
  type ProviderEvidence,
  type ProviderInputRefusalInput,
  type ProviderRefusalInput,
  type ProviderResponseInvalidInput,
  type ProviderUnavailableInput,
} from "./provider-evidence.ts";
import type { ROLE_PERMISSION_DENIED_REASONS } from "./codes.ts";

export const Errors = {
  notAuthenticated: (message?: string, opts?: { readonly failure_mode?: FailureMode }) =>
    new CapxulError(
      "NOT_AUTHENTICATED",
      message ?? "Not authenticated",
      opts?.failure_mode ? { details: { failure_mode: opts.failure_mode } } : undefined,
    ),
  emailDeliveryFailed: (detail: string) =>
    new CapxulError("EMAIL_DELIVERY_FAILED", "Failed to send email", {
      details: { detail },
    }),

  profileNotFound: (authUserId: string) =>
    new CapxulError("PROFILE_NOT_FOUND", `Profile not found for user ${authUserId}`, {
      details: { authUserId },
    }),

  smartAccountMissing: (authUserId: string) =>
    new CapxulError("SMART_ACCOUNT_MISSING", "Smart account not provisioned", {
      details: { authUserId },
    }),

  playerNotFound: (playerId?: string) =>
    new CapxulError(
      "PLAYER_NOT_FOUND",
      playerId ? `Openfort player ${playerId} not found` : "Openfort player not found",
      playerId === undefined ? undefined : { details: { playerId } },
    ),

  accountNotFound: (accountId?: string) =>
    new CapxulError(
      "ACCOUNT_NOT_FOUND",
      accountId ? `Openfort account ${accountId} not found` : "Openfort account not found",
      accountId === undefined ? undefined : { details: { accountId } },
    ),

  /**
   * The Safe at this email's address is deployed and its owner is neither the
   * Capxul bootstrap owner nor the caller's signer. The claim
   * `swapOwner(bootstrap → signer)` cannot succeed: only the on-chain owner
   * can hand the account over. Read from `getOwners()` before any
   * UserOperation is built (2026-09-02), so no simulation and no retry.
   */
  accountClaimedByOtherSigner: (details: {
    readonly safeAddress: string;
    readonly onChainOwner: string;
    /** A bounded sample of the `getOwners()` answer, for a Safe that is not single-owner. */
    readonly owners?: readonly string[];
    /** The full size of that answer, when the sample is shorter. */
    readonly ownerCount?: number;
    readonly expectedOwner: string;
    readonly signerAddress: string;
  }) =>
    new CapxulError(
      "ACCOUNT_CLAIMED_BY_OTHER_SIGNER",
      "This account is already owned by a different signer.",
      { details },
    ),

  /**
   * No usable answer came from the provider. `mode` says why: `timeout`,
   * `upstream-down` or `rate-limited` when the provider is at fault (retry
   * later); `signer-not-ready` or `no-secure-context` when the local signer
   * cannot answer; `defect` when Capxul's own side failed before an answer
   * could be used; `unknown` when nothing says. A chain cause, when given,
   * names the same mode with its upstream evidence.
   */
  providerUnavailable: <C = never>(input: ProviderUnavailableInput<C>) =>
    new CapxulError(
      "PROVIDER_ERROR",
      `${input.provider} ${input.operation} failed: ${input.mode}`,
      providerFailureOptions(input, input.mode),
    ),

  /**
   * The provider understood the request and refused it. The HTTP status is
   * required, or the chain cause that carries the refusal. `mode` says how,
   * and is `refused` unless the answer says more (`unauthorized`,
   * `forbidden`, `bad-request`, `revert`, ...).
   */
  providerRefused: <C = never>(input: ProviderRefusalInput<C>) => {
    const mode = input.chain?.mode ?? input.mode ?? "refused";
    const status = input.httpStatus ?? input.chain?.httpStatus;
    return new CapxulError(
      "PROVIDER_ERROR",
      `${input.provider} ${input.operation} refused the request: ${mode}${
        status === undefined ? "" : ` (HTTP ${String(status)})`
      }`,
      providerFailureOptions({ ...input, httpStatus: status }, mode),
    );
  },

  /**
   * The provider answered, but Capxul cannot use its answer: `field` names
   * the part, and `problem` says what is wrong with it (`missing`, `invalid`
   * or `conflict`). `reason` adds the specific words. Distinct from
   * `PROVIDER_ERROR`, where no usable answer arrived or the provider refused.
   */
  providerResponseInvalid: <C = never>(input: ProviderResponseInvalidInput<C>) =>
    new CapxulError(
      "PROVIDER_RESPONSE_INVALID",
      `${input.provider} ${input.operation} answered, but its ${input.field} is unusable: ${
        input.reason ?? input.problem
      }`,
      {
        ...(input.cause === undefined ? {} : { cause: input.cause }),
        details: {
          ...providerDetails(input),
          problem: input.problem,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
      },
    ),

  /**
   * The provider understood the request and refused the person's own input,
   * such as an amount below its minimum: `INVALID_INPUT`, so the caller acts
   * (ADR-0039 D2). `field` names the input as Capxul's caller knows it, and
   * `reason` is the provider's reason, which the person reads. The status that
   * refused is required. The field never sits before the colon, as in
   * `invalidInput` (CAP-441).
   */
  providerRefusedInput: <C = never>(input: ProviderInputRefusalInput<C>) =>
    new CapxulError("INVALID_INPUT", `${input.field} is invalid: ${input.reason}`, {
      ...(input.cause === undefined ? {} : { cause: input.cause }),
      details: { ...providerDetails(input), field: input.field, reason: input.reason },
    }),

  capabilityUnavailable: (provider: string, operation: string) =>
    new CapxulError("CAPABILITY_UNAVAILABLE", "Provider capability is unavailable", {
      details: { provider, operation },
    }),

  /**
   * The caller's input is wrong: `field` names it. `cause` is what refused it, such as a decode failure.
   * The field never sits before the colon: the prose mask reads `signature:` as a credential label
   * and would cut the next word on every surface that masks the text again (CAP-441).
   */
  invalidInput: <C = never>(field: string, reason: string, cause?: Caught<C>) =>
    new CapxulError("INVALID_INPUT", `${field} is invalid: ${reason}`, {
      ...(cause === undefined ? {} : { cause }),
      details: { field, reason },
    }),

  /** `cause` is what refused the value, when it is set but unusable. */
  envMissing: <C = never>(name: string, cause?: Caught<C>) =>
    new CapxulError("ENV_MISSING", `Environment variable ${name} not configured`, {
      ...(cause === undefined ? {} : { cause }),
      details: { name },
    }),

  notImplemented: (domain: string, method: string) =>
    new CapxulError(
      "NOT_IMPLEMENTED",
      `${domain}.${method} is not yet implemented. This feature is planned for a future release.`,
      { details: { domain, method } },
    ),

  verificationRequired: (details: VerificationRequiredDetails) => {
    const message =
      "rail" in details
        ? `Verification is required before ${details.rail} can use ${details.currentKind}.`
        : `Verification tier ${details.requiredTier} is required.`;

    return new CapxulError("VERIFICATION_REQUIRED", message, {
      details,
    });
  },

  insufficientBalance: (asset: string, available: string, required: string) =>
    new CapxulError("INSUFFICIENT_BALANCE", `Insufficient ${asset} balance`, {
      details: { asset, available, required },
    }),

  invalidRecipient: (reason: string) =>
    new CapxulError("INVALID_RECIPIENT", `Invalid recipient: ${reason}`, {
      details: { reason },
    }),

  /**
   * The org Zodiac Roles modifier REFUSED the spend on-chain (G4 · #547): the
   * member's role condition (per-tx cap, per-day allowance, allowed recipient,
   * or membership) was violated, so `execTransactionWithRole` reverted. This is
   * a PERMISSION denial — explicitly NOT an `INSUFFICIENT_BALANCE` (the treasury
   * held the funds; the role's authority is what bound). `reason` discriminates
   * the violated condition (`over_cap` / `daily_cap` / `not_member` /
   * `disallowed_recipient` / `condition_violation` / `budget_exhausted`);
   * no Safe, Roles module or role key enters the details.
   * `budget_exhausted` carries what the Budget's allowance still holds and
   * what the spend needs, as asset amounts in major units (#2297); the asset
   * id names the public token contract.
   */
  rolePermissionDenied: (details: {
    readonly reason: (typeof ROLE_PERMISSION_DENIED_REASONS)[number];
    readonly operation?: string;
    readonly remaining?: AssetAmount;
    readonly required?: AssetAmount;
  }) =>
    new CapxulError(
      "ROLE_PERMISSION_DENIED",
      `Org role denied this spend on-chain (${details.reason}).`,
      {
        details: {
          reason: details.reason,
          ...(details.operation === undefined ? {} : { operation: details.operation }),
          ...(details.remaining === undefined ? {} : { remaining: details.remaining }),
          ...(details.required === undefined ? {} : { required: details.required }),
        },
      },
    ),

  /**
   * A transaction (or sponsored UserOp) failed. `details.reason` discriminates
   * the failure mode for callers that must distinguish a CONFIRMED on-chain
   * revert (`"onchain_revert"` — the op executed and reverted, e.g. a Zodiac
   * Roles condition violation) from an inconclusive infra failure. A confirmed
   * revert is the ONLY mode the org spend port may map to a roles denial.
   */
  transactionFailed: <C = never>(
    operation: string,
    cause?: Caught<C>,
    extra?: { readonly reason?: string; readonly userOpHash?: string },
  ) =>
    new CapxulError("TRANSACTION_FAILED", `Transaction failed: ${operation}`, {
      cause,
      details: {
        operation,
        ...(extra?.reason === undefined ? {} : { reason: extra.reason }),
        ...(extra?.userOpHash === undefined ? {} : { userOpHash: extra.userOpHash }),
      },
    }),

  rateLimited: (details?: { readonly retryAfterMs?: number; readonly resource?: string }) =>
    new CapxulError(
      "RATE_LIMITED",
      "Rate limit exceeded",
      details === undefined ? undefined : { details: { ...details } },
    ),

  networkError: <C = never>(operation: string, cause?: Caught<C>, opts?: NetworkErrorOptions) => {
    const mode = isFailureMode(opts?.failure_mode) ? opts.failure_mode : undefined;
    return new CapxulError("NETWORK_ERROR", `Network error during ${operation}`, {
      cause,
      details: networkErrorDetails(operation, opts),
      ...(mode === undefined ? {} : { mode }),
    });
  },

  unknown: <C = never>(cause?: Caught<C>) => new CapxulError("UNKNOWN", "Unknown error", { cause }),

  otpExpired: (details?: { readonly email?: string; readonly expiredAt?: number }) =>
    new CapxulError(
      "OTP_EXPIRED",
      "Verification code has expired. Request a new one.",
      details === undefined ? undefined : { details: { ...details } },
    ),

  signerRejected: <C = never>(details: {
    readonly source: SignerSource;
    readonly reason?: string;
    readonly cause?: Caught<C>;
  }) =>
    new CapxulError("SIGNER_REJECTED", "Signer rejected the request.", {
      cause: details.cause,
      details:
        details.reason === undefined
          ? { source: details.source }
          : { source: details.source, reason: details.reason },
    }),

  superseded: (details: {
    readonly operation: string;
    readonly reason: string;
    readonly executionId?: string;
  }) =>
    new CapxulError("SUPERSEDED", "Operation was superseded.", {
      details: {
        operation: details.operation,
        reason: details.reason,
        ...(details.executionId === undefined ? {} : { executionId: details.executionId }),
      },
    }),

  cancelled: <C = never>(
    details?: { readonly operation?: string; readonly reason?: string },
    cause?: Caught<C>,
  ) =>
    new CapxulError("CANCELLED", "Operation was cancelled.", {
      ...(details === undefined ? {} : { details: { ...details } }),
      ...(cause === undefined ? {} : { cause }),
    }),

  /**
   * Method called from a flow state where its precondition fails (TA16). The
   * SDK's method API short-circuits with this error before driving the
   * internal state machine. `currentState` is the Effect-machine snapshot
   * tag (stringified from the SDK's actor-shell snapshot; see
   * `packages/errors/CONTEXT.md`); `validStates`
   * enumerates the states the method accepts that the target can still reach.
   * An empty list means the target is final, and the message says so instead
   * of listing states.
   */
  wrongState: (details: {
    readonly method: string;
    readonly currentState: string;
    readonly validStates: readonly string[];
    readonly organizationId?: string;
  }) =>
    new CapxulError(
      "WRONG_STATE",
      details.validStates.length === 0
        ? `${details.method} called from state '${details.currentState}'; it can no longer move to any state`
        : `${details.method} called from state '${details.currentState}'; valid states: ${details.validStates.join(", ")}`,
      {
        details: {
          method: details.method,
          currentState: details.currentState,
          validStates: [...details.validStates],
          ...(details.organizationId === undefined
            ? {}
            : { organizationId: details.organizationId }),
        },
      },
    ),
} as const;

/**
 * A provider answered with an HTTP failure status: `providerUnavailable` or
 * `providerRefused`, by what the status names (`httpStatusMode`).
 */
export function providerStatusFailure<C = never>(
  input: ProviderEvidence & { readonly httpStatus: number; readonly cause?: Caught<C> },
): CapxulError<"PROVIDER_ERROR"> {
  const mode = httpStatusMode(input.httpStatus);
  return isProviderUnavailableMode(mode)
    ? Errors.providerUnavailable({ ...input, mode })
    : Errors.providerRefused({ ...input, mode });
}
