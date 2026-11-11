import { CONCEPT_CODE_CLASSES, type CapxulErrorCode } from "./codes.ts";
import type { FailureMode } from "./failure-modes.ts";

/**
 * Who acts on a failure (ADR-0039 D2). A class is derived from code and mode
 * by the two tables below and is never stored, so it cannot disagree with
 * them. No layer rewrites it (ADR-0023 R10).
 */
export const FAILURE_CLASSES = [
  /** The caller's request or environment is wrong. The caller (the person or the calling app) acts. */
  "input",
  /** The request is valid; the current state refuses it. The person or another party acts after a re-read, or waits. */
  "state",
  /** No usable answer arrived (timeout, 5xx, rate limit). Nobody acts now: retry later. Operations act if it persists. */
  "provider-unavailable",
  /** The provider understood the request and refused it. Capxul operations act: account, permission or policy. */
  "provider-refused",
  /** The provider answered; Capxul could not use it. Capxul engineering acts: the parser or a provider change. */
  "provider-answer",
  /** A Capxul bug or misconfiguration, or no known cause. Capxul engineering acts. */
  "defect",
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** A catch-all code names no outcome of its own, so its mode says who acts. */
const BY_MODE = "by-mode";

/**
 * A code with one meaning has a fixed class, and the fixed class wins over the
 * mode. Typed over every code, so a new code without a class does not compile.
 * A concept's codes take the class its table gives (`#errors/code-table`).
 */
const CODE_CLASSES: Record<CapxulErrorCode, FailureClass | typeof BY_MODE> = {
  INVALID_INPUT: "input",
  INVALID_RECIPIENT: "input",
  OTP_EXPIRED: "input",
  NOT_AUTHENTICATED: "input",
  SIGNER_REJECTED: "input",
  CANCELLED: "input",
  WRONG_ENVIRONMENT: "input",

  WRONG_STATE: "state",
  SUPERSEDED: "state",
  STALE_EPOCH: "state",
  ACTOR_STOPPED: "state",
  RATE_LIMITED: "state",
  INSUFFICIENT_BALANCE: "state",
  VERIFICATION_REQUIRED: "state",
  ROLE_PERMISSION_DENIED: "state",
  ROLE_CONFLICT: "state",
  ACCOUNT_CLAIMED_BY_OTHER_SIGNER: "state",
  SMART_ACCOUNT_MISSING: "state",
  PROFILE_NOT_FOUND: "state",
  PLAYER_NOT_FOUND: "state",
  ACCOUNT_NOT_FOUND: "state",
  CAPABILITY_UNAVAILABLE: "state",
  FEATURE_NOT_AVAILABLE: "state",

  // Ruling 3.4: the code that `a38e8145` shipped keeps one fixed class.
  PROVIDER_RESPONSE_INVALID: "provider-answer",

  // Ruling D2b: a Convex execution deadline is `UNKNOWN` with mode `timeout`,
  // and the fixed class makes it a defect, not a provider timeout.
  UNKNOWN: "defect",
  ENV_MISSING: "defect",
  NOT_IMPLEMENTED: "defect",
  WORK_DIED: "defect",

  PROVIDER_ERROR: BY_MODE,
  NETWORK_ERROR: BY_MODE,
  TRANSACTION_FAILED: BY_MODE,
  EMAIL_DELIVERY_FAILED: BY_MODE,

  ...CONCEPT_CODE_CLASSES,
};

/**
 * The class of each mode, for a catch-all code. Typed over every mode, so a
 * new mode without a class does not compile (ADR-0039 guard T2).
 */
const MODE_CLASSES: Record<FailureMode, FailureClass> = {
  "auth-origin-mismatch": "input",
  "stale-openfort-cache": "input",
  "app-env-allowlist": "input",
  "no-secure-context": "input",
  "signer-not-ready": "input",

  revert: "state",
  "insufficient-balance": "state",
  "insufficient-allowance": "state",

  "rate-limited": "provider-unavailable",
  timeout: "provider-unavailable",
  "upstream-down": "provider-unavailable",

  forbidden: "provider-refused",
  rejected: "provider-refused",
  refused: "provider-refused",

  unauthorized: "defect",
  "bad-request": "defect",
  "method-unsupported": "defect",
  defect: "defect",
  unknown: "defect",
};

/**
 * Who acts on this failure. A fixed class wins over the mode; a catch-all
 * code takes the class of its mode, and a catch-all with no mode is a defect,
 * because nothing classified it. Total on any value: a code or mode outside
 * the vocabulary (a hand-built object, a newer peer) is a defect too.
 */
export function failureClass(failure: {
  readonly code: CapxulErrorCode;
  readonly mode?: FailureMode | undefined;
}): FailureClass {
  const fixed = ownEntry(CODE_CLASSES, failure.code) ?? "defect";
  if (fixed !== BY_MODE) return fixed;
  return failure.mode === undefined ? "defect" : (ownEntry(MODE_CLASSES, failure.mode) ?? "defect");
}

/** A table entry by its own key only, so `toString` or `constructor` is never a class. */
function ownEntry<V>(table: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}
