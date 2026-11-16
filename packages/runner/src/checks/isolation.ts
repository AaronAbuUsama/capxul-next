// The generic `isolation` check (roadmap step 4.8, "One shared world, every journey side by side"): every call of a
// journey acts only as the journey's own people and names no other journey's person, email or company. Journeys run
// side by side in one world, each with its own cast and company (packages/blueprint, src/starting-points/cast.ts), so
// a call that acts as, or names, another journey's people would reach into a company it does not own. A person or
// company no journey owns (a refusal's `zed`, an invitation to an address outside every cast) is not another
// journey's, so naming it is allowed. Pure; it reads only declarations and the calls. No scenario writes it, and a
// builder never changes it.
import { Cast } from "@capxul/blueprint";
import { declaredCast, type Journey } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import type { Call } from "../client.ts";
import type { Kept } from "../world/database.ts";
import { checkCall, type Check } from "./checks.ts";
import { withPaths } from "./paths.ts";

/** Whose people and company a journey's calls may name: its own, and every other journey's, which they may not. */
export interface Scope {
  readonly world: Journey["world"];
  /** Who the journey may act as: its own people, and in a world of its own also that world's own cast's roles. */
  readonly actsAs: ReadonlyArray<string>;
  /** Every person, email and company handle that belongs to another journey. */
  readonly others: ReadonlySet<string>;
}

/** The roles as the people of the same name, with their emails: the cast when the run casts nobody. */
const roles = Arr.map(Cast.CAST_ROLES, (each) => each.role);

/** A journey's own people, and every text of its own (its people, their emails, its company's handle). */
const ownOf = (key: Cast.JourneyKey, casted: boolean) => {
  const cast = casted ? declaredCast(key) : null;
  const people = cast === null ? roles : Rec.values(cast.people);
  const company = cast === null ? Cast.CAST_COMPANY : cast.company;
  return { people, texts: [...people, ...Arr.map(people, Cast.castEmail), company] };
};

/**
 * The scope of `journey`: `casted` says whether the run casts every journey its own people (scenarios' `Casting`).
 * Every journey's declared cast that is not this one's is another journey's; with a cast per journey, so are the plain
 * roles' people, unless the journey runs in a world of its own, whose cast they are.
 */
export const scopeOf = (journey: Pick<Journey, "key" | "world">, casted: boolean): Scope => {
  const own = ownOf(journey.key, casted);
  const plain = ownOf(journey.key, false);
  const inOwnWorld = journey.world === "own";
  const allowed = [...own.texts, ...(inOwnWorld ? plain.texts : [])];
  const everyone = [...Arr.flatMap(Cast.JOURNEY_KEYS, (key) => ownOf(key, true).texts), ...(casted ? plain.texts : [])];
  return {
    world: journey.world,
    actsAs: [...own.people, ...(inOwnWorld ? plain.people : [])],
    others: new Set(Arr.filter(everyone, (each) => !Arr.contains(allowed, each))),
  };
};

/** Every text a value holds, at any depth. */
const textsIn = (value: unknown): ReadonlyArray<string> => {
  if (Predicate.isString(value)) return [value];
  if (Arr.isArray(value)) return Arr.flatMap(value, textsIn);
  if (Predicate.isObject(value)) return Arr.flatMap(Rec.values(value), textsIn);
  return [];
};

/** The `isolation` check of one call of a journey in `scope`. */
export const checkIsolation = (scope: Scope, call: Call): Check => {
  const as = call.as ?? null;
  const named = Arr.dedupe(Arr.filter(textsIn(call.payload), (text) => scope.others.has(text)));
  const wrong = [
    ...(as !== null && !Arr.contains(scope.actsAs, as) ? [`acts as ${as}, who is not this journey's`] : []),
    ...(named.length > 0 ? [`names another journey's ${Arr.join(named, ", ")}`] : []),
  ];
  return { check: "isolation", passed: wrong.length === 0, detail: Arr.join(wrong, "; ") };
};

/** The calls checked so far, each with its `isolation` check; unchanged for a run that is no journey's. */
export const withIsolation = <C extends { readonly checks: ReadonlyArray<Check> }>(
  scope: Scope | undefined,
  calls: ReadonlyArray<Call>,
  checked: ReadonlyArray<C>,
): ReadonlyArray<C> =>
  scope === undefined
    ? checked
    : Arr.map(checked, (each, index) => {
        const call = calls[index];
        return call === undefined ? each : { ...each, checks: [...each.checks, checkIsolation(scope, call)] };
      });

/** Every generic check of every call of a run: each call's own, the `path` across them, and a journey's `isolation`. */
export const checkAll = (scope: Scope | undefined, calls: ReadonlyArray<Call>, kept: Kept) => {
  const paths = withPaths(
    calls,
    kept,
    Arr.map(calls, (call) => checkCall(call, kept)),
  );
  return { calls: withIsolation(scope, calls, paths.calls), coverage: paths.coverage };
};
