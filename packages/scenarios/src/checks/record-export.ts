// The checks of every record.export (claims.md, record.export 1 to 4): the record is the world's events, each entry
// once, in order, carrying exactly its event's fields; a range answers only the positions asked; a world made from a
// snapshot holds its parent's entries up to it, then its own birth; the events of every call made in making the
// starting world, and of the journey's own calls, are in it, in order; only the world's owner may read it.
import { startingWorlds, type CallOptions } from "@capxul/blueprint";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import type { Success } from "../client.ts";
import { expect, given } from "../expectation.ts";
import { Journal, type Made } from "../journal.ts";
import { present, same } from "../support/expect.ts";
import { carriesExactly, entriesOfCall, expectedOf, holdsInOrder } from "../support/record.ts";
import { fieldOf, operatorName, ownerOf, recordOf, textOf, view, whereOf, type Entry } from "../support/world.ts";
import { check, checks } from "./format.ts";

type Exported = Success<"record.export">;

const pick = (entries: ReadonlyArray<Entry>) => Arr.map(entries, (each) => [each.seq, each.event, each.carried]);

/** The calls made in making the starting world left their events, and none of anyone else's. */
const madeCallsIn = (exported: Exported) =>
  Effect.gen(function* () {
    const { calls } = yield* given(startingWorlds.nothing);
    let last = 0;
    for (const call of calls) {
      const under = Arr.filter(exported.entries, (entry) => entry.trace === call.trace);
      const expected = yield* entriesOfCall(call);
      const held = Arr.map(under, (entry) => ({ event: entry.event, carried: entry.carried }));
      // A call in another world (the template a world was restored from) left its events there; a restore copies
      // only those up to the snapshot. A call in this world left exactly its own.
      if (call.world === exported.world || under.length > 0)
        yield* same(`the entries of the ${call.operation} call ${call.trace} (${call.outcome})`, held, expected);
      for (const entry of under) {
        yield* expect(entry.seq > last, `entry ${entry.seq} of ${call.operation} ${call.trace} is out of call order`);
        last = entry.seq;
      }
    }
  });

/** The door a successful call of the journey left its events behind: its world's, or a new world's. */
const doorOf = (made: Made): string | null | undefined => {
  if (made.operation === "world.create" || made.operation === "world.snapshot.restore")
    return Predicate.hasProperty(made.success, "door") && Predicate.isString(made.success.door)
      ? made.success.door
      : undefined;
  if (made.operation === "world.snapshot.save" || made.operation === "world.show") return undefined;
  return made.options.at ?? null;
};

/** The journey's own calls at this door left their declared events in the record, in the order they were made. */
const journeyCallsIn = (exported: Exported, options: CallOptions) =>
  Effect.gen(function* () {
    const journal = yield* Journal;
    const made = yield* Ref.get(journal.made);
    const door = options.at ?? null;
    const here = Arr.filter(made, (each) => doorOf(each) === door);
    const expected = yield* Effect.forEach(here, expectedOf);
    yield* holdsInOrder(
      Arr.map(exported.entries, (entry) => ({ event: entry.event, carried: entry.carried })),
      Arr.flatten(expected),
    );
  });

export const recordExport = checks<"record.export", void>({
  before: () => Effect.void,
  success: (asked, exported) => {
    const whole = asked.payload.from === null && asked.payload.to === null;
    const from = asked.payload.from ?? 1;
    const to = Math.min(asked.payload.to ?? exported.head, exported.head);
    return [
      check(
        "it answers the positions asked, each once, in order: none past the head",
        same(
          "the entries' positions",
          Arr.map(exported.entries, (entry) => entry.seq),
          from > to ? [] : Arr.range(from, to),
        ),
      ),
      check(
        "every entry names an event the blueprint declares and carries exactly its fields",
        Effect.forEach(exported.entries, carriesExactly, { discard: true }),
      ),
      ...(whole
        ? [
            check(
              "a world made from a snapshot holds its parent's entries up to it, then its own world_created",
              Effect.gen(function* () {
                if (exported.lineage === null) return;
                const lineage = exported.lineage;
                const parent = yield* view(lineage.world);
                const theirs = yield* recordOf(yield* ownerOf(parent));
                yield* same(
                  `the entries up to ${lineage.recordSeq}, against ${lineage.world}'s`,
                  pick(Arr.take(exported.entries, lineage.recordSeq)),
                  pick(Arr.take(theirs.entries, lineage.recordSeq)),
                );
                const born = yield* present(
                  "the entry after the snapshot",
                  Option.getOrNull(Arr.get(exported.entries, lineage.recordSeq)),
                );
                yield* same("the entry after the snapshot", born.event, "world_created");
                yield* same(
                  "the world and parent it names",
                  [textOf(born.carried, "world"), fieldOf(born.carried, "parent")],
                  [exported.world, lineage],
                );
              }),
            ),
            check(
              "the calls made in making the starting world left their events in it, in the order they were made",
              madeCallsIn(exported),
            ),
            check(
              "the journey's own calls at this door left their events in it, in the order they were made",
              journeyCallsIn(exported, asked.options),
            ),
          ]
        : []),
    ];
  },
  refusals: {
    NotWorldOwner: (asked, refused) => [
      check(
        "NotWorldOwner names the world and its owner, and the caller is not the owner",
        Effect.gen(function* () {
          const shown = yield* view(refused.world);
          yield* same("NotWorldOwner's owner", refused.owner, shown.owner);
          const record = yield* recordOf(whereOf(asked.options));
          yield* same("the world at that door", refused.world, record.world);
          const caller = asked.options.as ?? (yield* operatorName(asked.options));
          yield* expect(caller !== shown.owner, `the owner ${caller} was refused as not the owner`);
        }),
      ),
    ],
    ExportNotAllowed: (_asked, refused) => [
      check("ExportNotAllowed names a real world", same("its grade", refused.grade, "real")),
    ],
  },
});
