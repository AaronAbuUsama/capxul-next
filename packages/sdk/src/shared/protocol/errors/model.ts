import type { ChainCause } from "./chain-cause.ts";
import { isFailureMode, type FailureMode } from "./failure-modes.ts";
import type { CapxulErrorCode } from "./codes.ts";

/**
 * The one failure representation carried by domain state, actor work, and
 * public error projection. Keeping it beside the canonical error catalog
 * prevents a machine or shell from inventing a second code vocabulary.
 */
export interface Failure {
  readonly code: CapxulErrorCode;
  readonly message: string;
  readonly mode?: FailureMode;
  readonly error?: CapxulError;
}

export type CapxulErrorDetails = Record<string, unknown>;

export type SignerSource = "openfort-embedded" | "injected-eip1193" | "local-private-key";

export type VerificationRequiredDetails =
  | { readonly requiredTier: number }
  | { readonly rail: string; readonly currentKind: string };

/** One link of a failure's cause chain as it crosses the wire: what it was and what it said. */
export type CauseLink = { readonly name: string; readonly message: string };

export type CapxulErrorOptions = {
  readonly cause?: unknown;
  readonly details?: CapxulErrorDetails;
  readonly correlationId?: string;
  readonly layer?: string;
  readonly mode?: FailureMode;
  readonly chain?: ChainCause;
};

/**
 * `Code` narrows to the literal a factory passes, so `Errors.invalidInput(...)`
 * is a `CapxulError<"INVALID_INPUT">`. An operation's error channel is then the
 * union of the codes it can actually produce.
 */
export class CapxulError<Code extends CapxulErrorCode = CapxulErrorCode> extends Error {
  readonly code: Code;
  readonly details?: CapxulErrorDetails;
  readonly correlationId?: string;
  readonly layer?: string;
  /** The one-word cause (`FailureMode`). `chain.mode` when a chain cause is set. */
  readonly mode?: FailureMode;
  /** The structured chain-path cause. Never rewritten by a later layer. */
  readonly chain?: ChainCause;

  constructor(code: Code, message: string, options: CapxulErrorOptions = {}) {
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.name = "CapxulError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.correlationId !== undefined) {
      this.correlationId = options.correlationId;
    }
    if (options.layer !== undefined) {
      this.layer = options.layer;
    }
    // The chain cause is authoritative; an explicit mode is next; the older
    // `details.failure_mode` home lifts into the first-class field so every
    // established producer (`Errors.notAuthenticated(..., { failure_mode })`)
    // gains it without a second vocabulary.
    const legacy = options.details?.failure_mode;
    const mode =
      options.chain?.mode ??
      (isFailureMode(options.mode) ? options.mode : undefined) ??
      (isFailureMode(legacy) ? legacy : undefined);
    if (mode !== undefined) {
      this.mode = mode;
    }
    if (options.chain !== undefined) {
      this.chain = options.chain;
    }
  }
}

export function isCapxulError(value: unknown): value is CapxulError {
  return value instanceof CapxulError;
}
