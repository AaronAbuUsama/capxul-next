// Each journey's own people and company (roadmap step 4.11, "a cast per journey"). A journey's story names people by
// their role (dana founds, sam keeps the books) and its company as Northwind; who plays each role, and the company's
// handle, are the journey's own, so journeys running side by side in one world never share a person's Safe, its
// nonce or a company. A journey reads them with `yield* Cast` and never writes a person's name or the handle itself.
//
// The run says who plays each role in which journey (`Casting`, from the world's cast made for every journey's key).
// A run that does not say, as today's runner, plays every role by the person of the same name in a world of the
// journey's own, and its company is `northwind`: one journey after another, as before.
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** The roles a journey's story names, each a person of its cast. pat has not finished signing up. */
export const ROLES = ["dana", "eli", "sam", "pat", "olga"] as const;
export type Role = (typeof ROLES)[number];

/** The company the starting worlds from `founded` on found, as a story names it: its handle when nobody casts it. */
export const COMPANY = "northwind";

/** Who plays each role in one journey, its company's handle, and the journey's key. */
export type Cast = { readonly [R in Role]: string } & { readonly company: string; readonly key: string };

/** What the run casts for a journey: who plays each of its roles, and its company's handle. */
export interface Casted {
  readonly people: { readonly [R in Role]: string };
  readonly company: string;
}

/** The run's casting, by journey key: provided by the runner once the world makes a cast per journey. */
export class Casting extends Context.Service<Casting, { readonly castOf: (key: string) => Effect.Effect<Casted> }>()(
  "@capxul/scenarios/cast/Casting",
) {}

/** The cast of the journey running: provided by `journey` (journey.ts) to its steps. */
export class JourneyCast extends Context.Service<JourneyCast, Cast>()("@capxul/scenarios/cast/JourneyCast") {}

/** Each role played by the person of its name, and the company `northwind`: the cast when the run casts nobody. */
const uncast = (key: string): Cast => ({
  dana: "dana",
  eli: "eli",
  sam: "sam",
  pat: "pat",
  olga: "olga",
  company: COMPANY,
  key,
});

/** The cast of the journey keyed `key`: the run's, or each role by its own name when the run casts nobody. */
export const castFor = (key: string): Effect.Effect<Cast> =>
  Effect.gen(function* () {
    const casting = yield* Effect.serviceOption(Casting);
    if (Option.isNone(casting)) return uncast(key);
    const casted = yield* casting.value.castOf(key);
    return { ...casted.people, company: casted.company, key };
  });

/** The journey's cast, as a step reads it. */
export const Cast = JourneyCast;

/** Every person of a cast, in the order of the roles. */
export const castPeopleOf = (cast: Cast): ReadonlyArray<string> => Arr.map(ROLES, (role) => cast[role]);
