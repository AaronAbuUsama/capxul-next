// Journey 1: two operators and their worlds. The first operator is at the limit of live worlds; the second opens a
// world of their own, shows it, keeps its record to themselves, and saves and restores it, while every request that
// cannot be done is refused and makes nothing.
import { startingWorlds } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Payload } from "../client.ts";
import { expect, given } from "../expectation.ts";
import { journey, outline } from "../journey.ts";
import { hostNow, millis, present, same } from "../support/expect.ts";
import { freshName, LIMITS, operators, type View } from "../support/world.ts";

const LONG_AGO = "2000-01-01T00:00:00Z";
const SECOND = 1000;
const MINUTE = 60_000;

const steps = outline({
  quota: ["world.create", "the first operator, at the limit of live worlds, is refused another"],
  refused: ["world.create", "the second operator is refused a real world, and one that starts before the seeded chain"],
  open: [
    "world.create",
    "the second operator opens a world halfway between the seed and host time, and cannot open it twice",
  ],
  show: [
    "world.show",
    "the platform shows the new world as it was made, the first operator's as theirs, and no world for an unknown name",
  ],
  record: [
    "record.export",
    "the owner reads the new world's record; each person of its cast is signed in at its door, and refused it",
  ],
  warp: ["world.clock.warp", "dana, a person of the world, may not move its clock"],
  save: [
    "world.snapshot.save",
    "only the owner saves a snapshot, of a world that exists: m3 and draft are saved, and m3 not twice",
  ],
  restore: ["world.snapshot.restore", "restores that cannot be made are refused, and make nothing"],
});

/** A private world with a frozen clock that lives an hour. */
const asked = (world: string, startAt: string | null = null): Payload<"world.create"> => ({
  world,
  grade: "private",
  lifetimeMinutes: 60,
  clock: { mode: "frozen", startAt },
});

/** Halfway between `earliest` and `now`, to the whole second a chain's block time keeps. */
const halfway = (earliest: string, now: string) =>
  DateTime.formatIso(DateTime.makeUnsafe(Math.floor((millis(earliest) + millis(now)) / 2 / SECOND) * SECOND));

/** Minutes from now to two minutes before `source` expires, and at least one. */
const lifetimeWithin = (source: View) =>
  Effect.map(hostNow, (now) => Math.max(1, Math.floor((millis(source.expiresAt) - millis(now)) / MINUTE) - 2));

const first = { operator: "first" } as const;
const second = { operator: "second" } as const;
const everyRecord = { from: null, to: null } as const;

export const twoOperators = journey(
  {
    name: "two operators and their worlds",
    key: "twoop",
    story:
      "An operator at the limit of live worlds is refused another; a second operator opens one, shows it, keeps its record to themselves, saves it and cannot restore it where no restore may be made.",
    given: startingWorlds.quotaFull,
    steps,
  },
  Effect.gen(function* () {
    const facts = yield* given(startingWorlds.quotaFull);
    const [refusedName, name, unknown, missing, restoredName] = yield* Effect.all([
      freshName("jq"),
      freshName("jw"),
      freshName("none"),
      freshName("none"),
      freshName("jr"),
    ]);

    yield* steps.quota.run((op) => op.refused("WorldQuotaReached", asked(refusedName), first));

    const early = yield* steps.refused.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("GradeNotOffered", { ...asked(name), grade: "real" }, second);
        return yield* op.refused("ClockBeforeSeed", asked(name, LONG_AGO), second);
      }),
    );

    const made = yield* steps.open.run((op) =>
      Effect.gen(function* () {
        const now = yield* hostNow;
        const start = halfway(early.earliest, now);
        yield* expect(millis(start) < millis(now), `halfway to host time, ${start}, is not before it, ${now}`);
        const opened = yield* op.succeeds(asked(name, start), second);
        yield* op.refused("WorldExists", asked(name, start), second);
        return opened;
      }),
    );
    const there = { at: made.door, operator: "second" } as const;
    const save = (snapshot: string, replace: boolean, template: boolean) => ({
      world: made.world,
      snapshot,
      replace,
      template,
    });

    yield* steps.show.run((op) =>
      Effect.gen(function* () {
        const named = yield* operators;
        yield* same("the second operator's world, shown", yield* op.succeeds({ world: made.world }, second), made);
        const theirs = yield* present("a world the first operator filled", Option.getOrNull(Arr.head(facts.filled)));
        const shown = yield* op.succeeds({ world: theirs.world });
        yield* same("the first operator's world, shown", [shown.owner, shown.door], [named.first, theirs.door]);
        yield* op.refused("WorldNotFound", { world: unknown });
      }),
    );

    yield* steps.record.run((op) =>
      Effect.gen(function* () {
        yield* op.succeeds(everyRecord, there);
        for (const person of made.cast)
          yield* op.refused("NotWorldOwner", everyRecord, { ...there, as: person.person });
      }),
    );

    yield* steps.warp.run((op) =>
      op.refused("NotWorldOwner", { target: { _tag: "by", seconds: 3600 } }, { ...there, as: "dana" }),
    );

    yield* steps.save.run((op) =>
      Effect.gen(function* () {
        yield* op.refused("NotWorldOwner", save("m3", false, true), first);
        yield* op.refused("WorldNotFound", { ...save("m3", false, true), world: missing }, second);
        const m3 = yield* op.succeeds(save("m3", false, true), second);
        yield* op.refused("SnapshotExists", save("m3", false, true), second);
        const replaced = yield* op.succeeds(save("m3", true, true), second);
        yield* expect(
          replaced.recordSeq > m3.recordSeq,
          `the replaced m3 holds position ${replaced.recordSeq}, not after ${m3.recordSeq}`,
        );
        yield* op.succeeds(save("draft", false, false), second);
      }),
    );

    yield* steps.restore.run((op) =>
      Effect.gen(function* () {
        const lifetimeMinutes = yield* lifetimeWithin(made);
        const restore = (snapshot: string, as: string, minutes = lifetimeMinutes) => ({
          world: made.world,
          snapshot,
          as,
          lifetimeMinutes: minutes,
        });
        yield* op.refused("SnapshotNotFound", restore("m9", restoredName), second);
        yield* op.refused("WorldExists", restore("m3", made.world), second);
        yield* op.refused("ExpiryBeyondSource", restore("m3", restoredName, LIMITS.lifetimeMinutes), second);
        yield* op.refused("WorldQuotaReached", restore("m3", restoredName), first);
      }),
    );
  }),
);
