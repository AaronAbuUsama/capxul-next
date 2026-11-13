// The little of the Solidity ABI the platform sends: a call's data from its selector and its arguments, static
// (address, uint, bool, bytes32) and dynamic (bytes, string). The selectors are written beside the calls that use
// them and checked against Foundry's `cast` in test/abi.test.ts. Nothing here touches the outside world.
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Str from "effect/String";
import { word } from "./faucet.ts";

export type Arg =
  | { readonly address: string }
  | { readonly uint: bigint }
  | { readonly bool: boolean }
  | { readonly bytes32: string }
  | { readonly bytes: string }
  | { readonly string: string };

const uint = (value: bigint): string => word(value.toString(16));
const hexOfText = (value: string): string =>
  Arr.join(
    Arr.map(Arr.fromIterable(new TextEncoder().encode(value)), (byte) => pipe(byte.toString(16), Str.padStart(2, "0"))),
    "",
  );
const strip = Str.replace(/^0x/, "");

/** Dynamic data as its length in bytes and its bytes padded to whole words. */
const dynamic = (hex: string): string =>
  uint(BigInt(Str.length(hex) / 2)) + Str.padEnd(Math.ceil(Str.length(hex) / 64) * 64, "0")(hex);

/** A static argument's word, or null for a dynamic one. */
const staticWord = (arg: Arg): string | null => {
  if ("address" in arg) return word(arg.address);
  if ("uint" in arg) return uint(arg.uint);
  if ("bool" in arg) return uint(arg.bool ? 1n : 0n);
  if ("bytes32" in arg) return Str.padEnd(64, "0")(Str.toLowerCase(strip(arg.bytes32)));
  return null;
};

const tailOf = (arg: Arg): string =>
  "bytes" in arg ? dynamic(strip(arg.bytes)) : "string" in arg ? dynamic(hexOfText(arg.string)) : "";

/** The ABI encoding of `args` as a tuple: their heads, then the tails of the dynamic ones. */
export const encodeArgs = (args: ReadonlyArray<Arg>): string => {
  const tails = Arr.map(args, tailOf);
  const headSize = args.length * 32;
  const { heads } = Arr.reduce(args, { heads: "", offset: headSize }, (acc, arg, index) => {
    const fixed = staticWord(arg);
    if (fixed !== null) return { heads: acc.heads + fixed, offset: acc.offset };
    const tail = tails[index] ?? "";
    return { heads: acc.heads + uint(BigInt(acc.offset)), offset: acc.offset + Str.length(tail) / 2 };
  });
  return heads + Arr.join(tails, "");
};

/** A call's data: its 4-byte selector, then its arguments. */
export const callData = (selector: string, args: ReadonlyArray<Arg>): string => `${selector}${encodeArgs(args)}`;

/** An address from the last 20 bytes of a 32-byte word, as `eth_call` answers it. */
export const addressOf = (answer: string): string => `0x${Str.slice(-40)(answer)}`;
