// Who plays each role in a starting world with a company, and the keys they sign with (roadmap 4.8 with 4.11): the
// journey's own cast when the run casts every journey (`Casting`, a run in one shared world, side-by-side.ts), so
// journeys side by side never found the same company or share a person's Safe; otherwise each role by its own name.
import { Cast, Values } from "@capxul/blueprint";
import { Casting, type Casted } from "@capxul/scenarios";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Rec from "effect/Record";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { JourneyMaking } from "./journey-making.ts";

/** Who plays each role in the starting world being made, and its company's handle (scenarios' cast.ts). */
export type Players = Casted["people"] & { readonly company: string };

/** Each role by the person of its name, and the story's company: one journey after another, as before. */
const UNCAST: Players = {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one entry per role of Cast.CAST_ROLES, each played by the person of its own name; the compiler cannot follow fromEntries over the roles' tuple
  ...(Rec.fromEntries(Arr.map(Cast.CAST_ROLES, ({ role }) => [role, role] as const)) as Casted["people"]),
  company: Cast.CAST_COMPANY,
};

/**
 * The players of the journey whose starting world is being made: its own cast, when the run casts every journey
 * (`Casting`, a run in one shared world, side-by-side.ts), so journeys side by side never found the same company or
 * share a person's Safe; otherwise each role by its own name.
 */
export const playersNow: Effect.Effect<Players> = Effect.gen(function* () {
  const making = yield* Effect.serviceOption(JourneyMaking);
  const casting = yield* Effect.serviceOption(Casting);
  const journey = Option.flatMap(making, (each) => Option.fromNullishOr(each.journey));
  if (Option.isNone(journey) || Option.isNone(casting)) return UNCAST;
  const casted = yield* casting.value.castOf(journey.value.key);
  return { ...casted.people, company: casted.company };
});

/**
 * How `founded` founds Northwind (packages/blueprint, src/starting-points/points.ts): dana founds it with eli, 2 of 2,
 * sam and pat, 1,000 USDC; each played by the journey's cast, the company under its handle.
 */
export const northwindOf = (players: Players) =>
  ({
    handle: players.company,
    profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
    directors: [players.eli],
    threshold: 2,
    members: [players.sam, players.pat],
    capital: { asset: "USDC", amount: "1000" },
  }) as const;

let derived: ReadonlyArray<HDAccount> | undefined;

/**
 * The well-known test keys of the world's own cast and of every journey's (`Cast.CAST_KEY_ACCOUNTS`, as the scenarios'
 * signing.ts derives them, which their door does not export), derived once, when first needed: side by side, each
 * journey's people sign with keys from 28 up (`Cast.castKeyIndex`).
 */
export const castAccounts = Effect.sync(
  () =>
    (derived ??= Arr.map(Arr.range(0, Cast.CAST_KEY_ACCOUNTS - 1), (addressIndex) =>
      mnemonicToAccount(Values.CAST_KEYS.mnemonic, { addressIndex }),
    )),
);
