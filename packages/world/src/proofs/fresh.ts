// Proof: a world made from nothing answers on every part (chain, index, Core and database), a second world made
// from it starts with its rows and its chain, and destroying both leaves the accounts as they were.
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { balanceOf } from "../chain/faucet.ts";
import { CORE_HEALTH } from "../core/health.ts";
import { ProofFailed } from "../failures.ts";
import { describe } from "../lifecycle/describe.ts";
import { rpc, rpcHex } from "../lifecycle/parts.ts";
import { withWorld } from "../lifecycle/run.ts";
import type { World } from "../lifecycle/spec.ts";
import { FUNDED, mintIsIndexed, ONE_USDC, OPENING, PAID, transferIsIndexed } from "./checks.ts";
import { check, conclude, inventoryReport, stackListing } from "./support.ts";

const lifetime = Duration.minutes(40);
const Count = Schema.Tuple([Schema.Struct({ n: Schema.Int })]);
const Notes = Schema.Array(Schema.Struct({ world: Schema.String, note: Schema.String }));
const CoreHealth = Schema.Struct({ core: Schema.String, world: Schema.String });

const holdsOf = (world: World, account: string) => balanceOf((method, params) => rpc(world, method, params), account);
const countOf = (world: World, statement: string, params: ReadonlyArray<unknown> = []) =>
  world.sql(statement, params).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Count)),
    Effect.map(([row]) => row.n),
  );

/** What the forked world sees, set against what the first world wrote. */
const useFork = (parent: World, parentHead: string, tx: string) => (fork: World) =>
  Effect.gen(function* () {
    const notes = yield* fork
      .sql("select world, note from app.notes order by id")
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Notes)));
    const transfers = yield* countOf(fork, "select count(*)::int as n from ponder.transfers where tx_hash = $1", [tx]);
    const inherited = yield* holdsOf(fork, FUNDED);
    const head = yield* rpcHex(fork, "eth_blockNumber");
    yield* fork.sql("insert into app.notes (world, note) values ($1, $2)", [fork.stage, "written in the fork"]);
    const own = yield* transferIsIndexed(fork);
    const parentNotes = yield* countOf(parent, "select count(*)::int as n from app.notes");
    return {
      startedWithNotes: notes,
      startedWithIndexedTransfers: transfers,
      startedWithFundedBalance: inherited.toString(),
      chainHead: head,
      ownIndexedTransfer: own,
      firstWorldNotesAfterForkWrote: parentNotes,
      checks: [
        check(
          "the fork starts with the first world's row",
          notes.length === 1 && notes[0]?.note === "written in the first world",
        ),
        check("the fork starts with the first world's indexed payment", transfers === 1),
        check("the fork's chain holds the first world's balances", inherited === OPENING - ONE_USDC),
        check("the fork's chain is not behind the first world's", BigInt(head) >= BigInt(parentHead)),
        check("the first world does not see the fork's row", parentNotes === 1),
      ],
    };
  });

const useFirst = (world: World) =>
  Effect.gen(function* () {
    const chainId = yield* rpcHex(world, "eth_chainId");
    const seedHead = yield* rpcHex(world, "eth_blockNumber");
    const mintEvent = yield* mintIsIndexed(world);
    const progress = yield* world.sql("select indexed_block::text from ponder.indexer_progress");
    const paid = yield* transferIsIndexed(world);
    const holds = { funded: yield* holdsOf(world, FUNDED), paid: yield* holdsOf(world, PAID) };
    const core = yield* HttpClient.get(`${world.coreUrl}${CORE_HEALTH}`).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(CoreHealth)),
      Effect.scoped,
    );
    yield* world.sql("insert into app.notes (world, note) values ($1, $2)", [
      world.stage,
      "written in the first world",
    ]);
    const head = yield* rpcHex(world, "eth_blockNumber");
    const forked = yield* withWorld(
      { name: "p-fork", owner: "proof", lifetime, from: world.name },
      useFork(world, head, paid.tx),
    );
    const fork = Option.getOrUndefined(forked.used);
    if (fork === undefined || Exit.isFailure(fork))
      return yield* ProofFailed.make({
        message: `the forked world's run did not pass: ${fork === undefined ? "never used" : describe(fork.cause)}`,
      });
    const funded = world.funded;
    return {
      observed: {
        chain: { chainId, seedHead, headAfterPayment: head },
        faucet: { testUsdc: world.testUsdc, mintedAtCreation: funded, mintEventInTheIndex: mintEvent },
        index: { progress, paymentEventInTheIndex: paid },
        balancesAfterOnePayment: { funded: holds.funded.toString(), paid: holds.paid.toString() },
        core,
        fork: { ...fork.value, checks: undefined },
        forkRecord: forked.record,
      },
      checks: [
        check("the chain is the seeded chain (id 84532)", chainId === "0x14a34"),
        check(
          "the faucet minted 250 test USDC at creation",
          funded.length === 1 && funded[0]?.holds === OPENING.toString(),
        ),
        check("the index wrote the faucet's mint to the world's database", mintEvent.amount === OPENING.toString()),
        check(
          "a payment through the world's RPC address moved 1 USDC",
          holds.funded === OPENING - ONE_USDC && holds.paid === ONE_USDC,
        ),
        check("the index wrote the payment to the world's database", paid.row.amount === ONE_USDC.toString()),
        check("Core answers its health check for this world", core.world === world.stage),
        ...fork.value.checks,
        check(
          "the forked world's run passed and its world was destroyed",
          forked.record.worldAfterwards === "destroyed",
        ),
      ],
    };
  });

export const fresh = Effect.gen(function* () {
  const before = yield* stackListing;
  const first = yield* withWorld(
    { name: "p-fresh", owner: "proof", lifetime, mint: [{ to: FUNDED, amount: OPENING }] },
    useFirst,
  );
  const after = yield* stackListing;
  const used = Option.getOrUndefined(first.used);
  const passed = used !== undefined && Exit.isSuccess(used);
  const inventory = inventoryReport(before, after, ["w-p-fresh", "w-p-fork"]);
  return yield* conclude(
    "fresh",
    "a world made from nothing answers on every part, a world forked from it starts with its rows and chain, and both are destroyed",
    [
      check("the first world's run passed", passed),
      ...(passed ? used.value.checks : []),
      check("the first world was destroyed", first.record.worldAfterwards === "destroyed"),
      check("nothing of either world is left in the accounts", inventory.leftOfTheseWorlds.length === 0),
      check("the accounts hold what they held before", inventory.sameAsBefore),
    ],
    {
      failure: used !== undefined && Exit.isFailure(used) ? describe(used.cause) : null,
      observed: passed ? used.value.observed : null,
      record: first.record,
      inventory,
    },
  );
});
