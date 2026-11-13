// world.show, claim 3: it shows a world's owner, grade, expiry, clock, record head, cast and companies, each company
// with its site's state. world.create's answer was given to whoever made the starting world, so world.show is
// compared with what that answer put in the record, the world's world_created, and with what `founded` holds.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { expect, scenario } from "../scenario.ts";
import { present, same, sameInstant } from "../support/expect.ts";
import { company, entriesOf, fieldOf, NORTHWIND, record, textOf, view } from "../support/world.ts";

export const worldShow3 = scenario(
  { operation: "world.show", claim: 3 },
  Effect.gen(function* () {
    const exported = yield* record;
    const shown = yield* view(exported.world);
    const born = yield* present(
      "the world's world_created",
      Option.getOrNull(
        Arr.findLast(entriesOf(exported.entries, "world_created"), (e) => textOf(e.carried, "world") === shown.world),
      ),
    );
    yield* same("the owner", shown.owner, textOf(born.carried, "owner"));
    yield* same("the grade", shown.grade, textOf(born.carried, "grade"));
    yield* sameInstant("the expiry", shown.expiresAt, textOf(born.carried, "expiresAt"));
    yield* same("the parent", shown.parent, fieldOf(born.carried, "parent"));
    yield* same("the clock's mode", shown.clock.mode, "frozen");
    yield* same("the record head", shown.recordHead, exported.head);
    const people = Arr.sort(
      Arr.map(shown.cast, (each) => each.person),
      Order.String,
    );
    yield* same("the cast", people, ["dana", "eli", "olga", "pat", "sam"]);
    yield* same(
      "the companies",
      Arr.map(shown.companies, (each) => each.handle),
      [NORTHWIND],
    );
    const northwind = yield* company(shown, NORTHWIND);
    yield* same("northwind's site", northwind.site.state, "ready");
    yield* expect(
      northwind.site.url !== null && northwind.site.url !== shown.door,
      `northwind's site is at ${northwind.site.url}, not an address of its own`,
    );
  }),
);
