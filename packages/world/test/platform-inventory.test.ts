// An operator's inventory as the platform serves it (src/platform/inventory.ts): world.list, world.snapshot.list and
// world.snapshot.delete, and world.snapshot.save's refusal to replace a snapshot in use. Each runs against an
// in-memory shared state and stand-ins for Neon, the registry, each world's database and the hub (platform-stand-in.ts).
//
// The first operator owns `alpha`, with two snapshots (`base`, a template, then `scratch`), the parked `beta`, and a
// name still being made (`half`); the second owns `gamma`, restored from `base`, so its branch hangs from base's.
import * as assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { hangingFrom } from "../src/platform/branches.ts";
import { instantOf } from "../src/platform/facts.ts";
import { list, savedOf, snapshotDelete, snapshotList } from "../src/platform/inventory.ts";
import { save } from "../src/platform/snapshots.ts";
import type { SnapshotRow } from "../src/platform/store.ts";
import { FAR, type Needs, type Outside, recordOf, runAs, WORLD_MS } from "./platform-stand-in.ts";

const snapshot = (
  name: string,
  branch: string,
  recordSeq: number,
  savedAt: string,
  template: boolean,
): SnapshotRow => ({
  stage: "w-alpha",
  snapshot: name,
  branch_id: branch,
  record_seq: recordSeq,
  clock_mode: "frozen",
  clock_ms: WORLD_MS,
  template,
  saved_at: savedAt,
  companies: 0,
  migrations: "0004_documents",
});

const BASE = snapshot("base", "br-base", 3, "2026-11-15T10:01:00.000Z", true);
const SCRATCH = snapshot("scratch", "br-scratch", 4, "2026-11-15T10:02:00.000Z", false);
const PARENT = { world: "alpha", snapshot: "base", recordSeq: 3 };

const worlds = {
  "w-alpha": recordOf("w-alpha", "first", "br-alpha"),
  "w-beta": recordOf("w-beta", "first", "br-beta", "parked"),
  "w-gamma": recordOf("w-gamma", "second", "br-gamma"),
};

let outside: Outside;

beforeEach(() => {
  outside = {
    claims: [
      { name: "w-beta", owner: "first" },
      { name: "w-alpha", owner: "first" },
      { name: "w-half", owner: "first" },
      { name: "w-gamma", owner: "second" },
    ],
    // Scratch saved after base; the stand-in answers them in the order saved, whatever order they are kept in.
    snapshots: [SCRATCH, BASE],
    branches: [
      { id: "br-root", name: "registry" },
      { id: "br-alpha", name: "w-alpha", parent_id: "br-root" },
      { id: "br-beta", name: "w-beta", parent_id: "br-root" },
      { id: "br-base", name: "snap-w-alpha-base-1f", parent_id: "br-alpha" },
      { id: "br-scratch", name: "snap-w-alpha-scratch-2e", parent_id: "br-alpha" },
      { id: "br-gamma", name: "w-gamma", parent_id: "br-base" },
    ],
    databases: {
      "br-alpha": { head: 5, appended: [], born: { grade: "private", parent: null } },
      "br-beta": { head: 1, appended: [], born: { grade: "private", parent: null } },
      "br-gamma": { head: 4, appended: [], born: { grade: "private", parent: PARENT } },
    },
    forgotten: [],
    oldHub: false,
    bench: [],
  };
});

const as = <A, E>(operator: string, program: Effect.Effect<A, E, Needs>) => runAs(outside, worlds, operator, program);

/** What a refused call failed with. */
const refusal = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flip(effect);

describe("world.list", () => {
  test("answers the caller's worlds by name, each as world.show shows it, with its count of snapshots", async () => {
    const first = await as("first", list());
    assert.deepStrictEqual(first, {
      owner: "first",
      limit: 5,
      worlds: [
        {
          world: "alpha",
          grade: "private",
          state: "running",
          expiresAt: FAR,
          door: "https://core-w-alpha.test",
          parent: null,
          snapshots: 2,
        },
        {
          world: "beta",
          grade: "private",
          state: "parked",
          expiresAt: FAR,
          door: "https://core-w-beta.test",
          parent: null,
          snapshots: 0,
        },
      ],
    });
  });
  test("holds no other operator's world, and names where a restored world came from", async () => {
    const second = await as("second", list());
    assert.deepStrictEqual(
      Arr.map(second.worlds, (world) => [world.world, world.parent, world.snapshots]),
      [["gamma", PARENT, 0]],
    );
    assert.deepStrictEqual((await as("nobody", list())).worlds, []);
  });
});

describe("world.snapshot.list", () => {
  test("lists the world's snapshots in the order saved, as each save answered, with the worlds hanging from each", async () => {
    const listed = await as("first", snapshotList({ world: "alpha" }));
    assert.deepStrictEqual(listed, {
      world: "alpha",
      snapshots: [
        { ...savedOf("alpha", BASE), inUseBy: ["gamma"] },
        { ...savedOf("alpha", SCRATCH), inUseBy: [] },
      ],
    });
    assert.deepStrictEqual(listed.snapshots[0]?.clock, { mode: "frozen", now: instantOf(WORLD_MS) });
    assert.deepStrictEqual(outside.databases["br-alpha"]?.appended, []);
  });
  test("names the snapshot's own world once it was reset to it in place", async () => {
    outside.branches = Arr.map(outside.branches, (branch) =>
      branch.id === "br-alpha" ? { ...branch, parent_id: "br-base" } : branch,
    );
    const listed = await as("first", snapshotList({ world: "alpha" }));
    assert.deepStrictEqual(listed.snapshots[0]?.inUseBy, ["alpha", "gamma"]);
  });
  test("is refused to another operator and of a world that does not exist", async () => {
    const other = await as("second", refusal(snapshotList({ world: "alpha" })));
    assert.deepStrictEqual(
      [other._tag, other.world, "owner" in other && other.owner],
      ["NotWorldOwner", "alpha", "first"],
    );
    const unknown = await as("first", refusal(snapshotList({ world: "nobody" })));
    assert.deepStrictEqual([unknown._tag, unknown.world], ["WorldNotFound", "nobody"]);
  });
});

