// The checks of every world.list (claims.md, world.list 1 and 2): it answers the caller as owner and the platform's
// limit, and lists by name, each once and no more than the limit, worlds the caller owns, each as world.show shows it
// and with as many snapshots as world.snapshot.list lists. What the story alone knows (which worlds) is its steps'.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import { expect } from "../expectation.ts";
import { snapshotsOf } from "../support/inventory.ts";
import { same } from "../support/expect.ts";
import { LIMITS, operatorName, operatorOf, view } from "../support/world.ts";
import { check, checks } from "./format.ts";

export const worldList = checks<"world.list", void>({
  before: () => Effect.void,
  success: (asked, listed) => [
    check(
      "it answers the caller as owner and the platform's limit of live worlds",
      Effect.gen(function* () {
        yield* same("the owner listed", listed.owner, yield* operatorName(asked.options));
        yield* same("the limit", listed.limit, LIMITS.liveWorldsPerOwner);
      }),
    ),
    check(
      "it lists each world once, ordered by name, and no more than the limit",
      Effect.gen(function* () {
        const names = Arr.map(listed.worlds, (each) => each.world);
        yield* same("the worlds' names", names, Arr.sort(Arr.dedupe(names), Order.String));
        yield* expect(
          names.length <= listed.limit,
          `${names.length} worlds are listed; an owner may have ${listed.limit}`,
        );
      }),
    ),
    check(
      "each world listed is the caller's, as world.show shows it",
      Effect.forEach(
        listed.worlds,
        (each) =>
          Effect.gen(function* () {
            const shown = yield* view(each.world);
            yield* same(`${each.world}'s owner`, shown.owner, listed.owner);
            yield* same(
              `${each.world} as listed`,
              [each.grade, each.state, each.expiresAt, each.door, each.parent],
              [shown.grade, shown.state, shown.expiresAt, shown.door, shown.parent],
            );
          }),
        { discard: true },
      ),
    ),
    check(
      "each world's count of snapshots is what world.snapshot.list lists of it",
      Effect.forEach(
        listed.worlds,
        (each) =>
          Effect.flatMap(snapshotsOf(each.world, { operator: operatorOf(asked.options) }), (snapshots) =>
            same(`${each.world}'s snapshots`, each.snapshots, snapshots.length),
          ),
        { discard: true },
      ),
    ),
  ],
  refusals: {},
});
