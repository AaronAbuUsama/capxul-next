// The world's bundler, brought up when the world is created (the `bundler` step): its two accounts are funded from
// the chain's faucet, the test paymaster is put on the chain and given its deposit at the EntryPoint, and alto is
// started and waited for. Each part is skipped when the chain already has it, as a world made from another does.
//
// test-paymaster.hex is MockPaymaster's creation code, compiled from packages/contracts/test/mocks/MockPaymaster.sol
// with solc 0.8.28 and the contracts package's settings (optimizer on, 200 runs, cancun, OpenZeppelin 5.6.1 from
// lib/), as test-usdc.hex is; compiled the same way, MockERC20 gives test-usdc.hex byte for byte.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Rec from "effect/Record";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { type Call, FAUCET_OPERATOR, word } from "../chain/faucet.ts";
import { BundlerFailed } from "../failures.ts";
import { describeFailure } from "../lifecycle/describe.ts";
import type { World } from "../lifecycle/spec.ts";
import { bundlerAnswers, bundlerStatus } from "./client.ts";
import {
  BUNDLER_ACCOUNTS,
  BUNDLER_FUNDS,
  CREATE2_DEPLOYER,
  ENTRY_POINT,
  PAYMASTER_DEPOSIT,
  TEST_PAYMASTER,
} from "./Keys.ts";

const Hex = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]*$/));
const Receipt = Schema.Struct({ status: Schema.String });
const ZERO_SALT = word("0");

const isBundlerFailed = Schema.is(BundlerFailed);
const setupFailed = (message: string) => BundlerFailed.make({ step: "setup", message });
/** Any failure on the way, as the setup's own failure; a bundler failure keeps its step. */
const asSetupFailed = (error: unknown): BundlerFailed =>
  isBundlerFailed(error) ? error : setupFailed(describeFailure(error));

/** One call whose result must be hex. */
const hexOf = <E, R>(call: Call<E, R>, method: string, params: ReadonlyArray<unknown>) =>
  call(method, params).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Hex)),
    Effect.mapError((error) => setupFailed(`${method}: ${describeFailure(error)}`)),
  );

/** Sends one transaction from the faucet's operator and insists that it succeeded. */
const sendFromOperator = <E, R>(call: Call<E, R>, transaction: Record<string, string>) =>
  Effect.gen(function* () {
    const hash = yield* hexOf(call, "eth_sendTransaction", [{ from: FAUCET_OPERATOR, ...transaction }]);
    const receipt = yield* call("eth_getTransactionReceipt", [hash]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Receipt)),
      Effect.retry(Schedule.max([Schedule.spaced("500 millis"), Schedule.recurs(20)])),
      Effect.mapError((error) => setupFailed(`no receipt for ${hash}: ${describeFailure(error)}`)),
    );
    if (receipt.status !== "0x1") return yield* setupFailed(`${hash} reverted (status ${receipt.status})`);
    return hash;
  });

const weiOf = <E, R>(call: Call<E, R>, address: string) =>
  Effect.map(hexOf(call, "eth_getBalance", [address, "latest"]), BigInt);

/** The paymaster's deposit at the EntryPoint: `balanceOf(address)`. */
const depositOf = <E, R>(call: Call<E, R>) =>
  Effect.map(
    hexOf(call, "eth_call", [{ to: ENTRY_POINT, data: `0x70a08231${word(TEST_PAYMASTER)}` }, "latest"]),
    BigInt,
  );

/** Gives each bundler account BUNDLER_FUNDS from the chain's faucet, unless it holds that much already. */
const fundAccounts = <E, R>(call: Call<E, R>) =>
  Effect.forEach(Rec.values(BUNDLER_ACCOUNTS), (account) =>
    Effect.gen(function* () {
      const held = yield* weiOf(call, account);
      if (held >= BUNDLER_FUNDS) return { account, wei: held.toString(), funded: false };
      // anvil answers null to anvil_setBalance, which a world's chain call takes for no answer, so what it did is
      // judged by the balance read back.
      yield* Effect.ignore(call("anvil_setBalance", [account, `0x${BUNDLER_FUNDS.toString(16)}`]));
      const now = yield* weiOf(call, account);
      if (now < BUNDLER_FUNDS) return yield* setupFailed(`anvil_setBalance left ${account} with ${now} wei`);
      return { account, wei: now.toString(), funded: true };
    }),
  );

/** Puts the paymaster on the chain through the CREATE2 deployer, unless it is there, and funds its deposit. */
const ensurePaymaster = <E, R>(call: Call<E, R>) =>
  Effect.gen(function* () {
    const there = (yield* hexOf(call, "eth_getCode", [TEST_PAYMASTER, "latest"])) !== "0x";
    if (!there) {
      const fs = yield* FileSystem.FileSystem;
      const code = Str.trim(yield* fs.readFileString(`${import.meta.dirname}/test-paymaster.hex`));
      yield* sendFromOperator(call, { to: CREATE2_DEPLOYER, data: `0x${ZERO_SALT}${code}${word(ENTRY_POINT)}` });
      if ((yield* hexOf(call, "eth_getCode", [TEST_PAYMASTER, "latest"])) === "0x")
        return yield* setupFailed(`the paymaster did not land at ${TEST_PAYMASTER}: test-paymaster.hex has changed`);
    }
    const before = yield* depositOf(call);
    // deposit(): the paymaster passes what it is sent on to the EntryPoint as its own deposit.
    if (before < PAYMASTER_DEPOSIT) {
      yield* sendFromOperator(call, {
        to: TEST_PAYMASTER,
        data: "0xd0e30db0",
        value: `0x${(PAYMASTER_DEPOSIT - before).toString(16)}`,
      });
    }
    // entryPoint(): the paymaster names the EntryPoint it sponsors through.
    const served = yield* hexOf(call, "eth_call", [{ to: TEST_PAYMASTER, data: "0xb0d691fe" }, "latest"]);
    if (!Str.endsWith(word(ENTRY_POINT))(Str.toLowerCase(served)))
      return yield* setupFailed(`the paymaster names ${served}, not the EntryPoint ${ENTRY_POINT}`);
    return { address: TEST_PAYMASTER, deployed: !there, depositWei: (yield* depositOf(call)).toString() };
  });

/**
 * The `bundler` step of a world's creation. The accounts are funded before alto's first start, because alto then
 * deploys its simulation contracts with its utility key. Gives back what it found and did, and how alto started.
 */
export const bringUpBundler = Effect.fn("world.bundler.up")(function* <E, R>(
  world: Pick<World, "bundlerUrl">,
  call: Call<E, R>,
) {
  const accounts = yield* fundAccounts(call);
  const paymaster = yield* ensurePaymaster(call);
  const entryPoints = yield* bundlerAnswers(world);
  const status = yield* bundlerStatus(world);
  return { accounts, paymaster, entryPoints, alto: status.record.starts };
}, Effect.mapError(asSetupFailed));
