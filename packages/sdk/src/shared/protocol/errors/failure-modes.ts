/**
 * Why an operation failed — the one flat vocabulary. The first five are the
 * auth and signer diagnoses that predate this file. The next eleven name the
 * chain path. `refused` and `defect` name a provider refusal and a Capxul
 * fault on any path (ADR-0039 D2). `FailureMode` is derived from this list so
 * a runtime membership check (the SDK's `$exception` projection, the
 * observability schema) and the type can never drift apart. Every word has a
 * failure class in `classes.ts`.
 */
export const FAILURE_MODES = [
  /** OTP cookies live on `localhost:PORT` but OpenFort hits the Convex host. */
  "auth-origin-mismatch",
  /** An old `userId` in scoped storage makes the SDK skip re-auth → 401. */
  "stale-openfort-cache",
  /** The selected app/deployment origin is not allowlisted → 401. */
  "app-env-allowlist",
  /** Sandboxed/headless browser with no Web Crypto. */
  "no-secure-context",
  /** The embedded wallet lost its configured signer state. */
  "signer-not-ready",
  /** One upstream answered HTTP 429 or JSON-RPC -32005. Retryable. */
  "rate-limited",
  /** No answer inside the budget. Retryable. */
  "timeout",
  /**
   * HTTP 5xx, a connection failure, an answer cut off in transit, or a chain
   * RPC answer of the wrong shape (the next upstream may answer it). Retryable.
   * A complete HTTP provider answer Capxul cannot use is
   * `PROVIDER_RESPONSE_INVALID`, with no mode.
   */
  "upstream-down",
  /** Simulation or execution reverted; `chain.revert` names it when decodable. */
  "revert",
  /** A balance pre-flight shortfall or a decoded `ERC20InsufficientBalance`. */
  "insufficient-balance",
  /** A decoded `ERC20InsufficientAllowance`. */
  "insufficient-allowance",
  /** The bundler's validation refused the operation (AA2x/AA3x); its text is carried. */
  "rejected",
  /** The upstream refused the credential (HTTP 401): the gateway token or a hosted node key. */
  "unauthorized",
  /** The upstream refused the key, origin, or method (HTTP 403). The next upstream's key may be fine. */
  "forbidden",
  /** The upstream refused the request shape (HTTP 400-family; JSON-RPC -32600, -32602, -32700). */
  "bad-request",
  /** The node does not serve the method (JSON-RPC -32601). The next upstream may. */
  "method-unsupported",
  /** The provider understood the request and refused it: an account, permission or policy refusal. */
  "refused",
  /** A Capxul bug or misconfiguration: Capxul's own code or settings failed. */
  "defect",
  /** No cause could be determined. */
  "unknown",
] as const;

export type FailureMode = (typeof FAILURE_MODES)[number];

export function isFailureMode(value: unknown): value is FailureMode {
  return typeof value === "string" && (FAILURE_MODES as readonly string[]).includes(value);
}
