// org.create, claim 4: the same intent resumes the same Organization; a changed intent or another founder refuses.
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { Capxul } from "../client.ts";
import { scenario } from "../scenario.ts";
import { answers, refusal, same } from "../support/expect.ts";
import { found, NORTHWIND_FOUNDING } from "../support/founding.ts";
import { head, thisView, unchangedRecord } from "../support/world.ts";

export const orgCreate4 = scenario(
  { operation: "org.create", claim: 4 },
  Effect.gen(function* () {
    const capxul = yield* Capxul;
    const founded = yield* found();
    const afterFounding = yield* head;

    const resumed = yield* answers(
      "the same org.create again",
      "Resumed",
      capxul["org.create"](NORTHWIND_FOUNDING, { as: "dana" }),
    );
    yield* same("the resumed org", resumed.org, founded.org);
    yield* same("the resumed handle", resumed.handle, founded.handle);
    yield* same("the resumed setup", resumed.setup, "awaiting_signatures");
    yield* same(
      "the approvals still to sign",
      Arr.map(resumed.approvals, (each) => each.id),
      Arr.map(founded.approvals, (each) => each.id),
    );
    yield* unchangedRecord("the resumed org.create", afterFounding);

    const renamed = { ...NORTHWIND_FOUNDING, profile: { ...NORTHWIND_FOUNDING.profile, name: "Northwind Holdings" } };
    const changed = yield* refusal(
      "org.create of northwind under another name",
      "FoundingChanged",
      capxul["org.create"](renamed, { as: "dana" }),
    );
    yield* same(
      "FoundingChanged",
      { handle: changed.handle, org: changed.org },
      { handle: "northwind", org: founded.org },
    );

    const taken = yield* refusal(
      "org.create of northwind by eli",
      "HandleTaken",
      capxul["org.create"]({ ...NORTHWIND_FOUNDING, directors: ["dana"] }, { as: "eli" }),
    );
    yield* same("HandleTaken's handle", taken.handle, "northwind");
    yield* unchangedRecord("the two refusals", afterFounding);

    const shown = yield* thisView;
    yield* same(
      "the companies world.show lists",
      Arr.map(shown.companies, (each) => each.org),
      [founded.org],
    );
  }),
);
