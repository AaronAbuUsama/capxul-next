// A company's budgets as the world's chain holds them now (Budgets.sol, `budgetOf`, `leftOf` and `childrenOf` at the
// latest block), and the people of the cast whose Safe wears a budget's hat. The chain is the only gate on spending,
// so every figure a budget read answers comes from here.
import type { Budgets } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { formatUnits, zeroAddress } from "viem";
import { Cast } from "../cast/Cast.ts";
import { BUDGETS, HATS } from "../chain/abi.ts";
import { readContract } from "../chain/calls.ts";
import { hex, sameAddress } from "../chain/hex.ts";
import { SEEDED, USDC_DECIMALS } from "../chain/seeded.ts";

type Period = typeof Budgets.Period.Type;

/** ICalendar's budget periods, by their codes: 0, 1 and 2. */
const PERIODS: ReadonlyArray<Period> = ["month", "quarter", "year"];

/** The period a chain code names; a code ICalendar does not have is a fault. */
export const periodOf = (code: number) =>
  Option.match(Arr.get(PERIODS, code), {
    onNone: () => Effect.die(`a budget of the period coded ${code}`),
    onSome: Effect.succeed,
  });

/** An amount in the test USDC's smallest unit, as the blueprint writes it. */
export const usdc = (units: bigint): string => formatUnits(units, USDC_DECIMALS);

/** One budget on the chain, its amounts in its token's smallest unit, for the period running now. */
export interface OnChain {
  readonly id: bigint;
  readonly safe: string;
  readonly parent: bigint;
  readonly hat: bigint;
  readonly token: string;
  readonly period: number;
  readonly closed: boolean;
  readonly amount: bigint;
  readonly spent: bigint;
  readonly committed: bigint;
  readonly left: bigint;
}

/** Budget `id` of the world's Budgets, if the company Safe `safe` has one by that id. */
export const budgetOf = Effect.fn("budgets.chain.budget")(function* (id: bigint, safe: string) {
  // An id no uint256 holds is no budget's, and no call could carry it.
  if (id >= 1n << 256n) return Option.none<OnChain>();
  const held = yield* readContract({ address: SEEDED.budgets, abi: BUDGETS, functionName: "budgetOf", args: [id] });
  if (sameAddress(held.safe, zeroAddress) || !sameAddress(held.safe, safe)) return Option.none<OnChain>();
  const left = yield* readContract({ address: SEEDED.budgets, abi: BUDGETS, functionName: "leftOf", args: [id] });
  return Option.some<OnChain>({
    id,
    safe: held.safe,
    parent: held.parent,
    hat: held.hat,
    token: held.token,
    period: held.period,
    closed: held.closed,
    amount: held.amount,
    spent: held.spent,
    committed: held.committed,
    left,
  });
});

/** The ids of `top` and of every budget below it, in the order the chain made them (its ids grow). */
export const treeOf = Effect.fn("budgets.chain.tree")(function* (top: bigint) {
  const found: Array<bigint> = [];
  let next: ReadonlyArray<bigint> = [top];
  while (Arr.isReadonlyArrayNonEmpty(next)) {
    found.push(...next);
    next = Arr.flatten(
      yield* Effect.forEach(
        next,
        (id) => readContract({ address: SEEDED.budgets, abi: BUDGETS, functionName: "childrenOf", args: [id] }),
        { concurrency: 4 },
      ),
    );
  }
  return Arr.sort(found, Order.BigInt);
});

/** The people of the world's cast whose personal Safe wears `hat` now, in the cast's order. */
export const holdersOf = Effect.fn("budgets.chain.holders")(function* (hat: bigint) {
  const cast = yield* Cast;
  const everyone = yield* cast.everyone;
  const wearing = yield* Effect.forEach(
    everyone,
    (each) =>
      each.safe === null
        ? Effect.succeed(false)
        : readContract({
            address: SEEDED.hats,
            abi: HATS,
            functionName: "isWearerOfHat",
            args: [hex(each.safe), hat],
          }),
    { concurrency: 4 },
  );
  return Arr.flatMap(everyone, (each, at) => (wearing[at] === true ? [each.person] : []));
});
