// One concept's error codes, beside its operations: each code, who acts on it
// (its class, ADR-0039 D2), whether it is an expected product outcome, and the
// `ROLE_PERMISSION_DENIED` reasons the concept adds. `codes.ts` joins every
// concept's table to the platform's own codes, so an operation that adds a
// code edits its concept's file alone.

import type { FailureClass } from "./classes.ts";

/**
 * A concept's table, checked as one: every code has a class, an expected
 * outcome is one of the concept's codes, and nothing else is listed.
 */
export function conceptErrors<
  const Codes extends readonly string[],
  const Reasons extends readonly string[],
>(table: {
  /** Its codes, in catalog order. */
  readonly codes: Codes;
  /** Who acts on each code: a concept's code has one fixed class. */
  readonly classes: { readonly [Code in Codes[number]]: FailureClass };
  /** The codes that are an expected product outcome rather than a defect. */
  readonly expected: readonly Codes[number][];
  /** The `ROLE_PERMISSION_DENIED` reasons the concept adds. */
  readonly reasons: Reasons;
}) {
  return table;
}
