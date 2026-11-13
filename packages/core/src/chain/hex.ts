// Text from the chain, the database or a payload, as viem's hex types, and addresses compared as the chain does.
import * as Str from "effect/String";
import { type Hex, isHex } from "viem";

/** Hex text as viem's `Hex`; anything that is not hex is empty bytes, which every call or check then refuses. */
export const hex = (text: string): Hex => (isHex(text) ? text : "0x");

/** Two addresses are one, whatever their letters' case. */
export const sameAddress = (a: string, b: string): boolean => Str.toLowerCase(a) === Str.toLowerCase(b);
