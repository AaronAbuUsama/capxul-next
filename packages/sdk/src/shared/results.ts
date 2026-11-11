// What every public method answers: the value or a typed error, never a rejected promise (ADR-0023).
// Brought from packages/sdk/src/platform/results.ts of the old repository: only this type, because the rest of that
// file reads the operation catalogue, which the book now owns.

import type { CapxulError } from "./protocol/errors/model.ts";
import type { CapxulErrorCode } from "./protocol/errors/codes.ts";

/** Result-shape: `Code` narrows the failure to the codes the method can return. */
export type CapxulResult<T, Code extends CapxulErrorCode = CapxulErrorCode> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CapxulError<Code> };
