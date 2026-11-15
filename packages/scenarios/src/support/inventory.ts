// Reading what an operator has on the platform: their worlds and a world's snapshots, as looks. A platform operation
// takes no `at`, so a look at a world's snapshots signs in as the operator who owns it and names no door.
import type { CallOptions, World } from "@capxul/blueprint";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Struct from "effect/Struct";
import { Capxul } from "../client.ts";
import { ownerOf, recordOf, viewOrNone, type View, type Who } from "./world.ts";

export type Listed = typeof World.ListedSnapshot.Type;
export type Snapshot = typeof World.Snapshot.Type;

/** A look's options for a platform operation: the operator of `who`, and no door. */
export const platformAs = (who: Who): CallOptions => (who.operator === undefined ? {} : { operator: who.operator });

/** world.snapshot.list of a world, as `who`. */
export const snapshotsOf = (world: string, who: Who) =>
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const answer = yield* capxul["world.snapshot.list"]({ world }, platformAs(who));
    return answer.snapshots;
  });

/** A listed snapshot as its save answered it: without the worlds that hang from it. */
export const asSaved = (listed: Listed): Snapshot => Struct.omit(listed, ["inUseBy"]);

/** A world read before a call on its snapshots: its view, its owner, its record head and its snapshots. */
export interface Held {
  readonly world: View;
  readonly owner: Who;
  readonly head: number;
  readonly snapshots: ReadonlyArray<Listed>;
}

/** The world `world` with its snapshots, read as its owner; none when no world has the name. */
export const heldBefore = (world: string) =>
  Effect.gen(function* () {
    const found = yield* viewOrNone(world);
    if (Option.isNone(found)) return Option.none<Held>();
    const owner = yield* ownerOf(found.value);
    const record = yield* recordOf(owner);
    const snapshots = yield* snapshotsOf(world, owner);
    return Option.some<Held>({ world: found.value, owner, head: record.head, snapshots });
  });
