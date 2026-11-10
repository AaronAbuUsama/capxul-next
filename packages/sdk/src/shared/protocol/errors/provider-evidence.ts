// The evidence a provider failure carries (ADR-0039 D1): the closed provider
// and problem words, the split of failure modes between the two provider
// factories, and the typed facts each provider factory turns into `details`.
import type { ChainCause } from "./chain-cause.ts";
import type { FailureMode } from "./failure-modes.ts";
import type { CapxulErrorOptions } from "./model.ts";

/**
 * The providers a failure can name: Capxul's integrations and the ports the
 * SDK and the backend call. Closed, so `details.provider` is a known word and
 * a projection with no free text can still send it (ADR-0039 D6).
 */
export const PROVIDERS = [
  "account-abstraction",
  "agent-exchange",
  "auth-cache",
  "auth-client",
  "better-auth",
  "bootstrap",
  "bridge",
  "browserBridge",
  "capxul-backend",
  "chain",
  "chain-evidence",
  "chain-rpc",
  "chainlink",
  "clock",
  "convex",
  "convex-storage",
  "credentials",
  "indexer",
  "invoice",
  "openfort",
  "openfort.shield",
  "ponder",
  "posthog",
  "resend",
  "sdk",
  "sdk-react",
  "signer",
  "verification",
] as const;

export type ProviderName = (typeof PROVIDERS)[number];

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** What is wrong with the part of a provider's answer that `field` names (ADR-0039 D1). */
export const PROVIDER_PROBLEMS = ["missing", "invalid", "conflict"] as const;

export type ProviderProblem = (typeof PROVIDER_PROBLEMS)[number];

export function isProviderProblem(value: unknown): value is ProviderProblem {
  return typeof value === "string" && (PROVIDER_PROBLEMS as readonly string[]).includes(value);
}

/**
 * The modes of a provider failure with no usable answer: none arrived, or
 * Capxul diagnosed what in the caller's environment kept the provider from
 * answering (the five auth and signer diagnoses). The mode is the evidence.
 * Every other mode names a refusal, which needs the status that refused, so
 * each mode belongs to exactly one provider factory.
 */
export const PROVIDER_UNAVAILABLE_MODES = [
  "auth-origin-mismatch",
  "stale-openfort-cache",
  "app-env-allowlist",
  "no-secure-context",
  "signer-not-ready",
  "rate-limited",
  "timeout",
  "upstream-down",
  "defect",
  "unknown",
] as const satisfies readonly FailureMode[];

export type ProviderUnavailableMode = (typeof PROVIDER_UNAVAILABLE_MODES)[number];

/** The modes of a provider that understood the request and refused it. */
export type ProviderRefusalMode = Exclude<FailureMode, ProviderUnavailableMode>;

export function isProviderUnavailableMode(mode: FailureMode): mode is ProviderUnavailableMode {
  return (PROVIDER_UNAVAILABLE_MODES as readonly FailureMode[]).includes(mode);
}

/**
 * What was caught, never a sentence about it: a string does not compile
 * (ADR-0039 guard T1). A value typed `unknown` passes, because it is the
 * caught value itself.
 */
export type Caught<C> = C extends string ? never : C;

/**
 * The evidence a provider failure names (ADR-0039 D1). Each fact becomes the
 * `details` key of the same name. `operation` is the provider's own operation,
 * such as `virtualAccountHistory` or `eth_call`.
 */
export interface ProviderEvidence {
  readonly provider: ProviderName;
  readonly operation: string;
  readonly httpStatus?: number | undefined;
  /** The provider's own error code, such as Bridge's `code`. */
  readonly providerCode?: string | undefined;
  /** The request or answer field the failure names. */
  readonly field?: string | undefined;
  /** The provider's id for this request, for its support. */
  readonly requestId?: string | undefined;
  /** More evidence for an operator. The wire masks every credential in it. */
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A refusal names what refused: the HTTP status, the chain cause that carries
 * it, or, when the answer kept no status, the mode Capxul read from the
 * provider's error class or code (Openfort's `AuthorizationError` has none).
 */
export type RefusalEvidence =
  | { readonly httpStatus: number; readonly chain?: ChainCause | undefined }
  | { readonly chain: ChainCause; readonly httpStatus?: undefined }
  | {
      readonly mode: ProviderRefusalMode;
      readonly httpStatus?: undefined;
      readonly chain?: undefined;
    };

/** `Errors.providerUnavailable`: no usable answer arrived. */
export type ProviderUnavailableInput<C> = ProviderEvidence & {
  readonly mode: ProviderUnavailableMode;
  readonly chain?: ChainCause | undefined;
  readonly cause?: Caught<C>;
};

/** `Errors.providerRefused`: the provider understood the request and refused it. */
export type ProviderRefusalInput<C> = Omit<ProviderEvidence, "httpStatus"> &
  RefusalEvidence & {
    readonly mode?: ProviderRefusalMode | undefined;
    readonly cause?: Caught<C>;
  };

/** `Errors.providerResponseInvalid`: the provider answered, and Capxul cannot use the answer. */
export type ProviderResponseInvalidInput<C> = ProviderEvidence & {
  readonly field: string;
  readonly problem: ProviderProblem;
  readonly reason?: string | undefined;
  readonly cause?: Caught<C>;
};

/**
 * `Errors.providerRefusedInput`: the provider understood the request and
 * refused the person's own input (ADR-0039 D2). `field` names that input in
 * Capxul's words, and `reason` is the provider's own reason for it.
 */
export type ProviderInputRefusalInput<C> = Omit<ProviderEvidence, "httpStatus" | "field"> & {
  readonly httpStatus: number;
  readonly field: string;
  readonly reason: string;
  readonly cause?: Caught<C>;
};

export function providerDetails(evidence: ProviderEvidence): Record<string, unknown> {
  return {
    ...evidence.details,
    provider: evidence.provider,
    operation: evidence.operation,
    ...(evidence.httpStatus === undefined ? {} : { httpStatus: evidence.httpStatus }),
    ...(evidence.providerCode === undefined ? {} : { providerCode: evidence.providerCode }),
    ...(evidence.field === undefined ? {} : { field: evidence.field }),
    ...(evidence.requestId === undefined ? {} : { requestId: evidence.requestId }),
  };
}

/**
 * The options of a provider failure with a mode. `details.failure_mode` stays
 * equal to `mode` for the readers that predate the field (ADR-0023 R7), such
 * as a released SDK that reads only `details`.
 */
export function providerFailureOptions(
  input: ProviderEvidence & { readonly chain?: ChainCause | undefined; readonly cause?: unknown },
  mode: FailureMode,
): CapxulErrorOptions {
  return {
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    details: { ...providerDetails(input), failure_mode: mode },
    mode,
    ...(input.chain === undefined ? {} : { chain: input.chain }),
  };
}

/** HTTP statuses that refuse the request shape, not the credential and not the server. */
const BAD_REQUEST_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 404, 405, 413, 414, 415, 422]);

/**
 * The mode an HTTP status names when a provider answers with it. The same
 * table as the backend's chain RPC door (`httpFailureMode` in
 * `chain-rpc/internal/rpcFailures.ts`) and the CLI wallet bridge
 * (`apps/cli/src/signer/wallet-failure.ts`): change them together. A status
 * the table does not name stays `unknown`, and the status rides beside it.
 */
export function httpStatusMode(status: number): FailureMode {
  if (status === 429) return "rate-limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "upstream-down";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (BAD_REQUEST_HTTP_STATUSES.has(status)) return "bad-request";
  return "unknown";
}
