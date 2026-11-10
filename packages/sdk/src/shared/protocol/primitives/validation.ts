import { Errors } from "../errors/factories.ts";

export function isNonEmptyString(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0;
}

/** `raw` as brand `B` once `isBrand` holds: the guard is the brand's proof. */
export function toNonEmptyStringBrand<B extends string>(
  raw: unknown,
  field: string,
  isBrand: (value: unknown) => value is B,
): B {
  if (!isBrand(raw)) {
    throw Errors.invalidInput(field, "must be a non-empty string");
  }

  return raw;
}

export function isSafeNonNegativeInteger(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0;
}

/** `raw` as brand `B` once `isBrand` holds: the guard is the brand's proof. */
export function toSafeNonNegativeIntegerBrand<B extends number>(
  raw: unknown,
  field: string,
  isBrand: (value: unknown) => value is B,
): B {
  if (!isBrand(raw)) {
    throw Errors.invalidInput(
      field,
      invalidValueReason("must be a non-negative safe integer", raw),
    );
  }

  return raw;
}

export function invalidValueReason(prefix: string, raw: unknown): string {
  if (typeof raw === "string") {
    return `${prefix}: ${raw.slice(0, 40)}`;
  }

  return `${prefix}: ${String(raw)}`;
}
