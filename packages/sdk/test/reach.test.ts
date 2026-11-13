// What a call can reach besides its own doors: the second operator, another world's door (`at`), and a world's
// chain through its door's chain JSON-RPC, with every read answering its declared type. And a payload its schema
// rejects is refused before it is sent.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { Chain, Errors } from "@capxul/blueprint";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Rec from "effect/Record";
import * as Ref from "effect/Ref";
import * as Str from "effect/String";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpServer from "effect/http/HttpServer";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  parseAbi,
  parseAbiParameters,
  type Abi,
  type Hex,
} from "viem";
import * as Sdk from "../src/door.ts";

const TOKEN = "door-token-1";
const SAFE = "0x00000000000000000000000000000000000000aa";
const DANA = "0x00000000000000000000000000000000000000d1";
const ELI = "0x00000000000000000000000000000000000000e1";
const PAID = "0x00000000000000000000000000000000000000b1";
const USDC = "0x0000000000000000000000000000000000000065";
const PAYMENTS = "0x0000000000000000000000000000000000000067";
const TX = `0x${Str.repeat(32)("77")}`;
const PAYMENT_ID = `0x${Str.repeat(32)("9a")}`;
const DOCUMENT = `0x${Str.repeat(32)("ef")}`;

const functions: Abi = parseAbi(Rec.values(Chain.FUNCTION_SIGNATURES));
const events: Abi = parseAbi(Rec.values(Chain.LOG_SIGNATURES));

const results: Readonly<Record<string, unknown>> = {
  balanceOf: 125_500_000n,
  decimals: 6,
  getOwners: [DANA, ELI],
  getThreshold: 2n,
  nonce: 3n,
  isWearerOfHat: true,
  viewHat: ["Books", 1, 1, SAFE, SAFE, "", 0, true, true],
  companySafeAddressFor: SAFE,
};

const paymentSent = {
  address: PAYMENTS,
  topics: encodeEventTopics({
    abi: events,
    eventName: "PaymentSent",
    args: { paymentId: PAYMENT_ID as Hex, sender: SAFE as Hex, recipient: PAID as Hex },
  }),
  data: encodeAbiParameters(parseAbiParameters("address, uint256, uint16, bytes32"), [
    USDC as Hex,
    125_500_000n,
    1,
    DOCUMENT as Hex,
  ]),
  blockNumber: "0x2a",
  transactionHash: TX,
  logIndex: "0x0",
};
const unknownLog = { ...paymentSent, topics: [`0x${Str.repeat(32)("01")}`], data: "0x", logIndex: "0x1" };

/** A chain answering what the reads ask, as a world's door would. */
const chain = (method: string, params: ReadonlyArray<unknown>): unknown => {
  if (method === "eth_getBlockByNumber") return { number: "0x2a", timestamp: "0x6af6d190", hash: TX };
  if (method === "eth_getTransactionReceipt")
    return {
      transactionHash: TX,
      blockNumber: "0x2a",
      from: DANA,
      to: SAFE,
      status: "0x1",
      logs: [paymentSent, unknownLog],
    };
  if (method === "eth_getLogs") return [paymentSent];
  const [request] = params as ReadonlyArray<{ readonly data: Hex }>;
  const { functionName } = decodeFunctionData({ abi: functions, data: request?.data ?? "0x" });
  return encodeFunctionResult({ abi: functions, functionName, result: results[functionName] as never });
};

const served = Sdk.TestDoor.serve({ token: TOKEN, answer: "examples", chain }).pipe(
  Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })),
);

