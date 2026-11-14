// Founding Northwind as the starting world `founded` describes it: dana founds it with eli as a Director, threshold
// 2, members sam and pat, and 1,000 USDC of her capital.
import type { Payload } from "../client.ts";

/** What org.create takes. */
export type Founding = Payload<"org.create">;

export const NORTHWIND_FOUNDING: Founding = {
  handle: "northwind",
  profile: { name: "Northwind Trading", country: "NL", bio: null, size: null },
  directors: ["eli"],
  threshold: 2,
  members: ["sam", "pat"],
  capital: { asset: "USDC", amount: "1000" },
};
