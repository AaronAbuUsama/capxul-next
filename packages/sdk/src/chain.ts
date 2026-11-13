// The chain reads (the blueprint's `Chain.reads`), served over a world's chain JSON-RPC through its door. viem is used
// only as a codec of the contracts' ABI, from the blueprint's own signatures: it encodes calls and decodes answers
// and logs, and never reaches the network. Every answer is decoded with the read's own schema, so a read answers
// exactly its declared type or dies. Every address and hash it answers is in lower case.
import { Chain } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  type Abi,
  type Hex,
} from "viem";
import type { JsonRpc } from "./transport.ts";

const functions: Abi = parseAbi(Rec.values(Chain.FUNCTION_SIGNATURES));
const logs: Abi = parseAbi(Rec.values(Chain.LOG_SIGNATURES));

/** A value as JSON-like data: big integers as decimal text, and hex (addresses included) in lower case. */
const plain = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return /^0x[0-9a-fA-F]*$/.test(value) ? Str.toLowerCase(value) : value;
  if (Arr.isArray(value)) return Arr.map(value, plain);
  if (Predicate.isObject(value) && !Predicate.isFunction(value))
    return Rec.map({ ...value } as Readonly<Record<string, unknown>>, plain);
  return value;
};

const hex = (n: number): string => `0x${n.toString(16)}`;
const blockTag = (block: number | null): string => (block === null ? "latest" : hex(block));
const decode = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: unknown): Effect.Effect<S["Type"]> =>
  Effect.orDie(Schema.decodeUnknownEffect(schema)(value));
const attempt = <A>(what: string, run: () => A): Effect.Effect<A> =>
  Effect.orDie(Effect.try({ try: run, catch: (cause) => `${what}: ${String(cause)}` }));

/** One contract function, called with eth_call at `block`, its result decoded by the contract's ABI. */
const call = (
  rpc: JsonRpc,
  to: string,
  name: keyof typeof Chain.FUNCTION_SIGNATURES,
  args: ReadonlyArray<unknown>,
  block: number | null,
) =>
  Effect.gen(function* () {
    const data = yield* attempt(`encoding ${name}`, () => encodeFunctionData({ abi: functions, functionName: name, args }));
    const answer = yield* decode(Schema.String, yield* rpc("eth_call", [{ to, data }, blockTag(block)]));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the JSON-RPC answer was decoded as a string above; viem names a hex string with a template type.
    const result = yield* attempt(`decoding ${name}`, () => decodeFunctionResult({ abi: functions, functionName: name, data: answer as Hex }));
    return plain(result);
  });

/** A whole amount of a token's smallest units, as a decimal string in its own decimals. */
const amountOf = (units: string, decimals: number): string => {
  const padded = Str.padStart(decimals + 1, "0")(units);
  const whole = Str.slice(0, padded.length - decimals)(padded);
  const fraction = Str.replace(/0+$/, "")(Str.slice(padded.length - decimals)(padded));
  return fraction === "" ? whole : `${whole}.${fraction}`;
};

const RawLog = Schema.Struct({
  address: Schema.String,
  topics: Schema.Array(Schema.String),
  data: Schema.String,
  blockNumber: Schema.String,
  transactionHash: Schema.String,
  logIndex: Schema.String,
});

const number = (text: string): number => Number.parseInt(text, 16);

