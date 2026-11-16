// world.snapshot.save against the stand-ins (platform-stand-in.ts; roadmap 4.8, the world track's B-2): a world's
// sites are saved beside its data, not before it, so a save finishes when the bench's door answers its backup only
// once the hub has been asked to save the chain; Ponder is stopped before the branch and started again after the
// chain's save, whatever fails; the save's `sites` and `chain` steps overlap; Neon's 423 waits are each a span of
// their own; and no more than 2 of Neon's branch requests are in flight at once. Structural only, never about speed.
import * as assert from "node:assert/strict";
import { test } from "node:test";
import { World as Declared } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Rec from "effect/Record";
import * as Str from "effect/String";
import * as Tracer from "effect/Tracer";
import { save } from "../src/account/snapshots.ts";
import { type Needs, type Outside, recordOf, runAs } from "./platform-stand-in.ts";

const saveSpans = Declared.snapshotSave.spans;
const createSpans = Declared.create.spans;

/** A world of the first operator's, its branch `br-<name>`, on the local bench, its branch already forkable. */
const worldOf = (name: string) => ({
  ...recordOf(`w-${name}`, "first", `br-${name}`, undefined, "local"),
  neonExpiry: "lifted so that snapshots could be saved",
});

const NORTHWIND = {
  org: "org_northwind1",
  handle: "northwind",
  name: "Northwind",
  site_state: "ready",
  site_url: null,
};

/** The stand-ins for worlds `names`, each with one company unless `companies` is false; every save step kept. */
const outsideOf = (names: ReadonlyArray<string>, more: Partial<Outside> = {}, companies = true): Outside => ({
  claims: Arr.map(names, (name) => ({ name: `w-${name}`, owner: "first" })),
  snapshots: [],
  branches: [
    { id: "br-root", name: "registry" },
    ...Arr.map(names, (name) => ({ id: `br-${name}`, name: `w-${name}`, parent_id: "br-root" })),
  ],
  databases: Rec.fromEntries(
    Arr.map(names, (name) => [
      `br-${name}`,
      {
        head: 5,
        appended: [],
        born: { grade: "private", parent: null },
        ...(companies ? { companies: [NORTHWIND] } : {}),
      },
    ]),
  ),
  forgotten: [],
  oldHub: false,
  bench: [],
  saving: [],
  ...more,
});

interface Ended {
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Runs `program` as the first operator over `outside`'s worlds, every span kept as it ends; fails after `within`. */
const saving = <A, E>(outside: Outside, program: Effect.Effect<A, E, Needs>, within: Duration.Input = "6 seconds") => {
  const ended: Array<Ended> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        ended.push({
          name: options.name,
          startMs: Number(options.startTime) / 1_000_000,
          endMs: Number(endTime) / 1_000_000,
        });
      };
      return span;
    },
  });
  const worlds = Rec.fromEntries(
    Arr.map(outside.claims, (claim) => [claim.name, worldOf(Str.slice(2)(claim.name))] as const),
  );
  return runAs(
    outside,
    worlds,
    "first",
    program.pipe(Effect.timeout(within), Effect.exit, Effect.withTracer(tracer)),
  ).then((exit) => ({ exit, ended }));
};

const saveOf = (world: string, snapshot = "m3") => save({ world, snapshot, replace: false, template: false });

const stepsOf = (outside: Outside) => outside.saving ?? [];
const at = (outside: Outside, step: string) => stepsOf(outside).indexOf(step);

test("a world with a company is saved when the bench holds its backup until the hub saves the chain", async () => {
  const outside = outsideOf(["alpha"], { holdSitesSave: true });
  const { exit } = await saving(outside, saveOf("alpha"));
  assert.ok(Exit.isSuccess(exit), `the save finished: ${String(exit)}`);
  assert.ok(
    at(outside, "chain save m3") < at(outside, "sites saved m3"),
    "the chain was asked for while the sites saved",
  );
});

test("Ponder is stopped before the branch and started again after the chain's save", async () => {
  const outside = outsideOf(["alpha"], {}, false);
  const { exit } = await saving(outside, saveOf("alpha"));
  assert.ok(Exit.isSuccess(exit), String(exit));
  const order = Arr.filter(stepsOf(outside), (step) =>
    Arr.contains(["index stop", "branch", "chain save m3", "index resume"], step),
  );
  assert.deepEqual(order, ["index stop", "branch", "chain save m3", "index resume"]);
});

test("Ponder is started again when the chain's save fails", async () => {
  const outside = outsideOf(["alpha"], { failChain: true }, false);
  const { exit } = await saving(outside, saveOf("alpha"));
  assert.ok(Exit.isFailure(exit), "the save fails");
  assert.ok(
    at(outside, "index resume") > at(outside, "chain save m3"),
    `resumed after: ${Arr.join(stepsOf(outside), ", ")}`,
  );
});

test("Ponder is started again when the branch cannot be made", async () => {
  const outside = outsideOf(["alpha"], { failBranch: true }, false);
  const { exit } = await saving(outside, saveOf("alpha"));
  assert.ok(Exit.isFailure(exit), "the save fails");
  assert.deepEqual(
    Arr.filter(stepsOf(outside), (step) => step === "index stop" || step === "index resume"),
    ["index stop", "index resume"],
  );
});

test("a save's sites step and its chain step overlap", async () => {
  const outside = outsideOf(["alpha"], { holdSitesSave: true });
  const { exit, ended } = await saving(outside, saveOf("alpha"));
  assert.ok(Exit.isSuccess(exit), String(exit));
  const sites = Arr.findFirst(ended, (span) => span.name === saveSpans.sites.name);
  const chain = Arr.findFirst(ended, (span) => span.name === saveSpans.chain.name);
  assert.ok(sites._tag === "Some" && chain._tag === "Some", "both steps are spans");
  assert.ok(
    sites.value.startMs < chain.value.endMs && chain.value.startMs < sites.value.endMs,
    "the sites are saved while the chain is",
  );
});

test("every 423 of Neon's is a world.create.branch.locked span", async () => {
  const outside = outsideOf(["alpha"], { neonLocked: 2 }, false);
  const { exit, ended } = await saving(outside, saveOf("alpha"), "10 seconds");
  assert.ok(Exit.isSuccess(exit), String(exit));
  assert.equal(Arr.filter(stepsOf(outside), (step) => step === "branch locked").length, 2);
  assert.equal(Arr.filter(ended, (span) => span.name === createSpans.branchLocked.name).length, 2, "one span a wait");
});

test("no more than 2 of Neon's branch requests are in flight at once", async () => {
  const outside = outsideOf(["alpha", "beta", "gamma"], { neonHoldMs: 150 }, false);
  const { exit } = await saving(
    outside,
    Effect.all([saveOf("alpha"), saveOf("beta"), saveOf("gamma")], { concurrency: "unbounded" }),
  );
  assert.ok(Exit.isSuccess(exit), String(exit));
  assert.equal(outside.neonInFlight?.most, 2, "two permits: the third waits");
});
