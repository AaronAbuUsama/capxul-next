// org.create, claim 6: bio and size are stored trimmed, and an over-long bio is refused. A bio of 281 characters is
// rejected by the payload's schema before it is sent (PayloadRejected, decisions.md, 43). It is tried first, while
// dana has no founding under way, so a handler that did run it would make a company.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { refusal, same } from "../support/expect.ts";
import { found, NORTHWIND_FOUNDING } from "../support/founding.ts";
import { head, thisView, unchangedRecord } from "../support/world.ts";

export const orgCreate6 = scenario(
  { operation: "org.create", claim: 6 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const before = yield* head;
    const long = { ...NORTHWIND_FOUNDING, profile: { ...NORTHWIND_FOUNDING.profile, bio: Str.repeat(281)("b") } };
    const rejected = yield* refusal(
      "org.create with a bio of 281 characters",
      "PayloadRejected",
      capxul["org.create"](long, { as: "dana" }),
    );
    yield* same("PayloadRejected's operation", rejected.operation, "org.create");
    yield* same("the companies after the long bio", (yield* thisView).companies, []);
    yield* unchangedRecord("the long bio", before);

    const padded = {
      ...NORTHWIND_FOUNDING,
      profile: { ...NORTHWIND_FOUNDING.profile, bio: "  We keep offices clean.  ", size: "  2-10  " },
    };
    const founded = yield* found(padded);
    yield* same("the stored bio", founded.profile.bio, "We keep offices clean.");
    yield* same("the stored size", founded.profile.size, "2-10");
    yield* same(
      "the companies",
      Arr.map((yield* thisView).companies, (each) => each.org),
      [founded.org],
    );
  }),
);
