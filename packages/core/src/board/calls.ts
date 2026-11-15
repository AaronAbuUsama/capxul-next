// The calls of a change to a company's Board, made by the founder's own Safe (blueprint `src/board/order.md`), and
// the live reads they are built from. Seating a Director is the Director hat's one more seat when every seat is worn,
// its mint to the new Director's Safe and the Signer Gate's `claimSignerFor`, which makes that Safe an owner of the
// company Safe; setting the threshold is the Gate's `setThresholdConfig`, `ABSOLUTE` with `min = target`, as
// org.create founds it. The building is pure; the reads go through `WorldChain`.
import * as Effect from "effect/Effect";
import { encodeFunctionData } from "viem";
import { GATE, HATS, SAFE } from "../chain/abi.ts";
import { readContract } from "../chain/calls.ts";
import { hex } from "../chain/hex.ts";
import type { Call } from "../chain/safe.ts";
import { SEEDED } from "../chain/seeded.ts";

/** The Gate's `ABSOLUTE` threshold type. */
const ABSOLUTE = 0;

/** What seating a Director needs: the Director hat, its seats now, the company's Gate and the new Director's Safe. */
export interface Seating {
  readonly hats: string;
  readonly gate: string;
  readonly hat: bigint;
  readonly supply: number;
  readonly maxSupply: number;
  readonly wearer: string;
}

/** The calls that seat a Director, in order: one more seat when every seat is worn, the mint, then the claim. */
export const seatCalls = (seating: Seating): ReadonlyArray<Call> => {
  const seat = {
    to: seating.hats,
    data: encodeFunctionData({
      abi: HATS,
      functionName: "changeHatMaxSupply",
      args: [seating.hat, seating.supply + 1],
    }),
  };
  const mint = {
    to: seating.hats,
    data: encodeFunctionData({ abi: HATS, functionName: "mintHat", args: [seating.hat, hex(seating.wearer)] }),
  };
  const claim = {
    to: seating.gate,
    data: encodeFunctionData({ abi: GATE, functionName: "claimSignerFor", args: [seating.hat, hex(seating.wearer)] }),
  };
  return seating.supply < seating.maxSupply ? [mint, claim] : [seat, mint, claim];
};

/** The call that makes the company Safe need `threshold` signatures, whatever its number of owners. */
export const thresholdCall = (gate: string, threshold: number): Call => ({
  to: gate,
  data: encodeFunctionData({
    abi: GATE,
    functionName: "setThresholdConfig",
    args: [{ thresholdType: ABSOLUTE, min: BigInt(threshold), target: BigInt(threshold) }],
  }),
});

/** The company Safe's owners and threshold, as the chain holds them now. */
export const ownersOf = Effect.fn("board.owners")(function* (safe: string) {
  const owners = yield* readContract({ address: safe, abi: SAFE, functionName: "getOwners", args: [] });
  const threshold = yield* readContract({ address: safe, abi: SAFE, functionName: "getThreshold", args: [] });
  return { owners, threshold: Number(threshold) };
});

/** How many wear the hat, and how many may. */
export const seatsOf = Effect.fn("board.seats")(function* (hat: bigint) {
  const [, maxSupply, supply] = yield* readContract({
    address: SEEDED.hats,
    abi: HATS,
    functionName: "viewHat",
    args: [hat],
  });
  return { supply, maxSupply };
});