const doors = (second: string | null) =>
  Layer.unwrap(
    Effect.map(Sdk.TestDoor.urls, (urls) =>
      Layer.mergeAll(
        Sdk.platformDoor({ url: urls.platform, token: Redacted.make(TOKEN) }),
        Sdk.worldDoor({ url: urls.world, token: Redacted.make(TOKEN) }),
        Sdk.reach({
          platform: urls.platform,
          chain: { url: urls.chain, token: Redacted.make(TOKEN) },
          operators: { first: Redacted.make(TOKEN), second: second === null ? null : Redacted.make(second) },
        }),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer));

const run = <A, E>(
  program: (client: Sdk.Full) => Effect.Effect<A, E, Sdk.TestDoor.Calls | HttpServer.HttpServer>,
  second: string | null = null,
) =>
  Effect.runPromise(
    Effect.flatMap(Sdk.make, program).pipe(Effect.provide(doors(second).pipe(Layer.provideMerge(served)))),
  );

test("a call at another world's door goes there, signed in with the operator's credential", async () => {
  const exported = await run((client) =>
    Effect.flatMap(Sdk.TestDoor.urls, (urls) => client["record.export"]({ from: null, to: null }, { at: urls.door })),
  );
  assert.equal(exported.world, "town");
});

test("the second operator signs in with its own credential, and without one is not signed in", async () => {
  const refused = await run((client) => Effect.flip(client["world.show"]({ world: "town" }, { operator: "second" })));
  assert.ok(refused._tag === "NotSignedIn" && refused.reason === "no_credential");
  const wrong = await run(
    (client) => Effect.flip(client["world.show"]({ world: "town" }, { operator: "second" })),
    "another-token",
  );
  assert.ok(wrong._tag === "NotSignedIn" && wrong.reason === "unknown_caller");
});

test("a payload its schema rejects is refused with PayloadRejected and never sent", async () => {
  const [refused, seen] = await run((client) =>
    Effect.gen(function* () {
      const profile = { name: "Northwind Trading", country: "NL", bio: Str.repeat(281)("b"), size: null };
      const founding = { handle: "northwind", profile, directors: [], threshold: 1, members: [], capital: null };
      const error = yield* Effect.flip(client["org.create"](founding, { as: "dana" }));
      return [error, yield* Ref.get(yield* Sdk.TestDoor.Calls)] as const;
    }),
  );
  assert.ok(refused instanceof Errors.PayloadRejected, `refused with ${String(refused)}`);
  assert.equal(refused.operation, "org.create");
  assert.deepEqual(seen, [], "the door saw the call");
});

test("every chain read answers its declared type from the door's chain JSON-RPC", async () => {
  const read = await run((client) =>
    Effect.all({
      head: client.chain.head({}),
      balance: client.chain.balance({ token: USDC, holder: SAFE, block: null }),
      safe: client.chain.safe({ safe: SAFE, block: 41 }),
      hat: client.chain.hat({ hats: SAFE, hat: "7", block: null }),
      wears: client.chain.wears({ hats: SAFE, hat: "7", wearer: DANA, block: null }),
      companySafe: client.chain.companySafeFor({
        minter: SAFE,
        owner: SAFE,
        namespace: "capxul:private:company:v1",
        company: "org_northwind1",
        founderSafe: DANA,
      }),
      transaction: client.chain.transaction({ transaction: TX }),
      logs: client.chain.logs({ log: "PaymentSent", address: PAYMENTS, fromBlock: null, toBlock: null }),
    }),
  );
  assert.deepEqual(read.head, { number: 42, timestamp: "2026-11-13T09:00:00.000Z", hash: TX });
  assert.equal(read.balance, "125.5");
  assert.deepEqual(read.safe, { owners: [DANA, ELI], threshold: 2, nonce: 3 });
  assert.deepEqual(read.hat, { details: "Books", maxSupply: 1, supply: 1, active: true });
  assert.equal(read.wears, true);
  assert.equal(Str.toLowerCase(read.companySafe), SAFE);
  assert.equal(read.transaction.status, "success");
  const [sent, other] = read.transaction.logs;
  assert.ok(sent?._tag === "PaymentSent", `the first log is ${sent?._tag}`);
  assert.deepEqual(
    { paymentId: sent.paymentId, amount: sent.amount, documentHash: sent.documentHash, block: sent.block },
    { paymentId: PAYMENT_ID, amount: "125500000", documentHash: DOCUMENT, block: 42 },
  );
  assert.equal(Str.toLowerCase(sent.recipient), PAID);
  assert.equal(other?._tag, "Other");
  assert.deepEqual(
    read.logs.map((log) => log._tag),
    ["PaymentSent"],
  );
});
