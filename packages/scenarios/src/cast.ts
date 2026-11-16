// Each journey's own people and company (roadmap step 4.11, "a cast per journey"). A journey's story names people by
// their role (dana founds, sam keeps the books) and its company as Northwind; who plays each role, and the company's
// handle, are the journey's own, so journeys running side by side in one world never share a person's Safe, its
// nonce or a company. A journey reads them with `yield* Cast` and never writes a person's name or the handle itself.
// The roles, the keys and how a journey's people are named are the blueprint's (`Cast`, its cast.ts); this file only
// hands a running journey its own.
//
// The run says who plays each role in which journey (`Casting`, provided by the runner once the world makes every
// journey's cast). A run that does not say, as today's runner, plays every role by the person of the same name in a
// world of the journey's own, and its company is `northwind`: one journey after another, as before.
import { Cast as Declared } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** A role a journey's story names: the blueprint's. */
export type Role = Declared.CastRole;

/** A journey's key: one of the blueprint's. */
export type JourneyKey = Declared.JourneyKey;

/** Who plays each role in one journey, its company's handle, and the journey's key. */
export type Cast = { readonly [R in Role]: string } & { readonly company: string; readonly key: JourneyKey };

/** What the run casts for a journey: who plays each of its roles, and its company's handle. */
export interface Casted {
  readonly people: { readonly [R in Role]: string };
  readonly company: string;
}

/** The run's casting, by journey key: provided by the runner once the world makes a cast per journey. */
export class Casting extends Context.Service<
  Casting,
  { readonly castOf: (key: JourneyKey) => Effect.Effect<Casted> }
>()("@capxul/scenarios/cast/Casting") {}

/** The cast of the journey running: provided by `journey` (journey.ts) to its steps. */
export class JourneyCast extends Context.Service<JourneyCast, Cast>()("@capxul/scenarios/cast/JourneyCast") {}

/** Each role played by the person of its name, and the story's company: the cast when the run casts nobody. */
const uncast = (key: JourneyKey): Cast => ({
  dana: "dana",
  eli: "eli",
  sam: "sam",
  pat: "pat",
  olga: "olga",
  company: Declared.CAST_COMPANY,
  key,
});

/** The journey's own cast as the blueprint names it: what a runner that casts every journey answers (`Casting`). */
export const declaredCast = (key: JourneyKey): Casted => {
  const declared = Declared.journeyCast(key, Declared.CAST_COMPANY);
  const playing = (role: Role) =>
    Option.getOrElse(
      Option.map(
        Arr.findFirst(declared.people, (each) => each.role === role),
        (each) => each.person,
      ),
      () => role,
    );
  return {
    people: {
      dana: playing("dana"),
      eli: playing("eli"),
      sam: playing("sam"),
      pat: playing("pat"),
      olga: playing("olga"),
    },
    company: declared.company,
  };
};

/** The cast of the journey keyed `key`: the run's, or each role by its own name when the run casts nobody. */
export const castFor = (key: JourneyKey): Effect.Effect<Cast> =>
  Effect.gen(function* () {
    const casting = yield* Effect.serviceOption(Casting);
    if (Option.isNone(casting)) return uncast(key);
    const casted = yield* casting.value.castOf(key);
    return { ...casted.people, company: casted.company, key };
  });

/** The journey's cast, as a step reads it. */
export const Cast = JourneyCast;

/** Every person of a cast, in the order of the blueprint's roles. */
export const castPeopleOf = (cast: Cast): ReadonlyArray<string> =>
  Arr.map(Declared.CAST_ROLES, (each) => cast[each.role]);
