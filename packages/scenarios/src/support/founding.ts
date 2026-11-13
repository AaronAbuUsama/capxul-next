// Founding Northwind as the starting world `founded` describes it: dana founds it with eli as a Director, threshold
// 2, members sam and pat, and 1,000 USDC of her capital.
import * as Effect from "effect/Effect";
import { Capxul, type CapxulClient } from "../client.ts";
import { answers } from "./expect.ts";

/** What org.create takes. */
export type Founding = Parameters<CapxulClient["org.create"]>[0];

export const NORTHWIND_FOUNDING: Founding = {
  handle: "northwind",
  profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
  directors: ["eli"],
  threshold: 2,
  members: ["sam", "pat"],
  capital: { asset: "USDC", amount: "1000" },
};

/** org.create as dana, which must answer Founded. */
export const found = (founding: Founding = NORTHWIND_FOUNDING) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    return yield* answers("org.create as dana", "Founded", capxul["org.create"](founding, { as: "dana" }));
  });
