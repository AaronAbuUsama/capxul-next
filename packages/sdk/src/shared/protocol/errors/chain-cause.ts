import { redactSecrets } from "./secret-material.ts";
import { type FailureMode, isFailureMode } from "./failure-modes.ts";
import { type RevertSummary, decodeRevert, revertSummaryText } from "./revert-summary.ts";
import { isRecord } from "../primitives/record.ts";
import { RPC_NODE_NAMES } from "../evm/rpc-endpoints.ts";

/**
 * Who answered: a configured node by its place in the chain's list
 * (`#evm/rpc-endpoints`), `alto` the bundler, or `gateway` the AA gateway's own
 * logic.
 */
export const CHAIN_UPSTREAMS = [...RPC_NODE_NAMES, "alto", "gateway"] as const;

export type ChainUpstream = (typeof CHAIN_UPSTREAMS)[number];

export function isChainUpstream(value: unknown): value is ChainUpstream {
  return typeof value === "string" && (CHAIN_UPSTREAMS as readonly string[]).includes(value);
}

/**
 * The structured cause of a chain-path failure. Built once by the layer that
 * saw the failure and passed on unchanged. `providerMessage` is the provider's
 * own words, bounded and secret-masked by the producer; it is evidence, never
 * something a consumer routes on.
 */
export type ChainCause = {
  readonly mode: FailureMode;
  readonly upstream: ChainUpstream;
  readonly method: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly rpcCode?: number;
  readonly revert?: RevertSummary;
  readonly providerMessage?: string;
  /**
   * Every upstream tried for this read, in order, ending with the one whose
   * answer this cause is (#1818). One `$exception` row then tells the whole
   * story of an exhausted chain; the recovered case stays an event.
   */
  readonly attempts?: readonly ChainAttempt[];
  /** The refusing upstream's allow-listed response headers, masked and bounded. */
  readonly responseHeaders?: Readonly<Record<string, string>>;
};

/** One upstream tried and the word for how it failed (#1818). */
export type ChainAttempt = {
  readonly upstream: ChainUpstream;
  readonly mode: FailureMode;
  readonly httpStatus?: number;
  readonly rpcCode?: number;
  readonly durationMs: number;
};

/** The most attempts a cause carries: three node upstreams and room for a chain that grows. */
export const CHAIN_ATTEMPTS_MAX = 5;

/**
 * The response headers that name a refusal or let provider support find the
 * request. Nothing else crosses: a header can carry a session or a key.
 */
export const RESPONSE_HEADER_ALLOWLIST: readonly string[] = [
  "retry-after",
  "www-authenticate",
  "content-type",
  "x-request-id",
  "cf-ray",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "server",
];

const RESPONSE_HEADER_VALUE_MAX = 128;

/**
 * The allow-listed headers of one answer, masked and bounded. `read` is
 * `Headers.get` or a lookup into a decoded record. Empty when none is present.
 */
export function boundedResponseHeaders(
  read: (name: string) => string | null | undefined,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {};
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = read(name);
    if (typeof value === "string" && value.length > 0) {
      headers[name] = boundedEvidence(value, RESPONSE_HEADER_VALUE_MAX);
    }
  }
  return headers;
}

// Bounds for evidence that crosses an untrusted boundary. The wire is the
// gateway's answer or a Convex error payload; a provider body can be any size
// and can echo a credential. Every string is masked and capped here, once.
const PROVIDER_MESSAGE_MAX = 300;

const METHOD_MAX = 64;

/** Mask credential-shaped content, then cap the length. Total on any string. */
export function boundedEvidence(value: string, max: number): string {
  const text = redactSecrets(value);
  return text.length <= max ? text : text.slice(0, max);
}

/**
 * Decode a `ChainCause` from untrusted wire data (gateway JSON-RPC `error.data`,
 * a Convex error payload). Every string is masked and bounded; an unrecognized
 * shape yields null, because a consumer must never invent a cause.
 */
export function decodeChainCause(value: unknown): ChainCause | null {
  if (!isRecord(value)) return null;
  if (!isFailureMode(value.mode) || !isChainUpstream(value.upstream)) return null;
  if (typeof value.method !== "string" || typeof value.retryable !== "boolean") return null;
  const cause: {
    -readonly [K in keyof ChainCause]: ChainCause[K];
  } = {
    mode: value.mode,
    upstream: value.upstream,
    method: boundedEvidence(value.method, METHOD_MAX),
    retryable: value.retryable,
  };
  if (typeof value.httpStatus === "number" && Number.isInteger(value.httpStatus)) {
    cause.httpStatus = value.httpStatus;
  }
  if (typeof value.rpcCode === "number" && Number.isInteger(value.rpcCode)) {
    cause.rpcCode = value.rpcCode;
  }
  const revert = decodeRevert(value.revert);
  if (revert !== null) cause.revert = revert;
  if (typeof value.providerMessage === "string") {
    cause.providerMessage = boundedEvidence(value.providerMessage, PROVIDER_MESSAGE_MAX);
  }
  const attempts = decodeAttempts(value.attempts);
  if (attempts !== null) cause.attempts = attempts;
  if (isRecord(value.responseHeaders)) {
    const raw = value.responseHeaders;
    const headers = boundedResponseHeaders((name) => {
      const header = raw[name];
      return typeof header === "string" ? header : null;
    });
    if (Object.keys(headers).length > 0) cause.responseHeaders = headers;
  }
  return cause;
}

