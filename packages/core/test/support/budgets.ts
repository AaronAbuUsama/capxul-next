// The harness of the budgets operations' test (test/budgets-sql.test.ts): a stand-in of the world's chain that
// answers the reads Core's budgets operations make (Budgets' budgetOf, leftOf and childrenOf, Hats' viewHat,
// buildHatId and isWearerOfHat, the company Safe's nonce) from a state the test holds and changes, as the chain would
// once a creation lands; and the company Safe transaction a creation proposes, decoded. It sends nothing: a
// transaction is the real chain's (test/chain/), which this is not.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Str from "effect/String";
import * as PgClient from "@effect/sql-pg/PgClient";
import { decodeFunctionData, encodeFunctionResult, type Hex, hexToNumber, isHex, slice, zeroAddress } from "viem";
import { BUDGETS, HATS, MULTI_SEND, SAFE } from "../../src/chain/abi.ts";
import { hex } from "../../src/chain/hex.ts";
import { SEEDED } from "../../src/chain/seeded.ts";
import { WorldChain } from "../../src/chain/WorldChain.ts";

const MAX = (1n << 256n) - 1n;

/** Hats' `buildHatId`: the child `child` of `admin`, at the first level below it that is empty. */
export const buildHatId = (admin: bigint, child: number): bigint => {
  for (let level = 0n; level < 14n; level += 1n) {
    const mask = (MAX << (16n * (14n - level))) & MAX;
    if ((admin & ~mask & MAX) === 0n) return admin | (BigInt(child) << (16n * (13n - level)));
  }
  return 0n;
};

/** A top hat of the domain `domain`, and Books, its first child, as the starting world `founded` has them. */
export const TOP_HAT = 1n << 224n;
export const BOOKS = buildHatId(TOP_HAT, 1);

export interface Held {
  readonly safe: string;
  readonly parent: bigint;
  readonly hat: bigint;
  readonly amount: bigint;
  childrenAmount: bigint;
  readonly children: Array<bigint>;
}

/** What the stand-in chain holds: budgets by id, each hat's last child, who wears what, and Safes' nonces. */
export interface ChainState {
  readonly budgets: Map<bigint, Held>;
  readonly lastChild: Map<bigint, number>;
  readonly wearers: Set<string>;
  readonly nonces: Map<string, bigint>;
}

export const wearing = (wearer: string, hat: bigint) => `${Str.toLowerCase(wearer)}:${hat}`;

const left = (held: Held) => held.amount - held.childrenAmount;

const empty = {
  safe: zeroAddress,
  parent: 0n,
  hat: 0n,
  token: zeroAddress,
  period: 0,
  depth: 0,
  closed: false,
  amount: 0n,
  childrenAmount: 0n,
  ownSpent: 0n,
  ownCommitted: 0n,
  spent: 0n,
  committed: 0n,
  periodIndex: 0n,
};

const budgetsCall = (state: ChainState, data: Hex): Hex => {
  const call = decodeFunctionData({ abi: BUDGETS, data });
  // budgetOf, leftOf and childrenOf each take the budget's id first.
  const id = call.args?.[0];
  const held = typeof id === "bigint" ? state.budgets.get(id) : undefined;
  switch (call.functionName) {
    case "budgetOf":
      return encodeFunctionResult({
        abi: BUDGETS,
        functionName: "budgetOf",
        result:
          held === undefined
            ? empty
            : {
                ...empty,
                safe: hex(held.safe),
                parent: held.parent,
                hat: held.hat,
                token: SEEDED.usdc,
                depth: 1,
                amount: held.amount,
                childrenAmount: held.childrenAmount,
              },
      });
    case "leftOf":
      return encodeFunctionResult({
        abi: BUDGETS,
        functionName: "leftOf",
        result: held === undefined ? 0n : left(held),
      });
    case "childrenOf":
      return encodeFunctionResult({ abi: BUDGETS, functionName: "childrenOf", result: held?.children ?? [] });
    default:
      return "0x";
  }
};

