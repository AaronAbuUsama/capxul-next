// Founding Northwind as the starting world `founded` describes it: dana founds it with eli as a Director, threshold
// 2, members sam and pat, and 1,000 USDC of her capital. And a founding as a person types it, which comes into the
// contract the way the command line brings it in.
import { operations } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
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

/** org.create's payload in its JSON form, as the command line reads it from a person (packages/cli, src/input.ts). */
const AsTyped = Schema.toCodecJson(operations["org.create"].rpc.payloadSchema);

/** A founding as a person types it: its JSON form, before org.create's payload schema has decoded it. */
export type TypedFounding = typeof AsTyped.Encoded;

/**
 * A founding as a person typed it, decoded by org.create's own payload schema exactly as the command line decodes its
 * input before it calls: text the schema trims comes out trimmed. The typed side of that schema holds only trimmed
 * text, so a payload with the spaces still in it cannot be sent (the client rejects it, `PayloadRejected`). One that
 * does not decode is the journey's own mistake, a defect.
 */
export const decodedAsTyped = (typed: TypedFounding): Effect.Effect<Founding> =>
  Effect.orDie(Schema.decodeEffect(AsTyped)(typed));
