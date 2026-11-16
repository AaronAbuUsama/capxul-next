// A journey's log reads, kept (support/scans.ts): the first read of a kind scans from genesis, later ones only the
// blocks since, and every read answers every log of its kind up to the head, as a scan from genesis would.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul, type CapxulClient } from "../src/door.ts";
import { ChainScans, logsSoFar, noScans } from "../src/support/scans.ts";

/** A chain whose head is `head.at`, holding one log per block; every logs read kept as [fromBlock, toBlock]. */
const chainOf = (head: { at: number }, asked: Array<readonly [number | null, number | null]>) => {
  const logsBetween = (from: number | null, to: number | null) =>
    Arr.map(Arr.range(from ?? 0, Math.min(to ?? head.at, head.at)), (block) => ({ _tag: "CompanySafeMinted", block }));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in chain for one test: only head and logs are read, and each answers the fields the scans use
  return {
    chain: {
      head: () => Effect.sync(() => ({ number: head.at })),
      logs: (payload: { fromBlock: number | null; toBlock: number | null }) =>
        Effect.sync(() => {
          asked.push([payload.fromBlock, payload.toBlock]);
          return logsBetween(payload.fromBlock, payload.toBlock);
        }),
    },
  } as unknown as CapxulClient;
};

const blocksOf = (logs: ReadonlyArray<{ readonly block: number }>) => Arr.map(logs, (each) => each.block);

test("a journey scans from genesis once, then only the blocks since, and always answers every log so far", () => {
  const head = { at: 5 };
  const asked: Array<readonly [number | null, number | null]> = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      const read = logsSoFar("CompanySafeMinted", null);
      const first = yield* read;
      const again = yield* read;
      head.at = 8;
      const later = yield* read;
      assert.deepEqual(blocksOf(first), [0, 1, 2, 3, 4, 5]);
      assert.deepEqual(blocksOf(again), [0, 1, 2, 3, 4, 5], "nothing new: nothing read");
      assert.deepEqual(blocksOf(later), [0, 1, 2, 3, 4, 5, 6, 7, 8], "every log so far, as from genesis");
      assert.deepEqual(asked, [
        [null, 5],
        [6, 8],
      ]);
    }).pipe(Effect.provideServiceEffect(ChainScans, noScans), Effect.provideService(Capxul, chainOf(head, asked))),
  );
});

test("with nothing kept, every read scans from genesis, as before", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const asked: Array<readonly [number | null, number | null]> = [];
      const client = chainOf({ at: 3 }, asked);
      const read = Effect.provideService(logsSoFar("CompanySafeMinted", null), Capxul, client);
      yield* read;
      yield* read;
      assert.deepEqual(asked, [
        [null, null],
        [null, null],
      ]);
    }),
  ));
