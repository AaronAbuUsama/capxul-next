// Proof: a world made from nothing answers on every part, a second world made from it starts with its rows and its
// chain, and destroying both leaves nothing of theirs in either account.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Duration from "effect/Duration";
import * as HttpClient from "effect/http/HttpClient";
import { inventory } from "../lifecycle/account.ts";
import { rpc } from "../lifecycle/parts.ts";
import { describe, withWorld } from "../lifecycle/run.ts";
import type { World } from "../lifecycle/spec.ts";
import { balanceOf } from "../chain/faucet.ts";
import { FUNDED, insist, mintIsIndexed, observed, OPENING, PAID, ProofFailed, transferIsIndexed } from "./checks.ts";

const ofThisStack = (listing: Effect.Success<typeof inventory>) => ({
  workers: listing.workers.ofThisStack,
  containerApplications: listing.containerApplications.ofThisStack,
  durableObjectNamespaces: listing.durableObjectNamespaces.ofThisStack,
  r2Buckets: listing.r2Buckets.ofThisStack,
  hyperdriveConfigurations: listing.hyperdriveConfigurations.ofThisStack,
  neonBranches: listing.neonBranches.names,
  imageRepositories: listing.imageRepositories.ofThisStack,
});

const worldsIn = (listing: ReturnType<typeof ofThisStack>, stage: string) =>
  Object.values(listing)
    .flat()
    .filter((name) => name.includes(stage));

/** What the forked world sees, checked against what the first world wrote. */
const useFork = (parent: World, parentHead: string, tx: string) => (fork: World) =>
  Effect.gen(function* () {
    const notes = yield* fork.sql("select world, note from app.notes order by id");
    const transfers = yield* fork.sql("select count(*)::int as n from ponder.transfers where tx_hash = $1", [tx]);
    const inherited = (yield* balanceOf((method, params) => rpc(fork, method, params), FUNDED)).toString();
    yield* insist(
      inherited === (OPENING - 1_000_000n).toString(),
      `the fork's chain does not hold the first world's balances: ${inherited}`,
    );
    const head = String(yield* rpc(fork, "eth_blockNumber"));
    yield* insist(
      JSON.stringify(notes).includes("written in the first world"),
      "the fork does not hold the first world's row",
    );
    yield* insist(JSON.stringify(transfers) === '[{"n":1}]', "the fork does not hold the first world's indexed event");
    yield* insist(BigInt(head) >= BigInt(parentHead), "the fork's chain is behind the first world's");
    yield* fork.sql("insert into app.notes (world, note) values ($1, $2)", [fork.stage, "written in the fork"]);
    const again = yield* transferIsIndexed(fork);
    const parentNotes = yield* parent.sql("select count(*)::int as n from app.notes");
    yield* insist(JSON.stringify(parentNotes) === '[{"n":1}]', "the first world saw the fork's row");
    const whileBothExisted = ofThisStack(yield* inventory);
    return {
      startedWithNotes: notes,
      startedWithIndexedTransfers: transfers,
      startedWithFundedBalance: inherited,
      chainHead: head,
      ownIndexedTransfer: again,
      firstWorldNotesAfterForkWrote: parentNotes,
      whileBothExisted,
    };
  });

const useFirst = (world: World) =>
  Effect.gen(function* () {
    const chainId = String(yield* rpc(world, "eth_chainId"));
    const seedHead = String(yield* rpc(world, "eth_blockNumber"));
    yield* insist(chainId === "0x14a34", `the chain id is ${chainId}`);
    const funded = world.funded;
    yield* insist(
      funded.length === 1 && funded[0]?.holds === OPENING.toString(),
      `the faucet's mint is not held: ${JSON.stringify(funded)}`,
    );
    const mintEvent = yield* mintIsIndexed(world);
    yield* insist(mintEvent.amount === OPENING.toString(), `the index holds a mint of ${mintEvent.amount}`);
    const progress = yield* world.sql("select indexed_block::text from ponder.indexer_progress");
    const indexed = yield* transferIsIndexed(world);
    const holds = {
      funded: (yield* balanceOf((method, params) => rpc(world, method, params), FUNDED)).toString(),
      paid: (yield* balanceOf((method, params) => rpc(world, method, params), PAID)).toString(),
    };
    yield* insist(
      holds.funded === (OPENING - 1_000_000n).toString() && holds.paid === "1000000",
      `after the payment the two hold ${JSON.stringify(holds)}`,
    );
    const core = yield* HttpClient.get(world.coreUrl).pipe(
      Effect.flatMap((response) => response.text),
      Effect.scoped,
    );
    yield* insist(core.includes(world.stage), `Core answered ${core}`);
    yield* world.sql("insert into app.notes (world, note) values ($1, $2)", [
      world.stage,
      "written in the first world",
    ]);
    const head = String(yield* rpc(world, "eth_blockNumber"));
    const forked = yield* withWorld(
      { name: "p-fork", owner: "proof", lifetime: Duration.minutes(40), from: world.name },
      useFork(world, head, indexed.tx),
    );
    const fork = Option.getOrUndefined(forked.used);
    if (fork === undefined || Exit.isFailure(fork)) {
      return yield* new ProofFailed({
        message: `the forked world's run did not pass: ${fork === undefined ? "not used" : describe(fork.cause)}`,
      });
    }
    return {
      chain: { chainId, seedHead, headAfterTransfer: head },
      faucet: {
        testUsdc: world.testUsdc,
        mintedAtCreation: funded,
        mintEventInTheIndex: mintEvent,
        balancesAfterOnePayment: holds,
      },
      index: { progress, paymentEventInTheIndex: indexed },
      core,
      fork: fork.value,
      forkRecord: forked.record,
    };
  });

export const fresh = Effect.gen(function* () {
  const before = ofThisStack(yield* inventory);
  const first = yield* withWorld(
    { name: "p-fresh", owner: "proof", lifetime: Duration.minutes(40), mint: [{ to: FUNDED, amount: OPENING }] },
    useFirst,
  );
  const after = ofThisStack(yield* inventory);
  const used = Option.getOrUndefined(first.used);
  const left = [...worldsIn(after, "w-p-fresh"), ...worldsIn(after, "w-p-fork")];
  yield* observed("fresh", {
    proof: "a world from nothing, a world forked from it, and both destroyed",
    passed: used !== undefined && Exit.isSuccess(used) && left.length === 0,
    observations: used !== undefined && Exit.isSuccess(used) ? used.value : null,
    failure: used !== undefined && Exit.isFailure(used) ? describe(used.cause) : null,
    record: first.record,
    listing: { before, after, leftOfTheseWorlds: left },
  });
  yield* insist(used !== undefined && Exit.isSuccess(used), "the first world's run did not pass");
  yield* insist(left.length === 0, `the destroys left ${left.join(", ")}`);
  return { passed: true, create: first.record.ms.create, destroy: first.record.ms.destroy, leftOfTheseWorlds: left };
});
