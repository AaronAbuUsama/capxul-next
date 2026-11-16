// A send from the service key whose nonce another send took first is signed again at the next pending nonce
// (src/chain/calls.ts, `sendAsService`): Core's Worker isolates sign with one key, and world run 43782964738 lost
// four companies' founding to "nonce too low". Against a fake chain that answers the first send so.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { nonceTaken, sendAsService } from "../src/chain/calls.ts";
import { ChainFailed, WorldChain } from "../src/chain/WorldChain.ts";

const HASH = "0xabababababababababababababababababababababababababababababababab";
const TO = "0x1111111111111111111111111111111111111111";

/** A chain whose first `refusing` sends answer `refusal`; it counts the sends and the nonce reads. */
const fakeChain = (refusing: number, refusal: string) => {
  const seen = { sends: 0, nonces: 0 };
  const rpc = (method: string) => {
    if (method === "eth_getTransactionCount") {
      seen.nonces += 1;
      return Effect.succeed(`0x${seen.nonces.toString(16)}`);
    }
    if (method === "eth_getBlockByNumber") return Effect.succeed({ baseFeePerGas: "0x1" });
    if (method === "eth_sendRawTransaction") {
      seen.sends += 1;
      return seen.sends <= refusing
        ? Effect.fail(ChainFailed.make({ reach: "rpc", method, message: refusal }))
        : Effect.succeed(HASH);
    }
    if (method === "eth_getTransactionReceipt")
      return Effect.succeed({ status: "0x1", transactionHash: HASH, blockNumber: "0x2", logs: [] });
    return Effect.fail(ChainFailed.make({ reach: "rpc", method, message: "not faked" }));
  };
  return { seen, layer: Layer.succeed(WorldChain, WorldChain.of({ rpc, bundler: rpc })) };
};

const send = (refusing: number, refusal: string) => {
  const chain = fakeChain(refusing, refusal);
  return Effect.runPromise(
    sendAsService(TO, "0x").pipe(
      Effect.provide(chain.layer),
      Effect.exit,
      Effect.map((exit) => ({ exit, ...chain.seen })),
    ),
  );
};

test("a send answered 'nonce too low' once is signed again at the next pending nonce, and lands", async () => {
  const { exit, sends, nonces } = await send(1, "nonce too low");
  assert.equal(exit._tag, "Success");
  assert.equal(sends, 2);
  assert.equal(nonces, 2, "the pending nonce read again");
});

test("a send whose nonce is taken every time stops after its tries", async () => {
  const { exit, sends } = await send(100, "replacement transaction underpriced");
  assert.equal(exit._tag, "Failure");
  assert.equal(sends, 9, "one send and eight again");
});

test("any other refusal is not sent again", async () => {
  const { exit, sends } = await send(1, "insufficient funds for gas * price + value");
  assert.equal(exit._tag, "Failure");
  assert.equal(sends, 1);
});

test("only a send's taken nonce counts", () => {
  assert.ok(nonceTaken(ChainFailed.make({ reach: "rpc", method: "eth_sendRawTransaction", message: "Nonce too low" })));
  assert.ok(!nonceTaken(ChainFailed.make({ reach: "rpc", method: "eth_call", message: "nonce too low" })));
});
