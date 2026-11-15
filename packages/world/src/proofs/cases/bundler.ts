// Proof: a world made by the one command holds a bundler and a test paymaster, and one UserOperation signed by a test
// key and sponsored by the paymaster lands on the world's chain as one transaction. Its receipt and the state it
// changed are read back from the chain, the index sees its transfer, and the destroy leaves nothing in either account.
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Str from "effect/String";
import { bundlerStatus, servesEntryPoint } from "../../parts/bundler/client.ts";
import { BUNDLER_ACCOUNTS, ENTRY_POINT, TEST_PAYMASTER } from "../../parts/bundler/Keys.ts";
import { word } from "../../parts/chain/faucet.ts";
import { destroy } from "../../things/world/destroy.ts";
import { list } from "../../things/world/list.ts";
import { open, rpc, stop } from "../../things/world/client.ts";
import { decodeJsonText } from "../../common/record.ts";
import type { World } from "../../things/world/values.ts";
import { check, conclude, inventoryReport, runCommandLine, stackListing, tailOf } from "../support/conclude.ts";
import { AMOUNT, chainReceipt, makeSafe, RECIPIENT, sendUserOperation } from "../support/userop.ts";

const NAME = "p-bundler";
const PROOF = "bundler";
const CLAIM =
  "`world create` makes a world with a bundler and a test paymaster; one UserOperation signed by a test key and sponsored by the paymaster lands on its chain as one transaction, the index sees it, and `world destroy` removes all of it";

const Ms = Schema.Record(Schema.String, Schema.Finite);
const Created = Schema.Struct({
  world: Schema.String,
  entryPoint: Schema.String,
  paymaster: Schema.String,
  ms: Ms,
});
const Destroyed = Schema.Struct({ world: Schema.String, resourcesDestroyed: Schema.Finite, ms: Ms });
const Block = Schema.Struct({ transactions: Schema.Array(Schema.String) });
const Transfer = Schema.Struct({ from: Schema.String, to: Schema.String, amount: Schema.String });
const Count = Schema.Tuple([Schema.Struct({ n: Schema.Int })]);

/** topic0 of the EntryPoint's UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256). */
const USER_OPERATION_EVENT = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f";

const lower = Str.toLowerCase;
const same = (a: string, b: string): boolean => lower(a) === lower(b);
const topicOf = (address: string): string => `0x${word(address)}`;

/** How long `effect` took, in milliseconds, with its result. */
const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const began = yield* Clock.currentTimeMillis;
    const value = yield* effect;
    return { value, ms: (yield* Clock.currentTimeMillis) - began };
  });

/** Waits, up to 90 s, until the index has written the UserOperation's transfer to the world's database. */
const indexedTransfer = (world: World, tx: string) =>
  world.sql(`select "from", "to", amount::text from ponder.transfers where tx_hash = $1`, [lower(tx)]).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Transfer]))),
    Effect.map(([row]) => row),
    Effect.retry(Schedule.max([Schedule.spaced("2 seconds"), Schedule.recurs(45)])),
  );

