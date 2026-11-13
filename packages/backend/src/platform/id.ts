import { randomBytes } from "node:crypto";

/** ULID spelling, with the source world instant rather than the host wall clock. */
export function newId(prefix: string, at: number) {
  if (!Number.isSafeInteger(at) || at < 0 || at >= 2 ** 48) throw new Error("INVALID_INPUT: id instant");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let n = BigInt(at) << 80n | BigInt(`0x${randomBytes(10).toString("hex")}`), result = "";
  for (let i = 0; i < 26; i++) { result = alphabet[Number(n & 31n)] + result; n >>= 5n; }
  return `${prefix}_${result}`;
}
