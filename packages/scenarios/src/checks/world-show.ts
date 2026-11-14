// The checks of every world.show (claims.md, world.show 1 to 3): it answers the world asked as its own record tells
// it (its head, and its parent as its lineage), each company with its site's state, and a name with no world is
// refused naming it.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { expect } from "../expectation.ts";
import { same } from "../support/expect.ts";
import { ownerOf, recordOf } from "../support/world.ts";
import { check, checks } from "./format.ts";

export const worldShow = checks<"world.show", void>({
  before: () => Effect.void,
  success: (asked, shown) => [
    check("it answers the world asked", same("the world shown", shown.world, asked.payload.world)),
    check(
      "its record head and parent are its record's head and lineage, read as its owner",
      Effect.gen(function* () {
        const record = yield* recordOf(yield* ownerOf(shown));
        yield* same("the world its door answers for", record.world, shown.world);
        yield* same("the record head", shown.recordHead, record.head);
        yield* same("the parent", shown.parent, record.lineage);
      }),
    ),
    check(
      "a company whose site is ready has it at an address of its own",
      Effect.forEach(
        Arr.filter(shown.companies, (each) => each.site.state === "ready"),
        (each) =>
          expect(
            each.site.url !== null && each.site.url !== shown.door,
            `${each.handle}'s site is at ${each.site.url}, not an address of its own`,
          ),
        { discard: true },
      ),
    ),
  ],
  refusals: {
    WorldNotFound: (asked, refused) => [
      check("WorldNotFound names the world asked", same("its world", refused.world, asked.payload.world)),
    ],
  },
});