const inWorld = (world: World) =>
  Effect.gen(function* () {
    const served = yield* servesEntryPoint(world);
    const alto = yield* bundlerStatus(world);
    const safe = yield* timed(makeSafe(world));
    const sent = yield* sendUserOperation(world, safe.value.safe);
    const tx = sent.receipt.receipt.transactionHash;
    const onChain = yield* chainReceipt(world, tx);
    const block = yield* rpc(world, "eth_getBlockByNumber", [onChain.blockNumber, false]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Block)),
    );
    const events = Arr.filter(
      onChain.logs,
      (log) => same(log.address, ENTRY_POINT) && log.topics[0] === USER_OPERATION_EVENT,
    );
    const indexed = yield* timed(indexedTransfer(world, tx));
    const [{ n: userOperationRows }] = yield* world
      .sql("select count(*)::int as n from ponder.user_operations where tx_hash = $1", [lower(tx)])
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Count)));
    // The world stops (the chain saved, the index and the bundler stopped); the next bundler call wakes it.
    yield* stop(world);
    const stopped = yield* bundlerStatus(world);
    const again = yield* timed(sendUserOperation(world, safe.value.safe));
    const woken = yield* bundlerStatus(world);
    const effect = {
      safeTestUsdc: String(sent.after.safe - sent.before.safe),
      recipientTestUsdc: String(sent.after.recipient - sent.before.recipient),
      safeEthWei: String(sent.after.safeEth - sent.before.safeEth),
      paymasterDepositWei: String(sent.after.deposit - sent.before.deposit),
      safeNonce: `${sent.before.nonce} -> ${sent.after.nonce}`,
    };
    const [event] = events;
    return {
      checks: [
        check(
          "the bundler serves the seeded EntryPoint",
          Arr.some(served, (address) => same(address, ENTRY_POINT)),
        ),
        check("alto is running in its container", alto.running && Arr.isReadonlyArrayNonEmpty(alto.record.starts)),
        check("the hash the bundler gave is the UserOperation's own hash", same(sent.userOpHash, sent.expectedHash)),
        check(
          "the bundler's receipt says it succeeded, from the Safe, sponsored by the test paymaster",
          sent.receipt.success &&
            same(sent.receipt.sender, safe.value.safe) &&
            same(sent.receipt.paymaster, TEST_PAYMASTER),
        ),
        check("on the chain, its transaction succeeded", onChain.status === "0x1"),
        check(
          "it was sent by the bundler's executor to the EntryPoint",
          same(onChain.from, BUNDLER_ACCOUNTS.executor) && onChain.to !== null && same(onChain.to, ENTRY_POINT),
        ),
        check(
          "its block holds that one transaction",
          block.transactions.length === 1 && same(block.transactions[0] ?? "", tx),
        ),
        check(
          "the transaction holds one UserOperationEvent, for this operation, from the Safe, paid by the paymaster",
          events.length === 1 &&
            event !== undefined &&
            same(event.topics[1] ?? "", sent.userOpHash) &&
            same(event.topics[2] ?? "", topicOf(safe.value.safe)) &&
            same(event.topics[3] ?? "", topicOf(TEST_PAYMASTER)),
        ),
        check(
          "the chain moved 25 test USDC from the Safe to the recipient",
          sent.after.safe - sent.before.safe === -AMOUNT && sent.after.recipient - sent.before.recipient === AMOUNT,
        ),
        check(
          "the paymaster paid the gas from its deposit, and the Safe paid nothing",
          sent.after.deposit < sent.before.deposit && sent.after.safeEth === sent.before.safeEth,
        ),
        check("the Safe's EntryPoint nonce moved by one", sent.after.nonce === sent.before.nonce + 1n),
        check(
          "the index wrote the transfer to the world's database",
          same(indexed.value.from, safe.value.safe) &&
            same(indexed.value.to, RECIPIENT) &&
            indexed.value.amount === AMOUNT.toString(),
        ),
        check("stopping the world's chain stopped the bundler", !stopped.running && stopped.record.stops.length === 1),
        check(
          "after the stop, a second UserOperation woke the chain and the bundler, and landed",
          again.value.receipt.success &&
            again.value.after.nonce === sent.after.nonce + 1n &&
            again.value.after.safe - again.value.before.safe === -AMOUNT &&
            woken.running &&
            woken.record.starts.length === 2,
        ),
      ],
      observed: {
        bundler: { servesEntryPoints: served, alto },
        safe: safe.value,
        userOperation: {
          hash: sent.userOpHash,
          signedDigest: sent.digest,
          bundlerReceipt: sent.receipt,
          chainReceipt: {
            ...onChain,
            logs: Arr.map(onChain.logs, (log) => ({ address: log.address, topic0: log.topics[0] ?? null })),
          },
          blockTransactions: block.transactions,
          effectOnTheChain: effect,
        },
        index: {
          transfer: indexed.value,
          // The index records a UserOperationEvent only for a Safe claimed through Companies House (known_safes);
          // this Safe was made directly, so its operation is seen through its transfer.
          userOperationRows,
        },
        afterAStop: {
          bundlerStopped: stopped.record.stops,
          secondUserOperation: { hash: again.value.userOpHash, bundlerReceipt: again.value.receipt },
          altoStarts: woken.record.starts,
        },
        ms: {
          secondUserOperationWakingTheWorld: again.ms,
          makeSafeAndFundIt: safe.ms,
          sendUserOperationAccepted: sent.acceptedMs,
          sendUserOperationToReceipt: sent.receiptMs,
          receiptToIndexed: indexed.ms,
        },
      },
    };
  });

export const bundler = Effect.gen(function* () {
  const before = yield* stackListing;
  const createArgs = ["create", NAME, "--owner", "proof", "--lifetime", "30 minutes"];
  const createRun = yield* runCommandLine(createArgs, { viaPnpm: true });
  if (createRun.exitCode !== 0) {
    return yield* conclude(PROOF, CLAIM, [check("the create command succeeded", false)], {
      exitCode: createRun.exitCode,
      createLogTail: tailOf(createRun, 40),
    });
  }
  const created = yield* decodeJsonText(Created)(createRun.stdout);
  const world = yield* open(NAME);
  const used = yield* inWorld(world);
  const between = yield* stackListing;
  const destroyRun = yield* runCommandLine(["destroy", NAME], { viaPnpm: true });
  const destroyed = yield* decodeJsonText(Destroyed)(destroyRun.stdout);
  const listed = Arr.filter(yield* list, (entry) => entry.world === world.stage);
  const inventory = inventoryReport(before, yield* stackListing, [world.stage]);
  const step = (name: string): number => created.ms[name] ?? 0;
  return yield* conclude(
    PROOF,
    CLAIM,
    [
      check("the create command succeeded", createRun.exitCode === 0),
      check(
        "the world's handle names the EntryPoint and the test paymaster",
        same(created.entryPoint, ENTRY_POINT) && same(created.paymaster, TEST_PAYMASTER),
      ),
      check("the create recorded the bundler step's duration", step("bundler") > 0),
      ...used.checks,
      check("the destroy command succeeded", destroyRun.exitCode === 0 && destroyed.resourcesDestroyed > 0),
      check("the shared state holds nothing of the world", listed.length === 0),
      check("nothing of the world is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    {
      commands: {
        create: `pnpm --filter @capxul/world world ${Arr.join(createArgs, " ")}`,
        destroy: `pnpm --filter @capxul/world world destroy ${NAME}`,
      },
      createMs: created.ms,
      // The bundler step runs beside the index step, so what it adds to the create's critical path is the part of
      // it that outlasts the index; the rest of its cost is in the deploy (one more container application).
      bundlerBeyondIndexMs: Math.max(0, step("bundler") - step("index")),
      destroyMs: destroyed.ms,
      resourcesDestroyed: destroyed.resourcesDestroyed,
      ...used.observed,
      worldResourcesWhileUp: pipe(between, (listing) => ({
        containerApplications: Arr.filter(listing.containerApplications, Str.includes(`-${world.stage}-`)),
        durableObjectNamespaces: Arr.filter(listing.durableObjectNamespaces, Str.includes(`-${world.stage}-`)),
      })),
      createLogTail: tailOf(createRun),
      destroyLogTail: tailOf(destroyRun),
      inventory,
    },
  );
}).pipe(Effect.ensuring(Effect.ignore(destroy(NAME))));
