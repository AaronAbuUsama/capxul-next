// Every journey fails against Core's empty handlers, which answer every call with the blueprint's NotImplemented,
// at its first step, on that refusal, and none passes or dies (roadmap step 1.14; the deployed run is the runner's).
// Each journey runs against a Capxul whose every function fails so, and is handed its starting world's example facts.
//
// The record of this is one file per journey, records/empty-handlers/<journey>.json, so two slices that each add a
// journey write different files. This test writes them: `pnpm --filter @capxul/scenarios record` writes every one and
// removes any no registered journey has, and every other run fails when the folder differs from what the run finds,
// so they are never edited by hand.
import { strict as assert } from "node:assert";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { Errors, operations, type OperationName } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Random from "effect/Random";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import { Capxul, Given, journeys, Steps, type CapxulClient, type Journey } from "../src/door.ts";

const RECORDS = new URL("../records/empty-handlers/", import.meta.url);

/** A journey's record file: its name in lower case, each run of other characters a dash. */
const fileOf = (name: string): string =>
  `${Arr.join(Arr.filter(Str.split(Str.toLowerCase(name), /[^a-z0-9]+/), Str.isNonEmpty), "-")}.json`;

const ZERO = "0x0000000000000000000000000000000000000000";

/** A chain on which nothing an operation does has happened. Reads are not operations: they are not in `calls`. */
const emptyChain: CapxulClient["chain"] = {
  head: () => Effect.succeed({ number: 0, timestamp: "2026-11-13T09:00:00.000Z", hash: `0x${Str.repeat(64)("0")}` }),
  balance: () => Effect.succeed("0"),
  safe: () => Effect.succeed({ owners: [], threshold: 0, nonce: 0 }),
  hat: () => Effect.succeed({ details: "", maxSupply: 0, supply: 0, active: false }),
  wears: () => Effect.succeed(false),
  companySafeFor: () => Effect.succeed(ZERO),
  budget: () => Effect.succeed(null),
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
    ...Rec.map(operations, (_, operation) => empty(operation)),
    chain: emptyChain,
  };
};

interface Result {
  readonly name: string;
  readonly given: string;
  readonly steps: number;
  /** The steps it began, each with what it ended with. */
  readonly began: ReadonlyArray<{ readonly step: number; readonly operation: string; readonly failure: string | null }>;
  /** The operations it called, in order, each answered NotImplemented. */
  readonly calls: ReadonlyArray<string>;
  readonly outcome: "failed" | "passed" | "died";
  readonly failedWith: string | null;
  readonly detail: string;
}

const run = async (each: Journey): Promise<Result> => {
  const calls: Array<string> = [];
  const began: Array<{ step: number; operation: string; failure: string | null }> = [];
  const steps = {
    begin: (step: number, outline: { readonly operation: string }) =>
      Effect.sync(() => began.push({ step, operation: outline.operation, failure: null })),
    tried: () => Effect.void,
    end: (step: number, failure: string | null) =>
      Effect.sync(() => {
        for (const entry of began) if (entry.step === step) entry.failure = failure;
      }),
  };
  const exit = await Effect.runPromiseExit(
    each.run.pipe(
      Effect.provideService(Capxul, emptyHandlers(calls)),
      Effect.provideService(Given, { world: each.given, facts: Effect.succeed(each.given.example) }),
      Effect.provideService(Steps, steps),
      Random.withSeed(each.name),
      Effect.timeout("10 seconds"),
    ),
  );
  const base = { name: each.name, given: each.given.name, steps: each.outline.length, began, calls };
  if (Exit.isSuccess(exit)) return { ...base, outcome: "passed", failedWith: null, detail: "" };
  const error = Cause.findError(exit.cause);
  if (error._tag === "Failure") return { ...base, outcome: "died", failedWith: null, detail: Cause.pretty(exit.cause) };
  const failure = error.success;
  const detail = failure._tag === "NotImplemented" ? `${failure.operation} answered NotImplemented` : failure._tag;
  return { ...base, outcome: "failed", failedWith: failure._tag, detail };
};

/** Failed at its first step, the one step it began, on the NotImplemented its own operation was answered. */
const fellAtFirstStep = (result: Result): boolean =>
  result.outcome === "failed" &&
  result.failedWith === "NotImplemented" &&
  result.calls.length > 0 &&
  result.began.length === 1 &&
  result.began[0]?.step === 1 &&
  result.began[0]?.failure !== null &&
  result.detail === `${result.began[0]?.operation} answered NotImplemented`;

test("every journey fails at its first step against the empty handlers, on the NotImplemented they answer", async () => {
  const results: Array<Result> = [];
  for (const each of journeys) results.push(await run(each));
  const wrong = Arr.filter(results, (result) => !fellAtFirstStep(result));
  const records = Arr.map(results, (result) => ({
    file: fileOf(result.name),
    text: `${JSON.stringify(
      {
        kind: "empty-handlers",
        step: "1.14",
        what: "A registered journey run against a Capxul whose every operation fails with NotImplemented, as Core's empty handlers do. It must fail at its first step, on the NotImplemented it is answered, never pass and never die.",
        outcome: fellAtFirstStep(result) ? "passed" : "failed",
        result,
      },
      null,
      2,
    )}\n`,
  }));
  const files = Arr.map(records, (each) => each.file);
  assert.deepEqual(Arr.dedupe(files), files, "two journeys' names make one record file");
  if (process.env["CAPXUL_WRITE_RECORD"] === "1") {
    mkdirSync(RECORDS, { recursive: true });
    for (const stale of readdirSync(RECORDS)) if (!Arr.contains(files, stale)) rmSync(new URL(stale, RECORDS));
    for (const each of records) writeFileSync(new URL(each.file, RECORDS), each.text);
  }
  assert.deepEqual(
    Arr.map(wrong, (result) => `${result.name}: ${result.outcome} ${result.detail}`),
    [],
    "journeys that did not fail at their first step on the empty handlers",
  );
  const write = "run `pnpm record` in this package to write them";
  assert.deepEqual(
    Arr.sort(readdirSync(RECORDS), Order.String),
    Arr.sort(files, Order.String),
    `records/empty-handlers/ holds a record of no registered journey, or lacks one; ${write}`,
  );
  for (const each of records)
    assert.equal(
      readFileSync(new URL(each.file, RECORDS), "utf8"),
      each.text,
      `records/empty-handlers/${each.file} differs from this run; ${write}`,
    );
});