/** One raw log, decoded as the declared log it is, or as `Other`. */
const logOf = (raw: typeof RawLog.Type): Effect.Effect<Chain.Log> => {
  const found = {
    address: Str.toLowerCase(raw.address),
    transaction: Str.toLowerCase(raw.transactionHash),
    block: number(raw.blockNumber),
    index: number(raw.logIndex),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the log's fields were decoded as strings; viem names hex strings with a template type.
  const topics = raw.topics as unknown as [Hex, ...Array<Hex>];
  const decoded = Effect.option(
    Effect.try(() => decodeEventLog({ abi: logs, data: raw.data as Hex, topics, strict: true })),
  );
  return Effect.flatMap(decoded, (event) =>
    Option.match(event, {
      onNone: () => decode(Chain.Log, { _tag: "Other", ...found, topic: Option.getOrNull(Arr.head(raw.topics)) }),
      onSome: ({ eventName, args }) => decode(Chain.Log, { ...(plain(args) as object), ...found, _tag: eventName }),
    }),
  );
};

const RawBlock = Schema.Struct({ number: Schema.String, timestamp: Schema.String, hash: Schema.String });
const RawReceipt = Schema.Struct({
  transactionHash: Schema.String,
  blockNumber: Schema.String,
  from: Schema.String,
  to: Schema.NullOr(Schema.String),
  status: Schema.String,
  logs: Schema.Array(RawLog),
});

const instantOf = (seconds: number): string => DateTime.formatIso(DateTime.makeUnsafe(seconds * 1000));
const at = <A>(items: ReadonlyArray<A>, index: number): A | undefined => items[index];

/** The reads over one chain's `rpc`. */
const readsOver = (rpc: JsonRpc) => {
  const answer = <Name extends Chain.ReadName>(name: Name, value: unknown) =>
    decode(Chain.reads[name].answer, value) as Effect.Effect<Chain.ReadAnswer<Name>>;
  return {
    head: () =>
      Effect.gen(function* () {
        const block = yield* decode(RawBlock, yield* rpc("eth_getBlockByNumber", ["latest", false]));
        return yield* answer("head", {
          number: number(block.number),
          timestamp: instantOf(number(block.timestamp)),
          hash: Str.toLowerCase(block.hash),
        });
      }),
    balance: ({ token, holder, block }) =>
      Effect.gen(function* () {
        const units = yield* decode(Schema.String, yield* call(rpc, token, "balanceOf", [holder], block));
        // viem decodes a uint8 as a number and a uint256 as a big integer, which `plain` makes text.
        const decimals = yield* decode(Schema.Union([Schema.Number, Schema.String]), yield* call(rpc, token, "decimals", [], block));
        return yield* answer("balance", amountOf(units, Number(decimals)));
      }),
    safe: ({ safe, block }) =>
      Effect.gen(function* () {
        const owners = yield* call(rpc, safe, "getOwners", [], block);
        const threshold = yield* call(rpc, safe, "getThreshold", [], block);
        const nonce = yield* call(rpc, safe, "nonce", [], block);
        return yield* answer("safe", { owners, threshold: Number(threshold), nonce: Number(nonce) });
      }),
    hat: ({ hats, hat, block }) =>
      Effect.gen(function* () {
        const viewed = yield* decode(Schema.Array(Schema.Unknown), yield* call(rpc, hats, "viewHat", [BigInt(hat)], block));
        return yield* answer("hat", {
          details: at(viewed, 0),
          maxSupply: at(viewed, 1),
          supply: at(viewed, 2),
          active: at(viewed, 8),
        });
      }),
    wears: ({ hats, hat, wearer, block }) =>
      Effect.flatMap(call(rpc, hats, "isWearerOfHat", [wearer, BigInt(hat)], block), (worn) => answer("wears", worn)),
    companySafeFor: ({ minter, owner, namespace, company, founderSafe }) =>
      Effect.flatMap(
        call(rpc, minter, "companySafeAddressFor", [owner, namespace, company, founderSafe], null),
        (safe) => answer("companySafeFor", safe),
      ),
    transaction: ({ transaction }) =>
      Effect.gen(function* () {
        const receipt = yield* decode(RawReceipt, yield* rpc("eth_getTransactionReceipt", [transaction]));
        return yield* answer("transaction", {
          transaction: Str.toLowerCase(receipt.transactionHash),
          block: number(receipt.blockNumber),
          from: Str.toLowerCase(receipt.from),
          to: receipt.to === null ? null : Str.toLowerCase(receipt.to),
          status: number(receipt.status) === 1 ? "success" : "reverted",
          logs: yield* Effect.forEach(receipt.logs, logOf),
        });
      }),
    logs: ({ log, address, fromBlock, toBlock }) =>
      Effect.gen(function* () {
        const [topic] = yield* attempt(`the topic of ${log}`, () => encodeEventTopics({ abi: logs, eventName: log }));
        const filter = {
          ...(address === null ? {} : { address }),
          topics: [topic],
          fromBlock: fromBlock === null ? "earliest" : hex(fromBlock),
          toBlock: blockTag(toBlock),
        };
        const raw = yield* decode(Schema.Array(RawLog), yield* rpc("eth_getLogs", [filter]));
        return yield* answer("logs", yield* Effect.forEach(raw, logOf));
      }),
  } satisfies {
    readonly [Name in Chain.ReadName]: (payload: Chain.ReadPayload<Name>) => Effect.Effect<Chain.ReadAnswer<Name>>;
  };
};

/**
 * The chain reads, each over the chain JSON-RPC its options name (`rpcFor`): the client's own world's, or another
 * world's door as an operator. Each read is a caller-side span named `chain.<read>`.
 */
export const readerOf = (rpcFor: (options?: Chain.ReadOptions) => JsonRpc): Chain.Reader => {
  const span = { kind: "client" } as const;
  return {
    head: (_payload, options) => Effect.withSpan(readsOver(rpcFor(options)).head(), "chain.head", span),
    balance: (payload, options) =>
      Effect.withSpan(readsOver(rpcFor(options)).balance(payload), "chain.balance", span),
    safe: (payload, options) => Effect.withSpan(readsOver(rpcFor(options)).safe(payload), "chain.safe", span),
    hat: (payload, options) => Effect.withSpan(readsOver(rpcFor(options)).hat(payload), "chain.hat", span),
    wears: (payload, options) => Effect.withSpan(readsOver(rpcFor(options)).wears(payload), "chain.wears", span),
    companySafeFor: (payload, options) =>
      Effect.withSpan(readsOver(rpcFor(options)).companySafeFor(payload), "chain.companySafeFor", span),
    transaction: (payload, options) =>
      Effect.withSpan(readsOver(rpcFor(options)).transaction(payload), "chain.transaction", span),
    logs: (payload, options) => Effect.withSpan(readsOver(rpcFor(options)).logs(payload), "chain.logs", span),
  };
};
