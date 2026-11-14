// The format of one domain's scenarios: one file of domains/ for each domain of the blueprint (packages/blueprint,
// src/domains.ts), holding the checks of each of its operations, the journeys it leads and where each claim of its
// operations is checked. domains.ts lists every domain's file once; checks/all.ts, registry.ts and coverage.ts gather
// them from there, so a slice that adds an operation or a journey to a domain touches only that domain's files.
import type { OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import type { Checks } from "./checks/format.ts";
import type { Declared } from "./journey.ts";

/** A domain of the blueprint, as its door (`src/<domain>/domain.ts`) declares its operations. */
interface BlueprintDomain {
  readonly operations: { readonly [name: string]: unknown };
}

/** The names of a domain's operations. */
type NamesOf<D extends BlueprintDomain> = Extract<keyof D["operations"], OperationName>;

/** Where one claim is checked: the operations whose checks hold it, and the declared journeys' steps (from 1). */
export interface Placed {
  readonly checks: ReadonlyArray<OperationName>;
  readonly steps: ReadonlyArray<{ readonly journey: Declared; readonly step: number }>;
}

/** One claim's place: the operations whose checks hold it, then each journey's step that calls it as it says. */
export const at = (
  checks: ReadonlyArray<OperationName>,
  ...steps: ReadonlyArray<readonly [Declared, number]>
): Placed => ({
  checks,
  steps: Arr.map(steps, ([journey, step]) => ({ journey, step })),
});

/**
 * One domain's scenarios: the checks of each of its operations (one file of checks/ each), the journeys it leads, in
 * the order they run, and the place of each claim of each of its operations, in claims.md's order. The compiler holds
 * that each of its operations has its checks and its places.
 */
export interface Domain<D extends BlueprintDomain> {
  readonly checks: { readonly [N in NamesOf<D>]: Checks<N> };
  readonly journeys: ReadonlyArray<Declared>;
  readonly coverage: { readonly [N in NamesOf<D>]: ReadonlyArray<Placed> };
}

/** A union of record types as the one record type that is all of them: `{ a } | { b }` becomes `{ a } & { b }`. */
export type Every<Each> = (Each extends unknown ? (each: Each) => void : never) extends (every: infer All) => void
  ? All
  : never;

/** Every entry of each domain's record under `key`, in one record, domain by domain. No two domains share a name. */
export const gather = <const Parts extends ReadonlyArray<object>, Key extends keyof Parts[number]>(
  parts: Parts,
  key: Key,
): Every<Parts[number][Key]> => Object.assign({}, ...Arr.map(parts, (part) => part[key]));
