// What the proofs do inside a world: pay from a funded address through the world's RPC address, and wait for the
// index to write what happened to the world's database.
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { word } from "../chain/faucet.ts";
import { rpcHex } from "../lifecycle/parts.ts";
import type { World } from "../lifecycle/spec.ts";

/** Two of anvil's unlocked accounts: the one the faucet funds in the proofs, and one it pays. */
export const FUNDED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const PAID = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
/** 250 test USDC, in millionths. */
export const OPENING = 250_000_000n;
/** What one payment moves: 1 test USDC. */
export const ONE_USDC = 1_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Calldata of `transfer(PAID, 1 USDC)`. */
const PAY_ONE = `0xa9059cbb${word(PAID)}${word(ONE_USDC.toString(16))}`;

const TransferRow = Schema.Struct({
  log_id: Schema.String,
  token: Schema.String,
  from: Schema.String,
  to: Schema.String,
  amount: Schema.String,
  block_number: Schema.String,
});
const COLUMNS = `log_id, token, "from", "to", amount::text, block_number::text`;

/** Waits, up to 90 s, until the index has written the one transfer that matches to the world's database. */
const indexedRow = (world: World, where: string, params: ReadonlyArray<unknown>) =>
  world.sql(`select ${COLUMNS} from ponder.transfers where ${where}`, params).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([TransferRow]))),
    Effect.map(([found]) => found),
    Effect.retry(Schedule.max([Schedule.spaced("2 seconds"), Schedule.recurs(45)])),
  );

/** Waits until the index has written the faucet's mint to FUNDED, made when the world was created. */
export const mintIsIndexed = (world: World) =>
  indexedRow(world, `"from" = $1 and "to" = $2`, [ZERO_ADDRESS, pipe(FUNDED, Str.toLowerCase)]);

/**
 * Sends a real transaction through the world's RPC address: FUNDED pays PAID one test USDC out of what the faucet
 * minted. Waits until the index has written its Transfer event to the world's database, and gives back both.
 */
export const transferIsIndexed = (world: World) =>
  Effect.gen(function* () {
    const tx = yield* rpcHex(world, "eth_sendTransaction", [
      { from: FUNDED, to: world.testUsdc, data: PAY_ONE, gas: "0x30d40" },
    ]);
    return { tx, row: yield* indexedRow(world, "tx_hash = $1", [tx]) };
  });