const hatsCall = (state: ChainState, data: Hex): Hex => {
  const call = decodeFunctionData({ abi: HATS, data });
  switch (call.functionName) {
    case "viewHat":
      return encodeFunctionResult({
        abi: HATS,
        functionName: "viewHat",
        result: ["", 1, 0, zeroAddress, zeroAddress, "", state.lastChild.get(call.args[0]) ?? 0, true, true],
      });
    case "buildHatId":
      return encodeFunctionResult({
        abi: HATS,
        functionName: "buildHatId",
        result: buildHatId(call.args[0], call.args[1]),
      });
    case "isWearerOfHat":
      return encodeFunctionResult({
        abi: HATS,
        functionName: "isWearerOfHat",
        result: state.wearers.has(wearing(call.args[0], call.args[1])),
      });
    default:
      return "0x";
  }
};

const safeCall = (state: ChainState, to: string): Hex =>
  encodeFunctionResult({ abi: SAFE, functionName: "nonce", result: state.nonces.get(Str.toLowerCase(to)) ?? 0n });

/** The world's chain as `state` holds it: eth_call of the reads above, and nothing else. */
export const standIn = (state: ChainState) => {
  const rpc = (method: string, params: ReadonlyArray<unknown> = []) =>
    Effect.sync(() => {
      const [request] = params;
      if (method !== "eth_call" || !Predicate.isObject(request)) return null;
      const to = Predicate.hasProperty(request, "to") && typeof request.to === "string" ? request.to : "";
      const data = Predicate.hasProperty(request, "data") && isHex(request.data) ? request.data : "0x";
      if (Str.toLowerCase(to) === Str.toLowerCase(SEEDED.budgets)) return budgetsCall(state, data);
      if (Str.toLowerCase(to) === Str.toLowerCase(SEEDED.hats)) return hatsCall(state, data);
      return safeCall(state, to);
    });
  return Layer.succeed(WorldChain, WorldChain.of({ rpc, bundler: rpc }));
};

/** The calls of a MultiSendCallOnly batch: each one's target and data. */
const batchOf = (data: Hex) => {
  const [packed] = decodeFunctionData({ abi: MULTI_SEND, data }).args;
  const calls: Array<{ readonly to: Hex; readonly data: Hex }> = [];
  for (let at = 0; at < (packed.length - 2) / 2;) {
    const length = hexToNumber(slice(packed, at + 53, at + 85));
    calls.push({ to: slice(packed, at + 1, at + 21), data: slice(packed, at + 85, at + 85 + length) });
    at += 85 + length;
  }
  return calls;
};

/** A call's argument, an address in lower case as the stand-in chain holds it. */
const lower = (each: unknown) =>
  typeof each === "string" && Str.startsWith("0x")(each) ? Str.toLowerCase(each) : each;

/** One call decoded by its target's ABI: the target, the function and its arguments, addresses in lower case. */
const decoded = (call: { readonly to: Hex; readonly data: Hex }) => {
  const { functionName, args } =
    Str.toLowerCase(call.to) === Str.toLowerCase(SEEDED.budgets)
      ? decodeFunctionData({ abi: BUDGETS, data: call.data })
      : decodeFunctionData({ abi: HATS, data: call.data });
  return { to: Str.toLowerCase(call.to), name: functionName, args: Arr.map(args ?? [], lower) };
};

/** The company Safe transaction a creation's subject lands with: its nonce and its calls, decoded. */
export const proposedOf = (creation: string) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const [row] = yield* sql<{ readonly landing: { readonly tx: { readonly data: Hex; readonly nonce: string } } }>`
      select landing from app.subjects where kind = 'budget_creation' and id = ${creation}`;
    const tx = row?.landing.tx ?? { data: "0x", nonce: "" };
    return { nonce: tx.nonce, calls: Arr.map(batchOf(tx.data), decoded) };
  });
