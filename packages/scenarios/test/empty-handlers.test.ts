// Step 1.5's proof (docs/roadmap.md): every registered scenario fails against Core's empty handlers, which answer
// every call with the blueprint's NotImplemented, and none passes vacuously. Each scenario runs against a Capxul
// whose every function fails so; it must reach the door, and fail with NotImplemented itself or with an expectation
// that names it, never pass and never die.
//
// The run record of this, records/empty-handlers.json, is written by this test: `pnpm --filter @capxul/scenarios
// record` writes it, and every other run fails when the committed file differs from what the run finds, so it is
// never edited by hand.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Errors, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Random from "effect/Random";
import * as Str from "effect/String";
import { Capxul, claimOf, Given, scenarios, type CapxulClient, type Scenario } from "../src/door.ts";

const RECORD = new URL("../records/empty-handlers.json", import.meta.url);

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * A chain on which nothing an operation does has happened, as a world's chain is while Core's handlers are empty:
 * its first block, every balance 0, no owners, no hats worn, no logs. Reads are not operations: they are not in
 * `calls`.
 */
const emptyChain: CapxulClient["chain"] = {
  head: () => Effect.succeed({ number: 0, timestamp: "2026-11-13T09:00:00.000Z", hash: `0x${Str.repeat(64)("0")}` }),
  balance: () => Effect.succeed("0"),
  safe: () => Effect.succeed({ owners: [], threshold: 0, nonce: 0 }),
  hat: () => Effect.succeed({ details: "", maxSupply: 0, supply: 0, active: false }),
  wears: () => Effect.succeed(false),
  companySafeFor: () => Effect.succeed(ZERO),
  transaction: ({ transaction }) =>
    Effect.succeed({ transaction, block: 0, from: ZERO, to: null, status: "reverted" as const, logs: [] }),
  logs: () => Effect.succeed([]),
};

/** Capxul as Core's empty handlers answer it: every call fails with NotImplemented naming its operation. */
const emptyHandlers = (calls: Array<string>): CapxulClient => {
  const empty = (operation: OperationName) => () =>
    Effect.andThen(
      Effect.sync(() => calls.push(operation)),
      Effect.fail(Errors.NotImplemented.make({ operation })),
    );
  return {
    "world.create": empty("world.create"),
    "world.show": empty("world.show"),
    "world.snapshot.save": empty("world.snapshot.save"),
    "world.snapshot.restore": empty("world.snapshot.restore"),
    "org.create": empty("org.create"),
    "org.member.grant": empty("org.member.grant"),
    "doc.create": empty("doc.create"),
    "doc.submit": empty("doc.submit"),
    "approval.sign": empty("approval.sign"),
    "report.run": empty("report.run"),
    "world.clock.warp": empty("world.clock.warp"),
    "record.export": empty("record.export"),
    chain: emptyChain,
  };
};

interface Result {
  readonly name: string;
  readonly proves: { readonly operation: string; readonly claim: number; readonly says: string } | null;
  readonly given: string;
  /** The operations the scenario called, in order, each answered NotImplemented. */
  readonly calls: ReadonlyArray<string>;
  /** "failed" as it should; "passed" or "died" when it did not. */
  readonly outcome: "failed" | "passed" | "died";
  /** The tag of what it failed with: NotImplemented, or ExpectationFailed. */
  readonly failedWith: string | null;
  readonly detail: string;
}

const run = async (each: Scenario): Promise<Result> => {
  const calls: Array<string> = [];
  const exit = await Effect.runPromiseExit(
    each.run.pipe(
      Effect.provideService(Capxul, emptyHandlers(calls)),
      // The starting world's example facts: what its maker would hand, had Core's handlers made it.
      Effect.provideService(Given, { world: each.given, facts: Effect.succeed(each.given.example) }),
      Random.withSeed(each.name),
      Effect.timeout("10 seconds"),
    ),
  );
  const proves =
    each.proves === null
      ? null
      : { ...each.proves, says: claimOf(each.proves).pipe((claim) => (claim._tag === "Some" ? claim.value.says : "")) };
  const base = { name: each.name, proves, given: each.given.name, calls };
  if (Exit.isSuccess(exit)) return { ...base, outcome: "passed", failedWith: null, detail: "" };
  const error = Cause.findError(exit.cause);
  if (error._tag === "Failure") return { ...base, outcome: "died", failedWith: null, detail: Cause.pretty(exit.cause) };
  const failure = error.success;
  const detail =
    failure._tag === "ExpectationFailed"
      ? failure.message
      : failure._tag === "NotImplemented"
        ? `${failure.operation} answered NotImplemented`
        : `failed with ${failure._tag}`;
  return { ...base, outcome: "failed", failedWith: failure._tag, detail };
};

const fellOnEmptyHandler = (result: Result): boolean =>
  result.outcome === "failed" &&
  result.calls.length > 0 &&
  (result.failedWith === "NotImplemented" ||
    (result.failedWith === "ExpectationFailed" && Str.includes("NotImplemented")(result.detail)));

test("every scenario fails against the empty handlers, on the NotImplemented they answer", async () => {
  const results: Array<Result> = [];
  for (const each of scenarios) results.push(await run(each));
  const wrong = Arr.filter(results, (result) => !fellOnEmptyHandler(result));
  const byOperation: Record<string, number> = {};
  for (const result of results)
    if (result.proves !== null) byOperation[result.proves.operation] = (byOperation[result.proves.operation] ?? 0) + 1;
  const record = {
    record: "empty-handlers",
    step: "1.5",
    what: "Every registered scenario run against a Capxul whose every operation fails with NotImplemented, as Core's empty handlers do. Each must reach the door and fail on the NotImplemented it is answered, never pass and never die.",
    outcome: wrong.length === 0 ? "passed" : "failed",
    scenarios: results.length,
    claims: Arr.filter(results, (result) => result.proves !== null).length,
    byOperation,
    results,
  };
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (process.env["CAPXUL_WRITE_RECORD"] === "1") writeFileSync(RECORD, text);
  assert.deepEqual(
    Arr.map(wrong, (result) => `${result.name}: ${result.outcome} ${result.detail}`),
    [],
    "scenarios that did not fail on the empty handlers",
  );
  assert.equal(
    readFileSync(RECORD, "utf8"),
    text,
    "records/empty-handlers.json differs from this run; run `pnpm --filter @capxul/scenarios record` to write it",
  );
});
