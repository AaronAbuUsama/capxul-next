// The one home for hex, address and bytes32 checks. Guards narrow `unknown`;
// constructors validate and say in their name what they do to case. Every
// constructor refuses with the same INVALID_INPUT shape, so a caller that
// reads a stored row or an upstream answer uses the guard and raises its own
// error class (a stored-row defect, a provider error) instead.

import {
  type Address,
  type Hex,
  getAddress,
  isAddress as isViemAddress,
  isHex as isViemHex,
} from "viem";
import { Errors } from "../errors/factories.ts";
import { invalidValueReason } from "../primitives/validation.ts";

export type { Address, Hex };

const ADDRESS_HEX = /^0x[0-9a-fA-F]{40}$/u;

const BYTES32_HEX = /^0x[0-9a-fA-F]{64}$/u;

const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;

const QUANTITY_HEX = /^0x[0-9a-fA-F]+$/u;

/** `0x` followed by hex digits only. */
export function isHex(value: unknown): value is Hex {
  return isViemHex(value, { strict: true });
}

/**
 * A 20-byte address. As EIP-55 reads it: all lowercase or all uppercase
 * carries no checksum and is accepted; mixed case must be the valid checksum.
 */
export function isAddress(value: unknown): value is Address {
  if (typeof value !== "string" || !ADDRESS_HEX.test(value)) return false;
  const digits = value.slice(2);
  return (
    digits === digits.toLowerCase() ||
    digits === digits.toUpperCase() ||
    isViemAddress(value, { strict: true })
  );
}

/** Byte data: `0x` followed by whole bytes (an even number of hex digits), any case. */
export function isHexData(value: unknown): value is Hex {
  return typeof value === "string" && HEX_DATA.test(value);
}

/** A JSON-RPC quantity: `0x` and at least one hex digit, any case. `BigInt` reads it. */
export function isQuantityHex(value: unknown): value is Hex {
  return typeof value === "string" && QUANTITY_HEX.test(value);
}

/** Exactly 32 bytes of hex, any case. */
export function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && BYTES32_HEX.test(value);
}

function refused(field: string, shape: string, value: unknown): never {
  throw Errors.invalidInput(field, invalidValueReason(`must be ${shape}`, value));
}

/** Rebuilding the `0x` prefix keeps the result a `Hex`; lowercasing never changes the bytes. */
function lowered(value: Hex): Hex {
  return `0x${value.slice(2).toLowerCase()}`;
}

/** Hex data exactly as given: case kept, for text another party compares or hashes as is. */
export function toExactHex(value: unknown, field = "value"): Hex {
  return isHex(value) ? value : refused(field, "0x-prefixed hex", value);
}

/** Hex data, lowercased. */
export function toLowerHex(value: unknown, field = "value"): Hex {
  return isHex(value) ? lowered(value) : refused(field, "0x-prefixed hex", value);
}

/** A bytes32 value, lowercased. */
export function toLowerBytes32(value: unknown, field = "value"): Hex {
  return isBytes32(value) ? lowered(value) : refused(field, "a 0x-prefixed bytes32 value", value);
}

/** An address, lowercased: the form stored rows and digests compare. */
export function toLowerAddress(value: unknown, field = "address"): Address {
  return isAddress(value) ? lowered(value) : refused(field, "an EVM address", value);
}

/** An address in its EIP-55 checksummed form: the form shown to people. */
export function toChecksumAddress(value: unknown, field = "address"): Address {
  return isAddress(value) ? getAddress(value) : refused(field, "an EVM address", value);
}
