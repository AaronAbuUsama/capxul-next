import {
  FAILURE_MODES as FAILURE_MODE_LIST,
  isFailureMode,
  type FailureMode,
} from "./protocol/errors/failure-modes.ts";
import { isCapxulError } from "./protocol/errors/model.ts";

/**
 * The canonical {@link FailureMode} members, for runtime membership checks.
 * Derived from `@capxul/errors` so this set and the taxonomy are one value:
 * the 2026-09-02 audit found a local copy that lacked `rate-limited`, so every
 * throttle was captured as `unknown`.
 */
export const FAILURE_MODES: ReadonlySet<string> = new Set<FailureMode>(FAILURE_MODE_LIST);

/**
 * Extract the structured {@link FailureMode} from a CapxulError.
 *
 * Reads the first-class `mode`, then the older `details.failure_mode` home,
 * and returns either only when it is a canonical member; any other value (a
 * legacy free string, a typo, a non-string) yields `undefined` so downstream
 * telemetry never reports an unrecognised cause.
 */
export function getFailureMode(error: unknown): FailureMode | undefined {
  if (!isCapxulError(error)) return undefined;
  if (isFailureMode(error.mode)) return error.mode;
  const details = error.details;
  if (details === undefined) return undefined;
  return isFailureMode(details.failure_mode) ? details.failure_mode : undefined;
}