describe("world.snapshot.delete", () => {
  test("removes what the save made, forgets it and records it, and answers it as it was saved", async () => {
    const deleted = await as("first", snapshotDelete({ world: "alpha", snapshot: "scratch" }));
    assert.deepStrictEqual(deleted, savedOf("alpha", SCRATCH));
    assert.ok(!Arr.some(outside.branches, (branch) => branch.id === "br-scratch"), "the branch is deleted");
    assert.deepStrictEqual(outside.forgotten, ["scratch"]);
    assert.deepStrictEqual(outside.snapshots, [BASE]);
    assert.deepStrictEqual(outside.databases["br-alpha"]?.appended, [
      { event: "snapshot_deleted", carried: { world: "alpha", snapshot: "scratch", recordSeq: 4 } },
    ]);
    const again = await as("first", refusal(snapshotDelete({ world: "alpha", snapshot: "scratch" })));
    assert.deepStrictEqual([again._tag, "snapshot" in again && again.snapshot], ["SnapshotNotFound", "scratch"]);
  });
  test("refuses a snapshot a live world hangs from, naming it, and changes nothing", async () => {
    const before = structuredClone({ branches: outside.branches, snapshots: outside.snapshots });
    const refused = await as("first", refusal(snapshotDelete({ world: "alpha", snapshot: "base" })));
    assert.deepStrictEqual(
      [refused._tag, refused.world, "snapshot" in refused && refused.snapshot, "worlds" in refused && refused.worlds],
      ["SnapshotInUse", "alpha", "base", ["gamma"]],
    );
    assert.deepStrictEqual({ branches: outside.branches, snapshots: outside.snapshots }, before);
    assert.deepStrictEqual(outside.forgotten, []);
    assert.deepStrictEqual(outside.databases["br-alpha"]?.appended, []);
  });
  test("refuses another operator, a snapshot never saved and a world that does not exist", async () => {
    const other = await as("second", refusal(snapshotDelete({ world: "alpha", snapshot: "scratch" })));
    assert.deepStrictEqual([other._tag, "owner" in other && other.owner], ["NotWorldOwner", "first"]);
    const never = await as("first", refusal(snapshotDelete({ world: "alpha", snapshot: "m9" })));
    assert.equal(never._tag, "SnapshotNotFound");
    const unknown = await as("first", refusal(snapshotDelete({ world: "nobody", snapshot: "scratch" })));
    assert.equal(unknown._tag, "WorldNotFound");
    assert.equal(outside.snapshots.length, 2);
    assert.deepStrictEqual(outside.databases["br-alpha"]?.appended, []);
  });
  test("on a hub from before a chain state could be forgotten, leaves that state for the world's end", async () => {
    outside.oldHub = true;
    await as("first", snapshotDelete({ world: "alpha", snapshot: "scratch" }));
    assert.deepStrictEqual(outside.forgotten, []);
    assert.deepStrictEqual(outside.snapshots, [BASE]);
  });
});

test("world.snapshot.delete of a snapshot of companies forgets what it saved of their sites on the bench", async () => {
  outside.snapshots = [{ ...SCRATCH, companies: 1 }, BASE];
  const benched = { ...worlds, "w-alpha": recordOf("w-alpha", "first", "br-alpha", undefined, "local") };
  await runAs(outside, benched, "first", snapshotDelete({ world: "alpha", snapshot: "scratch" }));
  assert.deepStrictEqual(outside.bench, ["DELETE /world/backup/scratch", "DELETE /world/points/scratch"]);
  assert.deepStrictEqual(outside.snapshots, [BASE]);
});

describe("world.snapshot.save", () => {
  test("refuses to replace a snapshot a live world hangs from", async () => {
    const refused = await as(
      "first",
      refusal(save({ world: "alpha", snapshot: "base", replace: true, template: true })),
    );
    assert.deepStrictEqual([refused._tag, "worlds" in refused && refused.worlds], ["SnapshotInUse", ["gamma"]]);
    assert.ok(Arr.some(outside.branches, (branch) => branch.id === "br-base"));
  });
});

describe("which worlds hang from a branch", () => {
  const worldsOf = [
    { stage: "w-a", branch: "br-a" },
    { stage: "w-a-pre", branch: "br-ap" },
    { stage: "w-b", branch: undefined },
  ];
  test("a world's own branch, by id, whatever it is called", () => {
    assert.deepStrictEqual(hangingFrom("p", [{ id: "br-a", name: "renamed", parent_id: "p" }], worldsOf), ["w-a"]);
  });
  test("a branch an in-place reset preserved belongs to the world it names, the longest name first", () => {
    const branches = [
      { id: "x1", name: "w-a-pre-1f", parent_id: "p" },
      { id: "x2", name: "w-a-pre-pre-2", parent_id: "p" },
      { id: "x3", name: "w-b-pre-3", parent_id: "p" },
    ];
    assert.deepStrictEqual(hangingFrom("p", branches, worldsOf), ["w-a", "w-a-pre", "w-b"]);
  });
  test("a branch of no world, and a branch hanging elsewhere, name none", () => {
    const branches = [
      { id: "x1", name: "someone-else", parent_id: "p" },
      { id: "br-a", name: "w-a", parent_id: "q" },
    ];
    assert.deepStrictEqual(hangingFrom("p", branches, worldsOf), []);
  });
});
