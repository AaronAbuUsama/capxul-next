// How a hub of the blueprint is composed from its parts: one record holding every entry of each part's record of
// one name. `operations` and `allClaims` gather the domains' (src/domains.ts), `refusals` and `exitCode` the refusal
// files' (src/errors.ts). Each part keeps its own record; a hub lists each part once.
import * as Arr from "effect/Array";

/** A union of record types as the one record type that is all of them: `{ a } | { b }` becomes `{ a } & { b }`. */
export type Every<Each> = (Each extends unknown ? (each: Each) => void : never) extends (every: infer All) => void
  ? All
  : never;

/**
 * Every entry of each part's record under `key`, in one record, in the parts' order. Two parts never share an entry
 * name: the blueprint's tests prove each operation is served once and each refusal declared once.
 */
export const gather = <const Parts extends ReadonlyArray<object>, Key extends keyof Parts[number]>(
  parts: Parts,
  key: Key,
): Every<Parts[number][Key]> => Object.assign({}, ...Arr.map(parts, (part) => part[key]));
