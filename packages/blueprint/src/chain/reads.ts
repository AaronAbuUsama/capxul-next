// The reads of a world's chain a caller may make through the world's door (decisions.md, 34). Each is declared once,
// here: what it is asked, what it answers, and the JSON-RPC call and contract function behind it. The SDK serves them
// over the door's chain JSON-RPC (`CHAIN_PATH`, read-only methods only), so a claim reads the chain itself, never a
// copy of it that Core keeps. Every address a read takes comes from the world's view (`WorldView.contracts`), from
// an operation's answer or from a log. A read that gets no answer is a defect, as an unanswered call is.
import { Abi } from "@capxul/contracts";
import * as Arr from "effect/Array";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { CallOptions } from "../telemetry.ts";
import { Address, Amount, Hash, HatId, Instant, Uint } from "../values.ts";
import { Log, LogName } from "./logs.ts";

/** The block a read reads at: a block number, or null for the latest. */
const Block = Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)));

type AbiItem = { readonly type: string; readonly name?: string };

/** The function `name` of `abi`. A read whose function the ABI lacks is a defect of this file, found when it is loaded. */
const functionOf = <const A extends ReadonlyArray<AbiItem>, const Name extends string>(abi: A, name: Name) =>
  Option.getOrThrowWith(
    Arr.findFirst(
      abi,
      (item): item is Extract<A[number], { readonly type: "function"; readonly name: Name }> =>
        item.type === "function" && item.name === name,
    ),
    () => new Error(`no function ${name} in its contract's ABI`),
  );

/** The contract functions the reads call, as the compiled ABIs declare them (`@capxul/contracts`, roadmap step 3.1). */
export const FUNCTIONS = {
  balanceOf: functionOf(Abi.IERC20Metadata, "balanceOf"),
  decimals: functionOf(Abi.IERC20Metadata, "decimals"),
  getOwners: functionOf(Abi.ISafe, "getOwners"),
  getThreshold: functionOf(Abi.ISafeState, "getThreshold"),
  nonce: functionOf(Abi.ISafeState, "nonce"),
  viewHat: functionOf(Abi.IHats, "viewHat"),
  isWearerOfHat: functionOf(Abi.IHats, "isWearerOfHat"),
  companySafeAddressFor: functionOf(Abi.CompanySafeMinter, "companySafeAddressFor"),
  budgetOf: functionOf(Abi.Budgets, "budgetOf"),
  leftOf: functionOf(Abi.Budgets, "leftOf"),
  childrenOf: functionOf(Abi.Budgets, "childrenOf"),
} as const;

export interface Read<P extends Schema.Struct.Fields, A extends Schema.Codec<unknown, unknown>> {
  readonly payload: Schema.Struct<P>;
  readonly answer: A;
  /** How the door's chain RPC is asked: the JSON-RPC method and, for a contract, the functions called. */
  readonly via: string;
}

const read = <P extends Schema.Struct.Fields, A extends Schema.Codec<unknown, unknown>>(
  payload: P,
  answer: A,
  via: string,
): Read<P, A> => ({ payload: Schema.Struct(payload), answer, via });

/** Every chain read, by the name a caller calls it by (`capxul.chain.<name>`). */
export const reads = {
  /** The chain's latest block. A world's clock is its chain's: a new world mines a block at its start. */
  head: read(
    {},
    Schema.Struct({ number: Schema.Int, timestamp: Instant, hash: Hash }),
    "eth_getBlockByNumber(latest); the timestamp as an instant",
  ),
  /** What `holder` holds of an ERC-20 `token`, in the token's own decimals. */
  balance: read(
    { token: Address, holder: Address, block: Block },
    Amount,
    "eth_call of the token's balanceOf(holder) and decimals()",
  ),
  /** A Safe's owners, in the Safe's order, its threshold and its nonce. */
  safe: read(
    { safe: Address, block: Block },
    Schema.Struct({ owners: Schema.Array(Address), threshold: Schema.Int, nonce: Schema.Int }),
    "eth_call of the Safe's getOwners(), getThreshold() and nonce()",
  ),
  /** A hat of the Hats protocol at `hats`: its details, how many may wear it, how many do, and whether it is active. */
  hat: read(
    { hats: Address, hat: HatId, block: Block },
    Schema.Struct({ details: Schema.String, maxSupply: Schema.Int, supply: Schema.Int, active: Schema.Boolean }),
    "eth_call of the Hats protocol's viewHat(hat)",
  ),
  /** Whether `wearer` wears `hat`. */
  wears: read(
    { hats: Address, hat: HatId, wearer: Address, block: Block },
    Schema.Boolean,
    "eth_call of the Hats protocol's isWearerOfHat(wearer, hat)",
  ),
  /** The company Safe Companies House derives for `company` (an Organization's id) and its founder's Safe. */
  companySafeFor: read(
    { minter: Address, owner: Address, namespace: Schema.String, company: Schema.String, founderSafe: Address },
    Address,
    "eth_call of the minter's companySafeAddressFor(owner, namespace, company, founderSafe)",
  ),
  /**
   * One budget of the Budgets contract at `budgets`, by its id, for the period running at `block`: its amounts in its
   * token's own decimals, `period` as ICalendar codes it (0 a month, 1 a quarter, 2 a year), `parent` 0 for a top
   * budget, and its children's ids in the order they were made. Null when no budget has the id.
   */
  budget: read(
    { budgets: Address, budget: Uint, block: Block },
    Schema.NullOr(
      Schema.Struct({
        safe: Address,
        parent: Uint,
        hat: HatId,
        token: Address,
        period: Schema.Int,
        depth: Schema.Int,
        closed: Schema.Boolean,
        amount: Amount,
        childrenAmount: Amount,
        spent: Amount,
        committed: Amount,
        left: Amount,
        children: Schema.Array(Uint),
      }),
    ),
    "eth_call of the Budgets contract's budgetOf(id), leftOf(id) and childrenOf(id), and of the token's decimals()",
  ),
  /** One transaction as the chain included it, with every log it emitted, decoded, in order. */
  transaction: read(
    { transaction: Hash },
    Schema.Struct({
      transaction: Hash,
      block: Schema.Int,
      from: Address,
      to: Schema.NullOr(Address),
      status: Schema.Literals(["success", "reverted"]),
      logs: Schema.Array(Log),
    }),
    "eth_getTransactionReceipt",
  ),
  /** Every log of one declared kind, from one contract or any, between two blocks (null: the first, the latest). */
  logs: read(
    { log: LogName, address: Schema.NullOr(Address), fromBlock: Block, toBlock: Block },
    Schema.Array(Log),
    "eth_getLogs by the log's first topic",
  ),
} as const;

export type ReadName = keyof typeof reads;

/** How a chain read is made: the world's chain it reads (`at`) and the operator who signs in to that door. */
export type ReadOptions = Pick<CallOptions, "at" | "operator">;

/** What one read takes and answers. */
export type ReadPayload<Name extends ReadName> = (typeof reads)[Name]["payload"]["Type"];
export type ReadAnswer<Name extends ReadName> = (typeof reads)[Name]["answer"]["Type"];

/** One function per read, as the SDK and the scenarios' `Capxul` offer them under `chain`. */
export type Reader = {
  readonly [Name in ReadName]: (payload: ReadPayload<Name>, options?: ReadOptions) => Effect.Effect<ReadAnswer<Name>>;
};
