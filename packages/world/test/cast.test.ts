// The world's cast (src/things/world/cast.ts): every journey's own people beside the fixed cast, their signers derived
// from the test mnemonic as the blueprint declares, and the Safes' transactions and mints sent side by side with one nonce each.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Cast } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { mnemonicToAccount } from "viem/accounts";
import { CAST, journeyPeople, makeCast, signersAt } from "../src/things/world/cast.ts";
import { FAUCET_OPERATOR } from "../src/parts/chain/faucet.ts";

const MNEMONIC = "test test test test test test test test test test test junk";

/** A field of a transaction as the stand-in reads it. */
const fieldOf = (value: unknown, key: string): string =>
  Predicate.hasProperty(value, key) && Predicate.isString(value[key]) ? value[key] : "";

const lower = (each: { readonly signer: string }) => Str.toLowerCase(each.signer);
const hex = (n: number, width: number) => Str.padStart(width, "0")(n.toString(16));

interface Sent {
  readonly from: string;
  readonly nonce: string;
}

/** A chain that answers the cast's calls: a Safe for each email, each sender's next nonce, and receipts that pass. */
const standIn = () => {
  const sent: Array<Sent> = [];
  const call = (method: string, params: ReadonlyArray<unknown>) =>
    Effect.sync((): unknown => {
      if (method === "eth_call") return `0x${hex(0, 24)}${Str.padStart(40, "a")((sent.length + 1).toString(16))}`;
      if (method === "eth_getTransactionCount") return params[0] === FAUCET_OPERATOR ? "0x2" : "0x7";
      if (method === "eth_sendTransaction") {
        sent.push({ from: fieldOf(params[0], "from"), nonce: fieldOf(params[0], "nonce") });
        return `0x${hex(sent.length, 64)}`;
      }
      if (method === "eth_getTransactionReceipt") return { status: "0x1" };
      return null;
    });
  return { sent, call };
};

describe("the world's cast", () => {
  test("the signers derived from the mnemonic are the mnemonic's accounts, the fixed cast's among them", async () => {
    const indexes = [4, 5, 6, 7, 8, 28, 91];
    const derived = await Effect.runPromise(signersAt(indexes));
    assert.deepStrictEqual(
      derived,
      Arr.map(indexes, (addressIndex) => mnemonicToAccount(MNEMONIC, { addressIndex }).address),
    );
    assert.deepStrictEqual(Arr.map(derived.slice(0, 5), Str.toLowerCase), Arr.map(CAST, lower));
  });

  test("every journey the blueprint declares has its own people, with the blueprint's signer each", async () => {
    const people = await Effect.runPromise(journeyPeople());
    const declared = Arr.flatMap(Cast.JOURNEY_KEYS, (key) => Cast.journeyCast(key, "northwind").people);
    assert.deepStrictEqual(
      Arr.map(people, (each) => each.person),
      Arr.map(declared, (each) => each.person),
    );
    assert.strictEqual(people[0]?.signer, mnemonicToAccount(MNEMONIC, { addressIndex: declared[0]?.keyIndex }).address);
    const signers = new Set(Arr.map([...CAST, ...people], lower));
    assert.strictEqual(signers.size, CAST.length + people.length);
  });

  test("every Safe of the cast is made and funded, each sender's transactions numbered from its next nonce", async () => {
    const { sent, call } = standIn();
    const members = await Effect.runPromise(makeCast(call));
    const journeys = await Effect.runPromise(journeyPeople());
    assert.strictEqual(members.length, CAST.length + journeys.length);
    assert.ok(Arr.every(members, (member) => member.email === `${member.person}@cast.test`));
    const safes = Arr.filter(members, (member) => member.safe !== null).length;
    // pat alone, in the fixed cast and in each journey's, has no Safe.
    assert.strictEqual(safes, members.length - 1 - Cast.JOURNEY_KEYS.length);
    const noncesOf = (from: string) =>
      Arr.sort(
        Arr.map(
          Arr.filter(sent, (each) => each.from === from),
          (each) => Number(BigInt(each.nonce)),
        ),
        Order.Number,
      );
    assert.deepStrictEqual(
      noncesOf(
        Arr.findFirst(sent, (each) => each.from !== FAUCET_OPERATOR).pipe(
          Option.match({ onNone: () => "", onSome: (each) => each.from }),
        ),
      ),
      Arr.map(Arr.range(0, safes - 1), (n) => n + 7),
    );
    assert.deepStrictEqual(
      noncesOf(FAUCET_OPERATOR),
      Arr.map(Arr.range(0, safes - 1), (n) => n + 2),
    );
  });
});
