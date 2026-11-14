// How a person of the cast signs: with their own key, never in a browser (decisions.md, 23 and 42). The cast's keys
// are the blueprint's `CAST_KEYS`: among the first accounts of the public test mnemonic. A journey finds the key
// whose address is the one an approval names, signs its digest as it is (no prefix) and hands the signature to
// approval.sign.
import { Values } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { mnemonicToAccount } from "viem/accounts";
import { present } from "./expect.ts";

/** The well-known test accounts, derived when first needed. */
export const testAccounts = Effect.sync(() =>
  Arr.map(Arr.range(0, Values.CAST_KEYS.accounts - 1), (addressIndex) =>
    mnemonicToAccount(Values.CAST_KEYS.mnemonic, { addressIndex }),
  ),
);

const lower = Str.toLowerCase;

/** True when `address` is one of the well-known test accounts. */
export const isTestAddress = (address: string) =>
  Effect.map(testAccounts, (accounts) => Arr.some(accounts, (account) => lower(account.address) === lower(address)));

/** The signature of `digest` by the test key whose address is `address`. */
export const signWith = (address: string, digest: string) =>
  Effect.gen(function* () {
    const accounts = yield* testAccounts;
    const account = yield* present(
      `a well-known test key for ${address}`,
      Option.getOrNull(Arr.findFirst(accounts, (each) => lower(each.address) === lower(address))),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a digest is a Hash, which the blueprint holds to 0x and 64 hex digits; viem names that shape a template type.
    return yield* Effect.promise(() => account.sign({ hash: digest as `0x${string}` }));
  });
