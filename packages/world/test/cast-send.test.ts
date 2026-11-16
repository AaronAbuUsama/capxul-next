// How the cast sends one account's transactions (src/things/world/cast.ts, `sendAll`): side by side, each with its
// own nonce counted from the account's next; one the chain refuses for its nonce sent again on its own; and any other
// failure, or a transaction that reverts, failing the cast by the name of what it was for.
import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import { describeFailure } from "../src/common/describe.ts";
import { ChainFailed } from "../src/common/failures.ts";
import { sendAll, type Send } from "../src/things/world/cast.ts";

const FROM = "0x00000000000000000000000000000000000000f0";

const fieldOf = (value: unknown, key: string): string =>
  Predicate.hasProperty(value, key) && Predicate.isString(value[key]) ? value[key] : "";

const hashOf = (nonce: string) => `0x${Str.padStart(64, "0")(Str.replace(/^0x/, "")(nonce))}`;

interface Chain {
  /** The account's next nonce, counting what is waiting. */
  readonly pending: number;
  /** The nonces the chain refuses the first time they are sent, and with what. */
  readonly refuse?: Readonly<Record<string, string>>;
  /** The nonces whose transaction reverts. */
  readonly reverts?: ReadonlyArray<string>;
}

/** A chain that mines what it is sent at once; `latest` counts every nonce it took below the first gap. */
const standIn = (chain: Chain) => {
  const tries: Array<string> = [];
  const taken = new Set<number>();
  const refused = new Set<string>();
  const call = (method: string, params: ReadonlyArray<unknown>) =>
    Effect.suspend((): Effect.Effect<unknown, ChainFailed> => {
      if (method === "eth_getTransactionCount") {
        if (params[1] === "pending") return Effect.succeed(`0x${chain.pending.toString(16)}`);
        let mined = chain.pending;
        while (taken.has(mined)) mined += 1;
        return Effect.succeed(`0x${mined.toString(16)}`);
      }
      if (method === "eth_sendTransaction") {
        const nonce = fieldOf(params[0], "nonce");
        tries.push(nonce);
        const refusal = chain.refuse?.[nonce];
        if (refusal !== undefined && !refused.has(nonce)) {
          refused.add(nonce);
          return Effect.fail(ChainFailed.make({ step: "rpc", message: refusal }));
        }
        taken.add(Number(BigInt(nonce)));
        return Effect.succeed(hashOf(nonce));
      }
      if (method === "eth_getTransactionReceipt") {
        const reverted = Arr.some(chain.reverts ?? [], (nonce) => hashOf(nonce) === params[0]);
        return Effect.succeed({ status: reverted ? "0x0" : "0x1" });
      }
      return Effect.succeed(null);
    });
  return { tries, call };
};

const sends: ReadonlyArray<Send> = Arr.map(Arr.range(1, 5), (n) => ({
  label: `person-${n}'s Safe`,
  transaction: { to: "0x00000000000000000000000000000000000000aa", data: "0x" },
}));

const failureOf = <A, E>(exit: Exit.Exit<A, E>): string =>
  Exit.isFailure(exit) ? describeFailure(exit.cause) : "it succeeded";

describe("sending one account's transactions for the cast", () => {
  test("each is given its own nonce, counted from the account's next", async () => {
    const { tries, call } = standIn({ pending: 7 });
    const hashes = await Effect.runPromise(sendAll(call, FROM, sends));
    assert.deepStrictEqual(Arr.sort(tries, Order.String), ["0x7", "0x8", "0x9", "0xa", "0xb"]);
    assert.deepStrictEqual(hashes, Arr.map(["0x7", "0x8", "0x9", "0xa", "0xb"], hashOf));
  });

  test("one refused for its nonce is sent again on its own, with the nonce the chain has mined up to", async () => {
    const { tries, call } = standIn({ pending: 7, refuse: { "0x9": "nonce too low" } });
    const hashes = await Effect.runPromise(sendAll(call, FROM, sends));
    assert.strictEqual(hashes.length, 5);
    assert.deepStrictEqual(
      Arr.filter(tries, (nonce) => nonce === "0x9"),
      ["0x9", "0x9"],
    );
  });

  test("one refused for anything else fails the cast, naming what it was for", async () => {
    const { call } = standIn({ pending: 7, refuse: { "0x8": "insufficient funds" } });
    const failure = failureOf(await Effect.runPromiseExit(sendAll(call, FROM, sends)));
    assert.match(failure, /person-2's Safe: not sent: .*insufficient funds/);
  });

  test("one that reverts fails the cast, naming what it was for and its transaction", async () => {
    const { call } = standIn({ pending: 7, reverts: ["0xa"] });
    const failure = failureOf(await Effect.runPromiseExit(sendAll(call, FROM, sends)));
    assert.match(failure, new RegExp(`person-4's Safe: ${hashOf("0xa")} reverted`));
  });
});
