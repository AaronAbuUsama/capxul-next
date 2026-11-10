// The one home for reading an unknown value as a plain record. Every package
// imports these instead of writing its own `typeof x === "object"` guard.

/** A non-null object that is not an array: a value whose fields can be read by name. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The field `key` of `value` when `value` is a record, else undefined. */
export function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** An array whose every entry is a string. */
export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
