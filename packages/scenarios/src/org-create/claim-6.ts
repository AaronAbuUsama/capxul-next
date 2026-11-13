// org.create, claim 6: bio and size are stored trimmed, and an over-long bio is refused. A bio of 281 characters is
// a shape fault, not a refusal (decisions.md, 9): the call must fail without any declared refusal, which would mean
// a handler ran, and leave no company and no entry. It is tried first, while dana has no founding under way.
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Str from "effect/String";
import { Capxul } from "../client.ts";
import { expect, scenario } from "../scenario.ts";
import { same, show } from "../support/expect.ts";
import { found, NORTHWIND_FOUNDING } from "../support/founding.ts";
import { head, thisView, unchangedRecord } from "../support/world.ts";

export const orgCreate6 = scenario(
  { operation: "org.create", claim: 6 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const before = yield* head;
    const long = { ...NORTHWIND_FOUNDING, profile: { ...NORTHWIND_FOUNDING.profile, bio: Str.repeat(281)("b") } };
    const rejected = yield* Effect.exit(capxul["org.create"](long, { as: "dana" }));
    yield* expect(
      Exit.isFailure(rejected) && !Cause.hasFails(rejected.cause),
      `org.create with a bio of 281 characters must be rejected by its schema; it gave ${show(rejected)}`,
    );
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
