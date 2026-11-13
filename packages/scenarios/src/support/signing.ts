// How a person of the cast signs: with their own key, never in a browser (decisions.md, 23). The cast's keys are
// the chain's well-known test accounts (decisions.md, 25): the public test mnemonic every Anvil chain starts with.
// A scenario finds the key whose address is the one an approval names, signs its digest and hands the signature to
// approval.sign. The digest is signed as it is, with no message prefix: an approval asks its signer to sign `digest`.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Str from "effect/String";
import { mnemonicToAccount } from "viem/accounts";
import { Capxul } from "../client.ts";
import { present } from "./expect.ts";
import type { Approval } from "./world.ts";

/** The public test mnemonic of Anvil and Hardhat. Its accounts hold no value anywhere but a test chain. */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

/** How many of the mnemonic's accounts a cast may draw its keys from: Anvil's default. */
const TEST_ACCOUNTS = 10;

/** The well-known test accounts, derived when first needed. */
export const testAccounts = Effect.sync(() =>
  Arr.map(Arr.range(0, TEST_ACCOUNTS - 1), (addressIndex) => mnemonicToAccount(TEST_MNEMONIC, { addressIndex })),
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

/** The signer of `approval` signs it with their own key, and approval.sign takes the signature as them. */
export const approve = (approval: Approval) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const signature = yield* signWith(approval.signerAddress, approval.digest);
    return yield* capxul["approval.sign"]({ approval: approval.id, signature }, { as: approval.signer });
  });
