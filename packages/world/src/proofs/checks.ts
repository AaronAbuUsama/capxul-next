// What the proofs share: a typed failure, a way to insist, and the file a proof's observations are written to.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { rpc } from "../lifecycle/parts.ts";
import { DEFAULT_RECORDS } from "../lifecycle/run.ts";
import type { World } from "../lifecycle/spec.ts";

export class ProofFailed extends Schema.TaggedError<ProofFailed>()("ProofFailed", {
  message: Schema.String,
}) {}

/** Fails the proof unless the condition holds. */
export const insist = (condition: boolean, message: string) => (condition ? Effect.void : Effect.fail(new ProofFailed({ message })));

/** Writes what a proof observed to `records/<name>.proof.json` and gives it back. */
export const observed = <A>(name: string, observations: A) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(DEFAULT_RECORDS, { recursive: true });
    yield* fs.writeFileString(`${DEFAULT_RECORDS}/${name}.proof.json`, `${JSON.stringify(observations, null, 2)}\n`);
    return observations;
  });

/** Two of anvil's unlocked accounts: the one the faucet funds in the proofs, and one it pays. */
export const FUNDED = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const PAID = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
/** 250 test USDC, in millionths. */
export const OPENING = 250_000_000n;

const pad = (hex: string) => hex.slice(2).toLowerCase().padStart(64, "0");
/** Calldata of `transfer(PAID, 1 USDC)`. */
const PAY_ONE = `0xa9059cbb${pad(PAID)}${(1_000_000).toString(16).padStart(64, "0")}`;

const TransferRow = Schema.Struct({ log_id: Schema.String, token: Schema.String, from: Schema.String, to: Schema.String, amount: Schema.String, block_number: Schema.String });
const COLUMNS = `log_id, token, "from", "to", amount::text, block_number::text`;

const indexedRow = (world: World, where: string, params: ReadonlyArray<unknown>) =>
  world.sql(`select ${COLUMNS} from ponder.transfers where ${where}`, params).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([TransferRow]))),
    Effect.map(([found]) => found),
    Effect.retry(Schedule.max([Schedule.spaced("2 seconds"), Schedule.recurs(45)])),
  );

/** Waits until the index has written the faucet's mint to FUNDED, made when the world was created, to the world's database. */
export const mintIsIndexed = (world: World) =>
  indexedRow(world, `"from" = $1 and "to" = $2`, ["0x0000000000000000000000000000000000000000", FUNDED.toLowerCase()]);

/**
 * Sends a real transaction through the world's RPC address: FUNDED pays PAID one test USDC out of what the faucet
 * minted. Waits until the index has written its Transfer event to the world's database, and gives back both.
 */
export const transferIsIndexed = (world: World) =>
  Effect.gen(function* () {
    const tx = String(yield* rpc(world, "eth_sendTransaction", [{ from: FUNDED, to: world.testUsdc, data: PAY_ONE, gas: "0x30d40" }]));
    return { tx, row: yield* indexedRow(world, "tx_hash = $1", [tx]) };
  });