/** The attempt sequence, bounded. A malformed entry drops the sequence, never the cause. */
function decodeAttempts(value: unknown): readonly ChainAttempt[] | null {
  if (!Array.isArray(value)) return null;
  const attempts: ChainAttempt[] = [];
  for (const entry of value.slice(0, CHAIN_ATTEMPTS_MAX)) {
    if (!isRecord(entry) || !isChainUpstream(entry.upstream) || !isFailureMode(entry.mode)) {
      return null;
    }
    const duration = entry.durationMs;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) return null;
    attempts.push({
      upstream: entry.upstream,
      mode: entry.mode,
      ...(typeof entry.httpStatus === "number" && Number.isInteger(entry.httpStatus)
        ? { httpStatus: entry.httpStatus }
        : {}),
      ...(typeof entry.rpcCode === "number" && Number.isInteger(entry.rpcCode)
        ? { rpcCode: entry.rpcCode }
        : {}),
      durationMs: Math.round(duration),
    });
  }
  return attempts.length === 0 ? null : attempts;
}

/**
 * The cause as flat PostHog properties. Same keys from every producer, so one
 * filter (`failure_mode = 'rate-limited'`) finds the gateway's, the backend's,
 * and the SDK's rows alike.
 */
export type ChainCauseProperties = {
  readonly failure_mode: FailureMode;
  readonly chain_upstream: ChainUpstream;
  readonly chain_method: string;
  readonly chain_retryable: boolean;
  readonly chain_http_status?: number;
  readonly chain_rpc_code?: number;
  readonly chain_revert_name?: string;
  readonly chain_revert_selector?: string;
  readonly chain_revert_args?: Readonly<Record<string, string>>;
  readonly chain_provider_message?: string;
  readonly chain_attempts?: {
    readonly upstream: ChainUpstream;
    readonly failure_mode: FailureMode;
    readonly http_status?: number;
    readonly rpc_code?: number;
    readonly duration_ms: number;
  }[];
  readonly chain_response_headers?: Readonly<Record<string, string>>;
};

export function chainCauseProperties(chain: ChainCause): ChainCauseProperties {
  return {
    failure_mode: chain.mode,
    chain_upstream: chain.upstream,
    chain_method: chain.method,
    chain_retryable: chain.retryable,
    ...(chain.httpStatus === undefined ? {} : { chain_http_status: chain.httpStatus }),
    ...(chain.rpcCode === undefined ? {} : { chain_rpc_code: chain.rpcCode }),
    ...(chain.revert === undefined
      ? {}
      : {
          chain_revert_name: chain.revert.name ?? "unknown",
          chain_revert_selector: chain.revert.selector,
          chain_revert_args: chain.revert.args,
        }),
    ...(chain.providerMessage === undefined
      ? {}
      : { chain_provider_message: chain.providerMessage }),
    ...(chain.attempts === undefined
      ? {}
      : {
          chain_attempts: chain.attempts.map((attempt) => ({
            upstream: attempt.upstream,
            failure_mode: attempt.mode,
            ...(attempt.httpStatus === undefined ? {} : { http_status: attempt.httpStatus }),
            ...(attempt.rpcCode === undefined ? {} : { rpc_code: attempt.rpcCode }),
            duration_ms: attempt.durationMs,
          })),
        }),
    ...(chain.responseHeaders === undefined
      ? {}
      : { chain_response_headers: chain.responseHeaders }),
  };
}

/**
 * The cause in one line for an issue description: the decoded revert first,
 * because the provider's own message masks the raw revert data (`reason:
 * [REDACTED]`), then the provider's words. `undefined` when the cause carries
 * neither, so the caller falls back to the error message.
 */
export function chainCauseSummary(chain: ChainCause): string | undefined {
  const revert = chain.revert === undefined ? undefined : revertSummaryText(chain.revert);
  if (revert === undefined) return chain.providerMessage;
  return chain.providerMessage === undefined ? revert : `${revert}; ${chain.providerMessage}`;
}

/**
 * The evidence behind the one word, for an issue name: ` (HTTP 403)` or
 * ` (JSON-RPC -32000)`. Empty when the cause carries neither. The status
 * names the provider's front door and the code names the node's verdict;
 * `forbidden` alone made an operator open the issue to learn it was a 403.
 */
export function chainEvidenceLabel(
  chain:
    | { readonly httpStatus?: number | undefined; readonly rpcCode?: number | undefined }
    | undefined,
): string {
  if (chain === undefined) return "";
  if (chain.httpStatus !== undefined && chain.httpStatus !== 200) {
    return ` (HTTP ${String(chain.httpStatus)})`;
  }
  if (chain.rpcCode !== undefined) return ` (JSON-RPC ${String(chain.rpcCode)})`;
  return "";
}

/**
 * The error-tracking fingerprint for a failure: the code, the one-word cause,
 * and the operation. PostHog groups `$exception` rows by this value, so one
 * issue is one cause at one operation instead of every provider failure in
 * one bucket (money-path audit 2026-09-02, row P1).
 */
export function failureFingerprint(
  code: string,
  mode: FailureMode | undefined,
  operation: string,
): string {
  return `${code}:${mode ?? "none"}:${operation}`;
}
